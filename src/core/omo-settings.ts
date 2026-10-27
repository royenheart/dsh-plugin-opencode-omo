/**
 * Pure normalization for the `opencode-omo` settings section.
 *
 * The host row stores two maps:
 *
 *   opencode-omo:
 *     roles:    { <role>: { model?, fallbackModels, maxSteps?, ultrawork? } }
 *     sessions: { <sessionId>: <role> }
 *
 * The host registry writes `model: null` for "follow the session model"; the
 * browser store decodes the stored section into the runtime shape used by the
 * UI (`model` omitted) with {@link normalizeOmoSettingsSection}. This module
 * owns that conversion so the client and its unit tests share one source of
 * truth with no dsh imports.
 */

import { isOmoRole, type OmoModelSelection, type OmoRoleConfig, type OmoUltraworkOverride, type StoredOmoRoleConfig } from './omo-roles.ts'

/** Host row / settings namespace id addressed by the official settings Remote. */
export const OMO_ROLE_SETTINGS_NAMESPACE = 'opencode-omo'

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

function normalizeRoleConfig(raw: unknown): OmoRoleConfig | undefined {
  if (!isRecord(raw)) return undefined
  const followSession = raw.model === null
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
    ...(followSession ? { followSession: true } : {}),
    fallbackModels,
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(ultrawork === undefined ? {} : { ultrawork }),
  }
}

function normalizeRoles(raw: unknown): Record<string, OmoRoleConfig> {
  const out: Record<string, OmoRoleConfig> = {}
  if (!isRecord(raw)) return out
  for (const [role, config] of Object.entries(raw)) {
    if (!isOmoRole(role)) continue
    const normalized = normalizeRoleConfig(config)
    if (normalized !== undefined) out[role] = normalized
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
