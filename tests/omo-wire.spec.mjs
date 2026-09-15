/**
 * Browser wire helpers: catalog keys and the 0.1.6 agent-preset projection.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { modelKey, parseModelKey, sessionAgentPreset } from '../src/client/omo-wire.ts'

test('modelKey / parseModelKey round-trip', () => {
  const key = modelKey({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
  assert.equal(key, 'deepseek-official::deepseek-v4-pro')
  assert.deepEqual(parseModelKey(key), { provider: 'deepseek-official', model: 'deepseek-v4-pro' })
})

test('sessionAgentPreset prefers the 0.1.6 projection field', () => {
  assert.equal(sessionAgentPreset({
    agentPreset: 'stale',
    projectionValues: { agentPreset: 'opencode-omo' },
  }), 'opencode-omo')
})

test('sessionAgentPreset falls back to a top-level summary field', () => {
  assert.equal(sessionAgentPreset({ agentPreset: 'opencode-omo' }), 'opencode-omo')
})

test('sessionAgentPreset ignores empty or missing values', () => {
  assert.equal(sessionAgentPreset(undefined), undefined)
  assert.equal(sessionAgentPreset({}), undefined)
  assert.equal(sessionAgentPreset({ projectionValues: { agentPreset: '' } }), undefined)
  assert.equal(sessionAgentPreset({ projectionValues: { agentPreset: null } }), undefined)
})
