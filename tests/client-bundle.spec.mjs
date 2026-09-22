/**
 * Browser-bundle smoke tests: evaluate the built client.js with a minimal
 * module-loader mock and assert the wrapper registers the package id and
 * exposes the plugin apply face. A second test renders the shipped settings
 * section and composer role chip with real React to catch hook/state
 * regressions without a browser.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import React from 'react'
import * as JsxRuntime from 'react/jsx-runtime'
import { renderToString } from 'react-dom/server'

function evaluateBundle(modules) {
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const loaded = {}
  const context = {
    console,
    window: { __ModuleLoader__: { load: ({ id, factory }) => { loaded.id = id; loaded.factory = factory } } },
  }
  vm.createContext(context)
  vm.runInContext(code, context)
  assert.equal(loaded.id, '@royenheart/dsh-plugin-opencode-omo')
  return loaded.factory(id => {
    if (!(id in modules)) throw new Error(`unexpected client require: ${id}`)
    return modules[id]
  })
}

function mockModules(react, jsxRuntime) {
  return {
    'react': react,
    'react/jsx-runtime': jsxRuntime,
    '@deepseek-ai/cordis': {
      Context: class {},
      Service: class { constructor(ctx, name) { this.ctx = ctx; this.name = name } },
    },
    '@deepseek-ai/dsh-client-ui-slots': {},
    '@deepseek-ai/dsh-client-web-react': {},
    '@deepseek-ai/dsh-client-ui-primitives': {
      IconAgentPresetOutlineRegular: () => null,
      IconChevronDownOutlineRegular: () => null,
      IconPlusOutlineMedium: () => null,
      IconCloseOutlineRegular: () => null,
      Menu: ({ anchor }) => anchor ?? null,
      Modal: () => null,
    },
    '@deepseek-ai/dsh-client-schema-form': {},
  }
}

function fakeForm(snapshot = { status: 'unavailable' }) {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    set: async () => true,
  }
}

function fakeRpc() {
  return {
    call: async () => ({
      ok: true,
      value: {
        defaultRole: 'sisyphus',
        roles: [{ id: 'sisyphus', displayName: 'Sisyphus', mode: 'primary', description: 'd', fallbackHint: 'h' }],
        configs: {},
        defaults: { sisyphus: null },
      },
    }),
  }
}

test('client bundle loads under the module loader and exports the plugin face', () => {
  const exportsObj = evaluateBundle(mockModules(
    { createElement: () => null, useState: () => [null, () => {}], useEffect: () => {}, useMemo: fn => fn(), useRef: () => ({}) },
    { jsx: () => null, jsxs: () => null },
  ))
  assert.equal(exportsObj.name, 'opencode-omo-client')
  assert.equal(JSON.stringify(exportsObj.inject), JSON.stringify(['slots', 'configForms', 'connection', 'remote', 'remote.session']))
  assert.equal(typeof exportsObj.apply, 'function')
  assert.equal(exportsObj.OMO_ROLE_SETTINGS_NAMESPACE, 'opencode-omo-roles')
  assert.equal(exportsObj.ROLES_ENDPOINT, undefined)
  assert.equal(typeof exportsObj.RoleSelect, 'function')
  assert.equal(typeof exportsObj.RoleSettingsSection, 'function')
})

test('settings section and role chip render with the hybrid settings store', () => {
  const exportsObj = evaluateBundle(mockModules(React, JsxRuntime))
  const form = fakeForm()
  const rpc = fakeRpc()

  const settingsHtml = renderToString(React.createElement(exportsObj.RoleSettingsSection, {
    form,
    rpc,
    loadModels: async () => [{ provider: 'openai', model: 'gpt-5.5', label: 'gpt-5.5' }],
  }))
  assert.match(settingsHtml, /为每个 omo 角色配置/)
  assert.match(settingsHtml, /Sisyphus/)

  const roleHtml = renderToString(React.createElement(exportsObj.RoleSelect, {
    sessionId: 'session-1',
    form,
    rpc,
    selectModel: async () => true,
    useSessions: selector => selector({ byId: { 'session-1': { agentPreset: 'opencode-omo' } } }),
  }))
  assert.match(roleHtml, /Sisyphus/)
})
