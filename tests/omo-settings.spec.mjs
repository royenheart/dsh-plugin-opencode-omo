/**
 * Pure normalization tests for the opencode-omo configuration section, the
 * Config schema, and the RPC payload parsers. No dsh services are required.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  fromStoredRoleConfig,
  normalizeOmoSettingsSection,
  OMO_ROLE_SETTINGS_NAMESPACE,
  sanitizeStoredRoleConfigs,
  toStoredRoleConfig,
} from '../src/core/omo-settings.ts'
import {
  OMO_RPC_CHANNEL,
  OMO_RPC_ENDPOINTS,
  parseOmoCatalogGetRequest,
  parseOmoRoleConfigSetRequest,
  parseOmoRoleSetRequest,
} from '../src/core/omo-rpc.ts'
import { Config } from '../src/index.ts'
import { normalizeRoleConfig } from '../src/omo-role-registry.ts'

/**
 * Read one Config field. On dsh 0.1.7's schemastery every field is a stable
 * live reference (`.get()`); on an older copy without `.volatile()` the parsed
 * field is already the plain value.
 */
const configField = (value) => (typeof value?.get === 'function' ? value.get() : value)

test('config namespace is the stable entry id', () => {
  assert.equal(OMO_ROLE_SETTINGS_NAMESPACE, 'opencode-omo-roles')
})

test('the bundle patch declares the host row under the config namespace', () => {
  // The client addresses the Config-derived form by the host entry id, and the
  // harness's one-time settings.yaml import maps a section to the entry with
  // the same id, so the template row id and the namespace must not drift.
  const template = readFileSync(new URL('../cordis.patch.template.yml', import.meta.url), 'utf8')
  const hostRow = template.match(/^\s*- id:\s*(\S+)\s*\n\s*name:\s*'@royenheart\/dsh-plugin-opencode-omo'/m)
  assert.ok(hostRow, 'template declares the host row')
  assert.equal(hostRow[1], OMO_ROLE_SETTINGS_NAMESPACE)
})

test('the Config schema accepts the legacy settings.yaml section shape', () => {
  // `model: {}` under ultrawork is the known malformed legacy shape; keeping
  // it importable is what lets the harness migrate a pre-0.1.7 section.
  const parsed = Config({
    roles: {
      sisyphus: {
        model: { provider: 'openai', model: 'gpt-5.5', reasoningEffort: 'high' },
        fallbackModels: [{ provider: 'openai', model: 'gpt-5.4' }],
      },
      hephaestus: { model: null, fallbackModels: [] },
      atlas: { fallbackModels: [], maxSteps: 0, ultrawork: { model: {} } },
    },
    sessions: { 'session-a': 'atlas' },
  })
  // A field is a live reference, never the root object: a root-volatile Config
  // would make `config.roles` undefined for the registry.
  assert.equal(typeof parsed?.get, 'undefined')
  const roles = configField(parsed.roles)
  const sessions = configField(parsed.sessions)
  assert.equal(roles.sisyphus.model.provider, 'openai')
  assert.equal(roles.sisyphus.fallbackModels.length, 1)
  assert.equal(roles.hephaestus.model, null)
  assert.deepEqual(roles.atlas.ultrawork.model, {})
  assert.equal(roles.atlas.maxSteps, 0)
  assert.deepEqual(sessions, { 'session-a': 'atlas' })
})

test('the Config schema defaults both maps', () => {
  const parsed = Config({})
  assert.deepEqual(configField(parsed.roles), {})
  assert.deepEqual(configField(parsed.sessions), {})
})

test('normalizeOmoSettingsSection reads stored role configs into the runtime shape', () => {
  const section = normalizeOmoSettingsSection({
    roles: {
      sisyphus: {
        model: { provider: 'openai', model: 'gpt-5.5', reasoningEffort: 'high' },
        fallbackModels: [{ provider: 'openai', model: 'gpt-5.4' }],
        maxSteps: 12,
        ultrawork: { model: { provider: 'openai', model: 'gpt-5.6' }, reasoningEffort: 'high' },
      },
      hephaestus: { model: null, fallbackModels: [] },
    },
    sessions: { 'session-a': 'atlas', 'session-b': 'unknown' },
  })
  assert.equal(section.roles['sisyphus'].model.provider, 'openai')
  assert.equal(section.roles['sisyphus'].fallbackModels.length, 1)
  assert.equal(section.roles['sisyphus'].maxSteps, 12)
  assert.equal(section.roles['sisyphus'].ultrawork.model.model, 'gpt-5.6')
  // model: null decodes to "follow session model" (model omitted).
  assert.equal(section.roles['hephaestus'].model, undefined)
  assert.deepEqual(section.roles['hephaestus'].fallbackModels, [])
  // Unknown session roles are dropped.
  assert.deepEqual(section.sessions, { 'session-a': 'atlas' })
})

