/**
 * Model routing on dsh 0.2.2: the step selection is frozen after
 * `agent/inbox/claimed`, and an ultrawork override is restored after the
 * prepared request so the next step starts from the user's base.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { currentToolModel, restoreAfterRequest, selectRoleRoute } from '../presets/opencode-omo/driver.mjs'

function state() {
  return { resolvedRoutes: new Map(), assembledRoutes: new Map(), restoreSelection: undefined, lastRouteTurn: 1, ultraworkTurn: 0 }
}

function harness(id, initial) {
  let current = { ...initial }
  const agent = {
    session: { id, snapshotEvents: () => [] },
    options: { ...initial },
    model: { current: () => current, select: value => { current = value } },
  }
  return { agent, get current() { return current } }
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

test('an ultrawork effort override records high without replacing the model', () => {
  const h = harness('session-ultra-effort', { provider: 'session-provider', model: 'gpt-5.5' })
  const omoRoles = {
    roleFor: () => 'sisyphus',
    configFor: () => ({ fallbackModels: [], ultrawork: { reasoningEffort: 'high' } }),
    fallbackModelsFor: () => [],
  }
  const s = { ...state(), ultraworkTurn: 1 }
  selectRoleRoute(omoRoles, s, h.agent.session, h.agent, 1, 1)
  assert.deepEqual(h.current, { provider: 'session-provider', model: 'gpt-5.5', reasoningEffort: 'high' })
})

test('tool admission prefers the passed step selection', () => {
  const h = harness('session-tools', { provider: 'live-provider', model: 'live-model' })
  const ctx = { get: () => ({ configFor: () => ({ model: { provider: 'role-provider', model: 'role-model' } }) }) }
  assert.equal(currentToolModel(ctx, h.agent, { provider: 'frozen-provider', model: 'frozen-model' }), 'frozen-model')
})

test('a fixed role primary can be overridden by an ultrawork model', () => {
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

test('the pre-ultra base is stored and restored after the prepared request', () => {
  const h = harness('session-restore-model', { provider: 'claude-provider', model: 'claude-opus' })
  const s = { ...state(), ultraworkTurn: 1 }
  const omoRoles = {
    roleFor: () => 'atlas',
    configFor: () => ({ ultrawork: { model: { provider: 'gpt-provider', model: 'gpt-5.5' }, reasoningEffort: 'high' }, fallbackModels: [] }),
    fallbackModelsFor: () => [],
  }
  selectRoleRoute(omoRoles, s, h.agent.session, h.agent, 1, 1)
  assert.deepEqual(h.current, { provider: 'gpt-provider', model: 'gpt-5.5', reasoningEffort: 'high' })
  assert.deepEqual(s.restoreSelection, { provider: 'claude-provider', model: 'claude-opus' })
  restoreAfterRequest(s, h.agent)
  assert.deepEqual(h.current, { provider: 'claude-provider', model: 'claude-opus' })
})

test('restoring keeps an explicit user effort', () => {
  const h = harness('session-restore-effort', { provider: 'claude-provider', model: 'claude-opus', reasoningEffort: 'high' })
  const s = { ...state(), ultraworkTurn: 1 }
  const omoRoles = {
    roleFor: () => 'atlas',
    configFor: () => ({ ultrawork: { reasoningEffort: 'xhigh' }, fallbackModels: [] }),
    fallbackModelsFor: () => [],
  }
  selectRoleRoute(omoRoles, s, h.agent.session, h.agent, 1, 1)
  restoreAfterRequest(s, h.agent)
  assert.deepEqual(h.current, { provider: 'claude-provider', model: 'claude-opus', reasoningEffort: 'high' })
})

test('restoring the same model keeps that model', () => {
  const h = harness('session-same-ultra', { provider: 'u-provider', model: 'u-model' })
  const s = { ...state(), ultraworkTurn: 1 }
  const omoRoles = {
    roleFor: () => 'atlas',
    configFor: () => ({ ultrawork: { model: { provider: 'u-provider', model: 'u-model' } }, fallbackModels: [] }),
    fallbackModelsFor: () => [],
  }
  selectRoleRoute(omoRoles, s, h.agent.session, h.agent, 1, 1)
  restoreAfterRequest(s, h.agent)
  assert.deepEqual(h.current, { provider: 'u-provider', model: 'u-model' })
})

test('a first ultrawork turn restores the AgentOptions base', () => {
  const h = harness('session-first-ultra', { provider: 'a-provider', model: 'a-model' })
  const s = { ...state(), ultraworkTurn: 1 }
  const omoRoles = {
    roleFor: () => 'atlas',
    configFor: () => ({ ultrawork: { model: { provider: 'u-provider', model: 'u-model' } }, fallbackModels: [] }),
    fallbackModelsFor: () => [],
  }
  selectRoleRoute(omoRoles, s, h.agent.session, h.agent, 1, 1)
  restoreAfterRequest(s, h.agent)
  assert.deepEqual(h.current, { provider: 'a-provider', model: 'a-model' })
})

test('an ordinary turn has no pending restore', () => {
  const h = harness('session-ordinary', { provider: 'a-provider', model: 'a-model' })
  const s = state()
  selectRoleRoute({ roleFor: () => 'atlas', configFor: () => ({ fallbackModels: [] }), fallbackModelsFor: () => [] }, s, h.agent.session, h.agent, 1, 1)
  assert.equal(s.restoreSelection, undefined)
})
