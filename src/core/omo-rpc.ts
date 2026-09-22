/**
 * RPC contract for the opencode-omo browser surface.
 *
 * The browser normally reads/writes the `opencode-omo-roles` profile entry
 * through `ctx.configForms.get(entryId)` (the Config-derived settings form).
 * On a non-loopback page dsh deliberately resolves that form to memory mode
 * (`status: 'unavailable'`, writes refused), so the client falls back to this
 * authenticated logical channel, which the host plugin registers with
 * `ctx.connection.rpc.handle(OMO_RPC_CHANNEL, handler)`.
 *
 * Authentication is inherited from `client-connection`: the physical route
 * runs every request through the same Host/Origin trust fence and dsh web
 * session cookie verification as the `/api` RPC. The plugin never registers a
 * bare `webServer` write route.
 *
 * This module is pure (no dsh imports) so parsing/validation is unit-testable.
 */

import { isOmoRole, type OmoRoleConfig } from './omo-roles.ts'

/** Single-segment logical channel name (required by `client-connection`). */
export const OMO_RPC_CHANNEL = '/opencode-omo'

/** Endpoints owned by the channel. */
export const OMO_RPC_ENDPOINTS = {
  catalogGet: 'catalog/get',
  roleSet: 'role/set',
  roleConfigSet: 'role-config/set',
} as const

export type OmoRpcEndpoint = (typeof OMO_RPC_ENDPOINTS)[keyof typeof OMO_RPC_ENDPOINTS]

/** Success/failure result shape mirrored from the dsh connection RPC result. */
export interface OmoRpcSuccess {
  readonly ok: true
  readonly value: unknown
}

export interface OmoRpcFailure {
  readonly ok: false
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details: Record<string, never>
  }
}

export type OmoRpcResult = OmoRpcSuccess | OmoRpcFailure

/** `catalog/get` request. */
export interface OmoCatalogGetRequest {
  readonly sessionId?: string
}

/** `role/set` request. */
export interface OmoRoleSetRequest {
  readonly sessionId: string
  readonly role: string
}

/** `role-config/set` request. */
export interface OmoRoleConfigSetRequest {
  readonly role: string
  readonly config: OmoRoleConfig
}

/** Parse a `catalog/get` payload. */
export function parseOmoCatalogGetRequest(raw: unknown): OmoCatalogGetRequest | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const sessionId = (raw as Record<string, unknown>).sessionId
  if (sessionId === undefined) return {}
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  return { sessionId }
}

/** Parse a `role/set` payload. */
export function parseOmoRoleSetRequest(raw: unknown): OmoRoleSetRequest | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const sessionId = (raw as Record<string, unknown>).sessionId
  const role = (raw as Record<string, unknown>).role
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  if (typeof role !== 'string' || !isOmoRole(role)) return undefined
  return { sessionId, role }
}

/** Parse a `role-config/set` payload. */
export function parseOmoRoleConfigSetRequest(raw: unknown): OmoRoleConfigSetRequest | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const role = (raw as Record<string, unknown>).role
  const config = (raw as Record<string, unknown>).config
  if (typeof role !== 'string' || !isOmoRole(role)) return undefined
  if (config === null || typeof config !== 'object' || Array.isArray(config)) return undefined
  return { role, config: config as OmoRoleConfig }
}
