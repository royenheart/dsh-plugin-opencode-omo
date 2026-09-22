/**
 * dsh-plugin-opencode-omo — node half.
 *
 * The package is a dsh BUNDLE (host row + agent-preset declaration through the
 * generated `cordis.patch.yml`) and a host plugin row. The host half:
 * - declares the durable role configuration as this entry's own volatile
 *   Cordis Config (`roles`, `sessions`), so dsh 0.1.7's Config-derived settings
 *   forms own the schema, persistence, and revision fencing;
 * - mounts the OmoRoleRegistry service (`ctx.omoRoles`) consumed by the
 *   preset's native-seam loop shim;
 * - serves the browser surface through an authenticated connection RPC
 *   channel (`/opencode-omo`): role catalog, per-session role, and per-role
 *   model/fallback configuration. The channel is the non-loopback transport:
 *   dsh deliberately keeps browser settings forms process-local for a
 *   non-loopback page, so the documented "settings persist" behavior needs
 *   this authenticated path there.
 */
import type { Context, Fiber } from '@deepseek-ai/cordis'
// Type-only: the config editor's types carry the loader's `Fiber.entry`
// augmentation — the profile row that owns the running instance, which is how
// a plugin addresses its own Config (same import the harness's own
// agent-default-model uses).
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'
import { OmoRoleRegistry } from './omo-role-registry.ts'
import type { OmoRoleConfigPatch, OmoRoleRegistryFace } from './omo-role-registry.ts'
import { OMO_DEFAULT_ROLE } from './core/omo-roles.ts'
import type { StoredOmoRoleConfig } from './core/omo-roles.ts'
import { OMO_ROLE_SETTINGS_NAMESPACE } from './core/omo-settings.ts'
import {
  OMO_RPC_CHANNEL,
  OMO_RPC_ENDPOINTS,
  parseOmoCatalogGetRequest,
  parseOmoRoleConfigSetRequest,
  parseOmoRoleSetRequest,
  type OmoRpcResult,
} from './core/omo-rpc.ts'

export { OmoRoleRegistry } from './omo-role-registry.ts'
export type { OmoRoleConfigPatch, OmoRoleRegistryFace } from './omo-role-registry.ts'
export { OMO_DEFAULT_ROLE, OMO_ROLES, emptyRoleConfig, isOmoRole, normalizeOmoRole } from './core/omo-roles.ts'
export type { OmoModelSelection, OmoRoleConfig, OmoRoleSettings } from './core/omo-roles.ts'
export { OMO_RPC_CHANNEL, OMO_RPC_ENDPOINTS } from './core/omo-rpc.ts'
export type { OmoRpcResult } from './core/omo-rpc.ts'
export { OMO_ROLE_SETTINGS_NAMESPACE } from './core/omo-settings.ts'

/** Cordis plugin name. */
export const name = 'opencode-omo'

/**
 * Required services: only the Config-derived settings face. `webServer` and
 * `connection` are host-layer services a headless composition (dsh-base +
 * dsh-headless, which the migrator's boot probe mounts) does not provide; the
 * authenticated RPC channel waits for them in {@link apply} instead, so this
 * row still activates there.
 */
export const inject = ['settings']

/**
 * One live Config reference on the harness's schemastery (`.volatile()`).
 * Consumers call `get()` during an operation; the reference is stable across
 * live updates.
 */
export interface OmoConfigRef<T> {
  get(): T
}

/** Read a Config field that may be a live reference or a plain value. */
function readConfigRef<T>(value: OmoConfigRef<T> | T): T {
  return typeof (value as OmoConfigRef<T>)?.get === 'function'
    ? (value as OmoConfigRef<T>).get()
    : value as T
}

/**
 * Declare a field live-updatable. The harness's vendored schemastery carries
 * `.volatile()`; an older schemastery copy lacks the marker, so the schema
 * stays valid but the entry exposes no form and the documented role settings
 * fall back to the authenticated RPC transport (apply() logs this loudly).
 */
function schemaSupportsVolatile(): boolean {
  return typeof (z.string() as unknown as { volatile?: unknown }).volatile === 'function'
}

/** Whether this process's schemastery declares live Config fields. */
const VOLATILE_CONFIG = schemaSupportsVolatile()

function live<T extends object>(schema: T): T {
  const marked = schema as T & { volatile?: () => T }
  return typeof marked.volatile === 'function' ? marked.volatile() : schema
}

const modelSelectionSchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  reasoningEffort: z.string(),
})

/**
 * `model` is `{provider, model}` for a pinned model, `null` for the explicit
 * "follow the session model" choice, and absent when the user made no choice
 * (the omo-default primary still applies).
 */
