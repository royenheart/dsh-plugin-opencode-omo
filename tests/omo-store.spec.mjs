/**
 * Client role-store transport tests: the 0.1.7 Config-derived form on
 * loopback, the authenticated RPC channel when the form is memory-mode
 * (non-loopback), and the stored-shape write that preserves `model: null`
 * ("follow the session model") versus an absent `model` (omo-default primary).
 *
 * The store is pure TypeScript with no cordis/React imports, so plain Node
 * exercises both transports directly.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { OmoRolesStore } from '../src/client/omo-roles-store.ts'
import { OMO_RPC_CHANNEL, OMO_RPC_ENDPOINTS } from '../src/core/omo-rpc.ts'

/** A fake `ctx.configForms.get(entryId)` form backed by one mutable section. */
function fakeForm(section, { status = 'ready', accepted = true } = {}) {
  const listeners = new Set()
  const state = { status, value: section }
  return {
    writes: [],
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async set(field, value) {
      this.writes.push([field, structuredClone(value)])
      if (!accepted) return false
      state.value = { ...state.value, [field]: structuredClone(value) }
      for (const listener of listeners) listener()
      return true
    },
  }
}

function fakeRpc(responses = {}) {
  const calls = []
  return {
    calls,
    call: async (channel, endpoint, payload) => {
      calls.push([channel, endpoint, payload])
      const response = responses[endpoint]
      return response === undefined ? { ok: false, error: { message: `${endpoint} unavailable` } } : response
    },
  }
}

test('reads the stored section through the Config form', () => {
  const form = fakeForm({
    roles: { hephaestus: { model: null, fallbackModels: [] } },
    sessions: { 'session-a': 'atlas' },
  })
  const store = new OmoRolesStore(form, undefined, 'session-a')
  store.start()
  const state = store.getSnapshot()
  assert.equal(state.currentRole, 'atlas')
  assert.equal(state.configs.hephaestus.model, undefined)
  assert.deepEqual(state.configs.hephaestus.fallbackModels, [])
})

test('setRole writes the sessions map through the form', async () => {
  const form = fakeForm({ roles: {}, sessions: { 'session-a': 'sisyphus' } })
  const store = new OmoRolesStore(form, undefined, 'session-a')
  store.start()
  await store.setRole('session-a', 'oracle')
  assert.deepEqual(form.writes, [['sessions', { 'session-a': 'oracle' }]])
  assert.equal(store.getSnapshot().currentRole, 'oracle')
})

test('setRoleConfig writes the stored shape and keeps other roles byte-identical', async () => {
  const form = fakeForm({
    roles: {
      hephaestus: { model: null, fallbackModels: [] },
      atlas: { fallbackModels: [] },
    },
    sessions: {},
  })
  const store = new OmoRolesStore(form, undefined, undefined)
  store.start()
  await store.setRoleConfig('sisyphus', {
    fallbackModels: [{ provider: 'openai', model: 'gpt-5.5' }],
  })
  const [, written] = form.writes[0]
  // The edited role stores the explicit follow-session null.
  assert.deepEqual(written.sisyphus.model, null)
  assert.equal(written.sisyphus.fallbackModels.length, 1)
  // Untouched roles keep their own null/absent distinction.
  assert.equal(written.hephaestus.model, null)
  assert.equal(Object.hasOwn(written.atlas, 'model'), false)
})

test('a refused form write surfaces as an error instead of a silent no-op', async () => {
  const form = fakeForm({ roles: {}, sessions: {} }, { accepted: false })
  const store = new OmoRolesStore(form, undefined, 'session-a')
  store.start()
  await assert.rejects(store.setRole('session-a', 'atlas'), /refused/)
  assert.match(store.getSnapshot().error, /refused/)
})

test('a memory-mode form falls back to the authenticated RPC channel', async () => {
  const form = fakeForm({ roles: {}, sessions: {} }, { status: 'unavailable' })
  const rpc = fakeRpc({
    [OMO_RPC_ENDPOINTS.catalogGet]: {
      ok: true,
      value: {
        defaultRole: 'sisyphus',
        roles: [{ id: 'sisyphus', displayName: 'Sisyphus', mode: 'primary', description: 'd', fallbackHint: 'h' }],
        configs: { sisyphus: { fallbackModels: [] } },
        defaults: { sisyphus: null },
        currentRole: 'sisyphus',
      },
    },
    [OMO_RPC_ENDPOINTS.roleSet]: { ok: true, value: { currentRole: 'atlas' } },
    [OMO_RPC_ENDPOINTS.roleConfigSet]: { ok: true, value: { config: { model: null, fallbackModels: [] } } },
  })
  const store = new OmoRolesStore(form, rpc, 'session-a')
  store.start()
  await store.setRole('session-a', 'atlas')
  await store.setRoleConfig('atlas', { fallbackModels: [] })
  assert.deepEqual(rpc.calls.map(call => call[1]), [
    OMO_RPC_ENDPOINTS.catalogGet,
    OMO_RPC_ENDPOINTS.roleSet,
    OMO_RPC_ENDPOINTS.roleConfigSet,
  ])
  assert.equal(rpc.calls[1][0], OMO_RPC_CHANNEL)
  assert.equal(store.getSnapshot().currentRole, 'atlas')
})

test('a role write with no transport at all reports the degraded state', async () => {
  const store = new OmoRolesStore(undefined, undefined, 'session-a')
  store.start()
  await assert.rejects(store.setRole('session-a', 'atlas'), /unavailable/)
  assert.equal(store.getSnapshot().degraded, true)
})
