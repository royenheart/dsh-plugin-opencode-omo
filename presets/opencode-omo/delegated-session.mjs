// Shared child-session identity for the preset's tool catalog, prompt table,
// and pre-execute gates. dsh stamps `origin: 'subagent'` and a positive
// `delegationDepth` on a delegated child's session header; either is enough.
//
// The catalog must treat children differently from the primary Agent: dsh's
// continuable-subagent return path tells every child to call `send_message`,
// so hiding that name from a child produces a prompt that names a tool the
// child cannot see. The primary surface still hides it (omo's task()/
// background_output interface remains the only delegation entry point).

/**
 * True for an in-process delegated child.
 * @param target - a tool-exec context (`{ agent }`) or an Agent.
 * @returns whether the target session is a delegated child.
 */
export function isDelegatedSession(target) {
  const header = target?.agent?.session?.header ?? target?.session?.header
  if (header == null) return false
  if (header.origin === 'subagent') return true
  return typeof header.delegationDepth === 'number' && header.delegationDepth >= 1
}
