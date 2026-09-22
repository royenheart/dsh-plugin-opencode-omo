/**
 * Cross-preset isolation as a before/after catalog snapshot.
 *
 * Sibling standing scopes (minimal, standard, code, online, cordis) and the
 * unscoped global view must be byte-identical after this plugin's host row
 * and preset surface load. Catalogs are compared as data — prompt sections, tool schemas,
 * skill summaries, command descriptors — so adding an omo tool, skill, or
 * command does not require a test edit. A leak into another preset fails
 * the deep equality; a silent no-op load fails because the omo catalog
 * must actually diverge.
 *
 * This is the CI-stable isolation contract. It boots the same registries
 * a session uses (tools, systemPrompt, skills, commands) rather than
 * asserting named rows. A full two-process dsh boot would need DSH_ROOT
 * plus an inspect RPC and is left to the benches.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Context, Service } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { apply as applyHost, inject as hostInject, name as hostName } from '../lib/index.js'
import { apply as applyCommentChecker } from '../presets/opencode-omo/comment-checker.mjs'

const require = createRequire(import.meta.url)

const SIBLINGS = ['minimal', 'standard', 'code', 'online', 'cordis']
const PRESET_MODULES = [
  '../presets/opencode-omo/omo-skills.mjs',
  '../presets/opencode-omo/omo-commands.mjs',
  '../presets/opencode-omo/comment-checker.mjs',
  '../presets/opencode-omo/permission-rules.mjs',
  '../presets/opencode-omo/apply-patch.mjs',
  '../presets/opencode-omo/hashline.mjs',
  '../presets/opencode-omo/tool-surface.mjs',
  '../presets/opencode-omo/delegation-surface.mjs',
  '../presets/opencode-omo/lsp-surface.mjs',
  '../presets/opencode-omo/start-work-continuation.mjs',
  '../presets/opencode-omo/task-shim.mjs',
  '../presets/opencode-omo/driver.mjs',
  '../presets/opencode-omo/escalating-bash.mjs',
]

async function importPeer(fromPackage, name) {
  const pkgJson = require.resolve(`${fromPackage}/package.json`)
  const entry = require.resolve(name, { paths: [pkgJson] })
  return import(entry)
}

function hostInsert() {
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  return patch.split('\n- insert:\n')[1] ?? ''
}

function dshTool(name, parameters) {
  return defineTool({
    name,
    description: `dsh ${name}`,
    parameters,
    output: {
      schema: { type: 'json' },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    execute: async () => ({}),
  })
}

function hasService(ctx, name) {
  try {
    return ctx.get(name) !== undefined
  } catch {
    return false
  }
}

function injectSatisfied(ctx, plugin) {
  return (plugin.inject ?? []).every(name => hasService(ctx, name))
}

function sortByName(items) {
  return [...items].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
}

function skillCatalog(skills) {
  return sortByName(skills.map(skill => ({
    name: skill.name,
    description: skill.description,
    source: skill.source,
    provider: skill.provider,
    invocation: skill.invocation,
    ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
  })))
}

function commandCatalog(commands) {
  return sortByName(commands.map(command => ({
    name: command.name,
    description: command.description,
  })))
}

function toolCatalog(schemas) {
  return sortByName(schemas.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  })))
}

function promptCatalog(assembly) {
  return {
    sections: assembly.sections.map(section => ({ name: section.name, text: section.text })),
    contexts: assembly.contexts.map(context => ({ name: context.name, text: context.text })),
    tools: toolCatalog(assembly.tools),
    variables: { ...assembly.variables },
  }
}

class StubFs extends Service {
  constructor(ctx) {
    super(ctx, 'fs')
  }
}

/** Mock 0.1.7 `settings` (Config-derived forms): record entry patches. */
class MemorySettings extends Service {
  constructor(ctx) {
    super(ctx, 'settings')
    this.entries = {}
    this.live = { roles: {}, sessions: {} }
  }
  configure() { return () => {} }
  update(ns, patch) {
    this.entries[ns] = { ...(this.entries[ns] ?? {}), ...structuredClone(patch) }
    if (patch.roles !== undefined) this.live.roles = this.entries[ns].roles
    if (patch.sessions !== undefined) this.live.sessions = this.entries[ns].sessions
    return Promise.resolve()
  }
}

