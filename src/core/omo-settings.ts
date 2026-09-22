/**
 * Pure normalization for the `opencode-omo-roles` configuration section.
 *
 * On dsh 0.1.7 a plugin's configurable values live in its own Cordis `Config`
 * (see `.agents/notes/implemented/architecture/2026-09-19-profile-owned-live-configuration.md`);
 * this plugin's form namespace is therefore its profile entry id, and its two
 * durable maps are the entry's volatile Config fields:
 *
 *   opencode-omo-roles:
 *     roles:    { <role>: { model?, fallbackModels, maxSteps?, ultrawork? } }
 *     sessions: { <sessionId>: <role> }
 *
 * The stored shape writes `model: null` for "follow the session model" and
 * omits `model` for "no user choice" (the omo-default primary still applies);
 * the runtime shape used by the UI omits `model` for both. This module owns the
 * conversions so the client form decode, the host registry, and unit tests
 * share one source of truth with no dsh imports.
 */

import { isOmoRole, type OmoModelSelection, type OmoRoleConfig, type OmoUltraworkOverride, type StoredOmoRoleConfig } from './omo-roles.ts'

/** Configuration namespace: the profile entry id of this plugin's host row. */
export const OMO_ROLE_SETTINGS_NAMESPACE = 'opencode-omo-roles'

/** Runtime settings-section shape consumed by the client. */
export interface OmoSettingsSection {
  readonly roles: Record<string, OmoRoleConfig>
  readonly sessions: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeModelSelection(raw: unknown): OmoModelSelection | undefined {
  if (!isRecord(raw)) return undefined
  const provider = raw.provider
  const model = raw.model
  if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') return undefined
  const reasoningEffort = raw.reasoningEffort
  return {
    provider,
    model,
    ...(typeof reasoningEffort === 'string' && reasoningEffort !== '' ? { reasoningEffort } : {}),
  }
}

function normalizeUltrawork(raw: unknown): OmoUltraworkOverride | undefined {
  if (!isRecord(raw)) return undefined
  const model = normalizeModelSelection(raw.model)
  const reasoningEffort = raw.reasoningEffort
  if (model === undefined && (typeof reasoningEffort !== 'string' || reasoningEffort === '')) return undefined
  return {
    ...(model === undefined ? {} : { model }),
    ...(typeof reasoningEffort === 'string' && reasoningEffort !== '' ? { reasoningEffort } : {}),
  }
}

/**
 * Read one stored role config into the runtime shape, tolerating legacy
 * malformed values (older profiles stored `ultrawork: { model: {} }`).
 * @param raw - one entry of the stored `roles` map.
 * @returns the runtime config; unknown shapes degrade to the empty config.
 */
export function fromStoredRoleConfig(raw: unknown): OmoRoleConfig {
  if (!isRecord(raw)) return { fallbackModels: [] }
  const model = raw.model === null || raw.model === undefined
    ? undefined
    : normalizeModelSelection(raw.model)
  const fallbackModels = Array.isArray(raw.fallbackModels)
    ? raw.fallbackModels.map(normalizeModelSelection).filter((entry): entry is OmoModelSelection => entry !== undefined)
    : []
  const maxSteps = typeof raw.maxSteps === 'number' && Number.isSafeInteger(raw.maxSteps) && raw.maxSteps > 0
    ? raw.maxSteps
    : undefined
  const ultrawork = normalizeUltrawork(raw.ultrawork)
  return {
    ...(model === undefined ? {} : { model }),
    fallbackModels,
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(ultrawork === undefined ? {} : { ultrawork }),
  }
}

/**
 * Normalize one runtime role config for storage. `model: null` is the explicit
 * "follow the session model" choice, so an omitted runtime model is stored as
 * `null`; that keeps the parsed Config's `model` absent only for "no user
 * choice", which still resolves the omo-default primary.
 * @param config - the runtime role configuration.
 * @returns the stored (validated) shape written into the profile entry.
 */
export function toStoredRoleConfig(config: OmoRoleConfig | null | undefined): StoredOmoRoleConfig {
  if (config === null || config === undefined || typeof config !== 'object') return { model: null, fallbackModels: [] }
  const model = config.model === undefined || config.model === null ? null : toStoredModel(config.model)
  const fallbackModels = Array.isArray(config.fallbackModels)
    ? config.fallbackModels.map(toStoredModel)
    : []
  const maxSteps = typeof config.maxSteps === 'number' && Number.isSafeInteger(config.maxSteps) && config.maxSteps > 0
    ? config.maxSteps
    : undefined
  const ultraworkInput = config.ultrawork
  const ultraworkModel = ultraworkInput !== null && typeof ultraworkInput === 'object'
    ? (ultraworkInput as OmoUltraworkOverride).model
    : undefined
  // Legacy profiles may store `ultrawork: { model: {} }`. Treat an invalid
  // ultrawork model as "no override" instead of failing the write; the same
  // tolerance lets a raw catalog config round-trip without being rejected.
  const ultrawork = ultraworkInput !== null && typeof ultraworkInput === 'object'
    ? {
      ...(ultraworkModel !== undefined && ultraworkModel !== null && typeof ultraworkModel === 'object'
        && typeof ultraworkModel.provider === 'string' && ultraworkModel.provider !== ''
        && typeof ultraworkModel.model === 'string' && ultraworkModel.model !== ''
        ? { model: toStoredModel(ultraworkModel) }
        : {}),
      ...(typeof ultraworkInput.reasoningEffort === 'string' && ultraworkInput.reasoningEffort !== ''
        ? { reasoningEffort: ultraworkInput.reasoningEffort }
        : {}),
    }
    : undefined
  const cleanedUltrawork = ultrawork !== undefined && Object.keys(ultrawork).length > 0 ? ultrawork : undefined
  return {
    model,
    fallbackModels,
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(cleanedUltrawork === undefined ? {} : { ultrawork: cleanedUltrawork }),
  }
}

/** Validate and copy one model selection for storage. */
function toStoredModel(model: OmoModelSelection): OmoModelSelection {
  if (typeof model?.provider !== 'string' || model.provider === '' || typeof model?.model !== 'string' || model.model === '') {
    throw new TypeError('model must be {provider, model} with non-empty strings')
  }
  return {
    provider: model.provider,
    model: model.model,
    ...(typeof model.reasoningEffort === 'string' && model.reasoningEffort !== ''
      ? { reasoningEffort: model.reasoningEffort }
      : {}),
  }
}

function normalizeRoles(raw: unknown): Record<string, OmoRoleConfig> {
  const out: Record<string, OmoRoleConfig> = {}
  if (!isRecord(raw)) return out
  for (const [role, config] of Object.entries(raw)) {
    if (!isOmoRole(role)) continue
    out[role] = fromStoredRoleConfig(config)
  }
  return out
}

function normalizeSessions(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isRecord(raw)) return out
  for (const [sessionId, role] of Object.entries(raw)) {
    if (typeof role === 'string' && isOmoRole(role)) out[sessionId] = role
  }
  return out
}

