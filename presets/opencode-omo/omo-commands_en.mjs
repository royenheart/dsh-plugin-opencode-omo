// omo builtin command ports over dsh's native command registry.
//
// omo reference: features/builtin-commands/commands.ts registers
// start-work / stop-continuation / remove-ai-slops / refactor / handoff /
// hyperplan. The ported handlers inject an instruction message into the
// receiving agent and let the shipped omo skill set (start-work,
// remove-ai-slops, refactor) do the actual work — no duplicated hook logic.
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'opencode-omo-commands'
export const inject = ['commands']

const COMMANDS = [
  {
    name: 'start-work',
    description: 'Pick a plan from .omo/plans and start/continue Atlas execution (loads the start-work skill)',
    text: 'Start work. Load the `start-work` skill with the skill tool and follow it exactly. If `.omo/boulder.json` or `.omo/plans/` exists, read it first, pick the current/latest plan, and continue execution from the recorded state.',
  },
  {
    name: 'remove-ai-slops',
    description: 'Clean AI-slop comments from the current workspace (loads the remove-ai-slops skill)',
    text: 'Load the `remove-ai-slops` skill with the skill tool and apply it to this workspace.',
  },
  {
    name: 'refactor',
    description: 'Refactor following the repository\'s existing patterns (loads the refactor skill)',
    text: 'Load the `refactor` skill with the skill tool and follow it for the requested refactor.',
  },
  {
    name: 'stop-continuation',
    description: 'Stop auto-continuation of the current plan and record state in .omo/boulder.json',
    text: 'Stop continuation. Update `.omo/boulder.json` (and the active plan checklist) with the current completed/in-progress state, write a concise handoff note, and stop without starting new work.',
  },
  {
    name: 'handoff',
    description: 'Generate handoff notes for the next worker',
    text: 'Produce a handoff: current goal, files changed, verification run, open risks, and the exact next command for the next worker.',
  },
  {
    name: 'hyperplan',
    description: 'Enter deep planning mode (loads the ulw-plan skill)',
    text: 'Load the `ulw-plan` skill with the skill tool and run the full planning workflow it describes.',
  },
  {
    name: 'team-mode',
    description: 'Delegate one lead plus multiple workers in parallel in team mode',
    text: 'Enter team mode. Use `workflow`/`ralph` (or parallel `subagent` calls) to stand up one lead worker plus independent specialists for disjoint workstreams, pass each a complete standalone prompt, collect and verify every result, and keep going until all lanes are done.',
  },
]

export function apply(ctx) {
  ctx.effect(() => {
    const disposers = COMMANDS.map(command => ctx.commands.register({
      name: command.name,
      description: command.description,
      handler: (invocation) => {
        invocation.agent.inject(createUserMessage({
          content: [{ type: 'text', text: command.text }],
          source: { kind: 'plugin', plugin: 'opencode-omo' },
        }))
        return { kind: 'success' }
      },
    }))
    return () => { for (const dispose of disposers) dispose() }
  }, 'opencode-omo: builtin commands')
}
