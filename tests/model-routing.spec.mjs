/**
 * The 0.2.2 loop snapshots the step model selection immediately after
 * `agent/inbox/claimed`; the preset must record the role route there and keep
 * `agent/request` from changing the frozen provider/model/effort.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { currentToolModel, selectRoleRoute } from '../presets/opencode-omo/driver.mjs'

function state() {
  return { fallbackAttempts: new Map(), resolvedRoutes: new Map(), assembledRoutes: new Map(), lastRouteTurn: 1, ultraworkTurn: 0 }
}

test('the role primary is recorded before step preparation', () => {
  let selected
  const agent = {
    session: { id: 'session-route', snapshotEvents: () => [] },
    options: { provider: 'session-provider', model: 'session-model' },
    model: { current: () => ({ provider: 'session-provider', model: 'session-model' }), select: value => { selected = value } },
  }
  const omoRoles = {
    roleFor: () => 'sisyphus',
    configFor: () => ({ model: { provider: 'role-provider', model: 'gpt-5.5' }, fallbackModels: [] }),
    fallbackModelsFor: () => [],
  }
  const route = selectRoleRoute(omoRoles, state(), agent.session, agent, 1, 2)
  assert.deepEqual(route, { provider: 'role-provider', model: 'gpt-5.5', target: { provider: 'role-provider', model: 'gpt-5.5' } })
  assert.deepEqual(selected, { provider: 'role-provider', model: 'gpt-5.5', reasoningEffort: 'medium' })
})

test('a follow-current role still records its reasoning effort', () => {
  let selected
  const agent = {
    session: { id: 'session-follow', snapshotEvents: () => [] },
    options: { provider: 'session-provider', model: 'gpt-5.5' },
    model: { current: () => ({ provider: 'session-provider', model: 'gpt-5.5' }), select: value => { selected = value } },
  }
  const omoRoles = { roleFor: () => 'sisyphus', configFor: () => ({ fallbackModels: [] }), fallbackModelsFor: () => [] }
  const route = selectRoleRoute(omoRoles, state(), agent.session, agent, 1, 2)
  assert.deepEqual(route, { provider: 'session-provider', model: 'gpt-5.5', target: undefined })
  assert.deepEqual(selected, { provider: 'session-provider', model: 'gpt-5.5', reasoningEffort: 'medium' })
})

test('an ultrawork effort override is recorded without replacing the model', () => {
  let selected
  const agent = {
    session: { id: 'session-ultra', snapshotEvents: () => [] },
    options: { provider: 'session-provider', model: 'gpt-5.5' },
    model: { current: () => ({ provider: 'session-provider', model: 'gpt-5.5' }), select: value => { selected = value } },
  }
  const omoRoles = {
    roleFor: () => 'sisyphus',
    configFor: () => ({ fallbackModels: [], ultrawork: { reasoningEffort: 'high' } }),
    fallbackModelsFor: () => [],
  }
  const route = selectRoleRoute(omoRoles, { ...state(), ultraworkTurn: 1 }, agent.session, agent, 1, 2)
  assert.deepEqual(route, { provider: 'session-provider', model: 'gpt-5.5', target: undefined })
  assert.deepEqual(selected, { provider: 'session-provider', model: 'gpt-5.5', reasoningEffort: 'high' })
})

test('following the current model preserves an explicit user effort', () => {
  let selected
  const agent = {
    session: { id: 'session-follow-effort', snapshotEvents: () => [] },
    options: { provider: 'session-provider', model: 'gpt-5.5' },
    model: {
      current: () => ({ provider: 'session-provider', model: 'gpt-5.5', reasoningEffort: 'high' }),
      select: value => { selected = value },
    },
  }
  const omoRoles = { roleFor: () => 'sisyphus', configFor: () => ({ fallbackModels: [] }), fallbackModelsFor: () => [] }
  selectRoleRoute(omoRoles, state(), agent.session, agent, 1, 2)
  assert.deepEqual(selected, { provider: 'session-provider', model: 'gpt-5.5', reasoningEffort: 'high' })
})

test('ultrawork effort does not leak into the next ordinary turn', () => {
  let selected
  const agent = {
    session: { id: 'session-after-ultra', snapshotEvents: () => [] },
    options: { provider: 'role-provider', model: 'gpt-5.5' },
    model: {
      current: () => ({ provider: 'role-provider', model: 'gpt-5.5', reasoningEffort: 'high' }),
      select: value => { selected = value },
    },
  }
  const s = { ...state(), ultraworkTurn: 0, lastEffort: { value: 'high', source: 'ultra' } }
  const omoRoles = { roleFor: () => 'sisyphus', configFor: () => ({ model: { provider: 'role-provider', model: 'gpt-5.5' }, fallbackModels: [] }), fallbackModelsFor: () => [] }
  selectRoleRoute(omoRoles, s, agent.session, agent, 2, 1)
  assert.deepEqual(selected, { provider: 'role-provider', model: 'gpt-5.5', reasoningEffort: 'medium' })
})


test('tool admission prefers the step model selection over live role settings', () => {
  const agent = {
    session: { id: 'session-tools', snapshotEvents: () => [] },
    options: { provider: 'live-provider', model: 'live-model' },
    model: { current: () => ({ provider: 'live-provider', model: 'live-model' }) },
  }
  const ctx = { get: () => ({ configFor: () => ({ model: { provider: 'role-provider', model: 'role-model' } }) }) }
  assert.equal(currentToolModel(ctx, agent, { provider: 'frozen-provider', model: 'frozen-model' }), 'frozen-model')
})

test('follow-current restores the pre-ultra model on the next ordinary turn', () => {
  let current = { provider: 'claude-provider', model: 'claude-opus' }
  const agent = {
    session: { id: 'session-restore-model', snapshotEvents: () => [] },
    options: current,
    model: { current: () => current, select: value => { current = value } },
  }
  const s = state()
  const omoRoles = {
    roleFor: () => 'atlas',
    configFor: () => ({ ultrawork: { model: { provider: 'gpt-provider', model: 'gpt-5.5' }, reasoningEffort: 'high' } }),
    fallbackModelsFor: () => [],
  }
  s.ultraworkTurn = 1
  selectRoleRoute(omoRoles, s, agent.session, agent, 1, 1)
  assert.deepEqual(current, { provider: 'gpt-provider', model: 'gpt-5.5', reasoningEffort: 'high' })
  s.ultraworkTurn = 0
  selectRoleRoute(omoRoles, s, agent.session, agent, 2, 1)
  assert.deepEqual(current, { provider: 'claude-provider', model: 'claude-opus' })
})

test('follow-current restores the explicit user effort after ultrawork', () => {
  let current = { provider: 'claude-provider', model: 'claude-opus', reasoningEffort: 'high' }
  const agent = {
    session: { id: 'session-restore-effort', snapshotEvents: () => [] },
    options: current,
    model: { current: () => current, select: value => { current = value } },
  }
  const s = state()
  const omoRoles = {
    roleFor: () => 'atlas',
    configFor: () => ({ ultrawork: { reasoningEffort: 'xhigh' } }),
    fallbackModelsFor: () => [],
  }
  s.ultraworkTurn = 1
  selectRoleRoute(omoRoles, s, agent.session, agent, 1, 1)
  assert.deepEqual(current, { provider: 'claude-provider', model: 'claude-opus', reasoningEffort: 'xhigh' })
  s.ultraworkTurn = 0
  selectRoleRoute(omoRoles, s, agent.session, agent, 2, 1)
  assert.deepEqual(current, { provider: 'claude-provider', model: 'claude-opus', reasoningEffort: 'high' })
})