const storedRoleConfigSchema = z.object({
  model: z.union([modelSelectionSchema, z.const(null)]),
  fallbackModels: z.array(modelSelectionSchema).default([]),
  // Plain `number()` (not min/step): a legacy profile may hold a value the
  // registry drops on read, and rejecting it here would refuse the whole
  // imported section.
  maxSteps: z.number(),
  // `any()` keeps legacy `ultrawork: { model: {} }` profiles importable; the
  // registry drops the malformed inner model on read, exactly as the former
  // boot-time self-heal did, and the next write persists the cleaned shape.
  ultrawork: z.object({
    model: z.any(),
    reasoningEffort: z.string(),
  }),
})

/** Durable role configuration owned by this plugin's profile entry. */
export interface OmoHostConfig {
  /** Stored per-role model/fallback configuration, keyed by role id. */
  roles: Record<string, StoredOmoRoleConfig>
  /** Last selected role per session id. */
  sessions: Record<string, string>
}

/**
 * Runtime schema for the durable role configuration. Every field is volatile:
 * dsh 0.1.7 derives the settings form from this schema and writes edits into
 * the active profile patch, which updates these references without remounting
 * the plugin. The marker is per *field*, not on the root object: a root-volatile
 * schema resolves to a single reference and `config.roles` would be undefined,
 * so the registry could never read a live edit.
 */
export const Config = z.object({
  roles: live(z.dict(storedRoleConfigSchema).default({})),
  sessions: live(z.dict(z.string()).default({})),
})

/** The host `settings` face this plugin consumes (`SettingsForms`). */
interface SettingsFormsFace {
  /** Persist one profile entry's Config patch (revision-unfenced). */
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
  /** Hide the auto-generated raw Config page: this plugin ships its own page. */
  configure(presentation: { auto?: boolean }, owner?: Fiber): () => void
}

interface ConnectionRpcFace {
  rpc?: {
    handle(channel: string, handler: (endpoint: string, payload: unknown) => Promise<OmoRpcResult>): () => Promise<void>
  }
}

/** The running profile's paths (`profileContext`, provided by app-boot). */
interface ProfileContextFace {
  /** dsh installation anchor: absolute path of the dsh app's package.json. */
  readonly installAnchor?: string
  /** Active profile directory (holds the profile package.json). */
  readonly dir?: string
  /** dsh home (holds the shared profile module fallback tree). */
  readonly home?: string
}

/**
 * Whether the running harness's OWN `@deepseek-ai/dsh-agent-loop` ships the
 * assistant-prefill seam from
 * `patches/0001-agent-pre-step-assistant-prefill.patch`.
 *
 * Resolution deliberately starts at the dsh installation anchor and the
 * profile directory, not at this plugin's own module: the plugin checkout can
 * hold an unpatched published copy of the loop while the harness runs a
 * patched one, and reading the wrong copy would silently degrade the
 * documented `maxSteps` behavior to the system-prompt fallback.
 *
 * @param ctx - host plugin context (may carry `profileContext`).
 * @returns true when `PreStepDecision.assistantPrefill` reaches the request.
 */
function detectAssistantPrefillSeam(ctx: Context): boolean {
  let profile: ProfileContextFace | undefined
  try {
    // Optional service: absent in headless/test compositions.
    profile = ctx.get('profileContext') as ProfileContextFace | undefined
  } catch {
    profile = undefined
  }
  const anchors = [
    ...(profile?.installAnchor === undefined ? [] : [profile.installAnchor]),
    ...(profile?.dir === undefined ? [] : [join(profile.dir, 'package.json')]),
    ...(profile?.home === undefined
      ? []
      : [join(profile.home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-agent-loop', 'package.json')]),
    // Last resort: this package's own tree (a hand-mounted plugin in tests or a
    // composition that supplies none of the profile facts).
    fileURLToPath(import.meta.url),
  ]
  for (const anchor of anchors) {
    try {
      const entry = createRequire(anchor).resolve('@deepseek-ai/dsh-agent-loop')
      if (readFileSync(entry, 'utf8').includes('assistantPrefill')) return true
    } catch {
      // Try the next anchor.
    }
  }
  return false
}

function badRequest(message: string): OmoRpcResult {
  return {
    ok: false,
    error: {
      code: 'opencode-omo/bad-request',
      message,
      details: {},
    },
  }
}

function badEndpoint(endpoint: string): OmoRpcResult {
  return {
    ok: false,
    error: {
      code: 'opencode-omo/bad-endpoint',
      message: `unknown endpoint ${endpoint}`,
      details: {},
    },
  }
}

/** Dispatch one `/opencode-omo` RPC endpoint. */
async function handleOmoRpc(
  roles: OmoRoleRegistryFace,
  endpoint: string,
  payload: unknown,
): Promise<OmoRpcResult> {
  if (endpoint === OMO_RPC_ENDPOINTS.catalogGet) {
    const request = parseOmoCatalogGetRequest(payload)
    if (request === undefined) return badRequest('invalid catalog/get payload')
    const catalog = roles.roles.map(role => ({ ...role }))
    return {
      ok: true,
      value: {
        defaultRole: OMO_DEFAULT_ROLE,
        roles: catalog,
        configs: roles.configs(),
        defaults: roles.defaults(),
        ...(request.sessionId === undefined ? {} : { currentRole: roles.roleFor(request.sessionId) }),
      },
    }
  }
  if (endpoint === OMO_RPC_ENDPOINTS.roleSet) {
    const request = parseOmoRoleSetRequest(payload)
    if (request === undefined) return badRequest('invalid role/set payload')
    try {
      await roles.setRole(request.sessionId, request.role)
      return {
        ok: true,
        value: {
          currentRole: request.role,
          config: roles.configFor(request.role),
        },
      }
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error))
    }
  }
  if (endpoint === OMO_RPC_ENDPOINTS.roleConfigSet) {
    const request = parseOmoRoleConfigSetRequest(payload)
    if (request === undefined) return badRequest('invalid role-config/set payload')
    try {
      await roles.setRoleConfig(request.role, request.config)
      return {
        ok: true,
        value: { config: roles.configFor(request.role) },
      }
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : String(error))
    }
  }
  return badEndpoint(endpoint)
}

