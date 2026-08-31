/**
 * dsh-plugin-opencode-omo — node half.
 *
 * The package is both a dsh BUNDLE (host row via cordis.patch.yml; the preset
 * itself ships through `$DSH_HOME/.agent-presets`) and a host plugin row. The
 * host half:
 * - registers the durable `opencode-omo-roles` settings namespace;
 * - mounts the OmoRoleRegistry service (`ctx.omoRoles`) consumed by the
 *   preset's native-seam loop shim;
 * - serves the small browser surface the client picker/settings use
 *   (role catalog, per-session role, per-role model/fallback config).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { OmoRoleRegistry } from './omo-role-registry_en.ts'
import type { OmoRoleRegistryFace } from './omo-role-registry_en.ts'
import { OMO_DEFAULT_ROLE, OMO_ROLES, isOmoRole } from './core/omo-roles_en.ts'
import type { OmoModelSelection } from './core/omo-roles_en.ts'
import { expandOmoPath, importOmoJson, OMO_JSON_DEFAULT_PATH, readOmoJsonFile } from './core/omo-json_en.ts'

export { OmoRoleRegistry } from './omo-role-registry_en.ts'
export type { OmoRoleRegistryFace } from './omo-role-registry_en.ts'
export { OMO_DEFAULT_ROLE, OMO_ROLES, emptyRoleConfig, isOmoRole, normalizeOmoRole } from './core/omo-roles_en.ts'
export type { OmoModelSelection, OmoRoleConfig, OmoRoleSettings } from './core/omo-roles_en.ts'
export { detectDshCompat } from './core/dsh-capabilities_en.ts'
export type { DshCompat } from './core/dsh-capabilities_en.ts'

/** Cordis plugin name. */
export const name = 'opencode-omo'

/** Required services: settings persistence + the web route registry. Headless benches satisfy the web registry with a standalone webserver row (see tests/benches). */
export const inject = ['settings', 'webServer']

/** Settings namespace name (lowercase kebab-case). */
export const OMO_ROLE_SETTINGS_NAMESPACE = 'opencode-omo-roles'

/** Browser-facing routes (exact beats the modules `/plugins` prefix). */
export const ROLES_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/roles'
export const ROLE_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/role'
export const ROLE_CONFIG_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/role-config'
export const OMO_JSON_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/omo-json'
export const OMO_JSON_IMPORT_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/omo-json/import'

const modelSelectionSchema = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
})

const roleConfigSchema = z.object({
  model: z.union([modelSelectionSchema, z.const(null)]),
  fallbackModels: z.array(modelSelectionSchema).default([]),
  maxSteps: z.number(),
  ultrawork: z.object({
    model: modelSelectionSchema,
    reasoningEffort: z.string(),
  }),
})

/** Runtime schema for the durable settings section. */
const SettingsSchema = z.object({
  roles: z.dict(roleConfigSchema).default({}),
  sessions: z.dict(z.string()).default({}),
  omoJson: z.object({
    enabled: z.boolean().default(false),
    path: z.string().default(OMO_JSON_DEFAULT_PATH),
  }).default({ enabled: false, path: OMO_JSON_DEFAULT_PATH }),
})

/** Reject non-string, empty, or absurdly long omo.json paths. */
function cleanOmoPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 1024) return undefined
  return value.trim()
}

/** Read a request body as UTF-8 text. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * Mount the role registry and its HTTP surface.
 * @param ctx - host plugin context carrying settings and httpServer.
 */
