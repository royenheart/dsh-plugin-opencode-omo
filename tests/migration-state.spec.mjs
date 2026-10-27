import test from 'node:test'
import assert from 'node:assert/strict'
import { INITIAL_MIGRATION, transitionMigration } from '../src/core/migration-state.ts'

test('legacy migration has one closed transition path', () => {
  const started = transitionMigration(INITIAL_MIGRATION, { type: 'start' })
  assert.deepEqual(started, { phase: 'migrating', reason: null })
  assert.deepEqual(transitionMigration(started, { type: 'updated' }), { phase: 'migrated', reason: 'updated' })
  assert.deepEqual(transitionMigration(started, { type: 'marker-present' }), { phase: 'migrated', reason: 'marker-present' })
  assert.deepEqual(transitionMigration(started, { type: 'no-legacy' }), { phase: 'skipped', reason: 'no-legacy' })
  assert.deepEqual(transitionMigration(started, { type: 'failed', reason: 'marker-failed' }), { phase: 'failed', reason: 'marker-failed' })
  assert.deepEqual(transitionMigration(started, { type: 'start' }), started)
  assert.deepEqual(transitionMigration({ phase: 'migrated', reason: 'updated' }, { type: 'updated' }), { phase: 'migrated', reason: 'updated' })
  assert.deepEqual(
    transitionMigration({ phase: 'migrated', reason: 'updated' }, { type: 'failed', reason: 'marker-failed' }),
    { phase: 'failed', reason: 'marker-failed' },
  )
})
