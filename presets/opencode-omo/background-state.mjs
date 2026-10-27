/** Closed lifecycle for one background subagent activation. */
export const BACKGROUND_PHASES = Object.freeze(['queued', 'running', 'cancelling', 'settled'])

export const INITIAL_BACKGROUND = Object.freeze({ phase: 'queued', outcome: null })

/**
 * Handlers/timers emit these events; task-shim owns the only writer.
 * A cancel before the activation is published and a cancel after publication
 * both converge on `cancelling`; `settled` is terminal.
 */
export function transitionBackground(state, event) {
  switch (event.type) {
    case 'start':
      return state.phase === 'queued' ? { phase: 'running', outcome: null } : state
    case 'cancel':
      return state.phase === 'queued' || state.phase === 'running'
        ? { phase: 'cancelling', outcome: null }
        : state
    case 'settle':
      return state.phase === 'settled'
        ? state
        : { phase: 'settled', outcome: event.outcome }
    default: {
      const never = event
      return never
    }
  }
}
