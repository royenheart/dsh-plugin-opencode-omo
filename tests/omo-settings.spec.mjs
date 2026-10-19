/**
 * Pure normalization tests for the opencode-omo settings section. No dsh
 * services are required.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeOmoSettingsSection,
  OMO_ROLE_SETTINGS_NAMESPACE,
  sanitizeStoredRoleConfigs,
} from '../src/core/omo-settings.ts'
import { normalizeRoleConfig } from '../src/omo-role-registry.ts'

test('settings namespace is the stable id', () => {
  assert.equal(OMO_ROLE_SETTINGS_NAMESPACE, 'opencode-omo')
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
