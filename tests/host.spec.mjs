/**
 * Host-side smoke tests for the opencode-omo role registry + authenticated RPC
 * surface. Uses a bare in-memory settings provider and mock webServer /
 * connection services, so no dsh profile is required.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import {
  OMO_DEFAULT_ROLE,
  OMO_RPC_CHANNEL,
  OMO_RPC_ENDPOINTS,
  apply,
  inject,
  name,
} from '../lib/index.js'

class MemorySettings extends SettingsProvider {
  doc = {}
  get writable() { return true }
  load() { return Promise.resolve(structuredClone(this.doc)) }
  persist(ns, section) {
    this.doc[ns] = structuredClone(section)
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
  name: 'memory-settings',
  inject: [],
  apply(ctx) { ctx.plugin(MemorySettings) },
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

async function boot() {
  const ctx = new Context()
  await ctx.plugin(settingsPlugin)
  await ctx.plugin(webPlugin)
  await ctx.plugin(connectionPlugin)
  await ctx.plugin(llmPlugin)
  await ctx.plugin({ name, inject, apply })
  const web = ctx.get('webServer')
  const connection = ctx.get('connection')
  assert.ok(web)
  assert.ok(connection)
  return { ctx, web, connection }
}

/** Invoke the recorded logical RPC handler directly. */
async function callRpc(connection, endpoint, payload) {
  assert.equal(connection.channel, OMO_RPC_CHANNEL)
  assert.equal(typeof connection.handler, 'function')
  return connection.handler(endpoint, payload)
}

/**
 * Boot the host half in the boot-probe composition: `settings` + `llm` (the
 * registry's own dependency), with neither `webServer` nor `connection`
 * mounted. The plugin owns no HTTP route, so this is a valid host composition
 * and must activate.
 */
async function bootHeadless() {
  const ctx = new Context()
  await ctx.plugin(settingsPlugin)
  await ctx.plugin(llmPlugin)
  await ctx.plugin({ name, inject, apply })
  assert.equal(ctx.get('webServer'), undefined)
  assert.equal(ctx.get('connection'), undefined)
  return ctx
}

test('registers the role registry and settings namespace', async () => {
  const { ctx } = await boot()
  const roles = ctx.omoRoles
  assert.equal(roles.roleFor('session-a'), OMO_DEFAULT_ROLE)
  assert.equal(roles.configs()['sisyphus'].fallbackModels.length, 0)
})

test('activates without webServer or connection (headless composition)', async () => {
  assert.ok(!inject.includes('webServer'))
  const ctx = await bootHeadless()
  assert.ok(ctx.omoRoles)
  assert.equal(ctx.omoRoles.roleFor('session-a'), OMO_DEFAULT_ROLE)
  await ctx.omoRoles.setRole('session-a', 'atlas')
  assert.equal(ctx.omoRoles.roleFor('session-a'), 'atlas')
})

test('persists per-role model config and returns it through the registry', async () => {
  const { ctx } = await boot()
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
  assert.equal(ctx.omoRoles.configFor('sisyphus').fallbackModels.length, 0)
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
