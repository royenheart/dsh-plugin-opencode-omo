/**
 * Browser wire vocabulary for the opencode-omo role surface. Pure types and
 * small JSON helpers shared by the composer RoleSelect and the header
 * RoleSettings modal — no cordis imports, so both are bundled by the client
 * half only.
 */
import type { OmoModelSelection, OmoRoleConfig } from '../core/omo-roles.ts'

export type { OmoModelSelection, OmoRoleConfig } from '../core/omo-roles.ts'

/** One role row served by the host catalog endpoint. */
export interface OmoRoleView {
  readonly id: string
  readonly displayName: string
  readonly mode: 'primary' | 'subagent' | 'all'
  readonly description: string
  readonly fallbackHint: string
}

/** dsh-side seam support detected by the host plugin at load. */
export interface OmoCompat {
  readonly assistantPrefill: boolean
  readonly maxStepsMode: 'assistant-prefill' | 'system-prompt-section' | 'disabled'
  readonly warnings: readonly string[]
  readonly detectionFailed: boolean
}

/** GET /plugins/.../roles response. */
export interface OmoRolesResponse {
  readonly ok: boolean
  readonly error?: string
  readonly defaultRole: string
  readonly roles: readonly OmoRoleView[]
  readonly configs: Record<string, OmoRoleConfig>
  /** Catalog-resolved omo default primary per role (null = none available). */
  readonly defaults: Record<string, OmoModelSelection | null>
  readonly compat?: OmoCompat
  readonly currentRole?: string
}

/** POST /plugins/.../role response. */
export interface OmoRoleResponse {
  readonly ok: boolean
  readonly error?: string
  readonly currentRole?: string
  readonly config?: OmoRoleConfig
}

/** POST /plugins/.../role-config response. */
export interface OmoRoleConfigResponse {
  readonly ok: boolean
  readonly error?: string
  readonly config?: OmoRoleConfig
}

/** One adapter-owned reasoning effort choice. */
export interface OmoReasoningEffort {
  readonly id: string
  readonly name: string
}

/** A flattened catalog model entry for the settings dropdowns. */
export interface OmoCatalogModel extends OmoModelSelection {
  readonly label: string
  readonly efforts?: readonly OmoReasoningEffort[]
  readonly defaultEffort?: string | undefined
}

/** Encode one provider/model pair as a Menu row id (both strings are dsh ids, not URLs). */
export function modelKey(model: OmoModelSelection): string {
  return `${model.provider}::${model.model}`
}

/** Parse a model Menu row id back into provider/model (unknown ids return undefined). */
export function parseModelKey(key: string): OmoModelSelection | undefined {
  const separator = key.indexOf('::')
  if (separator <= 0 || separator === key.length - 2) return undefined
  return { provider: key.slice(0, separator), model: key.slice(separator + 2) }
}

/** Session list row face used to decide whether the composer role chip shows. */
export interface SessionPresetSummary {
  readonly agentPreset?: string
  readonly projectionValues?: Readonly<Partial<Record<string, unknown>>> & {
    readonly agentPreset?: string | null
  }
}

/**
 * Read the session's agent-preset id. dsh 0.1.2 keeps it on
 * `projectionValues.agentPreset`; older list rows put it on the summary
 * itself. Empty / non-string values do not count.
 */
export function sessionAgentPreset(summary: SessionPresetSummary | undefined): string | undefined {
  const projected = summary?.projectionValues?.agentPreset
  if (typeof projected === 'string' && projected !== '') return projected
  if (typeof summary?.agentPreset === 'string' && summary.agentPreset !== '') return summary.agentPreset
  return undefined
}

/** Ask the host for the role catalog plus one session's current role. */
export async function loadOmoRoles(
  endpoint: string,
  sessionId: string | undefined,
): Promise<OmoRolesResponse> {
  const suffix = sessionId === undefined ? '' : `?sessionId=${encodeURIComponent(sessionId)}`
  const response = await fetch(`${endpoint}${suffix}`, { headers: { accept: 'application/json' } })
  const data = await response.json() as OmoRolesResponse
  if (!data.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
  return data
}

/** Persist the selected role for one session. */
export async function postOmoRole(
  endpoint: string,
  sessionId: string,
  role: string,
): Promise<OmoRoleResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, role }),
  })
  const data = await response.json() as OmoRoleResponse
  if (!data.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
  return data
}

/** Persist one role's model/fallback configuration. */
export async function postOmoRoleConfig(
  endpoint: string,
  role: string,
  config: OmoRoleConfig,
): Promise<OmoRoleConfigResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      role,
      model: config.model ?? null,
      fallbackModels: config.fallbackModels,
    }),
  })
  const data = await response.json() as OmoRoleConfigResponse
  if (!data.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
  return data
}
