/**
 * Host-side smoke tests for the opencode-omo role registry + authenticated RPC
 * surface. Uses a mock 0.1.7 `settings` service (Config-derived forms) and mock
 * webServer / connection services, so no dsh profile is required.
 *
 * The harness SettingsForms owns schema/persistence; this mock only records the
 * entry-scoped `update(ns, patch)` calls AND folds them into the same volatile
 * references the plugin's Config would expose, which is what the real Loader
 * does for a volatile-only config change.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import {
  OMO_DEFAULT_ROLE,
  OMO_ROLE_SETTINGS_NAMESPACE,
  OMO_RPC_CHANNEL,
  OMO_RPC_ENDPOINTS,
  apply,
  inject,
  name,
} from '../lib/index.js'

class MockSettings extends Service {
  constructor(ctx) {
    super(ctx, 'settings')
    /** Persisted entry configs, keyed by profile entry id. */
    this.entries = {}
    /** Folded live Config values (one object per volatile field). */
    this.live = { roles: {}, sessions: {} }
    this.presentations = []
  }
  get writable() { return true }
  configure(presentation) {
    this.presentations.push(presentation)
    return () => {}
  }
  async update(ns, patch) {
    this.entries[ns] = { ...(this.entries[ns] ?? {}), ...structuredClone(patch) }
    if (patch.roles !== undefined) this.live.roles = this.entries[ns].roles
    if (patch.sessions !== undefined) this.live.sessions = this.entries[ns].sessions
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

class MockConnection extends Service {
  channel = undefined
  handler = undefined
  constructor(ctx) {
    super(ctx, 'connection')
  }
  get rpc() {
    return {
      handle: (channel, handler) => {
        this.channel = channel
        this.handler = handler
        return () => {
          this.channel = undefined
          this.handler = undefined
        }
      },
    }
  }
}

/** Mock app-boot `profileContext` (only the paths the seam probe reads). */
class MockProfile extends Service {
  constructor(ctx, facts) {
    super(ctx, 'profileContext')
    Object.assign(this, facts)
  }
}

class MockLlm extends Service {
  constructor(ctx) {
    super(ctx, 'llm')
  }
  listProviders() {
    return [{ id: 'openai' }]
  }
  async listModels() {
    return [{ id: 'gpt-5.5' }, { id: 'deepseek-v4-flash' }]
  }
}

const settingsPlugin = {
  name: 'mock-settings',
  inject: [],
  apply(ctx) { ctx.plugin(MockSettings) },
}

const webPlugin = {
  name: 'mock-web-server',
  inject: [],
  apply(ctx) { ctx.plugin(MockWebServer) },
}

const connectionPlugin = {
  name: 'mock-connection',
  inject: [],
  apply(ctx) { ctx.plugin(MockConnection) },
}

const llmPlugin = {
  name: 'mock-llm',
  inject: [],
  apply(ctx) { ctx.plugin(MockLlm) },
}

async function boot(profileFacts) {
  const ctx = new Context()
  await ctx.plugin(settingsPlugin)
  await ctx.plugin(webPlugin)
  await ctx.plugin(connectionPlugin)
  await ctx.plugin(llmPlugin)
  if (profileFacts !== undefined) {
    await ctx.plugin({ name: 'mock-profile', inject: [], apply: host => { host.plugin(MockProfile, profileFacts) } })
  }
  const settings = ctx.get('settings')
  // The plugin's Config fields are volatile on 0.1.7; hand the apply the same
  // stable references the Loader would, backed by the mock's live store.
  await ctx.plugin({ name, inject, apply }, {
    roles: { get: () => settings.live.roles },
    sessions: { get: () => settings.live.sessions },
  })
  const web = ctx.get('webServer')
  const connection = ctx.get('connection')
  assert.ok(web)
  assert.ok(connection)
  return { ctx, web, connection, settings }
}

/** Invoke the recorded logical RPC handler directly. */
async function callRpc(connection, endpoint, payload) {
  assert.equal(connection.channel, OMO_RPC_CHANNEL)
  assert.equal(typeof connection.handler, 'function')
  return connection.handler(endpoint, payload)
}

test('registers the role registry and settings namespace', async () => {
  const { ctx, settings } = await boot()
  const roles = ctx.omoRoles
  assert.equal(roles.roleFor('session-a'), OMO_DEFAULT_ROLE)
  assert.equal(roles.configs()['sisyphus'].fallbackModels.length, 0)
  // This plugin ships its own settings page; the auto-generated raw-Config
  // page for the entry must be turned off.
  assert.deepEqual(settings.presentations, [{ auto: false }])
})

test('persists per-role model config into the entry Config', async () => {
  const { ctx, settings } = await boot()
  await ctx.omoRoles.setRoleConfig('prometheus', {
    model: { provider: 'deepseek-official', model: 'deepseek-v4' },
    fallbackModels: [
      { provider: 'deepseek-official', model: 'deepseek-v3.2' },
      { provider: 'pi-ai', model: 'gpt-5.5' },
    ],
  })
  // The write lands in the documented profile-entry namespace, in the stored
  // shape (`model` present, never collapsed to absent).
  const stored = settings.entries[OMO_ROLE_SETTINGS_NAMESPACE]
  assert.deepEqual(stored.roles.prometheus.model, { provider: 'deepseek-official', model: 'deepseek-v4' })
  const config = ctx.omoRoles.configFor('prometheus')
  assert.deepEqual(config.model, { provider: 'deepseek-official', model: 'deepseek-v4' })
  assert.equal(config.fallbackModels.length, 2)
  assert.equal(ctx.omoRoles.configFor('sisyphus').fallbackModels.length, 0)
})

test('an unconfigured role keeps the omo-default primary (model absent)', async () => {
  const { ctx, settings } = await boot()
  await ctx.omoRoles.refreshDefaultFallbacks()
  await ctx.omoRoles.setRoleConfig('sisyphus', { fallbackModels: [] })
  const stored = settings.entries[OMO_ROLE_SETTINGS_NAMESPACE].roles.sisyphus
  assert.equal(stored.model, null)
  // A different role never written stays absent and resolves omo defaults.
  assert.equal(settings.entries[OMO_ROLE_SETTINGS_NAMESPACE].roles.hephaestus, undefined)
  assert.equal(ctx.omoRoles.primaryModelFor('hephaestus').model, 'gpt-5.5')
})

test('resolves omo-default primary and post-primary fallback chains', async () => {
  const { ctx } = await boot()
  await ctx.omoRoles.refreshDefaultFallbacks()
  const primary = ctx.omoRoles.primaryModelFor('hephaestus')
  assert.deepEqual(primary, { provider: 'openai', model: 'gpt-5.5' })
  // The omo default primary is also the first available chain entry, so the
  // effective fallback chain starts AFTER it (omo attachFallbackModels).
  assert.equal(ctx.omoRoles.fallbackModelsFor('hephaestus').length, 0)
})

test('explicit follow-session model keeps the session route', async () => {
  const { ctx } = await boot()
  await ctx.omoRoles.refreshDefaultFallbacks()
  await ctx.omoRoles.setRoleConfig('hephaestus', { model: null, fallbackModels: [] })
  assert.equal(ctx.omoRoles.primaryModelFor('hephaestus'), undefined)
  assert.equal(ctx.omoRoles.fallbackModelsFor('hephaestus').length, 0)
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

test('registers the authenticated RPC channel and no raw /plugins routes', async () => {
  const { web, connection } = await boot()
  assert.equal(connection.channel, OMO_RPC_CHANNEL)
  assert.equal(typeof connection.handler, 'function')
  assert.equal(web.routes.has('/plugins/@royenheart/dsh-plugin-opencode-omo/roles'), false)
  assert.equal(web.routes.has('/plugins/@royenheart/dsh-plugin-opencode-omo/role'), false)
  assert.equal(web.routes.has('/plugins/@royenheart/dsh-plugin-opencode-omo/role-config'), false)
})

test('serves the role catalog through the RPC channel', async () => {
  const { connection } = await boot()
  const result = await callRpc(connection, OMO_RPC_ENDPOINTS.catalogGet, {})
  assert.equal(result.ok, true)
  assert.equal(result.value.defaultRole, OMO_DEFAULT_ROLE)
  assert.ok(Array.isArray(result.value.roles))
  assert.ok(result.value.roles.length > 0)
})

test('persists a session role through the RPC channel', async () => {
  const { ctx, connection } = await boot()
  const result = await callRpc(connection, OMO_RPC_ENDPOINTS.roleSet, { sessionId: 'session-a', role: 'atlas' })
  assert.equal(result.ok, true)
  assert.equal(result.value.currentRole, 'atlas')
  assert.equal(ctx.omoRoles.roleFor('session-a'), 'atlas')
})

test('rejects unknown roles through the RPC channel', async () => {
  const { connection } = await boot()
  const result = await callRpc(connection, OMO_RPC_ENDPOINTS.roleSet, { sessionId: 'session-a', role: 'nope' })
  assert.equal(result.ok, false)
})

test('saves role config through the RPC channel', async () => {
  const { ctx, connection } = await boot()
  const result = await callRpc(connection, OMO_RPC_ENDPOINTS.roleConfigSet, {
    role: 'momus',
    config: {
      model: null,
      fallbackModels: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }],
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.value.config.fallbackModels.length, 1)
  assert.equal(ctx.omoRoles.configFor('momus').model, undefined)
})

test('probes the running installation for the assistant-prefill seam', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omo-seam-'))
  try {
    const loopDir = join(dir, 'node_modules', '@deepseek-ai', 'dsh-agent-loop')
    mkdirSync(loopDir, { recursive: true })
    writeFileSync(join(loopDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-agent-loop', main: 'index.js' }))
    writeFileSync(join(loopDir, 'index.js'), 'export const assistantPrefill = true\n')
    const { ctx } = await boot({ installAnchor: join(dir, 'package.json') })
    assert.equal(ctx.omoRoles.honorsAssistantPrefill(), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('reports no assistant-prefill seam without a patched installation', async () => {
  const { ctx } = await boot()
  assert.equal(ctx.omoRoles.honorsAssistantPrefill(), false)
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
