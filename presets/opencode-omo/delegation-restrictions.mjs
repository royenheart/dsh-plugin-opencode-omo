/**
 * One capability table for delegated tool restrictions.
 *
 * Role filters are derived from this table, not maintained as independent
 * name lists. The named primary rows (sisyphus/hephaestus/atlas/sisyphus-junior)
 * are delegation tools, so read-only specialists cannot reach them indirectly;
 * `hashline_edit` is classified as a write tool. Unknown/unmounted tools are
 * read-only by default; the architecture check requires every named row in
 * agent.cordis.yml to be classified.
 */

/** Closed capability categories. */
export const CAPABILITIES = Object.freeze([
  'read',
  'write',
  'shell',
  'delegate-worker',
  'delegate-orchestrator',
  'delegate-specialist',
])

export const TOOL_CAPABILITIES = Object.freeze({
  write: 'write',
  edit: 'write',
  apply_patch: 'write',
  hashline_edit: 'write',
  bash: 'shell',
  task: 'delegate-worker',
  call_omo_agent: 'delegate-worker',
  subagent: 'delegate-worker',
  subagent_fork: 'delegate-worker',
  plan: 'delegate-orchestrator',
  sisyphus: 'delegate-orchestrator',
  hephaestus: 'delegate-orchestrator',
  atlas: 'delegate-orchestrator',
  'sisyphus-junior': 'delegate-orchestrator',
  workflow: 'delegate-orchestrator',
  ralph: 'delegate-orchestrator',
  oracle: 'delegate-specialist',
  librarian: 'delegate-specialist',
  explore: 'delegate-specialist',
  metis: 'delegate-specialist',
  momus: 'delegate-specialist',
  'multimodal-looker': 'delegate-specialist',
  athena: 'delegate-specialist',
  'athena-junior': 'delegate-specialist',
  'council-member': 'delegate-specialist',
  read: 'read',
  read_image: 'read',
  glob: 'read',
  grep: 'read',
  skill: 'read',
  todo_write: 'read',
  web_fetch: 'read',
  web_search: 'read',
  lsp_goto_definition: 'read',
  lsp_find_references: 'read',
  lsp_hover: 'read',
  lsp_go_to_implementation: 'read',
  lsp_diagnostics: 'read',
  lsp_rename: 'read',
  lsp_prepare_rename: 'read',
  lsp_symbols: 'read',
  lsp_status: 'read',
})

export function capabilityOf(toolName) {
  return TOOL_CAPABILITIES[toolName] ?? 'read'
}

const namesWith = capability => Object.freeze(
  Object.keys(TOOL_CAPABILITIES).filter(name => TOOL_CAPABILITIES[name] === capability),
)

export const WRITE_TOOLS = namesWith('write')
export const SHELL_TOOLS = namesWith('shell')
export const DELEGATE_WORKER_TOOLS = namesWith('delegate-worker')
export const DELEGATE_ORCHESTRATOR_TOOLS = namesWith('delegate-orchestrator')
export const DELEGATE_SPECIALIST_TOOLS = namesWith('delegate-specialist')
export const DELEGATE_TOOLS = Object.freeze([
  ...DELEGATE_WORKER_TOOLS,
  ...DELEGATE_ORCHESTRATOR_TOOLS,
  ...DELEGATE_SPECIALIST_TOOLS,
])

export const DENY_SPECIALISTS = Object.freeze([...WRITE_TOOLS, ...DELEGATE_TOOLS])
export const DENY_PRIMARY = Object.freeze([...DELEGATE_TOOLS])
/** Prometheus keeps write tools and specialist delegation; it cannot spawn a worker/orchestrator. */
export const DENY_PLAN = Object.freeze([...DELEGATE_WORKER_TOOLS, ...DELEGATE_ORCHESTRATOR_TOOLS])

export const ROLE_TOOL_FILTERS = Object.freeze({
  prometheus: Object.freeze({ deny: DENY_PLAN }),
  oracle: Object.freeze({ deny: DENY_SPECIALISTS }),
  librarian: Object.freeze({ deny: DENY_SPECIALISTS }),
  explore: Object.freeze({ deny: DENY_SPECIALISTS }),
  metis: Object.freeze({ deny: DENY_SPECIALISTS }),
  momus: Object.freeze({ deny: DENY_SPECIALISTS }),
  'multimodal-looker': Object.freeze({ allow: Object.freeze(['read', 'read_image']) }),
  athena: Object.freeze({ deny: DENY_SPECIALISTS }),
  'athena-junior': Object.freeze({ deny: DENY_SPECIALISTS }),
  'council-member': Object.freeze({ deny: DENY_SPECIALISTS }),
  sisyphus: Object.freeze({ deny: DENY_PRIMARY }),
  hephaestus: Object.freeze({ deny: DENY_PRIMARY }),
  atlas: Object.freeze({ deny: DENY_PRIMARY }),
  'sisyphus-junior': Object.freeze({ deny: DENY_PRIMARY }),
})

const MISSING_ROLE_FILTER = ROLE_TOOL_FILTERS.oracle

/**
 * Restriction recovered from a role id. An absent/unknown role fails closed to
 * the read-only specialist policy rather than an unrestricted child; the
 * fallback lives here so callers cannot silently skip it.
 */
export function restrictionForRole(role) {
  return ROLE_TOOL_FILTERS[role] ?? MISSING_ROLE_FILTER
}
