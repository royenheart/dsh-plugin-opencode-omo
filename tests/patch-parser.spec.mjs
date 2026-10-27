import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePatch } from '../presets/opencode-omo/patch-parser.mjs'

test('the shared patch parser owns header whitespace and Move paths', () => {
  assert.deepEqual(
    parsePatch('*** Begin Patch\n*** Add File:\r../outside\n*** End Patch\n').map(op => [op.kind, op.path]),
    [['add', '../outside']],
  )
  assert.deepEqual(
    parsePatch('*** Update File: a\n*** Move to:\u2028../outside\n').map(op => [op.kind, op.path, op.moveTo]),
    [['update', 'a', '../outside']],
  )
})
