/**
 * OmoRoleRegistry — the opencode-omo host service shared by the browser-facing
 * authenticated RPC surface and the preset's native-seam loop shim.
 *
 * It owns three planes:
 * - durable configuration (the `opencode-omo-roles` profile entry's volatile
 *   Config): per-role model/fallback configuration plus the last selected role
 *   per session, persisted through the harness settings service into the
 *   profile patch;
 * - process-local session overrides: the role picked in the composer applies
 *   immediately to the live agent without waiting for the config write;
 * - omo-default fallback resolution: when a role has no user-configured
 *   fallbacks, the registry matches omo's `AGENT_MODEL_REQUIREMENTS` model ids
 *   against dsh's live `llm` catalog (recomputed on `llm/adapters-updated`).
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import {
  fromStoredRoleConfig, toStoredRoleConfig,
} from './core/omo-settings.ts'
import {
  OMO_DEFAULT_ROLE, OMO_ROLES, OMO_ROLE_FALLBACK_MODELS, OMO_ROLE_FALLBACK_PROVIDERS, emptyRoleConfig, isOmoRole, normalizeOmoRole,
} from './core/omo-roles.ts'
import type {
  OmoModelSelection, OmoRoleConfig, StoredOmoRoleConfig,
} from './core/omo-roles.ts'

export type {
  OmoModelSelection, OmoRoleConfig, OmoRoleSettings, OmoUltraworkOverride, StoredOmoRoleConfig,
} from './core/omo-roles.ts'
export {
  OMO_DEFAULT_ROLE, OMO_ROLES, OMO_ROLE_FALLBACK_MODELS, OMO_ROLE_FALLBACK_PROVIDERS, emptyRoleConfig, isOmoRole, normalizeOmoRole,
} from './core/omo-roles.ts'
export { toStoredRoleConfig as normalizeRoleConfig } from './core/omo-settings.ts'

/** Minimal llm face used for catalog matching. */
interface LlmFace {
  listProviders(): readonly { id: string }[]
  listModels(provider: string): Promise<readonly { id: string }[]>
}

/** Outward face consumed through `ctx.get('omoRoles')` (the driver) and `ctx.omoRoles`. */
export interface OmoRoleRegistryFace {
  /** Shipped role catalog (static). */
  readonly roles: typeof OMO_ROLES
  /** Role selected for one session (config-backed; default sisyphus). */
  roleFor(sessionId: string): string
  /** Persist the role selected for one session. */
  setRole(sessionId: string, role: string): Promise<void>
  /**
   * Synchronously pin a session's role (child spawn) so the next prompt
   * assembly sees it. Persistence is best-effort; the in-memory override wins
   * for this process even if the config write fails.
   */
  pinRole(sessionId: string, role: string): void
  /** Resolved per-role model routing configuration (user layer only). */
  configFor(role: string): OmoRoleConfig
  /** Persist one role's model routing configuration. */
  setRoleConfig(role: string, config: OmoRoleConfig): Promise<void>
  /** Resolved config snapshot for every shipped role (user layer only). */
  configs(): Record<string, OmoRoleConfig>
  /**
   * Effective primary route: the user-pinned model, the omo-default primary
   * resolved from the live catalog (first AGENT_MODEL_REQUIREMENTS match), or
   * undefined when the user explicitly chose "follow session model".
   */
  primaryModelFor(role: string): OmoModelSelection | undefined
  /** Effective fallback chain: user-configured entries, else omo-default catalog matches after the primary. */
  fallbackModelsFor(role: string): OmoModelSelection[]
  /** Catalog-resolved omo default primary per role (no user settings applied). */
  defaults(): Record<string, OmoModelSelection | null>
  /**
   * Whether the running harness's own `@deepseek-ai/dsh-agent-loop` honors
   * `PreStepDecision.assistantPrefill` (patch
   * `patches/0001-agent-pre-step-assistant-prefill.patch`). The preset driver
   * asks this instead of probing its own module tree, which can hold an
   * unpatched published copy.
   */
  honorsAssistantPrefill(): boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    omoRoles: OmoRoleRegistryFace
  }
}

/** One durable config patch written back into the owning profile entry. */
export interface OmoRoleConfigPatch {
  /** Complete stored roles map (only when this write changed a role). */
  readonly roles?: Record<string, StoredOmoRoleConfig>
  /** Complete session → role map (only when this write changed a session). */
  readonly sessions?: Record<string, string>
}

