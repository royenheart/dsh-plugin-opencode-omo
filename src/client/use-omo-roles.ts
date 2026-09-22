/**
 * React binding for the opencode-omo role store.
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { OmoConfigForm, OmoRolesStore, OmoRpcCaller } from './omo-roles-store.ts'
import { OmoRolesStore as RoleStore } from './omo-roles-store.ts'
import type { OmoRolesState } from './omo-wire.ts'

export interface UseOmoRolesResult {
  readonly state: OmoRolesState
  readonly store: OmoRolesStore
}

/**
 * Create (or reuse) the role store for one mounted surface and subscribe it to
 * React. The store is intentionally per-surface: the composer chip resolves a
 * session id while the settings section reads the global configs.
 */
export function useOmoRoles(
  form: OmoConfigForm | undefined,
  rpc: OmoRpcCaller | undefined,
  sessionId: string | undefined,
): UseOmoRolesResult {
  const store = useMemo(
    () => new RoleStore(form, rpc, sessionId),
    [form, rpc, sessionId],
  )
  useEffect(() => store.start(), [store])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return { state, store }
}
