/**
 * The 0.2.2 loop snapshots the step model selection immediately after
 * `agent/inbox/claimed`; the preset must record the role route there and keep
 * `agent/request` from changing the frozen provider/model/effort.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectRoleRoute } from '../presets/opencode-omo/driver.mjs'

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
