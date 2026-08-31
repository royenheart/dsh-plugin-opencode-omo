/**
 * opencode-omo role catalog — pure data shared by the host role registry and
 * the browser role picker/settings. Role ids and display names mirror omo's
 * `shared/agent-display-names.ts`; `mode` mirrors omo's `AgentMode`:
 * - primary: available as the main composer agent and follows the UI model
 * - subagent: specialist roles used through the delegation tools
 * - all: available in both contexts
 * The `fallbackHint` strings are the model families from omo's
 * `model-core/agent-model-requirements.ts`; they are informational only —
 * the actual selectable models always come from dsh's model catalog.
 */

/** provider/model pair as selected from dsh's model catalog. */
export interface OmoModelSelection {
  readonly provider: string
  readonly model: string
  /** Adapter-owned reasoning effort, kept when the adapter accepts it. */
  readonly reasoningEffort?: string | undefined
}

/** Per-role model routing configuration (runtime face). */
export interface OmoRoleConfig {
  /** Explicit primary model; undefined means "follow the session model". */
  readonly model?: OmoModelSelection | undefined
  /** Ordered fallback models tried when the primary route fails. */
  readonly fallbackModels: OmoModelSelection[]
  /** opencode-style agent step budget; undefined/Infinity means unlimited. */
  readonly maxSteps?: number | undefined
  /** omo ultrawork keyword override (maximum-precision route). */
  readonly ultrawork?: OmoUltraworkOverride | undefined
}

/** omo ultrawork model/variant override. */
export interface OmoUltraworkOverride {
  readonly model?: OmoModelSelection | undefined
  readonly reasoningEffort?: string | undefined
}

/** Stored settings shape: `model: null` records "follow the session model". */
export interface StoredOmoRoleConfig {
  readonly model: OmoModelSelection | null
  readonly fallbackModels: OmoModelSelection[]
  readonly maxSteps?: number | undefined
  readonly ultrawork?: OmoUltraworkOverride | undefined
}

/** Persisted opencode-omo settings section shape. */
export interface OmoRoleSettings {
  readonly roles: Record<string, StoredOmoRoleConfig>
  readonly sessions: Record<string, string>
}

export type OmoAgentMode = 'primary' | 'subagent' | 'all'

export interface OmoRoleCatalogEntry {
  readonly id: string
  readonly displayName: string
  readonly mode: OmoAgentMode
  readonly description: string
  readonly fallbackHint: string
}

/** Default composer role: omo's primary ultraworker. */
export const OMO_DEFAULT_ROLE = 'sisyphus'

/**
 * The complete omo agent roster (AGENT_DISPLAY_NAMES), ordered the way omo's
 * type selector presents it: primary agents first, then council/specialists.
 */
export const OMO_ROLES: readonly OmoRoleCatalogEntry[] = [
  {
    id: 'sisyphus',
    displayName: 'Sisyphus - Ultraworker',
    mode: 'primary',
    description: 'Primary orchestrator: plan, delegate, verify, deliver — the default executor role.',
    fallbackHint: 'claude-opus-4-7 / kimi-k3 / kimi-k2.6 / gpt-5.5 / glm-5',
  },
  {
    id: 'hephaestus',
    displayName: 'Hephaestus - Deep Agent',
    mode: 'primary',
    description: 'Deeply autonomous worker: explores thoroughly, then completes complex implementations end to end.',
    fallbackHint: 'gpt-5.6-sol / gpt-5.5',
  },
  {
    id: 'prometheus',
    displayName: 'Prometheus - Plan Builder',
    mode: 'primary',
    description: 'Planning advisor: researches and produces plan artifacts under `.omo/`, never implements.',
    fallbackHint: 'claude-opus-4-7 / gpt-5.5 / glm-5.2 / gemini-3.1-pro',
  },
  {
    id: 'atlas',
    displayName: 'Atlas - Plan Executor',
    mode: 'primary',
    description: 'Chief execution orchestrator: delegates tasks per the plan, verifies, and auto-continues until completion.',
    fallbackHint: 'claude-sonnet-4-6 / kimi-k2.6 / gpt-5.5 / minimax-m3',
  },
  {
    id: 'sisyphus-junior',
    displayName: 'Sisyphus-Junior',
    mode: 'all',
    description: 'Lightweight Sisyphus: domain-task worker.',
    fallbackHint: 'claude-sonnet-4-6 / kimi-k2.6 / gpt-5.5 / minimax-m3',
  },
  {
    id: 'athena',
    displayName: 'Athena - Council',
    mode: 'subagent',
    description: 'Council reviewer: multi-perspective review and decisions.',
    fallbackHint: 'claude-opus-4-7 / gpt-5.5',
  },
  {
    id: 'athena-junior',
    displayName: 'Athena-Junior - Council',
    mode: 'subagent',
    description: 'Lightweight council member.',
    fallbackHint: 'claude-sonnet-4-6 / gpt-5.5',
  },
  {
    id: 'council-member',
    displayName: 'council-member',
    mode: 'subagent',
    description: 'General-purpose council member.',
    fallbackHint: 'claude-sonnet-4-6 / gpt-5.5',
  },
  {
    id: 'metis',
    displayName: 'Metis - Plan Consultant',
    mode: 'subagent',
    description: 'Pre-planning consultant: surfaces hidden intent, ambiguity, and unstated requirements.',
    fallbackHint: 'claude-sonnet-4-6 / claude-opus-4-7 / gpt-5.5 / glm-5.2',
  },
  {
    id: 'momus',
    displayName: 'Momus - Plan Critic',
    mode: 'subagent',
    description: 'Plan reviewer: validates executability and reference validity.',
    fallbackHint: 'gpt-5.6-terra / gpt-5.5 / claude-opus-4-7 / gemini-3.1-pro',
  },
  {
    id: 'oracle',
    displayName: 'oracle',
    mode: 'subagent',
    description: 'Read-only strategic technical advisor: architecture, self-review, and deep debugging.',
    fallbackHint: 'gpt-5.5 / gemini-3.1-pro / claude-opus-4-7 / glm-5.2',
  },
  {
    id: 'librarian',
    displayName: 'librarian',
    mode: 'subagent',
    description: 'External documentation and open-source code retrieval.',
    fallbackHint: 'gpt-5.4-mini-fast / qwen3.5-plus / minimax-m3 / haiku-4-5',
  },
  {
    id: 'explore',
    displayName: 'explore',
    mode: 'subagent',
    description: 'Codebase search specialist.',
    fallbackHint: 'gpt-5.4-mini-fast / qwen3.5-plus / minimax-m3 / haiku-4-5',
  },
  {
    id: 'multimodal-looker',
    displayName: 'multimodal-looker',
    mode: 'subagent',
    description: 'Media analysis: PDFs, images, and charts.',
    fallbackHint: 'gpt-5.5 / kimi-k2.6 / glm-4.6v / gpt-5-nano',
  },
]

