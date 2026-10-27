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
 *
 * All writes go through `reduce` via `dispatch`; the form subscription, save
 * handlers and UI handlers only emit events. Error states carry a closed
 * machine-readable reason in addition to the display message.
 */

import { OMO_DEFAULT_ROLE, OMO_ROLES } from '../core/omo-roles.ts'
import { normalizeOmoSettingsSection } from '../core/omo-settings.ts'
import type { OmoSettingsSection } from '../core/omo-settings.ts'
import type { OmoRoleConfig } from '../core/omo-roles.ts'
import type { OmoModelSelection, OmoRolesErrorReason, OmoRolesState, OmoRoleView } from './omo-wire.ts'

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

type SnapshotChanges = Partial<Pick<OmoRolesState, 'configs' | 'sessions' | 'currentRole'>>

type StoreEvent =
  | { readonly type: 'snapshot/loading' }
  | { readonly type: 'snapshot/unavailable' }
  | { readonly type: 'snapshot/ready'; readonly section: OmoSettingsSection; readonly currentRole: string }
  | { readonly type: 'save/optimistic'; readonly changes: SnapshotChanges }
  | { readonly type: 'save/failed'; readonly reason: OmoRolesErrorReason; readonly message: string }
  | { readonly type: 'settings/not-ready' }

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
  errorReason: null,
}

function reduce(state: OmoRolesState, event: StoreEvent): OmoRolesState {
  switch (event.type) {
    case 'snapshot/loading':
      return { ...state, loading: true, degraded: false }
    case 'snapshot/unavailable':
      return {
        ...state,
        loading: false,
        degraded: true,
        error: 'opencode-omo settings unavailable in this browser',
        errorReason: 'unavailable',
      }
    case 'snapshot/ready':
      return {
        ...state,
        roles: OMO_ROLES,
        configs: event.section.roles,
        sessions: event.section.sessions,
        currentRole: event.currentRole,
        loading: false,
        degraded: false,
        error: null,
        errorReason: null,
      }
    case 'save/optimistic':
      return { ...state, ...event.changes, error: null, errorReason: null }
    case 'save/failed':
      return { ...state, error: event.message, errorReason: event.reason }
    case 'settings/not-ready':
      return {
        ...state,
        loading: false,
        degraded: true,
        error: 'opencode-omo settings are not ready in this browser',
        errorReason: 'not-ready',
      }
    default: {
      const never: never = event
      return never
    }
  }
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
    const form = this.readyForm()
    const sessions = { ...this.storedSessions(), [sessionId]: role }
    this.dispatch({ type: 'save/optimistic', changes: { sessions: { ...this.state.sessions, [sessionId]: role }, currentRole: role } })
    let accepted
    try {
      accepted = await form.set('sessions', sessions)
    } catch (cause) {
      this.fail('transport-failed', cause)
      throw cause
    }
    if (!accepted) {
      const error = new Error('the Host refused the role change')
      this.fail('host-refused', error)
      throw error
    }
  }

  /** Persist one role's model/fallback configuration. */
  async setRoleConfig(role: string, config: OmoRoleConfig): Promise<void> {
    const form = this.readyForm()
    const section = this.section()
    const current = section.roles[role] ?? { fallbackModels: [] as const }
    const next = { ...current, ...config }
    const { followSession, ...storedBase } = next
    // Stored shape: model:null is the explicit "follow session" sentinel; an
    // omitted model is the distinct omo-default state. Fallback/effort edits
    // therefore must not silently turn a default primary into follow-session.
    const stored = {
      ...storedBase,
      ...(followSession === true
        ? { model: null }
        : next.model === undefined
          ? {}
          : { model: next.model }),
    }
    const roles = { ...this.storedRoles(), [role]: stored }
    this.dispatch({ type: 'save/optimistic', changes: { configs: { ...section.roles, [role]: next } } })
    let accepted
    try {
      accepted = await form.set('roles', roles)
    } catch (cause) {
      this.fail('transport-failed', cause)
      throw cause
    }
    if (!accepted) {
      const error = new Error('the Host refused the role configuration')
      this.fail('host-refused', error)
      throw error
    }
  }

  /** Re-read configs/sessions from the settings form. */
  private refresh(): void {
    const snapshot = this.form?.getSnapshot()
    if (snapshot === undefined) {
      this.dispatch({ type: 'snapshot/unavailable' })
      return
    }
    if (snapshot.status === 'ready') {
      const section = normalizeOmoSettingsSection(snapshot.value)
      this.dispatch({
        type: 'snapshot/ready',
        section,
        currentRole: this.sessionId === undefined ? OMO_DEFAULT_ROLE : (section.sessions[this.sessionId] ?? OMO_DEFAULT_ROLE),
      })
      return
    }
    if (snapshot.status === 'unavailable') {
      this.dispatch({ type: 'snapshot/unavailable' })
      return
    }
    this.dispatch({ type: 'snapshot/loading' })
  }

  private section(): OmoSettingsSection {
    return normalizeOmoSettingsSection(this.form?.getSnapshot().value)
  }

  /** A form that has received the Host's first accepted section and accepts writes. */
  private readyForm(): OmoConfigForm {
    const snapshot = this.form?.getSnapshot()
    if (this.form === undefined || snapshot === undefined || snapshot.status !== 'ready' || snapshot.writable !== true) {
      this.dispatch({ type: 'settings/not-ready' })
      throw new Error('opencode-omo settings are not ready in this browser')
    }
    return this.form
  }

  private fail(reason: OmoRolesErrorReason, cause: unknown): void {
    this.refresh()
    this.dispatch({
      type: 'save/failed',
      reason,
      message: cause instanceof Error ? cause.message : String(cause),
    })
  }

  /** Stored role map, preserving other roles' null/omitted follow-session shape. */
  private storedRoles(): Record<string, unknown> {
    const value = this.form?.getSnapshot().value as { roles?: unknown } | undefined
    return value !== null && typeof value === 'object' && value.roles !== null && typeof value.roles === 'object'
      ? { ...value.roles as Record<string, unknown> }
      : {}
  }

  /** Stored session map, preserving entries the runtime normalizer would drop. */
  private storedSessions(): Record<string, string> {
    const value = this.form?.getSnapshot().value as { sessions?: unknown } | undefined
    return value !== null && typeof value === 'object' && value.sessions !== null && typeof value.sessions === 'object'
      ? { ...value.sessions as Record<string, string> }
      : {}
  }

  /** The only writer of reactive state. */
  private dispatch(event: StoreEvent): void {
    const next = reduce(this.state, event)
    if (next === this.state) return
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

/** Local type re-export kept for component props that only need the model row. */
export type { OmoModelSelection }
