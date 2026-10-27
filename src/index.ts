/**
 * dsh-plugin-opencode-omo — node half.
 *
 * The package is both a dsh BUNDLE (the host row below plus the declared
 * `opencode-omo` agent preset) and a host plugin row. On 0.2.1 the durable
 * role/session state is the row's own volatile config (`opencode-omo`), exposed
 * to the browser through the official settings form Remote. The host half:
 * - mounts the OmoRoleRegistry service (`ctx.omoRoles`) consumed by the
 *   preset's native-seam loop shim;
 * - declares the `roles` / `sessions` fields that the browser Role Settings
 *   page and the composer role picker edit.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { load } from 'js-yaml'
import { OmoRoleRegistry } from './omo-role-registry.ts'
import type { OmoRoleRegistryFace } from './omo-role-registry.ts'
import { OMO_DEFAULT_ROLE } from './core/omo-roles.ts'
import type { StoredOmoRoleConfig } from './core/omo-roles.ts'
import { sanitizeStoredRoleConfigs } from './core/omo-settings.ts'
import { INITIAL_MIGRATION, transitionMigration } from './core/migration-state.ts'
import type { MigrationState } from './core/migration-state.ts'

export { OmoRoleRegistry } from './omo-role-registry.ts'
export type { OmoRoleRegistryFace } from './omo-role-registry.ts'
export { OMO_DEFAULT_ROLE, OMO_ROLES, emptyRoleConfig, isOmoRole, normalizeOmoRole } from './core/omo-roles.ts'
export type { OmoModelSelection, OmoRoleConfig, OmoRoleSettings } from './core/omo-roles.ts'
export { OMO_ROLE_SETTINGS_NAMESPACE } from './core/omo-settings.ts'

/** Cordis plugin name. */
export const name = 'opencode-omo'

/** Required service: the durable settings presenter and the LLM catalog used for omo defaults. */
export const inject = ['settings', 'llm']

/** Volatile fields this row owns; the official settings Remote edits them live. */
export interface Config {
  /** role id -> primary/fallback/maxSteps/ultrawork configuration. */
  roles: Volatile<Record<string, StoredOmoRoleConfig>>
  /** session id -> selected omo role. */
  sessions: Volatile<Record<string, string>>
}

const optionalString = z.union([z.string(), z.const(undefined)]).default(undefined)
const optionalNumber = z.union([z.number(), z.const(undefined)]).default(undefined)

const modelSelectionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: optionalString,
})

const optionalModelSelection = z.union([modelSelectionSchema, z.const(undefined)]).default(undefined)

const ultraworkSchema = z.object({
  model: optionalModelSelection,
  reasoningEffort: optionalString,
})

const storedRoleConfigSchema = z.object({
  model: z.union([modelSelectionSchema, z.const(null), z.const(undefined)]).default(undefined),
  fallbackModels: z.array(modelSelectionSchema).default([]),
  maxSteps: optionalNumber,
  ultrawork: z.union([ultraworkSchema, z.const(undefined)]).default(undefined),
})

/** Runtime schema for this row's durable, browser-editable fields. */
export const Config = z.object({
  roles: z.dict(storedRoleConfigSchema).default({}).volatile(),
  sessions: z.dict(z.string()).default({}).volatile(),
})

/** Old profile entry id used before the 0.2.1 row rename. */
const LEGACY_SETTINGS_NAMESPACE = 'opencode-omo-roles'
/** One-time per-profile marker so a later deletion of migrated roles cannot resurrect them. */
const LEGACY_MIGRATION_MARKER = '.opencode-omo-legacy-settings-migrated'

interface ProfileDetails {
  readonly home: string
  readonly dir: string
}

/** Profile-local settings home and marker directory; falls back to the dsh home. */
function profileDetails(ctx: Context): ProfileDetails {
  const profile = (ctx as Context & { get(name: string): unknown }).get('profileContext') as
    | { home?: unknown; dir?: unknown }
    | undefined
  const home = typeof profile?.home === 'string' && profile.home !== ''
    ? profile.home
    : process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const dir = typeof profile?.dir === 'string' && profile.dir !== '' ? profile.dir : home
  return { home, dir }
}

/** Read the old namespace's roles/sessions from dsh's renamed settings backup. */
function legacySection(home: string): { roles?: unknown; sessions?: unknown } | undefined {
  for (const name of ['settings.yaml.imported', 'settings.yaml']) {
    const path = join(home, name)
    if (!existsSync(path)) continue
    try {
      const document = load(readFileSync(path, 'utf8'))
      if (document === null || typeof document !== 'object') continue
      const section = (document as Record<string, unknown>)[LEGACY_SETTINGS_NAMESPACE]
      if (section !== null && typeof section === 'object') return section as { roles?: unknown; sessions?: unknown }
    } catch {
      // A malformed backup is not worth failing the host row over.
    }
  }
  return undefined
}

function markerPath(details: ProfileDetails): string {
  return join(details.dir, LEGACY_MIGRATION_MARKER)
}

function markMigrated(details: ProfileDetails): void {
  writeFileSync(markerPath(details), `${new Date().toISOString()}\n`)
}

