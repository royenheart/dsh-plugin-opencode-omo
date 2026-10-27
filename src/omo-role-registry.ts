/**
 * OmoRoleRegistry — the opencode-omo host service shared by the browser-facing
 * HTTP surface and the preset's native-seam loop shim.
 *
 * It owns three planes:
 * - durable settings (`opencode-omo` row fields): per-role model/fallback
 *   configuration plus the last selected role per session, persisted through
 *   the dsh settings provider;
 * - process-local session overrides: the role picked in the composer applies
 *   immediately to the live agent without waiting for the settings write;
 * - omo-default fallback resolution: when a role has no user-configured
 *   fallbacks, the registry matches omo's `AGENT_MODEL_REQUIREMENTS` model ids
 *   against dsh's live `llm` catalog (recomputed on `llm/adapters-updated`).
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type { Config } from './index.ts'
import {
  OMO_DEFAULT_ROLE, OMO_ROLES, OMO_ROLE_FALLBACK_MODELS, OMO_ROLE_FALLBACK_PROVIDERS, emptyRoleConfig, isOmoRole, normalizeOmoRole,
} from './core/omo-roles.ts'
import type {
  OmoModelSelection, OmoRoleConfig, OmoRoleSettings, OmoUltraworkOverride, StoredOmoRoleConfig,
} from './core/omo-roles.ts'

export type {
  OmoModelSelection, OmoRoleConfig, OmoRoleSettings, OmoUltraworkOverride, StoredOmoRoleConfig,
} from './core/omo-roles.ts'
export {
  OMO_DEFAULT_ROLE, OMO_ROLES, OMO_ROLE_FALLBACK_MODELS, OMO_ROLE_FALLBACK_PROVIDERS, emptyRoleConfig, isOmoRole, normalizeOmoRole,
} from './core/omo-roles.ts'

/** Minimal llm face used for catalog matching. */
interface LlmFace {
  listProviders(): readonly { id: string }[]
  listModels(provider: string): Promise<readonly { id: string }[]>
}

/** Outward face consumed through `ctx.get('omoRoles')` (the driver) and `ctx.omoRoles`. */
export interface OmoRoleRegistryFace {
  /** Shipped role catalog (static). */
  readonly roles: typeof OMO_ROLES
  /** Role selected for one session (settings-backed; default sisyphus). */
  roleFor(sessionId: string): string
  /** Whether the session has an explicit/persisted role pin. */
  hasRolePin(sessionId: string): boolean
  /** Persist the role selected for one session. */
  setRole(sessionId: string, role: string): Promise<void>
  /**
   * Synchronously pin a session's role (child spawn) so the next prompt
   * assembly sees it. Persistence is best-effort; the in-memory override wins
   * for this process even if the settings write fails.
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
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    omoRoles: OmoRoleRegistryFace
  }
}

/** Service plugin config handed to the constructor by the owning apply(). */
export interface OmoRoleRegistryConfig {
  /** The host row's live volatile fields (`roles` / `sessions`). */
  readonly config: Config
}

function normalizeModel(model: OmoModelSelection): OmoModelSelection {
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

/** Normalize one role config for storage (rejects malformed wire shapes). */
export function normalizeRoleConfig(config: OmoRoleConfig): StoredOmoRoleConfig {
  if (config === null || typeof config !== 'object') return { fallbackModels: [] }
  const followSession = config.followSession === true || config.model === null
  const model = config.model === undefined || config.model === null
    ? undefined
    : normalizeModel(config.model)
  const fallbackModels = Array.isArray(config.fallbackModels)
    ? config.fallbackModels.map(normalizeModel)
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
        ? { model: normalizeModel(ultraworkModel) }
        : {}),
      ...(typeof ultraworkInput.reasoningEffort === 'string' && ultraworkInput.reasoningEffort !== ''
        ? { reasoningEffort: ultraworkInput.reasoningEffort }
        : {}),
    }
    : undefined
  const cleanedUltrawork = ultrawork !== undefined && Object.keys(ultrawork).length > 0 ? ultrawork : undefined
  return {
    ...(followSession ? { model: null } : model === undefined ? {} : { model }),
    fallbackModels,
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(cleanedUltrawork === undefined ? {} : { ultrawork: cleanedUltrawork }),
  }
}

/**
 * Host service body. Constructed with `ctx.plugin(OmoRoleRegistry, {settings})`
 * from the package's host apply; the driver reaches it through the preset
 * standing scope's `ctx.get('omoRoles')`.
 */
