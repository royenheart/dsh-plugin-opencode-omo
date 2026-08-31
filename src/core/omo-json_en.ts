/**
 * omo.json import core (English surface).
 *
 * Pure, dependency-injected logic shared by the host routes, the startup
 * auto-import, and the CLI script.
 *
 * Two accepted file formats:
 *  1. Official oh-my-openagent omo.json (validated against
 *     assets/omo.schema.json v4.19.x): `{ "$schema": …, "[opencode]": {
 *     "agents": { "<role>": { "model": "provider/model", "reasoning": …,
 *     "fallback_models": [ "provider/model" | { "model": …, "reasoning": … } ],
 *     "ultrawork": { "model": …, "reasoning": … }, … } } }, … }`. The
 *     top-level `agents` section is also accepted when `[opencode]` is absent,
 *     and every other official section ($schema, categories, codegraph, task,
 *     teams, models, profiles, [senpi], [codex], *_migrations) is ignored.
 *  2. Flat DSH map: `{ "<role>": { "model": { provider, model }, … } }` (the
 *     original role-config wire shape).
 *
 * Imports are non-fatal by design: unknown roles and malformed entries are
 * collected as per-role errors while valid entries still apply.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { isOmoRole, normalizeRoleConfig } from '../omo-role-registry_en.ts'
import type { OmoModelSelection, OmoRoleConfig } from './omo-roles_en.ts'

/** Default location of the omo.json defaults file. */
export const OMO_JSON_DEFAULT_PATH = '~/.omo/omo.json'

/** Hard cap for an imported file (bytes); larger files are refused unread. */
export const OMO_JSON_MAX_BYTES = 2 * 1024 * 1024

/** omo provider aliases that differ from the DSH provider ids. */
const PROVIDER_ALIASES: Record<string, string> = {
  deepseek: 'deepseek-official',
}

/** Expand a leading `~/` against the host user's home directory. */
export function expandOmoPath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

/** Split an omo "provider/model" reference into a DSH model selection. */
export function splitModelRef(raw: unknown): OmoModelSelection | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined
  const slash = raw.indexOf('/')
  if (slash <= 0) return undefined
  const provider = PROVIDER_ALIASES[raw.slice(0, slash)] ?? raw.slice(0, slash)
  return { provider, model: raw.slice(slash + 1) }
}

/** The official reasoning vocabulary is open-ended; pass strings through. */
export function omoReasoningEffort(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

/** Stored-shape → wire-shape conversion (mirrors the registry's configFor). */
function toWireConfig(stored: ReturnType<typeof normalizeRoleConfig>): OmoRoleConfig {
  return {
    ...(stored.model === null ? {} : { model: stored.model }),
    fallbackModels: stored.fallbackModels ?? [],
    ...(stored.maxSteps === undefined ? {} : { maxSteps: stored.maxSteps }),
    ...(stored.ultrawork === undefined ? {} : { ultrawork: stored.ultrawork }),
  }
}

/** Map one fallback_models entry (string or object) into a selection. */
function parseFallbackEntry(raw: unknown): OmoModelSelection | undefined {
  if (typeof raw === 'string') return splitModelRef(raw)
  if (raw === null || typeof raw !== 'object') return undefined
  const entry = raw as Record<string, unknown>
  const selection = splitModelRef(entry.model)
  if (selection === undefined) return undefined
  const effort = omoReasoningEffort(entry.reasoning ?? entry.reasoningEffort)
  return { ...selection, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
}

/** Parse one official-format agent entry into a normalized role config. */
function parseOmoAgent(role: string, raw: unknown): { config?: OmoRoleConfig; error?: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: `role "${role}": agent entry must be an object` }
  }
  const entry = raw as Record<string, unknown>
  const modelRef = entry.model ?? (Array.isArray(entry.models) ? entry.models[0] : undefined)
  const model = modelRef === undefined ? undefined : splitModelRef(
    modelRef !== null && typeof modelRef === 'object' ? (modelRef as Record<string, unknown>).model : modelRef,
  )
  if (modelRef !== undefined && model === undefined) {
    return { error: `role "${role}": model must be a "provider/model" string` }
  }
  const effort = omoReasoningEffort(entry.reasoning)
  const rawFallbacks = entry.fallback_models
  const fallbackModels = typeof rawFallbacks === 'string'
    ? [parseFallbackEntry(rawFallbacks)].filter((item): item is OmoModelSelection => item !== undefined)
    : Array.isArray(rawFallbacks)
      ? rawFallbacks.map(parseFallbackEntry).filter((item): item is OmoModelSelection => item !== undefined)
      : []
  const ultraworkInput = entry.ultrawork
  const ultrawork = ultraworkInput !== null && typeof ultraworkInput === 'object'
    ? (() => {
      const ultra = ultraworkInput as Record<string, unknown>
      const ultraModel = splitModelRef(ultra.model)
      const ultraEffort = omoReasoningEffort(ultra.reasoning)
      if (ultraModel === undefined && ultraEffort === undefined) return undefined
      return {
        ...(ultraModel === undefined ? {} : { model: ultraModel }),
        ...(ultraEffort === undefined ? {} : { reasoningEffort: ultraEffort }),
      }
    })()
    : undefined
  return {
    config: toWireConfig(normalizeRoleConfig({
      ...(model === undefined
        ? {}
        : { model: { ...model, ...(effort === undefined ? {} : { reasoningEffort: effort }) } }),
      fallbackModels,
      ...(ultrawork === undefined ? {} : { ultrawork }),
    })),
  }
}