class MockWebServer extends Service {
  routes = new Map()
  constructor(ctx) {
    super(ctx, 'webServer')
  }
  register(route) {
    this.routes.set(route.path, route.handler)
    return () => { this.routes.delete(route.path) }
  }
}

class MockLlm extends Service {
  constructor(ctx) {
    super(ctx, 'llm')
  }
  listProviders() { return [] }
  async listModels() { return [] }
}

async function mintScope(ctx, createScope, id, inject) {
  const key = { id }
  let scope
  await ctx.plugin(Object.assign(
    inner => { scope = createScope(inner, key) },
    { inject },
  ))
  return { scope, key }
}

async function loadOmoPreset(scopeCtx) {
  const loaded = []
  for (const specifier of PRESET_MODULES) {
    const plugin = await import(specifier)
    if (!injectSatisfied(scopeCtx, plugin)) continue
    await scopeCtx.plugin(plugin)
    loaded.push(plugin.name ?? specifier)
  }
  scopeCtx.emit('agent/created', { agent: { ctx: scopeCtx } })
  return loaded
}

async function loadHostPlugin(ctx) {
  if (!injectSatisfied(ctx, { inject: hostInject })) return false
  await ctx.plugin({ name: hostName, inject: hostInject, apply: applyHost })
  return true
}

function emptySurface() {
  return { tools: null, prompt: null, skills: null, commands: null }
}

async function snapshotSurface(ctx, key) {
  const surface = emptySurface()
  if (hasService(ctx, 'tools')) {
    surface.tools = toolCatalog(ctx.tools.schemas(key))
  }
  if (hasService(ctx, 'systemPrompt')) {
    surface.prompt = promptCatalog(await ctx.systemPrompt.assemble(key === undefined ? {} : { scope: key }))
  }
  if (hasService(ctx, 'skills')) {
    surface.skills = skillCatalog(await ctx.skills.list(key === undefined ? {} : { scope: key }))
  }
  if (hasService(ctx, 'commands')) {
    surface.commands = commandCatalog(ctx.commands.list(key ?? {}))
  }
  return surface
}

async function snapshotViews(ctx, keys) {
  const views = { global: await snapshotSurface(ctx, undefined) }
  for (const [name, key] of Object.entries(keys)) {
    views[name] = await snapshotSurface(ctx, key)
  }
  return views
}

function assertSiblingCatalogsFrozen(before, after) {
  assert.deepEqual(after.global, before.global, 'global catalog changed after loading opencode-omo')
  for (const name of SIBLINGS) {
    assert.deepEqual(after[name], before[name], `${name} catalog changed after loading opencode-omo`)
  }
}

function assertOmoDiverged(before, after) {
  assert.notDeepEqual(after.omo, before.omo, 'omo catalog did not change; preset plugins did not load')
  assert.notDeepEqual(after.omo, after.minimal, 'omo catalog matches minimal; isolation test is vacuous')
}

test('host bundle patch inserts only the role-registry row, no tools', () => {
  const insert = hostInsert()
  assert.match(insert, /id: opencode-omo-roles/)
  assert.match(insert, /name: '@royenheart\/dsh-plugin-opencode-omo'/)
  assert.equal([...insert.matchAll(/^\s+- id:/gm)].length, 1)
})