export class OmoRoleRegistry extends Service {
  static inject = ['llm', 'settings']

  private readonly config: Config
  private readonly settings: Context['settings']
  private readonly llm: LlmFace
  private readonly sessionOverrides = new Map<string, string>()
  private readonly defaultFallbacks = new Map<string, OmoModelSelection[]>()
  private refreshing: Promise<void> | undefined

  constructor(ctx: Context, config: OmoRoleRegistryConfig) {
    super(ctx, 'omoRoles')
    this.config = config.config
    this.settings = ctx.settings
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

  hasRolePin(sessionId: string): boolean {
    const stored = this.config.sessions.get()[sessionId]
    return this.sessionOverrides.has(sessionId) || (stored !== undefined && isOmoRole(stored))
  }

  roleFor(sessionId: string): string {
    const override = this.sessionOverrides.get(sessionId)
    if (override !== undefined) return override
    const stored = this.config.sessions.get()[sessionId]
    return normalizeOmoRole(stored)
  }

  async setRole(sessionId: string, role: string): Promise<void> {
    if (!isOmoRole(role)) throw new TypeError(`unknown omo role "${role}"`)
    const previous = this.sessionOverrides.get(sessionId)
    this.sessionOverrides.set(sessionId, role)
    try {
      await this.settings.update('opencode-omo', {
        sessions: { ...this.config.sessions.get(), [sessionId]: role },
      })
    } catch (error) {
      if (previous === undefined) this.sessionOverrides.delete(sessionId)
      else this.sessionOverrides.set(sessionId, previous)
      throw error
    }
  }

  pinRole(sessionId: string, role: string): void {
    if (!isOmoRole(role)) throw new TypeError(`unknown omo role "${role}"`)
    this.sessionOverrides.set(sessionId, role)
    void this.settings.update('opencode-omo', {
      sessions: { ...this.config.sessions.get(), [sessionId]: role },
    }).catch(() => {
      // The override already applies for this process.
    })
  }

  configFor(role: string): OmoRoleConfig {
    const stored = this.config.roles.get()[normalizeOmoRole(role)]
    if (stored === undefined) return emptyRoleConfig()
    return {
      ...(stored.model === null ? { followSession: true } : stored.model === undefined ? {} : { model: stored.model }),
      fallbackModels: stored.fallbackModels ?? [],
      ...(stored.maxSteps === undefined ? {} : { maxSteps: stored.maxSteps }),
      ...(stored.ultrawork === undefined ? {} : { ultrawork: stored.ultrawork }),
    }
  }

  async setRoleConfig(role: string, config: OmoRoleConfig): Promise<void> {
    if (!isOmoRole(role)) throw new TypeError(`unknown omo role "${role}"`)
    const current = this.config.roles.get()[role]
    const normalized = normalizeRoleConfig(config)
    // settings.update() recursively merges role objects, which cannot remove a
    // previous `model`/`maxSteps`/`ultrawork`. Setting the whole role path via
    // mutate makes the omitted-model omo-default state actually stick.
    const next = {
      ...(normalized.model === undefined ? {} : { model: normalized.model }),
      fallbackModels: normalized.fallbackModels,
      ...(normalized.maxSteps === undefined
        ? current?.maxSteps === undefined ? {} : { maxSteps: current.maxSteps }
        : { maxSteps: normalized.maxSteps }),
      ...(normalized.ultrawork === undefined
        ? current?.ultrawork === undefined ? {} : { ultrawork: current.ultrawork }
        : { ultrawork: normalized.ultrawork }),
    }
    await this.settings.mutate('opencode-omo', [{ op: 'set', path: ['roles', role], value: next }])
  }

  configs(): Record<string, OmoRoleConfig> {
    const roles = this.config.roles.get()
    return Object.fromEntries(OMO_ROLES.map(role => {
      const stored = roles[role.id]
      return [role.id, stored === undefined
        ? emptyRoleConfig()
        : {
          ...(stored.model === null ? { followSession: true } : stored.model === undefined ? {} : { model: stored.model }),
          fallbackModels: stored.fallbackModels ?? [],
          ...(stored.maxSteps === undefined ? {} : { maxSteps: stored.maxSteps }),
          ...(stored.ultrawork === undefined ? {} : { ultrawork: stored.ultrawork }),
        }]
    }))
  }

  primaryModelFor(role: string): OmoModelSelection | undefined {
    const id = normalizeOmoRole(role)
    const stored = this.config.roles.get()[id]
    // `model: null` is the explicit "follow session model" choice.
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
