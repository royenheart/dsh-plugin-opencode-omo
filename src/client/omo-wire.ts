/**
 * Browser wire vocabulary for the opencode-omo role surface. Pure types and
 * small helpers shared by the composer RoleSelect and the settings
 * RoleSettings — no cordis imports, so both are bundled by the client half.
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

/** Reactive snapshot exposed by the client role store. */
export interface OmoRolesState {
  readonly defaultRole: string
  readonly roles: readonly OmoRoleView[]
  readonly configs: Record<string, OmoRoleConfig>
  readonly sessions: Record<string, string>
  /** Catalog-resolved omo default primary per role (null = none available). */
  readonly defaults: Record<string, OmoModelSelection | null>
  readonly currentRole: string
  readonly loading: boolean
  readonly degraded: boolean
  readonly error: string | null
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
  readonly projectionValues?: { readonly agentPreset?: string | null }
}

/**
 * Read the session's agent-preset id. dsh 0.1.6 keeps it on
 * `projectionValues.agentPreset`; older list rows put it on the summary
 * itself. Empty / non-string values do not count.
 */
export function sessionAgentPreset(summary: SessionPresetSummary | undefined): string | undefined {
  const projected = summary?.projectionValues?.agentPreset
  if (typeof projected === 'string' && projected !== '') return projected
  if (typeof summary?.agentPreset === 'string' && summary.agentPreset !== '') return summary.agentPreset
  return undefined
}