test('omo agent-plane modules live in the preset composition, not the host patch', () => {
  const preset = readFileSync(new URL('../presets/opencode-omo/agent.cordis.yml', import.meta.url), 'utf8')
  const insert = hostInsert()
  for (const module of [
    './apply-patch.mjs',
    './hashline.mjs',
    './task-shim.mjs',
    './delegation-surface.mjs',
    './lsp-surface.mjs',
    './start-work-continuation.mjs',
    './omo-skills.mjs',
    './omo-commands.mjs',
    './driver.mjs',
    './tool-surface.mjs',
  ]) {
    assert.match(preset, new RegExp(module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(insert, new RegExp(module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(preset, /toolName:/)
  assert.doesNotMatch(insert, /toolName:/)
})

test('named-role deny lists that block task also block call_omo_agent and plan', () => {
  const preset = readFileSync(new URL('../presets/opencode-omo/agent.cordis.yml', import.meta.url), 'utf8')
  const blocks = [...preset.matchAll(/deny:\n((?:            - .+\n)+)/g)].map(match => match[1])
  assert.ok(blocks.length >= 9, `expected named deny lists, got ${blocks.length}`)
  let taskBlocks = 0
  for (const block of blocks) {
    if (!block.includes('- task\n')) continue
    taskBlocks += 1
    assert.match(block, /call_omo_agent/)
    assert.match(block, /- plan\n/)
  }
  assert.ok(taskBlocks >= 9, `expected task deny lists, got ${taskBlocks}`)
})

test('sibling tools and prompts stay identical after this plugin loads', async () => {
  const { createScope } = await importPeer('@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-scope')
  const { default: SystemPrompt } = await importPeer('@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-system-prompt')
  const ctx = new Context()
  await ctx.plugin({ name: 'memory-settings', apply(host) { host.plugin(MemorySettings) } })
  await ctx.plugin({ name: 'mock-web-server', apply(host) { host.plugin(MockWebServer) } })
  await ctx.plugin({ name: 'mock-llm', apply(host) { host.plugin(MockLlm) } })
  await ctx.plugin({ name: 'stub-fs', apply(host) { host.plugin(StubFs) } })
  await ctx.plugin(SystemPrompt, { persona: 'You are a helpful software engineer assistant.' })
  await ctx.plugin(ToolRuntime)
  ctx.systemPrompt.context({ name: 'runtime:cwd', order: 0, text: '/workspace' })

  const inject = ['tools', 'systemPrompt', 'fs']
  const omo = await mintScope(ctx, createScope, 'opencode-omo', inject)
  const keys = { omo: omo.key }
  const scopes = [omo.scope]
  for (const id of SIBLINGS) {
    const minted = await mintScope(ctx, createScope, id, inject)
    keys[id] = minted.key
    scopes.push(minted.scope)
  }

  ctx.tools.register(dshTool('read', {
    file_path: { type: 'string', required: true, description: 'dsh path' },
  }))
  ctx.tools.register(dshTool('edit', {
    file_path: { type: 'string', required: true },
    old_string: { type: 'string', required: true },
    new_string: { type: 'string', required: true },
  }))
  ctx.tools.register(dshTool('write', {
    file_path: { type: 'string', required: true },
    content: { type: 'string', required: true },
  }))
  ctx.tools.register(dshTool('web_search', {
    queries: { type: 'array', required: true, items: { type: 'string' } },
  }))
  ctx.tools.register(dshTool('bash', {
    command: { type: 'string', required: true },
  }))

  const before = await snapshotViews(ctx, keys)
  const hostLoaded = await loadHostPlugin(ctx)
  const loaded = await loadOmoPreset(omo.scope.ctx)
  assert.equal(hostLoaded, true)
  assert.ok(loaded.includes('opencode-omo-tool-surface'), `expected tool-surface, loaded ${loaded.join(', ')}`)
  assert.ok(loaded.includes('opencode-omo-loop'), `expected driver, loaded ${loaded.join(', ')}`)
  assert.ok(loaded.includes('opencode-omo-lsp-surface'), `expected lsp-surface, loaded ${loaded.join(', ')}`)
  const after = await snapshotViews(ctx, keys)

  assertSiblingCatalogsFrozen(before, after)
  assertOmoDiverged(before, after)

  for (const scope of scopes) await scope.dispose()
  await ctx.fiber.dispose()
})

test('sibling skill catalogs stay identical after this plugin loads', async () => {
  const { createScope } = await importPeer('@deepseek-ai/dsh-skill', '@deepseek-ai/dsh-scope')
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  ctx.skills.register({
    name: 'baseline-skill',
    description: 'shared baseline skill',
    source: 'user-dsh',
    content: 'do nothing',
  })

  const inject = ['skills']
  const omo = await mintScope(ctx, createScope, 'opencode-omo', inject)
  const keys = { omo: omo.key }
  const scopes = [omo.scope]
  for (const id of SIBLINGS) {
    const minted = await mintScope(ctx, createScope, id, inject)
    keys[id] = minted.key
    scopes.push(minted.scope)
  }

  const before = await snapshotViews(ctx, keys)
  const loaded = await loadOmoPreset(omo.scope.ctx)
  assert.ok(loaded.includes('omo-skills'), `expected omo-skills, loaded ${loaded.join(', ')}`)
  const after = await snapshotViews(ctx, keys)

  assertSiblingCatalogsFrozen(before, after)
  assertOmoDiverged(before, after)

  for (const scope of scopes) await scope.dispose()
  await ctx.fiber.dispose()
})

test('sibling command catalogs stay identical after this plugin loads', async () => {
  const { createScope } = await importPeer('@deepseek-ai/dsh-skill', '@deepseek-ai/dsh-scope')
  const { default: CommandRuntime } = await importPeer('@deepseek-ai/dsh-skill', '@deepseek-ai/dsh-commands')
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  ctx.commands.register({
    name: 'help',
    description: 'shared baseline command',
    handler: () => ({ kind: 'success' }),
  })

  const inject = ['commands']
  const omo = await mintScope(ctx, createScope, 'opencode-omo', inject)
  const keys = { omo: omo.key }
  const scopes = [omo.scope]
  for (const id of SIBLINGS) {
    const minted = await mintScope(ctx, createScope, id, inject)
    keys[id] = minted.key
    scopes.push(minted.scope)
  }

  const before = await snapshotViews(ctx, keys)
  const loaded = await loadOmoPreset(omo.scope.ctx)
  assert.ok(loaded.includes('opencode-omo-commands'), `expected omo-commands, loaded ${loaded.join(', ')}`)
  const after = await snapshotViews(ctx, keys)

  assertSiblingCatalogsFrozen(before, after)
  assertOmoDiverged(before, after)

  for (const scope of scopes) await scope.dispose()
  await ctx.fiber.dispose()
})

test('comment-checker pre-execute only runs in the omo scope', async () => {
  const { createScope, scopeTarget } = await importPeer('@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-scope')
  const { default: SystemPrompt } = await importPeer('@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-system-prompt')
  const ctx = new Context()
  await ctx.plugin({ name: 'stub-fs', apply(host) { host.plugin(StubFs) } })
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)

  const inject = ['tools', 'systemPrompt', 'fs']
  const omo = await mintScope(ctx, createScope, 'opencode-omo', inject)
  const minimal = await mintScope(ctx, createScope, 'minimal', inject)
  applyCommentChecker(omo.scope.ctx)

  const slop = {
    name: 'edit',
    arguments: { newString: '// obviously the default\nreturn 1' },
  }
  const allow = () => Promise.resolve({ kind: 'allow' })

  const omoDecision = await ctx.waterfall(scopeTarget(ctx.tools, omo.key), 'tools/pre-execute', slop, allow)
  const minimalDecision = await ctx.waterfall(scopeTarget(ctx.tools, minimal.key), 'tools/pre-execute', slop, allow)

  assert.equal(omoDecision.kind, 'deny')
  assert.match(omoDecision.reason, /AI-slop comment rejected/)
  assert.equal(minimalDecision.kind, 'allow')

  await omo.scope.dispose()
  await minimal.scope.dispose()
  await ctx.fiber.dispose()
})
