/**
 * English (_en) host-entry behavior tests.
 *
 * The _en entry must be a drop-in for the original: same plugin identity,
 * same service inject, the SAME settings namespace (so configuration made
 * through either variant keeps working), and an English role catalog served
 * over the same endpoints.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { OMO_ROLES } from '../src/core/omo-roles.ts'
import {
  OMO_DEFAULT_ROLE,
  OMO_JSON_ENDPOINT,
  OMO_JSON_IMPORT_ENDPOINT,
  OMO_ROLE_SETTINGS_NAMESPACE,
  ROLES_ENDPOINT,
  ROLE_ENDPOINT,
  ROLE_CONFIG_ENDPOINT,
  apply,
  inject,
  name,
} from '../src/index_en.ts'
import { OMO_ROLE_SETTINGS_NAMESPACE as ORIGINAL_NAMESPACE } from '../src/index.ts'
const CJK_RE = /[\u2E80-\u2FFF\u31C0-\u31EF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/


class MemorySettings extends SettingsProvider {
  constructor(ctx, sharedDoc) {
    super(ctx)
    this.doc = sharedDoc ?? {}
  }
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

async function boot(sharedDoc) {
  const ctx = new Context()
  await ctx.plugin({ name: 'memory-settings', inject: [], apply(c) { c.plugin(MemorySettings, sharedDoc) } })
  await ctx.plugin({ name: 'mock-web-server', inject: [], apply(c) { c.plugin(MockWebServer) } })
  await ctx.plugin({ name: 'mock-llm', inject: [], apply(c) { c.plugin(MockLlm) } })
  await ctx.plugin({ name, inject, apply })
  const web = ctx.get('webServer')
  assert.ok(web)
  return { ctx, web }
}

function jsonResponse(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function call(web, path, body) {
  const req = new EventEmitter()
  req.method = body === undefined ? 'GET' : 'POST'
  req.url = body === undefined ? path : undefined
  let status = 200
  let payload = ''
  const res = new EventEmitter()
  res.writeHead = (code) => { status = code }
  res.end = (chunk) => { payload = typeof chunk === 'string' ? chunk : '' }
  const handler = web.routes.get(path)
  assert.equal(typeof handler, 'function')
  const promise = handler(req, res)
  if (body !== undefined) {
    req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  }
  await promise
  return { status, payload: JSON.parse(payload) }
}

test('en entry keeps the plugin identity and inject contract', () => {
  assert.equal(name, 'opencode-omo')
  assert.deepEqual(inject, ['settings', 'webServer'])
})

test('en entry reuses the original settings namespace (configuration survives the switch)', () => {
  assert.equal(OMO_ROLE_SETTINGS_NAMESPACE, 'opencode-omo-roles')
  assert.equal(OMO_ROLE_SETTINGS_NAMESPACE, ORIGINAL_NAMESPACE)
})

test('en catalog serves the same role ids as the original over the roles endpoint', async () => {
  const { ctx, web } = await boot()
  const response = await call(web, ROLES_ENDPOINT)
  assert.equal(response.status, 200)
  assert.equal(response.payload.ok, true)
  assert.equal(response.payload.defaultRole, OMO_DEFAULT_ROLE)
  assert.deepEqual(
    response.payload.roles.map((role) => role.id),
    OMO_ROLES.map((role) => role.id),
  )
  // English: every served catalog string is ASCII.
  for (const role of response.payload.roles) {
    assert.doesNotMatch(role.description, CJK_RE)
    assert.doesNotMatch(role.fallbackHint, CJK_RE)
  }
})

test('en registry persists role config and session role through the same endpoints', async () => {
  const { ctx, web } = await boot()
  const configResponse = await call(web, ROLE_CONFIG_ENDPOINT, {
    role: 'oracle',
    model: null,
    fallbackModels: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash' }],
  })
  assert.equal(configResponse.status, 200)
  assert.equal(configResponse.payload.config.fallbackModels.length, 1)

  const roleResponse = await call(web, ROLE_ENDPOINT, { sessionId: 'session-a', role: 'momus' })
  assert.equal(roleResponse.status, 200)
  assert.equal(roleResponse.payload.currentRole, 'momus')
  assert.equal(ctx.omoRoles.roleFor('session-a'), 'momus')
  assert.equal(ctx.omoRoles.configFor('oracle').model, undefined)
})

test('configuration written through the original entry is read back through the en entry', async () => {
  const original = await import('../src/index.ts')
  const sharedDoc = {}
  const originalCtx = await bootWith(original, sharedDoc)
  await originalCtx.omoRoles.setRoleConfig('oracle', {
    model: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    fallbackModels: [{ provider: 'pi-ai', model: 'gpt-5.5' }],
    maxSteps: 9,
  })
  const enCtx = await bootWith({ name, inject, apply }, sharedDoc)
  const config = enCtx.omoRoles.configFor('oracle')
  assert.deepEqual(config.model, { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  assert.equal(config.fallbackModels.length, 1)
  assert.equal(config.maxSteps, 9)
})

async function bootWith(entry, sharedDoc) {
  const ctx = new Context()
  await ctx.plugin({ name: 'memory-settings', inject: [], apply(c) { c.plugin(MemorySettings, sharedDoc) } })
  await ctx.plugin({ name: 'mock-web-server', inject: [], apply(c) { c.plugin(MockWebServer) } })
  await ctx.plugin({ name: 'mock-llm', inject: [], apply(c) { c.plugin(MockLlm) } })
  await ctx.plugin({ name: entry.name, inject: entry.inject, apply: entry.apply })
  return ctx
}

test('omo-json settings default to disabled with the standard path', async () => {
  const { web } = await boot()
  const response = await call(web, OMO_JSON_ENDPOINT)
  assert.equal(response.status, 200)
  assert.equal(response.payload.ok, true)
  assert.equal(response.payload.enabled, false)
  assert.equal(response.payload.path, '~/.omo/omo.json')
})

test('omo-json settings persist the toggle and path', async () => {
  const { web } = await boot()
  const update = await call(web, OMO_JSON_ENDPOINT, { enabled: true, path: '/tmp/custom-omo.json' })
  assert.equal(update.status, 200)
  assert.equal(update.payload.enabled, true)
  assert.equal(update.payload.path, '/tmp/custom-omo.json')
  const read = await call(web, OMO_JSON_ENDPOINT)
  assert.equal(read.payload.enabled, true)
  assert.equal(read.payload.path, '/tmp/custom-omo.json')
})

test('omo-json import applies a file into the registry through the endpoint', async () => {
  const { ctx, web } = await boot()
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(`${tmpdir()}/omo-json-`)
  const file = `${dir}/omo.json`
  await writeFile(file, JSON.stringify({
    oracle: {
      model: { provider: 'tokeness', model: 'gpt-5.5' },
      fallbackModels: [{ provider: 'tokeness', model: 'claude-opus-4-7' }],
    },
    bogus: { model: { provider: 'x', model: 'y' }, fallbackModels: [] },
  }))
  const response = await call(web, OMO_JSON_IMPORT_ENDPOINT, { path: file })
  assert.equal(response.status, 200)
  assert.equal(response.payload.ok, true)
  assert.equal(response.payload.imported, 1)
  assert.ok(response.payload.errors.some((error) => error.includes('bogus')))
  const config = ctx.omoRoles.configFor('oracle')
  assert.equal(config.model.provider, 'tokeness')
  assert.equal(config.fallbackModels.length, 1)
})

test('omo-json import is non-fatal on a missing file', async () => {
  const { web } = await boot()
  const response = await call(web, OMO_JSON_IMPORT_ENDPOINT, { path: '/definitely/missing/omo.json' })
  assert.equal(response.status, 200)
  assert.equal(response.payload.ok, false)
  assert.equal(response.payload.imported, 0)
})

test('boot-time auto-import runs when omoJson.enabled is set', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(`${tmpdir()}/omo-auto-`)
  const file = `${dir}/omo.json`
  await writeFile(file, JSON.stringify({
    metis: { model: { provider: 'tokeness', model: 'kimi-k3' }, fallbackModels: [] },
  }))
  const sharedDoc = {
    'opencode-omo-roles': {
      roles: {},
      sessions: {},
      omoJson: { enabled: true, path: file },
    },
  }
  const ctx = await bootWith({ name, inject, apply }, sharedDoc)
  // The startup import is async; poll until the registry reflects the file.
  const deadline = Date.now() + 2000
  let model
  while (Date.now() < deadline) {
    model = ctx.omoRoles.configFor('metis').model
    if (model !== undefined) break
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(model?.provider, 'tokeness')
  assert.equal(model?.model, 'kimi-k3')
})

test('omo-json endpoints reject invalid paths with 400', async () => {
  const { web } = await boot()
  for (const bad of ['', 123, 'x'.repeat(1025)]) {
    const configResponse = await call(web, OMO_JSON_ENDPOINT, { path: bad })
    assert.equal(configResponse.status, 400)
    const importResponse = await call(web, OMO_JSON_IMPORT_ENDPOINT, { path: bad })
    assert.equal(importResponse.status, 400)
  }
})
