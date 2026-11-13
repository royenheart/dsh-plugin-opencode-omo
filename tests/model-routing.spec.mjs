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

test('an ultrawork model overrides a fixed role primary', () => {
  let selected
  const agent = {
    session: { id: 'session-fixed-ultra', snapshotEvents: () => [] },
    options: { provider: 'role-provider', model: 'claude-opus' },
    model: { current: () => ({ provider: 'role-provider', model: 'claude-opus' }), select: value => { selected = value } },
  }
  const omoRoles = {
    roleFor: () => 'sisyphus',
    configFor: () => ({
      model: { provider: 'role-provider', model: 'claude-opus' },
      ultrawork: { model: { provider: 'ultra-provider', model: 'gpt-5.5', reasoningEffort: 'high' } },
      fallbackModels: [],
    }),
    fallbackModelsFor: () => [],
  }
  const s = { ...state(), ultraworkTurn: 1 }
  selectRoleRoute(omoRoles, s, agent.session, agent, 1, 1)
  assert.deepEqual(selected, { provider: 'ultra-provider', model: 'gpt-5.5', reasoningEffort: 'high' })
})

test('restoring a follow-current selection does not inherit the ultra model default', () => {
  let current = { provider: 'claude-provider', model: 'claude-opus' }
  const agent = {
    session: { id: 'session-restore-default', snapshotEvents: () => [] },
    options: current,
    model: { current: () => current, select: value => { current = value } },
  }
  const s = state()
  const omoRoles = {
    roleFor: () => 'sisyphus',
    configFor: () => ({ ultrawork: { model: { provider: 'gpt-provider', model: 'gpt-5.5' } } }),
    fallbackModelsFor: () => [],
  }
  s.ultraworkTurn = 1
  selectRoleRoute(omoRoles, s, agent.session, agent, 1, 1)
  s.ultraworkTurn = 0
  selectRoleRoute(omoRoles, s, agent.session, agent, 2, 1)
  assert.deepEqual(current, { provider: 'claude-provider', model: 'claude-opus' })
})

test('a user selection made after ultrawork wins over the saved base', () => {
  let current = { provider: 'claude-provider', model: 'claude-opus', reasoningEffort: 'low' }
  const agent = {
    session: { id: 'session-user-after-ultra', snapshotEvents: () => [] },
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
  current = { provider: 'new-provider', model: 'new-model', reasoningEffort: 'low' }
  s.ultraworkTurn = 0
  selectRoleRoute(omoRoles, s, agent.session, agent, 2, 1)
  assert.deepEqual(current, { provider: 'new-provider', model: 'new-model', reasoningEffort: 'low' })
})

test('cold recovery restores the model before an ultrawork selection from the session log', () => {
  const session = {
    id: 'session-cold',
    snapshotEvents: () => [
      { type: 'model/selection', data: { provider: 'claude-provider', model: 'claude-opus' } },
      { type: 'model/selection', data: { provider: 'gpt-provider', model: 'gpt-5.5', reasoningEffort: 'high' } },
      { type: 'user/message', data: { content: [{ type: 'text', text: 'use ultrawork' }] } },
    ],
  }
  let current = { provider: 'gpt-provider', model: 'gpt-5.5', reasoningEffort: 'high' }
  const agent = { session, options: current, model: { current: () => current, select: value => { current = value } } }
  const omoRoles = { roleFor: () => 'atlas', configFor: () => ({ fallbackModels: [] }), fallbackModelsFor: () => [] }
  selectRoleRoute(omoRoles, state(), session, agent, 2, 1)
  assert.deepEqual(current, { provider: 'claude-provider', model: 'claude-opus' })
})

test('an ultrawork model effort is honored', () => {
  let selected
  const agent = {
    session: { id: 'session-ultra-model-effort', snapshotEvents: () => [] },
    options: { provider: 'role-provider', model: 'claude-opus' },
    model: { current: () => ({ provider: 'role-provider', model: 'claude-opus' }), select: value => { selected = value } },
  }
  const omoRoles = {
    roleFor: () => 'sisyphus',
    configFor: () => ({ ultrawork: { model: { provider: 'gpt-provider', model: 'gpt-5.5', reasoningEffort: 'high' } } }),
    fallbackModelsFor: () => [],
  }
  selectRoleRoute(omoRoles, { ...state(), ultraworkTurn: 1 }, agent.session, agent, 1, 1)
  assert.deepEqual(selected, { provider: 'gpt-provider', model: 'gpt-5.5', reasoningEffort: 'high' })
})


test('cold recovery keeps a newer user model selection', () => {
  const session = {
    id: 'session-cold-user-change',
    snapshotEvents: () => [
      { type: 'model/selection', data: { provider: 'claude-provider', model: 'claude-opus' } },
      { type: 'model/selection', data: { provider: 'gpt-provider', model: 'gpt-5.5', reasoningEffort: 'high' } },
      { type: 'user/message', data: { content: [{ type: 'text', text: 'use ultrawork' }] } },
      { type: 'user/message', data: { content: [{ type: 'text', text: 'ordinary next turn' }] } },
      { type: 'model/selection', data: { provider: 'new-provider', model: 'new-model', reasoningEffort: 'low' } },
    ],
  }
  let current = { provider: 'new-provider', model: 'new-model', reasoningEffort: 'low' }
  const agent = { session, options: current, model: { current: () => current, select: value => { current = value } } }
  const omoRoles = { roleFor: () => 'atlas', configFor: () => ({ fallbackModels: [] }), fallbackModelsFor: () => [] }
  selectRoleRoute(omoRoles, state(), session, agent, 3, 1)
  assert.deepEqual(current, { provider: 'new-provider', model: 'new-model', reasoningEffort: 'low' })
})

test('a reloaded ultrawork turn saves the recovered base, not the temporary model', () => {
  const session = {
    id: 'session-cold-ultra-again',
    snapshotEvents: () => [
      { type: 'model/selection', data: { provider: 'claude-provider', model: 'claude-opus' } },
      { type: 'model/selection', data: { provider: 'gpt-provider', model: 'gpt-5.5', reasoningEffort: 'high' } },
      { type: 'user/message', data: { content: [{ type: 'text', text: 'use ultrawork' }] } },
    ],
  }
  let current = { provider: 'gpt-provider', model: 'gpt-5.5', reasoningEffort: 'high' }
  const agent = { session, options: current, model: { current: () => current, select: value => { current = value } } }
  const s = { ...state(), ultraworkTurn: 1 }
  const omoRoles = {
    roleFor: () => 'atlas',
    configFor: () => ({ ultrawork: { model: { provider: 'gpt-provider', model: 'gpt-5.5' }, reasoningEffort: 'high' } }),
    fallbackModelsFor: () => [],
  }
  selectRoleRoute(omoRoles, s, session, agent, 2, 1)
  s.ultraworkTurn = 0
  selectRoleRoute(omoRoles, s, session, agent, 3, 1)
  assert.deepEqual(current, { provider: 'claude-provider', model: 'claude-opus' })
})