/**
 * Service plugin config handed to the constructor by the owning apply().
 *
 * On dsh 0.1.7 a plugin's configurable values live in its own Cordis Config
 * with `.volatile()` fields; the owning apply reads them and hands the
 * registry accessor closures plus the entry-scoped persistence callback, so
 * the registry never depends on the settings service shape.
 */
export interface OmoRoleRegistryConfig {
  /** Live stored role configs (the entry's volatile `roles` field). */
  readonly roles: () => Record<string, StoredOmoRoleConfig>
  /** Live session → role map (the entry's volatile `sessions` field). */
  readonly sessions: () => Record<string, string>
  /**
   * Persist a patch into the owning profile entry's Config through
   * `ctx.settings.update(entryId, patch)`. Undefined in compositions without
   * a configurable profile entry (headless/test mounts): the in-memory
   * override still applies for the process.
   */
  readonly persist?: (patch: OmoRoleConfigPatch) => Promise<void>
  /**
   * Whether the running harness's loop ships the assistant-prefill seam
   * (probed by the owning apply against the dsh installation anchor).
   */
  readonly assistantPrefillSeam?: boolean
}

/**
 * Host service body. Constructed with `ctx.plugin(OmoRoleRegistry, { roles,
 * sessions, persist })` from the package's host apply; the driver reaches it
 * through the preset standing scope's `ctx.get('omoRoles')`.
 */
export class OmoRoleRegistry extends Service {
  static inject = ['llm']

  private readonly readRoles: () => Record<string, StoredOmoRoleConfig>
  private readonly readSessions: () => Record<string, string>
  private readonly persist: ((patch: OmoRoleConfigPatch) => Promise<void>) | undefined
  private readonly assistantPrefillSeam: boolean
  private readonly llm: LlmFace
  private readonly sessionOverrides = new Map<string, string>()
  private readonly defaultFallbacks = new Map<string, OmoModelSelection[]>()
  private refreshing: Promise<void> | undefined

  constructor(ctx: Context, config: OmoRoleRegistryConfig) {
    super(ctx, 'omoRoles')
    this.readRoles = config.roles
    this.readSessions = config.sessions
    this.persist = config.persist
    this.assistantPrefillSeam = config.assistantPrefillSeam === true
    this.llm = ctx.get('llm') as LlmFace
    this.ctx.effect(() => {
      const off = this.ctx.on('llm/adapters-updated', () => { void this.refreshDefaultFallbacks() })
      void this.refreshDefaultFallbacks()
      return () => { off() }
    }, 'omo-roles: omo default fallback resolution')
  }

  get roles(): typeof OMO_ROLES {
    return OMO_ROLES
  }

  /** Stored role configs, tolerating legacy malformed values on read. */
  private storedRoles(): Record<string, StoredOmoRoleConfig> {
    try {
      return this.readRoles() ?? {}
    } catch {
      // A detached config reference (plugin unloading) must not break a
      // prompt assembly that is already in flight.
      return {}
    }
  }

  private storedSessions(): Record<string, string> {
    try {
      return this.readSessions() ?? {}
    } catch {
      return {}
    }
  }

  roleFor(sessionId: string): string {
    const override = this.sessionOverrides.get(sessionId)
    if (override !== undefined) return override
    const stored = this.storedSessions()[sessionId]
    return normalizeOmoRole(stored)
  }

  async setRole(sessionId: string, role: string): Promise<void> {
    if (!isOmoRole(role)) throw new TypeError(`unknown omo role "${role}"`)
    const previous = this.sessionOverrides.get(sessionId)
    this.sessionOverrides.set(sessionId, role)
    try {
      await this.persist?.({ sessions: { ...this.storedSessions(), [sessionId]: role } })
    } catch (error) {
      if (previous === undefined) this.sessionOverrides.delete(sessionId)
      else this.sessionOverrides.set(sessionId, previous)
      throw error
    }
  }

  pinRole(sessionId: string, role: string): void {
    if (!isOmoRole(role)) throw new TypeError(`unknown omo role "${role}"`)
    this.sessionOverrides.set(sessionId, role)
    void this.persist?.({ sessions: { ...this.storedSessions(), [sessionId]: role } }).catch(() => {
      // The override already applies for this process.
    })
  }

  configFor(role: string): OmoRoleConfig {
    const stored = this.storedRoles()[normalizeOmoRole(role)]
    if (stored === undefined) return emptyRoleConfig()
    return fromStoredRoleConfig(stored)
  }

