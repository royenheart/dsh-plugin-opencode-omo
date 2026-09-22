/**
 * The `opencode-omo` preset declaration row must activate in a composition
 * that has no preset registry (dsh-base + dsh-headless, the migrator's boot
 * probe) and still register through the official `agentPresets` service in the
 * web-app profile.
 *
 * The row is the package's own `presets/opencode-omo/preset-row.mjs`, not the
 * stock `@deepseek-ai/dsh-agent-preset` class: the stock row statically injects
 * `agentPresets`, so a registry-less composition reports it as an entry that
 * never activated. These tests pin the wrapping contract and the generated
 * bundle patch that uses it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EntryGroup } from '@deepseek-ai/cordis-plugin-loader'
import OmoAgentPresetRow from '../presets/opencode-omo/preset-row.mjs'

const DEFINITION = {
  id: 'opencode-omo',
  order: 5,
  description: 'opencode + omo',
  plugins: [{ id: 'opencode-omo-loop', name: './driver.mjs' }],
}

/** Minimal host context: record the deferred service injection. */
function fakeHost() {
  const state = { deps: undefined, callback: undefined }
  return {
    state,
    inject(deps, callback) {
      state.deps = deps
      state.callback = callback
      return () => {}
    },
    logger: { warn() {} },
  }
}

test('the row carries EntryGroup semantics and validates the official definition shape', () => {
  assert.equal(OmoAgentPresetRow[EntryGroup.key], true)
  // The key is a registered global symbol, so the loader recognizes the row
  // even when it resolves the module through a second package copy.
  assert.equal(OmoAgentPresetRow[Symbol.for('cordis.group')], true)
  const parsed = OmoAgentPresetRow.Config(DEFINITION)
  assert.equal(parsed.id, 'opencode-omo')
  assert.equal(parsed.plugins.length, 1)
})

test('the row activates without a registry and registers once the service arrives', async () => {
  const host = fakeHost()
  // Constructing the row must not require agentPresets: this is the headless case.
  new OmoAgentPresetRow(host, DEFINITION)
  assert.deepEqual(host.state.deps, ['agentPresets'])

  const registered = new Map()
  let disposer
  const child = {
    agentPresets: {
      register(definition) {
        registered.set(definition.id, definition)
        return Promise.resolve(async () => { registered.delete(definition.id) })
      },
    },
    logger: { warn() {} },
    effect(callback) {
      disposer = callback()
      return () => {}
    },
  }
  host.state.callback(child)
  await new Promise(resolve => { setTimeout(resolve, 0) })
  assert.equal(registered.size, 1)
  assert.equal(registered.get('opencode-omo').plugins[0].name, './driver.mjs')

  await disposer()
  assert.equal(registered.size, 0)
})

test('a registration failure is logged, never thrown into the loader', async () => {
  const host = fakeHost()
  new OmoAgentPresetRow(host, DEFINITION)
  const warnings = []
  const child = {
    agentPresets: { register() { return Promise.reject(new Error('duplicate agent preset')) } },
    logger: { warn(...args) { warnings.push(args) } },
    effect(callback) {
      callback()
      return () => {}
    },
  }
  host.state.callback(child)
  await new Promise(resolve => { setTimeout(resolve, 0) })
  assert.equal(warnings.length, 1)
  assert.match(String(warnings[0][0]), /agent preset registration failed/)
})

test('the generated bundle patch declares the headless-safe row', () => {
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const presetRow = patch.slice(patch.lastIndexOf('- insert:'))
  assert.match(presetRow, /id: preset-opencode-omo/)
  assert.match(presetRow, /name: '@royenheart\/dsh-plugin-opencode-omo\/presets\/opencode-omo\/preset-row\.mjs'/)
  assert.doesNotMatch(presetRow, /name: '@deepseek-ai\/dsh-agent-preset'/)
})