const roleIds = new Set(OMO_ROLES.map(role => role.id))

/** True when `role` is one of the shipped omo agent ids. */
export function isOmoRole(role: string): boolean {
  return roleIds.has(role)
}

/** Resolve a role id to its catalog entry (unknown ids fall back to undefined). */
export function omoRoleOf(role: string): OmoRoleCatalogEntry | undefined {
  return OMO_ROLES.find(entry => entry.id === role)
}

/** Normalize a stored/requested role to a known id; unknown ids fall back to sisyphus. */
export function normalizeOmoRole(role: string | undefined | null): string {
  return role !== null && role !== undefined && isOmoRole(role) ? role : OMO_DEFAULT_ROLE
}

/** Empty role config: follow the session model and carry no fallbacks. */
export function emptyRoleConfig(): OmoRoleConfig {
  return { fallbackModels: [] }
}

/**
 * omo's default fallback model ids per role, flattened from
 * `model-core/src/agent-model-requirements.ts`. Used by the host registry to
 * resolve omo-default fallbacks against dsh's live model catalog when the
 * user has not configured any. Provider scopes/variants are intentionally
 * represented by model-id matching here; dsh adapters own provider identity.
 */
export const OMO_ROLE_FALLBACK_MODELS: Readonly<Record<string, readonly string[]>> = {
  sisyphus: ['claude-opus-4-7', 'kimi-k3', 'kimi-k2.6', 'k2p5', 'kimi-k2.5', 'gpt-5.5', 'glm-5', 'big-pickle'],
  hephaestus: ['gpt-5.6-sol', 'gpt-5.5'],
  prometheus: ['claude-opus-4-7', 'gpt-5.5', 'glm-5.2', 'gemini-3.1-pro'],
  atlas: ['claude-sonnet-4-6', 'kimi-k2.6', 'gpt-5.5', 'minimax-m3', 'MiniMax-M3', 'minimax-m2.7'],
  'sisyphus-junior': ['claude-sonnet-4-6', 'kimi-k2.6', 'gpt-5.5', 'minimax-m3', 'MiniMax-M3', 'minimax-m2.7', 'big-pickle'],
  athena: ['claude-opus-4-7', 'gpt-5.5'],
  'athena-junior': ['claude-sonnet-4-6', 'gpt-5.5'],
  'council-member': ['claude-sonnet-4-6', 'gpt-5.5'],
  metis: ['claude-sonnet-4-6', 'claude-opus-4-7', 'gpt-5.5', 'glm-5.2', 'k2p5'],
  momus: ['gpt-5.6-terra', 'gpt-5.5', 'claude-opus-4-7', 'gemini-3.1-pro', 'glm-5.2'],
  oracle: ['gpt-5.5', 'gemini-3.1-pro', 'claude-opus-4-7', 'glm-5.2'],
  librarian: ['gpt-5.4-mini-fast', 'qwen3.5-plus', 'minimax-m2.7-highspeed', 'minimax-m3', 'MiniMax-M3', 'minimax-m2.7', 'claude-haiku-4-5', 'gpt-5.4-nano'],
  explore: ['gpt-5.4-mini-fast', 'qwen3.5-plus', 'minimax-m2.7-highspeed', 'minimax-m3', 'MiniMax-M3', 'minimax-m2.7', 'claude-haiku-4-5', 'gpt-5.4-nano'],
  'multimodal-looker': ['gpt-5.5', 'kimi-k2.6', 'glm-4.6v', 'gpt-5-nano'],
}