/** Parse the official-format agents section into entries + errors. */
function parseAgentsSection(agents: unknown): { entries: Record<string, OmoRoleConfig>; errors: string[] } {
  const entries: Record<string, OmoRoleConfig> = {}
  const errors: string[] = []
  if (agents === null || typeof agents !== 'object' || Array.isArray(agents)) {
    return { entries, errors: ['agents section must be an object mapping role ids to configs'] }
  }
  for (const [role, entry] of Object.entries(agents)) {
    if (!isOmoRole(role)) {
      errors.push(`unknown omo role "${role}"`)
      continue
    }
    const parsed = parseOmoAgent(role, entry)
    if (parsed.error !== undefined) errors.push(parsed.error)
    else entries[role] = parsed.config!
  }
  return { entries, errors }
}

/** Parse one omo.json document into per-role configs plus collected errors. */
export function parseOmoJson(text: string): {
  entries: Record<string, OmoRoleConfig>
  errors: string[]
} {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { entries: {}, errors: [`invalid JSON: ${String(error instanceof Error ? error.message : error)}`] }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { entries: {}, errors: ['omo.json root must be a JSON object'] }
  }
  const root = raw as Record<string, unknown>

  // Official oh-my-openagent format: detected by the presence of the
  // "[opencode]" section or the "$schema" marker. Agents live under
  // "[opencode]".agents (preferred) or the top-level "agents" section;
  // every other official section is ignored. A legitimately agent-less
  // official file parses to an empty entry set with no errors.
  const opencode = root['[opencode]']
  const isOfficial = opencode !== undefined || typeof root.$schema === 'string'
  if (isOfficial) {
    const nestedAgents = opencode !== null && typeof opencode === 'object'
      ? (opencode as Record<string, unknown>).agents
      : undefined
    const agents = nestedAgents ?? root.agents ?? {}
    return parseAgentsSection(agents)
  }

  // Flat DSH map format.
  const entries: Record<string, OmoRoleConfig> = {}
  const errors: string[] = []
  for (const [role, config] of Object.entries(root)) {
    if (!isOmoRole(role)) {
      errors.push(`unknown omo role "${role}"`)
      continue
    }
    try {
      const stored = normalizeRoleConfig(config as OmoRoleConfig)
      entries[role] = toWireConfig(stored)
    } catch (error) {
      errors.push(`role "${role}": ${String(error instanceof Error ? error.message : error)}`)
    }
  }
  return { entries, errors }
}

/**
 * Import one omo.json document through the role registry.
 * `reader(path)` returns the file text (injected for tests); `registry` is
 * any object exposing `setRoleConfig(role, config)`.
 */
export async function importOmoJson(
  reader: (path: string) => Promise<string>,
  registry: { setRoleConfig(role: string, config: OmoRoleConfig): Promise<void> },
  path: string,
): Promise<{ ok: boolean; imported: number; errors: string[] }> {
  let text: string
  try {
    text = await reader(path)
  } catch (error) {
    return {
      ok: false,
      imported: 0,
      errors: [`cannot read ${path}: ${String(error instanceof Error ? error.message : error)}`],
    }
  }
  const { entries, errors } = parseOmoJson(text)
  let imported = 0
  for (const [role, config] of Object.entries(entries)) {
    try {
      await registry.setRoleConfig(role, config)
      imported += 1
    } catch (error) {
      errors.push(`role "${role}": ${String(error instanceof Error ? error.message : error)}`)
    }
  }
  return { ok: true, imported, errors }
}

/** Read an omo.json file with the size cap enforced (host filesystem). */
export async function readOmoJsonFile(path: string): Promise<string> {
  const info = await stat(path)
  if (info.size > OMO_JSON_MAX_BYTES) {
    throw new Error(`omo.json exceeds the ${OMO_JSON_MAX_BYTES}-byte import cap`)
  }
  return readFile(path, 'utf8')
}
