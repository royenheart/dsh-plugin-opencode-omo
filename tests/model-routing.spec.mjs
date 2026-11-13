/**
 * Model routing on dsh 0.2.2: step selection is frozen after
 * agent/inbox/claimed. An ultrawork override is kept for the whole turn and
 * restored once at turn-stopping; prompt/tool/request read the frozen route.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { currentToolModel, restoreOnTurnEnd, selectRoleRoute } from '../presets/opencode-omo/driver.mjs'

function state() {
  return {
    resolvedRoutes: new Map(),
    assembledRoutes: new Map(),
    restoreSelection: undefined,
    restoreTurn: undefined,
    appliedSelection: undefined,
    lastRouteTurn: 1,
    ultraworkTurn: 0,
  }
}

function harness(id, initial) {
  let current = { ...initial }
  const agent = {
    session: { id, snapshotEvents: () => [] },
    options: { ...initial },
    model: { current: () => current, select: value => { current = value } },
  }
  return { agent, get current() { return current }, set current(value) { current = value } }
}

test('the role primary is recorded before step preparation', () => {
  const h = harness('session-route', { provider: 'session-provider', model: 'session-model' })
  const omoRoles = {
    roleFor: () => 'sisyphus',
    configFor: () => ({ model: { provider: 'role-provider', model: 'gpt-5.5' }, fallbackModels: [] }),
    fallbackModelsFor: () => [],
  }
  const route = selectRoleRoute(omoRoles, state(), h.agent.session, h.agent, 1, 2)
  assert.deepEqual(route, { provider: 'role-provider', model: 'gpt-5.5', target: { provider: 'role-provider', model: 'gpt-5.5' } })
  assert.deepEqual(h.current, { provider: 'role-provider', model: 'gpt-5.5', reasoningEffort: 'medium' })
})

test('a follow-current role records its reasoning effort', () => {
  const h = harness('session-follow', { provider: 'session-provider', model: 'gpt-5.5' })
  const omoRoles = { roleFor: () => 'sisyphus', configFor: () => ({ fallbackModels: [] }), fallbackModelsFor: () => [] }
  const route = selectRoleRoute(omoRoles, state(), h.agent.session, h.agent, 1, 2)
  assert.deepEqual(route, { provider: 'session-provider', model: 'gpt-5.5', target: undefined })
  assert.deepEqual(h.current, { provider: 'session-provider', model: 'gpt-5.5', reasoningEffort: 'medium' })
})

test('tool admission prefers the passed step selection', () => {
  const h = harness('session-tools', { provider: 'live-provider', model: 'live-model' })
  const ctx = { get: () => ({ configFor: () => ({ model: { provider: 'role-provider', model: 'role-model' } }) }) }
  assert.equal(currentToolModel(ctx, h.agent, { provider: 'frozen-provider', model: 'frozen-model' }), 'frozen-model')
})

test('a fixed role primary is overridden by ultrawork model and effort', () => {
  const h = harness('session-fixed-ultra', { provider: 'role-provider', model: 'claude-opus' })
  const omoRoles = {
    roleFor: () => 'sisyphus',
    configFor: () => ({
      model: { provider: 'role-provider', model: 'claude-opus' },
      ultrawork: { model: { provider: 'ultra-provider', model: 'gpt-5.5', reasoningEffort: 'high' } },
      fallbackModels: [],
    }),
    fallbackModelsFor: () => [],
  }
  selectRoleRoute(omoRoles, { ...state(), ultraworkTurn: 1 }, h.agent.session, h.agent, 1, 1)
  assert.deepEqual(h.current, { provider: 'ultra-provider', model: 'gpt-5.5', reasoningEffort: 'high' })
})

test('an ultrawork effort overrides the role primary effort', () => {
  const h = harness('session-fixed-effort', { provider: 'role-provider', model: 'claude-opus' })
  const omoRoles = {
    roleFor: () => 'sisyphus',
    configFor: () => ({
      model: { provider: 'role-provider', model: 'claude-opus' },
      ultrawork: { reasoningEffort: 'high' },
      fallbackModels: [],
    }),
    fallbackModelsFor: () => [],
  }
  selectRoleRoute(omoRoles, { ...state(), ultraworkTurn: 1 }, h.agent.session, h.agent, 1, 1)
  assert.deepEqual(h.current, { provider: 'role-provider', model: 'claude-opus', reasoningEffort: 'high' })
})

test('the ultrawork override lasts the whole turn and restores once at turn end', () => {
  const h = harness('session-turn', { provider: 'claude-provider', model: 'claude-opus' })
  const s = { ...state(), ultraworkTurn: 1 }
  const omoRoles = {
    roleFor: () => 'atlas',
    configFor: () => ({ ultrawork: { model: { provider: 'gpt-provider', model: 'gpt-5.5' }, reasoningEffort: 'high' }, fallbackModels: [] }),
    fallbackModelsFor: () => [],
  }
  selectRoleRoute(omoRoles, s, h.agent.session, h.agent, 1, 1)
  assert.deepEqual(h.current, { provider: 'gpt-provider', model: 'gpt-5.5', reasoningEffort: 'high' })
  assert.deepEqual(s.restoreSelection, { provider: 'claude-provider', model: 'claude-opus' })
  // A continuation step in the same turn does not claim a message.
  selectRoleRoute(omoRoles, s, h.agent.session, h.agent, 1, 2)
  assert.deepEqual(h.current, { provider: 'gpt-provider', model: 'gpt-5.5', reasoningEffort: 'high' })
  restoreOnTurnEnd(s, h.agent, 1)
  assert.deepEqual(h.current, { provider: 'claude-provider', model: 'claude-opus' })
})

test('a second claim in the same turn does not overwrite the restore baseline', () => {
  const h = harness('session-batch', { provider: 'a-provider', model: 'a-model' })
  const s = { ...state(), ultraworkTurn: 1 }
  const omoRoles = {
    roleFor: () => 'atlas',
    configFor: () => ({ ultrawork: { model: { provider: 'u-provider', model: 'u-model' } }, fallbackModels: [] }),
    fallbackModelsFor: () => [],
  }
  selectRoleRoute(omoRoles, s, h.agent.session, h.agent, 1, 1)
  selectRoleRoute(omoRoles, s, h.agent.session, h.agent, 1, 1)
  assert.deepEqual(s.restoreSelection, { provider: 'a-provider', model: 'a-model' })
  restoreOnTurnEnd(s, h.agent, 1)
  assert.deepEqual(h.current, { provider: 'a-provider', model: 'a-model' })
})

test('a user model choice during the turn wins over restore', () => {
  const h = harness('session-user-turn', { provider: 'a-provider', model: 'a-model' })
  const s = { ...state(), ultraworkTurn: 1 }
  const omoRoles = {
    roleFor: () => 'atlas',
    configFor: () => ({ ultrawork: { model: { provider: 'u-provider', model: 'u-model' } }, fallbackModels: [] }),
    fallbackModelsFor: () => [],
  }
  selectRoleRoute(omoRoles, s, h.agent.session, h.agent, 1, 1)
  h.current = { provider: 'c-provider', model: 'c-model' }
  restoreOnTurnEnd(s, h.agent, 1)
  assert.deepEqual(h.current, { provider: 'c-provider', model: 'c-model' })
})

test('a stale restore from an interrupted turn is applied at the next ordinary claim', () => {
  const h = harness('session-stale', { provider: 'u-provider', model: 'u-model' })
  const s = {
    ...state(),
    restoreSelection: { provider: 'a-provider', model: 'a-model' },
    restoreTurn: 1,
    appliedSelection: { provider: 'u-provider', model: 'u-model' },
  }
  const omoRoles = { roleFor: () => 'atlas', configFor: () => ({ fallbackModels: [] }), fallbackModelsFor: () => [] }
  selectRoleRoute(omoRoles, s, h.agent.session, h.agent, 2, 1)
  assert.deepEqual(h.current, { provider: 'a-provider', model: 'a-model' })
})

test('a first ultrawork turn restores AgentOptions after turn end', () => {
  const h = harness('session-first-ultra', { provider: 'a-provider', model: 'a-model' })
  const s = { ...state(), ultraworkTurn: 1 }
  const omoRoles = {
    roleFor: () => 'atlas',
    configFor: () => ({ ultrawork: { model: { provider: 'u-provider', model: 'u-model' } }, fallbackModels: [] }),
    fallbackModelsFor: () => [],
  }
  selectRoleRoute(omoRoles, s, h.agent.session, h.agent, 1, 1)
  restoreOnTurnEnd(s, h.agent, 1)
  assert.deepEqual(h.current, { provider: 'a-provider', model: 'a-model' })
})