/** Normalize a raw settings section into the client runtime shape. */
export function normalizeOmoSettingsSection(raw: unknown): OmoSettingsSection {
  if (!isRecord(raw)) return { roles: {}, sessions: {} }
  return {
    roles: normalizeRoles(raw.roles),
    sessions: normalizeSessions(raw.sessions),
  }
}

function hasModelSelectionShape(value: unknown): value is OmoModelSelection {
  if (!isRecord(value)) return false
  const provider = value.provider
  const model = value.model
  return typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== ''
}

/**
 * Sanitize ONE stored role config for legacy malformed shapes. The only
 * mutation performed is dropping an `ultrawork.model` that is present but is
 * not a valid provider/model pair (older settings contain `"model": {}`).
 * Everything else is preserved exactly as stored.
 */
function sanitizeStoredRoleConfig(raw: unknown): { config: StoredOmoRoleConfig; changed: boolean } {
  const base: Record<string, unknown> = isRecord(raw) ? { ...raw } : {}
  let changed = false

  if (isRecord(base.ultrawork)) {
    const ultrawork: Record<string, unknown> = { ...base.ultrawork }
    if (ultrawork.model !== undefined && ultrawork.model !== null && !hasModelSelectionShape(ultrawork.model)) {
      delete ultrawork.model
      changed = true
    }
    if (Object.keys(ultrawork).length === 0) {
      delete base.ultrawork
      changed = true
    } else {
      base.ultrawork = ultrawork
    }
  }

  return { config: base as unknown as StoredOmoRoleConfig, changed }
}

/**
 * Sanitize a full stored roles map and report which role ids were changed.
 * Used by the host self-heal to clean legacy `ultrawork.model: {}` entries
 * once, without dropping unknown roles or unrelated fields.
 */
export function sanitizeStoredRoleConfigs(raw: unknown): {
  roles: Record<string, StoredOmoRoleConfig>
  changedRoleIds: string[]
} {
  const roles: Record<string, StoredOmoRoleConfig> = {}
  const changedRoleIds: string[] = []
  if (!isRecord(raw)) return { roles, changedRoleIds }
  for (const [role, config] of Object.entries(raw)) {
    const sanitized = sanitizeStoredRoleConfig(config)
    roles[role] = sanitized.config
    if (sanitized.changed) changedRoleIds.push(role)
  }
  return { roles, changedRoleIds }
}
