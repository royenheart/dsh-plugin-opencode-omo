/**
 * Preset-side English (_en) parity tests.
 *
 * driver_en.mjs / omo-commands_en.mjs are full copies of the Chinese
 * originals with only the user/model-visible strings translated. Verified
 * through the public interfaces: apply(ctx) registrations and exports.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const CJK_RE = /[\u2E80-\u2FFF\u31C0-\u31EF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/

function fakeCommandsCtx() {
  const registered = []
  return {
    registered,
    ctx: {
      effect(cb) { return cb() },
      commands: {
        register(def) {
          registered.push(def)
          return () => {}
        },
      },
    },
  }
}

test('en commands register the same ids, texts and order through apply', async () => {
  const original = fakeCommandsCtx()
  const english = fakeCommandsCtx()
  const { apply: applyOriginal } = await import('../presets/opencode-omo/omo-commands.mjs')
  const { apply: applyEn } = await import('../presets/opencode-omo/omo-commands_en.mjs')
  applyOriginal(original.ctx)
  applyEn(english.ctx)

  assert.deepEqual(
    english.registered.map((command) => command.name),
    original.registered.map((command) => command.name),
  )
  english.registered.forEach((command, index) => {
    assert.equal(command.description.length > 0, true)
    assert.equal(typeof command.handler, 'function')
    assert.equal(typeof original.registered[index].handler, 'function')
  })
  // descriptions are English
  for (const command of english.registered) {
    assert.doesNotMatch(command.description, CJK_RE)
  }
})

test('en driver exports the same identity as the original', async () => {
  const driver = await import('../presets/opencode-omo/driver.mjs')
  const driverEn = await import('../presets/opencode-omo/driver_en.mjs')
  assert.equal(driverEn.name, driver.name)
  assert.deepEqual(driverEn.inject, driver.inject)
  assert.equal(typeof driverEn.persistPlanFile, 'function')
})

test('en driver keeps every routing-table row and carries no Chinese', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(
    new URL('../presets/opencode-omo/driver_en.mjs', import.meta.url),
    'utf8',
  )
  for (const id of ['oracle', 'librarian', 'explore', 'metis', 'momus', 'hephaestus', 'atlas', 'sisyphus']) {
    assert.ok(source.includes(`['${id}',`), `missing ${id} row in driver_en.mjs`)
  }
  assert.doesNotMatch(source, CJK_RE)
})