export function apply(ctx: Context): void {
  const scope = ctx.settings.register(
    settingsNamespace(OMO_ROLE_SETTINGS_NAMESPACE),
    SettingsSchema,
    { applies: 'live' },
  )
  ctx.plugin(OmoRoleRegistry, { settings: scope })

  // The registry service this plugin just mounted becomes injectable once its
  // fiber is up; the HTTP surface runs in that callback so the route handlers
  // resolve the same live instance the preset driver reads.
  ctx.inject(['settings', 'webServer', 'omoRoles'], (hostCtx) => {
    const roles = hostCtx.omoRoles
    hostCtx.effect(() => {
    const catalog = roles.roles.map(role => ({ ...role }))

    const disposeRoles = ctx.webServer.register({
      kind: 'exact',
      path: ROLES_ENDPOINT,
      handler: (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://dsh.internal')
        const sessionId = url.searchParams.get('sessionId')
        const configs = roles.configs()
        sendJson(res, 200, {
          ok: true,
          defaultRole: OMO_DEFAULT_ROLE,
          roles: catalog,
          configs,
          defaults: roles.defaults(),
          compat: roles.compat,
          ...(sessionId === null ? {} : { currentRole: roles.roleFor(sessionId) }),
        })
      },
    })

    const disposeRole = ctx.webServer.register({
      kind: 'exact',
      path: ROLE_ENDPOINT,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        let body: { sessionId?: unknown; role?: unknown }
        try {
          body = JSON.parse(await readBody(req)) as { sessionId?: unknown; role?: unknown }
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' })
          return
        }
        const sessionId = body.sessionId
        const role = body.role
        if (typeof sessionId !== 'string' || sessionId === '' || typeof role !== 'string' || !isOmoRole(role)) {
          sendJson(res, 400, { ok: false, error: 'expected {sessionId: string, role: known omo role}' })
          return
        }
        try {
          await roles.setRole(sessionId, role)
          sendJson(res, 200, { ok: true, currentRole: role, config: roles.configFor(role) })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const disposeRoleConfig = ctx.webServer.register({
      kind: 'exact',
      path: ROLE_CONFIG_ENDPOINT,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        let body: {
          role?: unknown
          model?: unknown
          fallbackModels?: unknown
          maxSteps?: unknown
          ultrawork?: unknown
        }
        try {
          body = JSON.parse(await readBody(req)) as typeof body
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' })
          return
        }
        const role = body.role
        if (typeof role !== 'string' || !isOmoRole(role)) {
          sendJson(res, 400, { ok: false, error: 'expected {role: known omo role}' })
          return
        }
        const model = body.model
        const fallbackModels = body.fallbackModels
        const isSelection = (value: unknown): value is OmoModelSelection =>
          typeof value === 'object' && value !== null
          && typeof (value as OmoModelSelection).provider === 'string'
          && typeof (value as OmoModelSelection).model === 'string'
        const cleanSelection = (value: OmoModelSelection): OmoModelSelection => ({
          provider: value.provider,
          model: value.model,
          ...(typeof value.reasoningEffort === 'string' && value.reasoningEffort !== ''
            ? { reasoningEffort: value.reasoningEffort }
            : {}),
        })
        const ultraworkRaw = body.ultrawork
        const ultrawork = ultraworkRaw !== null && typeof ultraworkRaw === 'object'
          ? {
            ...(isSelection((ultraworkRaw as { model?: unknown }).model)
              ? { model: cleanSelection((ultraworkRaw as { model: OmoModelSelection }).model) }
              : {}),
            ...(typeof (ultraworkRaw as { reasoningEffort?: unknown }).reasoningEffort === 'string'
              ? { reasoningEffort: (ultraworkRaw as { reasoningEffort: string }).reasoningEffort }
              : {}),
          }
          : undefined
        const config = {
          ...(model === null || model === undefined
            ? {}
            : isSelection(model)
              ? { model: cleanSelection(model) }
              : { __invalid: true as const }),
          fallbackModels: Array.isArray(fallbackModels)
            ? fallbackModels.filter(isSelection).map(cleanSelection)
            : [],
          ...(typeof body.maxSteps === 'number' && Number.isSafeInteger(body.maxSteps) && body.maxSteps > 0
            ? { maxSteps: body.maxSteps }
            : {}),
          ...(ultrawork === undefined ? {} : { ultrawork }),
        }
        if ('__invalid' in config) {
          sendJson(res, 400, { ok: false, error: 'model must be null or {provider, model}' })
          return
        }
        try {
          await roles.setRoleConfig(role, config)
          sendJson(res, 200, { ok: true, config: roles.configFor(role) })
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    const disposeOmoJson = ctx.webServer.register({
      kind: 'exact',
      path: OMO_JSON_ENDPOINT,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const { enabled, path } = scope.get().omoJson
          sendJson(res, 200, { ok: true, enabled, path })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        let body: { enabled?: unknown; path?: unknown }
        try {
          body = JSON.parse(await readBody(req)) as { enabled?: unknown; path?: unknown }
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' })
          return
        }
        const current = scope.get().omoJson
        const next = {
          enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
          path: body.path === undefined ? current.path : (cleanOmoPath(body.path) ?? current.path),
        }
        if (body.path !== undefined && cleanOmoPath(body.path) === undefined) {
          sendJson(res, 400, { ok: false, error: 'path must be a non-empty string of at most 1024 characters' })
          return
        }
        await scope.update({ omoJson: next })
        // Turning the toggle ON imports immediately (non-fatal, like the button).
        if (next.enabled && !current.enabled) {
          void importOmoJson(readOmoJsonFile, roles, expandOmoPath(next.path)).catch((error: unknown) => {
            console.warn(`[opencode-omo] omo.json import failed: ${String(error)}`)
          })
        }
        sendJson(res, 200, { ok: true, ...next })
      },
    })

    const disposeOmoJsonImport = ctx.webServer.register({
      kind: 'exact',
      path: OMO_JSON_IMPORT_ENDPOINT,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        let body: { path?: unknown }
        try {
          body = JSON.parse(await readBody(req)) as { path?: unknown }
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid json' })
          return
        }
        const requested = body.path === undefined ? scope.get().omoJson.path : cleanOmoPath(body.path)
        if (requested === undefined) {
          sendJson(res, 400, { ok: false, error: 'path must be a non-empty string of at most 1024 characters' })
          return
        }
        const result = await importOmoJson(readOmoJsonFile, roles, expandOmoPath(requested))
        sendJson(res, 200, result)
      },
    })

    // Startup auto-import: when the toggle is ON, apply the configured file
    // once the registry fiber is up. Never fatal; a missing file just logs.
    {
      const { enabled, path } = scope.get().omoJson
      if (enabled) {
        void importOmoJson(readOmoJsonFile, roles, expandOmoPath(path)).then((result) => {
          if (!result.ok || result.errors.length > 0) {
            console.warn(`[opencode-omo] startup omo.json import: ${JSON.stringify(result)}`)
          }
        }).catch((error: unknown) => {
          console.warn(`[opencode-omo] startup omo.json import failed: ${String(error)}`)
        })
      }
    }

      return () => {
        disposeRoles()
        disposeRole()
        disposeRoleConfig()
        disposeOmoJson()
        disposeOmoJsonImport()
      }
    }, 'opencode-omo: role routes')
  })
}
