/**
 * English (_en) localization parity tests.
 *
 * The shipped catalog/preset files remain Chinese; the `*_en` variants must
 * keep the exact same structure (ids, modes, fallback chains) while carrying
 * only ASCII text in their model/user-visible strings.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { OMO_ROLES } from '../src/core/omo-roles.ts'

import { OMO_ROLES as OMO_ROLES_EN } from '../src/core/omo-roles_en.ts'
const CJK_RE = /[\u2E80-\u2FFF\u31C0-\u31EF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/

const PRESET_EN = fileURLToPath(new URL('../presets/opencode-omo/preset_en.yml', import.meta.url))

test('en role catalog keeps the same ids, modes and order', () => {
  assert.equal(OMO_ROLES_EN.length, OMO_ROLES.length)
  OMO_ROLES.forEach((role, index) => {
    assert.equal(OMO_ROLES_EN[index].id, role.id)
    assert.equal(OMO_ROLES_EN[index].mode, role.mode)
    assert.equal(OMO_ROLES_EN[index].displayName, role.displayName)
  })
})

test('en role catalog strings are ASCII-only', () => {
  for (const role of OMO_ROLES_EN) {
    for (const field of [role.description, role.fallbackHint]) {
      assert.doesNotMatch(field, CJK_RE, `Chinese text in ${role.id} field: ${field}`)
    }
  }
})

test('preset_en.yml description is ASCII-only', () => {
  const text = readFileSync(PRESET_EN, 'utf8')
  const line = text.split('\n').find((l) => l.startsWith('description:')) ?? ''
  assert.doesNotMatch(line, CJK_RE, 'preset_en.yml description contains Chinese text')
  assert.ok(line.includes('opencode + omo'), 'description should mention opencode + omo')
})

test('original catalog keeps its Chinese descriptions (originals untouched)', () => {
  const chinese = OMO_ROLES.filter((role) => CJK_RE.test(role.description ?? ''))
  assert.ok(chinese.length > 0, 'original catalog should still carry Chinese descriptions')
  assert.equal(OMO_ROLES[0].id, OMO_ROLES_EN[0].id)
})

test('preset_en.yml parses with js-yaml and exposes the English description', () => {
  const parsed = yaml.load(readFileSync(PRESET_EN, 'utf8'))
  assert.equal(parsed.name, 'opencode-omo')
  assert.match(parsed.description, /opencode \+ omo/)
  assert.doesNotMatch(parsed.description, CJK_RE)
})