/**
 * Carry the pre-rename `opencode-omo-roles` config into the active row. dsh's
 * legacy settings importer preserves unknown entries in settings.yaml.imported
 * instead of importing them; without this one-time read an upgrade silently
 * resets every configured role and session.
 */
async function migrateLegacyRoleSettings(ctx: Context, config: Config): Promise<MigrationState> {
  let state = transitionMigration(INITIAL_MIGRATION, { type: 'start' })
  const details = profileDetails(ctx)
  if (existsSync(markerPath(details))) {
    state = transitionMigration(state, { type: 'marker-present' })
    return state
  }
  const currentRoles = config.roles.get()
  const currentSessions = config.sessions.get()
  const legacy = legacySection(details.home)
  if (legacy === undefined) {
    state = transitionMigration(state, { type: 'no-legacy' })
    return state
  }
  const roles = sanitizeStoredRoleConfigs(legacy.roles).roles
  const sessions: Record<string, string> = {}
  if (legacy.sessions !== null && typeof legacy.sessions === 'object' && !Array.isArray(legacy.sessions)) {
    for (const [id, role] of Object.entries(legacy.sessions as Record<string, unknown>)) {
      if (typeof role === 'string') sessions[id] = role
    }
  }
  if (Object.keys(roles).length === 0 && Object.keys(sessions).length === 0) {
    state = transitionMigration(state, { type: 'empty-legacy' })
    return state
  }
  const mergedRoles = Object.fromEntries([
    ...Object.entries(roles).map(([id, legacyRole]) => {
      const current = currentRoles[id]
      if (current === undefined) return [id, legacyRole]
      return [id, {
        // model omission is the explicit omo-default state; never inherit a
        // legacy pin over it.
        ...(current.model === undefined ? {} : { model: current.model }),
        fallbackModels: current.fallbackModels ?? legacyRole.fallbackModels ?? [],
        ...(current.maxSteps === undefined
          ? legacyRole.maxSteps === undefined ? {} : { maxSteps: legacyRole.maxSteps }
          : { maxSteps: current.maxSteps }),
        ...(current.ultrawork === undefined
          ? legacyRole.ultrawork === undefined ? {} : { ultrawork: legacyRole.ultrawork }
          : { ultrawork: current.ultrawork }),
      }]
    }),
    ...Object.entries(currentRoles).filter(([id]) => !(id in roles)),
  ])
  const nextSessions = { ...sessions, ...currentSessions }
  if (JSON.stringify(mergedRoles) === JSON.stringify(currentRoles)
    && JSON.stringify(nextSessions) === JSON.stringify(currentSessions)) {
    state = transitionMigration(state, { type: 'already-current' })
    try { markMigrated(details) } catch (error) {
      state = transitionMigration(state, { type: 'failed', reason: 'marker-failed' })
      ctx.logger?.warn('opencode-omo: legacy migration marker failed', error)
    }
    return state
  }
  try {
    await ctx.settings.update('opencode-omo', { roles: mergedRoles, sessions: nextSessions })
  } catch (error) {
    state = transitionMigration(state, { type: 'failed', reason: 'update-failed' })
    ctx.logger?.warn('opencode-omo: legacy role settings update failed', error)
    return state
  }
  state = transitionMigration(state, { type: 'updated' })
  try { markMigrated(details) } catch (error) {
    state = transitionMigration(state, { type: 'failed', reason: 'marker-failed' })
    ctx.logger?.warn('opencode-omo: legacy migration marker failed', error)
  }
  return state
}

/** Run migration before the malformed-role cleanup so neither write overwrites the other. */
async function bootstrapRoleSettings(ctx: Context, config: Config): Promise<void> {
  try {
    const migration = await migrateLegacyRoleSettings(ctx, config)
    if (migration.phase === 'migrated' && migration.reason === 'updated') {
      ctx.logger?.warn('opencode-omo: migrated legacy opencode-omo-roles settings')
    } else if (migration.phase === 'failed') {
      ctx.logger?.warn(`opencode-omo: legacy migration failed (${migration.reason ?? 'unknown'})`)
    }
  } catch (error) {
    ctx.logger?.warn('opencode-omo: legacy role settings migration failed', error)
  }
  const cleaned = sanitizeStoredRoleConfigs(config.roles.get())
  if (cleaned.changedRoleIds.length === 0) return
  await ctx.settings.mutate('opencode-omo', [{ op: 'set', path: ['roles'], value: cleaned.roles }])
  ctx.logger?.warn(`opencode-omo: cleaned malformed role settings for roles: ${cleaned.changedRoleIds.join(', ')}`)
}

/**
 * Mount the role registry and mark this row as self-rendered so Settings does
 * not also generate a generic page for it.
 * @param ctx - host plugin context carrying settings.
 * @param config - live volatile config references owned by this row.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  void bootstrapRoleSettings(ctx, config).catch((error: unknown) => {
    ctx.logger?.warn('opencode-omo: role settings migration/self-heal failed', error)
  })

  ctx.plugin(OmoRoleRegistry, { config })
}
