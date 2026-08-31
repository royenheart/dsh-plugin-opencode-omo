/**
 * Dark-theme regression guard for the English settings components.
 *
 * The settings page must not fall back to light-theme colors: surfaces are
 * dark gray (#212121) and wording is white/light (#ffffff family). Pinned at
 * the source level because these colors are CSS-in-JS literals.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const LIGHT_LITERALS = ["#fff'", "#fff)", '#fafafa', "#333'", '#616161', '#909090', '#81858c', '#e0e0e0', '#f0f0f0']

async function source(name) {
  return readFile(new URL(`../src/client/${name}`, import.meta.url), 'utf8')
}

test('settings components carry no light-theme literals', async () => {
  for (const file of ['OmoSettingsSection_en.tsx', 'RoleSettings_en.tsx']) {
    const text = await source(file)
    for (const literal of LIGHT_LITERALS) {
      assert.ok(!text.includes(literal), `${file} still contains light literal ${literal}`)
    }
  }
})

test('settings components use dark-gray surfaces and white wording', async () => {
  // The section wrapper is transparent (it inherits the settings shell);
  // every explicit surface lives in RoleSettings.
  const section = await source('OmoSettingsSection_en.tsx')
  assert.ok(section.includes('#ffffff'), 'OmoSettingsSection_en.tsx missing white wording')
  const roles = await source('RoleSettings_en.tsx')
  assert.ok(roles.includes('#212121'), 'RoleSettings_en.tsx missing dark surface')
  assert.ok(roles.includes('#ffffff'), 'RoleSettings_en.tsx missing white wording')
})