/**
 * Mount the role registry and the authenticated browser RPC channel.
 *
 * The plugin entry's own Config carries the durable role data; its id is the
 * settings-form namespace. `opencode-omo-roles` is kept as the entry id so the
 * harness's one-time `$DSH_HOME/settings.yaml` import (section id → entry id)
 * carries a pre-0.1.7 `opencode-omo-roles` section into the new Config.
 *
 * @param ctx - host plugin context carrying settings (and, in the browser
 *   deployment, webServer + connection for the RPC channel).
 * @param config - the parsed (volatile) role configuration.
 */
export function apply(ctx: Context, config?: OmoHostConfig): void {
  const settings = ctx.get('settings') as SettingsFormsFace | undefined
  // The Loader entry id is the settings-form namespace; a hand-mounted
  // instance (tests, custom compositions) has no entry, and the documented
  // namespace is then the only addressable one. A wrong/missing entry surfaces
  // loudly from `settings.update`, never as a silent no-op.
  const entryId = ctx.fiber.entry?.id ?? OMO_ROLE_SETTINGS_NAMESPACE
  const persist = settings === undefined
    ? undefined
    : (patch: OmoRoleConfigPatch): Promise<void> => settings.update(entryId, patch)

  // This plugin ships its own settings page; without this the Plugins page
  // would also render a generic raw-Config form for the same entry.
  if (settings !== undefined && typeof settings.configure === 'function') {
    try {
      settings.configure({ auto: false }, ctx.fiber)
    } catch (error) {
      ctx.logger?.warn('opencode-omo: could not disable the auto-generated settings page', error)
    }
  }
  if (!VOLATILE_CONFIG && settings !== undefined) {
    ctx.logger?.warn(
      'opencode-omo: @deepseek-ai/schemastery has no .volatile(); the Config-derived settings form '
      + 'will not expose role settings, and the page falls back to the authenticated /opencode-omo transport',
    )
  }

  ctx.plugin(OmoRoleRegistry, {
    roles: () => readConfigRef(config?.roles) ?? {},
    sessions: () => readConfigRef(config?.sessions) ?? {},
    assistantPrefillSeam: detectAssistantPrefillSeam(ctx),
    ...(persist === undefined ? {} : { persist }),
  })

  // The registry service this plugin just mounted becomes injectable once its
  // fiber is up; the browser RPC surface runs in that callback so handlers
  // resolve the same live instance the preset driver reads. `connection` is
  // included so the channel registers only after the connection host service
  // is active (headless compositions without connection skip this callback).
  ctx.inject(['settings', 'webServer', 'omoRoles', 'connection'], (hostCtx) => {
    const roles = hostCtx.omoRoles
    const connection = hostCtx.get('connection') as ConnectionRpcFace | undefined
    hostCtx.effect(() => {
      if (connection?.rpc === undefined) return () => {}
      const disposeRpc = connection.rpc.handle(OMO_RPC_CHANNEL, (endpoint, payload) => {
        return handleOmoRpc(roles, endpoint, payload)
      })
      return () => disposeRpc()
    }, 'opencode-omo: authenticated role rpc')
  })
}
