/**
 * Role model routing on dsh 0.2.2. Step selection is recorded before step
 * preparation; provider/model/effort stay frozen for the request and no
 * plugin-side ultrawork model override is applied.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { currentToolModel, selectRoleRoute } from '../presets/opencode-omo/driver.mjs'

function state() {
  return { resolvedRoutes: new Map(), assembledRoutes: new Map(), lastRouteTurn: 1 }
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
  const route = selectRoleRoute(omoRoles, state(), h.agent.session, h.agent)
  assert.deepEqual(route, { provider: 'role-provider', model: 'gpt-5.5', target: { provider: 'role-provider', model: 'gpt-5.5' } })
  assert.deepEqual(h.current, { provider: 'role-provider', model: 'gpt-5.5', reasoningEffort: 'medium' })
})

test('a follow-current role records its sampling effort', () => {
  const h = harness('session-follow', { provider: 'session-provider', model: 'gpt-5.5' })
  const omoRoles = { roleFor: () => 'sisyphus', configFor: () => ({ fallbackModels: [] }), fallbackModelsFor: () => [] }
  const route = selectRoleRoute(omoRoles, state(), h.agent.session, h.agent)
  assert.deepEqual(route, { provider: 'session-provider', model: 'gpt-5.5', target: undefined })
  assert.deepEqual(h.current, { provider: 'session-provider', model: 'gpt-5.5', reasoningEffort: 'medium' })
})

test('follow-current preserves an explicit user effort', () => {
  const h = harness('session-follow-effort', { provider: 'session-provider', model: 'gpt-5.5', reasoningEffort: 'high' })
  const omoRoles = { roleFor: () => 'sisyphus', configFor: () => ({ fallbackModels: [] }), fallbackModelsFor: () => [] }
  selectRoleRoute(omoRoles, state(), h.agent.session, h.agent)
  assert.deepEqual(h.current, { provider: 'session-provider', model: 'gpt-5.5', reasoningEffort: 'high' })
})

test('tool admission prefers the passed step selection', () => {
  const h = harness('session-tools', { provider: 'live-provider', model: 'live-model' })
  const ctx = { get: () => ({ configFor: () => ({ model: { provider: 'role-provider', model: 'role-model' } }) }) }
  assert.equal(currentToolModel(ctx, h.agent, { provider: 'frozen-provider', model: 'frozen-model' }), 'frozen-model')
})

test('a role with no configured model keeps the current model', () => {
  const h = harness('session-none', { provider: 'a-provider', model: 'a-model' })
  const omoRoles = { roleFor: () => 'atlas', configFor: () => ({ fallbackModels: [] }), fallbackModelsFor: () => [] }
  assert.deepEqual(selectRoleRoute(omoRoles, state(), h.agent.session, h.agent), { provider: 'a-provider', model: 'a-model', target: undefined })
})
