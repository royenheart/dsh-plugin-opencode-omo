/**
 * General-tab source guards (English surface).
 *
 * The client General tab is typechecked and built, not DOM-tested; these
 * guards pin the required controls and the dark-theme contract at the
 * source level.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const CJK_RE = /[\u2E80-\u2FFF\u31C0-\u31EF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/
const LIGHT_LITERALS = ["#fff'", "#fff)", '#fafafa', "#333'", '#616161', '#909090', '#81858c', '#e0e0e0', '#f0f0f0']

async function source(name) {
  return readFile(new URL(`../src/client/${name}`, import.meta.url), 'utf8')
}

test('GeneralSettings_en carries the required controls and default path', async () => {
  const text = await source('GeneralSettings_en.tsx')
  for (const required of ['Use omo.json', 'Re-Import', '~/.omo/omo.json']) {
    assert.ok(text.includes(required), `missing ${required}`)
  }
  assert.doesNotMatch(text, CJK_RE)
})

test('GeneralSettings_en keeps the dark-theme contract', async () => {
  const text = await source('GeneralSettings_en.tsx')
  assert.ok(text.includes('#212121') || text.includes('#2e2e2e'), 'missing dark surface')
  assert.ok(text.includes('#ffffff'), 'missing white wording')
  for (const literal of LIGHT_LITERALS) {
    assert.ok(!text.includes(literal), `light literal ${literal}`)
  }
})

test('OmoSettingsSection_en renders both tabs, General first and default-selected', async () => {
  const text = await source('OmoSettingsSection_en.tsx')
  const tabs = text.slice(text.indexOf('const TABS'))
  assert.ok(tabs.indexOf('General') < tabs.indexOf('Role Settings'), 'General must come before Role Settings')
  assert.ok(text.includes("useState<TabId>('general')"), 'General must be the default-selected tab')
  assert.ok(text.includes('only:'), 'missing slot entry selector')
})

test('the client entry registers the general tab', async () => {
  const text = await source('index_en.ts')
  assert.ok(text.includes("id: 'general'"), 'general tab entry not registered')
  assert.ok(text.includes('GeneralSettings'), 'general tab component not referenced')
  const generalOrder = text.indexOf("id: 'general'")
  const rolesOrder = text.indexOf("id: 'roles'")
  assert.ok(generalOrder > 0 && rolesOrder > 0)
  assert.ok(generalOrder < rolesOrder, 'general tab must register before roles')
})

test('GeneralSettings_en reports import failures and ENOENT guidance', async () => {
  const text = await source('GeneralSettings_en.tsx')
  assert.ok(text.includes('Import failed'))
  assert.ok(text.includes('File not found'))
  assert.ok(text.includes('result.errors.some((item) => item.includes'))
})

test('RoleSettings_en shows an explicit no-fallback empty state', async () => {
  const text = await source('RoleSettings_en.tsx')
  assert.ok(text.includes('No fallback models'))
})
