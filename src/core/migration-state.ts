/**
 * Closed state model for the one-time legacy role-settings migration.
 * Effects live in src/index.ts; this module only decides the next phase and
 * the machine-readable reason, so callers cannot invent ad-hoc states.
 */

export type MigrationPhase = 'pending' | 'migrating' | 'migrated' | 'skipped' | 'failed'

export type MigrationReason =
  | 'marker-present'
  | 'no-legacy'
  | 'empty-legacy'
  | 'already-current'
  | 'updated'
  | 'update-failed'
  | 'marker-failed'

export interface MigrationState {
  readonly phase: MigrationPhase
  readonly reason: MigrationReason | null
}

export type MigrationEvent =
  | { readonly type: 'start' }
  | { readonly type: 'marker-present' }
  | { readonly type: 'no-legacy' }
  | { readonly type: 'empty-legacy' }
  | { readonly type: 'already-current' }
  | { readonly type: 'updated' }
  | { readonly type: 'failed'; readonly reason: 'update-failed' | 'marker-failed' }

export const INITIAL_MIGRATION: MigrationState = { phase: 'pending', reason: null }

export function transitionMigration(state: MigrationState, event: MigrationEvent): MigrationState {
  if (event.type === 'start') {
    return state.phase === 'pending' ? { phase: 'migrating', reason: null } : state
  }
  if (event.type === 'failed' && state.phase === 'migrated') {
    return { phase: 'failed', reason: event.reason }
  }
  if (state.phase !== 'migrating') return state
  switch (event.type) {
    case 'marker-present':
      return { phase: 'migrated', reason: 'marker-present' }
    case 'no-legacy':
      return { phase: 'skipped', reason: 'no-legacy' }
    case 'empty-legacy':
      return { phase: 'skipped', reason: 'empty-legacy' }
    case 'already-current':
      return { phase: 'migrated', reason: 'already-current' }
    case 'updated':
      return { phase: 'migrated', reason: 'updated' }
    case 'failed':
      return { phase: 'failed', reason: event.reason }
    default: {
      const never: never = event
      return never
    }
  }
}