test('normalizeOmoSettingsSection tolerates missing and malformed input', () => {
  assert.deepEqual(normalizeOmoSettingsSection(undefined), { roles: {}, sessions: {} })
  assert.deepEqual(normalizeOmoSettingsSection(null), { roles: {}, sessions: {} })
  assert.deepEqual(normalizeOmoSettingsSection({ roles: { unknown: {} } }), { roles: {}, sessions: {} })
  const section = normalizeOmoSettingsSection({
    roles: { sisyphus: { model: { provider: '', model: '' }, fallbackModels: 'bad' } },
    sessions: { a: 'bad-role' },
  })
  assert.equal(section.roles['sisyphus'].model, undefined)
  assert.deepEqual(section.roles['sisyphus'].fallbackModels, [])
  assert.deepEqual(section.sessions, {})
})

test('sanitizeStoredRoleConfigs drops only malformed ultrawork.model', () => {
  const result = sanitizeStoredRoleConfigs({
    sisyphus: {
      model: { provider: 'openai', model: 'gpt-5.5' },
      fallbackModels: [{ provider: 'openai', model: 'gpt-5.4' }],
      ultrawork: { model: {} },
    },
    atlas: { fallbackModels: [] },
    prometheus: {
      fallbackModels: [],
      ultrawork: { model: { provider: 'openai', model: 'gpt-5.6' }, reasoningEffort: 'high' },
    },
  })
  assert.deepEqual(result.changedRoleIds, ['sisyphus'])
  assert.equal(result.roles['sisyphus'].ultrawork, undefined)
  assert.deepEqual(result.roles['atlas'], { fallbackModels: [] })
  assert.deepEqual(result.roles['prometheus'].ultrawork, {
    model: { provider: 'openai', model: 'gpt-5.6' },
    reasoningEffort: 'high',
  })
})

test('normalizeRoleConfig tolerates legacy empty ultrawork.model', () => {
  const config = normalizeRoleConfig({
    fallbackModels: [{ provider: 'openai', model: 'gpt-5.4' }],
    ultrawork: { model: {} },
  })
  assert.equal(config.ultrawork, undefined)
  assert.equal(config.fallbackModels.length, 1)
})

test('rpc channel is a single-segment logical channel', () => {
  assert.equal(OMO_RPC_CHANNEL, '/opencode-omo')
  assert.match(OMO_RPC_CHANNEL, /^\/[A-Za-z0-9._~-]+$/)
})

test('rpc endpoints are stable', () => {
  assert.equal(OMO_RPC_ENDPOINTS.catalogGet, 'catalog/get')
  assert.equal(OMO_RPC_ENDPOINTS.roleSet, 'role/set')
  assert.equal(OMO_RPC_ENDPOINTS.roleConfigSet, 'role-config/set')
})

test('parseOmoCatalogGetRequest accepts empty and sessionId payloads', () => {
  assert.deepEqual(parseOmoCatalogGetRequest({}), {})
  assert.deepEqual(parseOmoCatalogGetRequest({ sessionId: 'session-a' }), { sessionId: 'session-a' })
  assert.equal(parseOmoCatalogGetRequest({ sessionId: '' }), undefined)
  assert.equal(parseOmoCatalogGetRequest('bad'), undefined)
})

test('parseOmoRoleSetRequest validates the role', () => {
  assert.deepEqual(
    parseOmoRoleSetRequest({ sessionId: 'session-a', role: 'atlas' }),
    { sessionId: 'session-a', role: 'atlas' },
  )
  assert.equal(parseOmoRoleSetRequest({ sessionId: 'session-a', role: 'nope' }), undefined)
  assert.equal(parseOmoRoleSetRequest({ sessionId: '', role: 'atlas' }), undefined)
})

test('parseOmoRoleConfigSetRequest validates the shape', () => {
  assert.deepEqual(
    parseOmoRoleConfigSetRequest({ role: 'momus', config: { fallbackModels: [] } }),
    { role: 'momus', config: { fallbackModels: [] } },
  )
  assert.equal(parseOmoRoleConfigSetRequest({ role: 'nope', config: {} }), undefined)
  assert.equal(parseOmoRoleConfigSetRequest({ role: 'momus', config: 'bad' }), undefined)
  assert.equal(parseOmoRoleConfigSetRequest({ role: 'momus', config: null }), undefined)
})
