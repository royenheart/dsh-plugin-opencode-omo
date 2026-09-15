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

/**
 * Stored settings shape: `model: null` records "follow the session model",
 * while an absent model is the schema's own default and means the same thing.
 */
export interface StoredOmoRoleConfig {
  readonly model?: OmoModelSelection | null | undefined
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
    description: '主编排者：规划、委托、验证、交付，默认执行角色。',
    fallbackHint: 'claude-opus-4-7 / kimi-k3 / kimi-k2.6 / gpt-5.5 / glm-5',
  },
  {
    id: 'hephaestus',
    displayName: 'Hephaestus - Deep Agent',
    mode: 'primary',
    description: '深度自治工作者：充分探索后端到端完成复杂实现。',
    fallbackHint: 'gpt-5.6-sol / gpt-5.5',
  },
  {
    id: 'prometheus',
    displayName: 'Prometheus - Plan Builder',
    mode: 'primary',
    description: '规划顾问：只调研并产出 `.omo/` 下的计划产物，不实施。',
    fallbackHint: 'claude-opus-4-7 / gpt-5.5 / glm-5.2 / gemini-3.1-pro',
  },
  {
    id: 'atlas',
    displayName: 'Atlas - Plan Executor',
    mode: 'primary',
    description: '总执行编排者：按计划委托任务、验证并自动继续直到完成。',
    fallbackHint: 'claude-sonnet-4-6 / kimi-k2.6 / gpt-5.5 / minimax-m3',
  },
  {
    id: 'sisyphus-junior',
    displayName: 'Sisyphus-Junior',
    mode: 'all',
    description: '轻量 Sisyphus：领域任务 worker。',
    fallbackHint: 'claude-sonnet-4-6 / kimi-k2.6 / gpt-5.5 / minimax-m3',
  },
  {
    id: 'athena',
    displayName: 'Athena - Council',
    mode: 'subagent',
    description: '委员会评审：多视角评审与决策。',
    fallbackHint: 'claude-opus-4-7 / gpt-5.5',
  },
  {
    id: 'athena-junior',
    displayName: 'Athena-Junior - Council',
    mode: 'subagent',
    description: '轻量委员会成员。',
    fallbackHint: 'claude-sonnet-4-6 / gpt-5.5',
  },
  {
    id: 'council-member',
    displayName: 'council-member',
    mode: 'subagent',
    description: '通用委员会成员。',
    fallbackHint: 'claude-sonnet-4-6 / gpt-5.5',
  },
  {
    id: 'metis',
    displayName: 'Metis - Plan Consultant',
    mode: 'subagent',
    description: '规划前咨询：识别隐藏意图、歧义与未声明需求。',
    fallbackHint: 'claude-sonnet-4-6 / claude-opus-4-7 / gpt-5.5 / glm-5.2',
  },
  {
    id: 'momus',
    displayName: 'Momus - Plan Critic',
    mode: 'subagent',
    description: '计划评审：验证可执行性与引用有效性。',
    fallbackHint: 'gpt-5.6-terra / gpt-5.5 / claude-opus-4-7 / gemini-3.1-pro',
  },
  {
    id: 'oracle',
    displayName: 'oracle',
    mode: 'subagent',
    description: '只读战略技术顾问：架构、自审与疑难调试。',
    fallbackHint: 'gpt-5.5 / gemini-3.1-pro / claude-opus-4-7 / glm-5.2',
  },
  {
    id: 'librarian',
    displayName: 'librarian',
    mode: 'subagent',
    description: '外部文档与开源代码检索。',
    fallbackHint: 'gpt-5.4-mini-fast / qwen3.5-plus / minimax-m3 / haiku-4-5',
  },
  {
    id: 'explore',
    displayName: 'explore',
    mode: 'subagent',
    description: '代码库搜索专家。',
    fallbackHint: 'gpt-5.4-mini-fast / qwen3.5-plus / minimax-m3 / haiku-4-5',
  },
  {
    id: 'multimodal-looker',
    displayName: 'multimodal-looker',
    mode: 'subagent',
    description: '媒体分析：PDF、图片与图表解读。',
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
