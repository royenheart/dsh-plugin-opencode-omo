/**
 * Client role store: one reactive snapshot over the opencode-omo role data.
 *
 * On 0.2.1 the role/session maps are the host row's own volatile config, read
 * and written through the official settings form (`ctx.configForms.get`). That
 * transport is authenticated by the harness's `/api` boundary on every browser,
 * so the former private connection-RPC channel and its loopback/non-loopback
 * split are gone.
 *
 * The store itself is React-free so the transport selection can be unit-tested
 * with plain Node; components subscribe through `useSyncExternalStore`.
 */

import { OMO_DEFAULT_ROLE, OMO_ROLES } from '../core/omo-roles.ts'
import type { OmoSettingsSection } from '../core/omo-settings.ts'
import type { OmoRoleConfig } from '../core/omo-roles.ts'
import type { OmoModelSelection, OmoRolesState, OmoRoleView } from './omo-wire.ts'

/** The official settings form face this client consumes (see `ConfigForm`). */
export interface OmoConfigForm {
  getSnapshot(): {
    readonly status: 'loading' | 'ready' | 'unavailable'
    readonly value?: OmoSettingsSection
    readonly writable?: boolean
  }
  subscribe(listener: () => void): () => void
  set(field: 'roles' | 'sessions', value: unknown): Promise<boolean>
}

const EMPTY_STATE: OmoRolesState = {
  defaultRole: OMO_DEFAULT_ROLE,
  roles: OMO_ROLES,
  configs: {},
  sessions: {},
  defaults: {},
  currentRole: OMO_DEFAULT_ROLE,
  loading: true,
  degraded: false,
  error: null,
}

/**
 * One reactive role store. Instantiate per mounted surface (composer chip or
 * settings section) with the session id that surface should resolve.
 */
export class OmoRolesStore {
  private state: OmoRolesState = { ...EMPTY_STATE }
  private readonly listeners = new Set<() => void>()
  private unsubscribeForm: (() => void) | undefined
  private started = false

  constructor(
    private readonly form: OmoConfigForm | undefined,
    private readonly sessionId: string | undefined,
  ) {}

  getSnapshot = (): OmoRolesState => {
    return this.state
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Start form subscription and the initial read. Idempotent. */
  start(): () => void {
    if (this.started) return () => {}
    this.started = true
    if (this.form !== undefined) {
      this.unsubscribeForm = this.form.subscribe(() => { this.refresh() })
    }
    this.refresh()
    return () => {
      this.unsubscribeForm?.()
      this.unsubscribeForm = undefined
      this.started = false
    }
  }

  /** Persist one session's role. */
  async setRole(sessionId: string, role: string): Promise<void> {
    if (this.form === undefined) throw new Error('opencode-omo settings unavailable in this browser')
    const section = this.section()
    const sessions = { ...section.sessions, [sessionId]: role }
    this.publish({ ...this.state, sessions, currentRole: role, error: null })
    const accepted = await this.form.set('sessions', sessions)
    if (!accepted) {
      this.refresh()
      const error = new Error('the Host refused the role change')
      this.publish({ ...this.state, error: error.message })
      throw error
    }
  }

  /** Persist one role's model/fallback configuration. */
  async setRoleConfig(role: string, config: OmoRoleConfig): Promise<void> {
    if (this.form === undefined) throw new Error('opencode-omo settings unavailable in this browser')
    const section = this.section()
    const roles = { ...section.roles, [role]: config }
    this.publish({ ...this.state, configs: roles, error: null })
    const accepted = await this.form.set('roles', roles)
    if (!accepted) {
      this.refresh()
      const error = new Error('the Host refused the role configuration')
      this.publish({ ...this.state, error: error.message })
      throw error
    }
  }

  /** Re-read configs/sessions from the settings form. */
  private refresh(): void {
    const snapshot = this.form?.getSnapshot()
    if (snapshot === undefined) {
      this.publish({ ...this.state, loading: false, degraded: true, error: 'opencode-omo settings unavailable in this browser' })
      return
    }
    if (snapshot.status === 'ready') {
      const section = snapshot.value ?? { roles: {}, sessions: {} }
      this.publish({
        ...this.state,
        roles: OMO_ROLES,
        configs: section.roles,
        sessions: section.sessions,
        currentRole: this.sessionId === undefined ? OMO_DEFAULT_ROLE : (section.sessions[this.sessionId] ?? OMO_DEFAULT_ROLE),
        loading: false,
        degraded: false,
        error: null,
      })
      return
    }
    if (snapshot.status === 'unavailable') {
      this.publish({
        ...this.state,
        loading: false,
        degraded: true,
        error: 'opencode-omo settings unavailable in this browser',
      })
    }
  }

  private section(): OmoSettingsSection {
    return this.form?.getSnapshot().value ?? { roles: {}, sessions: {} }
  }

  private publish(next: OmoRolesState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

/** Local type re-export kept for component props that only need the model row. */
export type { OmoModelSelection }
