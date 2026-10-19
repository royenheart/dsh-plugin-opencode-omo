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
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { OmoRoleRegistry } from './omo-role-registry.ts'
import type { OmoRoleRegistryFace } from './omo-role-registry.ts'
import { OMO_DEFAULT_ROLE } from './core/omo-roles.ts'
import type { StoredOmoRoleConfig } from './core/omo-roles.ts'
import { sanitizeStoredRoleConfigs } from './core/omo-settings.ts'

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

  // Self-heal legacy malformed role settings once per boot. Older profiles
  // stored `ultrawork: { model: {} }`; drop that invalid model so later writes
  // never fail and the raw catalog can round-trip.
  try {
    const cleaned = sanitizeStoredRoleConfigs(config.roles.get())
    if (cleaned.changedRoleIds.length > 0) {
      void ctx.settings.update('opencode-omo', { roles: cleaned.roles })
        .then(() => {
          ctx.logger?.warn(`opencode-omo: cleaned malformed role settings for roles: ${cleaned.changedRoleIds.join(', ')}`)
        })
        .catch((error: unknown) => {
          ctx.logger?.warn('opencode-omo: failed to clean malformed role settings', error)
        })
    }
  } catch (error) {
    ctx.logger?.warn('opencode-omo: role settings self-heal skipped', error)
  }

  ctx.plugin(OmoRoleRegistry, { config })
}