  async setRoleConfig(role: string, config: OmoRoleConfig): Promise<void> {
    if (!isOmoRole(role)) throw new TypeError(`unknown omo role "${role}"`)
    const normalized = toStoredRoleConfig(config)
    await this.persist?.({ roles: { ...this.storedRoles(), [role]: normalized } })
  }

  configs(): Record<string, OmoRoleConfig> {
    const settings = this.storedRoles()
    return Object.fromEntries(OMO_ROLES.map(role => {
      const stored = settings[role.id]
      return [role.id, stored === undefined ? emptyRoleConfig() : fromStoredRoleConfig(stored)]
    }))
  }

  primaryModelFor(role: string): OmoModelSelection | undefined {
    const id = normalizeOmoRole(role)
    const stored = this.storedRoles()[id]
    // `model: null` is the explicit "follow session model" choice; an absent
    // `model` still resolves the omo-default primary below.
    if (stored?.model === null) return undefined
    if (stored?.model !== undefined) return { ...stored.model }
    return this.defaultFallbacks.get(id)?.[0]
  }

  defaults(): Record<string, OmoModelSelection | null> {
    return Object.fromEntries(OMO_ROLES.map(role => {
      const primary = this.defaultFallbacks.get(role.id)?.[0]
      return [role.id, primary === undefined ? null : { ...primary }]
    }))
  }

  fallbackModelsFor(role: string): OmoModelSelection[] {
    const config = this.configFor(role)
    if (config.fallbackModels.length > 0) return [...config.fallbackModels]
    const chain = this.defaultFallbacks.get(normalizeOmoRole(role)) ?? []
    const primary = this.primaryModelFor(role)
    // omo attaches only the chain entries AFTER the resolved primary; a
    // primary outside the chain (an exotic user-pinned model) gets no defaults.
    const index = primary === undefined
      ? 0
      : chain.findIndex(entry => entry.provider === primary.provider && entry.model === primary.model)
    return index < 0 ? [] : [...chain.slice(index + 1)]
  }

  honorsAssistantPrefill(): boolean {
    return this.assistantPrefillSeam
  }

  /** Match omo's model-id fallback table against dsh's live catalog. */
  async refreshDefaultFallbacks(): Promise<void> {
    this.refreshing ??= this.resolveDefaultFallbacks().finally(() => { this.refreshing = undefined })
    await this.refreshing
  }

  private async resolveDefaultFallbacks(): Promise<void> {
    const catalog: { provider: string; id: string }[] = []
    const providers = this.llm.listProviders() ?? []
    const providerIndex = new Map(providers.map((provider, index) => [provider.id.toLowerCase(), index]))
    for (const provider of providers) {
      try {
        const models = await this.llm.listModels(provider.id)
        catalog.push(...models.map(model => ({ provider: provider.id, id: model.id })))
      } catch {
        // One adapter with a broken catalog must not hide the sound ones.
      }
    }
    const next = new Map<string, OmoModelSelection[]>()
    for (const role of OMO_ROLES) {
      const desired = OMO_ROLE_FALLBACK_MODELS[role.id] ?? []
      const preferred = OMO_ROLE_FALLBACK_PROVIDERS[role.id] ?? []
      const matches: OmoModelSelection[] = []
      const seen = new Set<string>()
      for (let index = 0; index < desired.length; index += 1) {
        const wanted = desired[index]!.toLowerCase()
        const scopes = (preferred[index] ?? []).map(scope => scope.toLowerCase())
        const scopeRank = new Map(scopes.map((scope, rank) => [scope, rank]))
        const candidates = catalog
          .filter(entry => {
            const id = entry.id.toLowerCase()
            return id.includes(wanted) || wanted.includes(id)
          })
          .sort((left, right) => {
            const leftRank = scopeRank.get(left.provider.toLowerCase()) ?? 1000 + (providerIndex.get(left.provider.toLowerCase()) ?? 0)
            const rightRank = scopeRank.get(right.provider.toLowerCase()) ?? 1000 + (providerIndex.get(right.provider.toLowerCase()) ?? 0)
            return leftRank - rightRank
          })
        for (const entry of candidates) {
          const key = `${entry.provider}\u0000${entry.id}`
          if (seen.has(key)) continue
          seen.add(key)
          matches.push({ provider: entry.provider, model: entry.id })
        }
      }
      next.set(role.id, matches)
    }
    this.defaultFallbacks.clear()
    for (const [role, models] of next) this.defaultFallbacks.set(role, models)
  }
}

export default OmoRoleRegistry