/**
 * Preferred provider scopes for each omo fallback model id, aligned by index
 * with {@link OMO_ROLE_FALLBACK_MODELS}. The resolver orders a matched model
 * by these scopes, then by dsh's provider registration order.
 */
export const OMO_ROLE_FALLBACK_PROVIDERS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  sisyphus: [
    ['anthropic', 'github-copilot', 'opencode', 'vercel'],
    ['opencode-go', 'kimi-for-coding', 'moonshotai', 'opencode', 'vercel'],
    ['opencode-go', 'vercel'],
    ['kimi-for-coding'],
    ['opencode', 'bailian-coding-plan', 'moonshotai', 'moonshotai-cn', 'firmware', 'ollama-cloud', 'aihubmix', 'vercel'],
    ['openai', 'github-copilot', 'opencode', 'vercel'],
    ['zai-coding-plan', 'opencode', 'bailian-coding-plan', 'vercel'],
    ['opencode'],
  ],
  hephaestus: [
    ['openai', 'github-copilot', 'vercel'],
    ['openai', 'github-copilot', 'opencode', 'vercel'],
  ],
  prometheus: [
    ['anthropic', 'github-copilot', 'opencode', 'vercel'],
    ['openai', 'github-copilot', 'opencode', 'vercel'],
    ['opencode-go', 'vercel'],
    ['google', 'github-copilot', 'opencode', 'vercel'],
  ],
  atlas: [
    ['anthropic', 'github-copilot', 'opencode', 'vercel'],
    ['opencode-go', 'vercel'],
    ['openai', 'github-copilot', 'opencode', 'vercel'],
    ['opencode-go', 'vercel'],
    ['minimax-coding-plan', 'minimax-cn-coding-plan'],
    ['opencode-go', 'vercel'],
  ],
  'sisyphus-junior': [
    ['anthropic', 'github-copilot', 'opencode', 'vercel'],
    ['opencode-go', 'vercel'],
    ['openai', 'github-copilot', 'opencode', 'vercel'],
    ['opencode-go', 'vercel'],
    ['minimax-coding-plan', 'minimax-cn-coding-plan'],
    ['opencode-go', 'vercel'],
    ['opencode'],
  ],
  athena: [['anthropic', 'github-copilot', 'opencode', 'vercel'], ['openai', 'github-copilot', 'opencode', 'vercel']],
  'athena-junior': [['anthropic', 'github-copilot', 'opencode', 'vercel'], ['openai', 'github-copilot', 'opencode', 'vercel']],
  'council-member': [['anthropic', 'github-copilot', 'opencode', 'vercel'], ['openai', 'github-copilot', 'opencode', 'vercel']],
  metis: [
    ['anthropic', 'github-copilot', 'opencode', 'vercel'],
    ['anthropic', 'github-copilot', 'opencode', 'vercel'],
    ['openai', 'github-copilot', 'opencode', 'vercel'],
    ['opencode-go', 'vercel'],
    ['kimi-for-coding'],
  ],
  momus: [
    ['openai', 'vercel'],
    ['openai', 'github-copilot', 'opencode', 'vercel'],
    ['anthropic', 'github-copilot', 'opencode', 'vercel'],
    ['google', 'github-copilot', 'opencode', 'vercel'],
    ['opencode-go', 'vercel'],
  ],
  oracle: [
    ['openai', 'github-copilot', 'opencode', 'vercel'],
    ['google', 'github-copilot', 'opencode', 'vercel'],
    ['anthropic', 'github-copilot', 'opencode', 'vercel'],
    ['opencode-go', 'vercel'],
  ],
  librarian: [
    ['openai'], ['opencode-go', 'bailian-coding-plan'], ['vercel'], ['opencode-go', 'vercel'],
    ['minimax-coding-plan', 'minimax-cn-coding-plan'], ['opencode-go', 'vercel'],
    ['anthropic', 'github-copilot', 'vercel'], ['openai', 'vercel'],
  ],
  explore: [
    ['openai'], ['opencode-go', 'bailian-coding-plan'], ['vercel'], ['opencode-go', 'vercel'],
    ['minimax-coding-plan', 'minimax-cn-coding-plan'], ['opencode-go', 'vercel'],
    ['anthropic', 'github-copilot', 'vercel'], ['openai', 'vercel'],
  ],
  'multimodal-looker': [
    ['openai', 'opencode', 'vercel'],
    ['opencode-go', 'vercel'],
    ['zai-coding-plan', 'vercel'],
    ['openai', 'github-copilot', 'opencode', 'vercel'],
  ],
}
