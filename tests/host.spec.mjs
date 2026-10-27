/**
 * Host-side smoke tests for the opencode-omo role registry.
 *
 * The 0.2.1 host row owns `roles` / `sessions` as volatile config fields; the
 * browser edits them through the official settings form. These tests exercise
 * the registry against an in-memory settings service + live-looking refs, so no
 * dsh profile is required.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { OMO_DEFAULT_ROLE, OmoRoleRegistry } from '../lib/index.js'

class MockSettings extends Service {
  state = { roles: {}, sessions: {} }
  constructor(ctx) {
    super(ctx, 'settings')
  }
  configure() { return () => {} }
  async update(_ns, patch) {
    this.state = { ...this.state, ...structuredClone(patch) }
  }
  async mutate(_ns, ops) {
    const next = structuredClone(this.state)
    for (const op of ops) {
      if (op.op !== 'set') continue
      let node = next
      for (const key of op.path.slice(0, -1)) {
        if (node[key] === undefined || typeof node[key] !== 'object') node[key] = {}
        node = node[key]
      }
      node[op.path.at(-1)] = structuredClone(op.value)
    }
    this.state = next
  }
}

class MockLlm extends Service {
  constructor(ctx) {
    super(ctx, 'llm')
  }
  listProviders() { return [{ id: 'openai' }] }
  async listModels() { return [{ id: 'gpt-5.5' }, { id: 'deepseek-v4-flash' }] }
}

const settingsPlugin = { name: 'memory-settings', inject: [], apply(ctx) { ctx.plugin(MockSettings) } }
const llmPlugin = { name: 'mock-llm', inject: [], apply(ctx) { ctx.plugin(MockLlm) } }

async function boot() {
  const ctx = new Context()
  await ctx.plugin(settingsPlugin)
  await ctx.plugin(llmPlugin)
  const settings = ctx.settings
  const config = {
    roles: { get: () => settings.state.roles },
    sessions: { get: () => settings.state.sessions },
  }
  await ctx.plugin(OmoRoleRegistry, { config })
  return { ctx, settings }
}

test('registers the role registry with an empty role config', async () => {
  const { ctx } = await boot()
  assert.equal(ctx.omoRoles.roleFor('session-a'), OMO_DEFAULT_ROLE)
  assert.equal(ctx.omoRoles.configs()['sisyphus'].fallbackModels.length, 0)
})

test('persists per-role model config through the settings service', async () => {
  const { ctx, settings } = await boot()
  await ctx.omoRoles.setRoleConfig('prometheus', {
    model: { provider: 'deepseek-official', model: 'deepseek-v4' },
    fallbackModels: [
      { provider: 'deepseek-official', model: 'deepseek-v3.2' },
      { provider: 'pi-ai', model: 'gpt-5.5' },
    ],
  })
  const config = ctx.omoRoles.configFor('prometheus')
  assert.deepEqual(config.model, { provider: 'deepseek-official', model: 'deepseek-v4' })
  assert.equal(config.fallbackModels.length, 2)
  assert.equal(settings.state.roles.prometheus.fallbackModels.length, 2)
  assert.equal(ctx.omoRoles.configFor('sisyphus').fallbackModels.length, 0)
})

test('resolves omo-default primary and post-primary fallback chains', async () => {
  const { ctx } = await boot()
  await ctx.omoRoles.refreshDefaultFallbacks()
  const primary = ctx.omoRoles.primaryModelFor('hephaestus')
  assert.deepEqual(primary, { provider: 'openai', model: 'gpt-5.5' })
  assert.equal(ctx.omoRoles.fallbackModelsFor('hephaestus').length, 0)
})

test('explicit follow-session model keeps the session route', async () => {
  const { ctx } = await boot()
  await ctx.omoRoles.refreshDefaultFallbacks()
  await ctx.omoRoles.setRoleConfig('hephaestus', { model: null, fallbackModels: [] })
  assert.equal(ctx.omoRoles.primaryModelFor('hephaestus'), undefined)
  assert.equal(ctx.omoRoles.fallbackModelsFor('hephaestus').length, 0)
})

test('setRoleConfig can clear a pin back to the omo-default route', async () => {
  const { ctx } = await boot()
  await ctx.omoRoles.refreshDefaultFallbacks()
  await ctx.omoRoles.setRoleConfig('hephaestus', { model: null, fallbackModels: [] })
  assert.equal(ctx.omoRoles.primaryModelFor('hephaestus'), undefined)
  await ctx.omoRoles.setRoleConfig('hephaestus', { fallbackModels: [] })
  assert.deepEqual(ctx.omoRoles.primaryModelFor('hephaestus'), { provider: 'openai', model: 'gpt-5.5' })
})

test('persists step budget and ultrawork override on a role config', async () => {
  const { ctx } = await boot()
  await ctx.omoRoles.setRoleConfig('sisyphus', {
    fallbackModels: [],
    maxSteps: 12,
    ultrawork: {
      model: { provider: 'openai', model: 'gpt-5.5', reasoningEffort: 'high' },
    },
  })
  const config = ctx.omoRoles.configFor('sisyphus')
  assert.equal(config.maxSteps, 12)
  assert.equal(config.ultrawork.model.provider, 'openai')
  assert.equal(config.ultrawork.model.reasoningEffort, 'high')
})

test('persists a session role through the settings service', async () => {
  const { ctx, settings } = await boot()
  await ctx.omoRoles.setRole('session-a', 'atlas')
  assert.equal(ctx.omoRoles.roleFor('session-a'), 'atlas')
  assert.equal(settings.state.sessions['session-a'], 'atlas')
})

test('rejects unknown roles through the registry', async () => {
  const { ctx } = await boot()
  await assert.rejects(ctx.omoRoles.setRole('session-a', 'unknown'))
  await assert.rejects(ctx.omoRoles.setRoleConfig('unknown', { fallbackModels: [] }))
})

test('pinRole applies synchronously for a child session', async () => {
  const { ctx } = await boot()
  ctx.omoRoles.pinRole('child-session', 'oracle')
  assert.equal(ctx.omoRoles.roleFor('child-session'), 'oracle')
  assert.throws(() => ctx.omoRoles.pinRole('child-session', 'unknown'))
})
