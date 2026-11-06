// opencode-omo sandbox-escalation shim for the persistent `bash` tool.
//
// dsh's @deepseek-ai/dsh-tool-bash-persistent runs every command inside the
// session's file sandbox but carries none of the sandbox-escalation contract
// that @deepseek-ai/dsh-tool-bash has (no `sandbox_permissions` schema field,
// no denial markers, no approval wiring), so under workspace-write a model
// whose command hits EROFS outside the workspace has no sanctioned way
// forward and tends to detour into sudo/提权 attempts.
//
// This shim re-registers `bash` in the agent's own tool layer — the same
// shadowing mechanism tool-surface.mjs uses for read/write/edit (agent layer
// shadows the preset layer; no preset-file change and no dsh patch needed).
// Ordinary commands delegate to the persistent PTY unchanged. A call carrying
// `sandbox_permissions` + `justification` goes through dsh-sandbox's shared
// approveEscalation choreography (the user-approval prompt resolves BEFORE
// anything executes) and then runs ONCE through the host `shell` executor
// stamped with the granted mode; that one command does not share the
// persistent shell's state (cwd, variables). Everything used here is a public
// dsh service or package export.
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ESCALATION_TARGETS,
  approveEscalation,
  escalationHintMarker,
  validateEscalationArgs,
} from '@deepseek-ai/dsh-sandbox'
import { isDelegatedSession } from './delegated-session.mjs'
import { currentToolModel, restrictionFor } from './driver.mjs'
import { toolVisible } from './tool-policy.mjs'

export const name = 'opencode-omo-escalating-bash'
export const inject = ['tools']

/**
 * The tool-surface module owns opencode's rendered bash profile. It installs
 * this provider at module load so the single per-agent `bash` registration can
 * carry that description without a second same-name shadow.
 */
let bashDescriptionProvider

/** Install the model-visible bash description provider. */
export function setBashDescriptionProvider(provider) {
  bashDescriptionProvider = provider
}

/**
 * The schema fields advertised only when the composition can escalate. The
 * descriptions mirror tool-bash's own wording so the model meets the same
 * vocabulary whichever preset it runs under.
 */
export const ESCALATION_PARAMETERS = {
  sandbox_permissions: {
    type: 'string',
    enum: [...ESCALATION_TARGETS],
    description: 'The wider sandbox mode this command needs. Only valid as a one-shot retry of a command the sandbox just denied; requires justification and user approval.',
  },
  justification: {
    type: 'string',
    description: 'Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access.',
  },
}

/** Model-facing guidance appended to the bash description when escalation is available. */
export const ESCALATION_GUIDANCE = ' Commands run inside the session\'s file sandbox. A file write outside the workspace fails with a "Read-only file system" (EROFS) error — a policy denial, not a bug in the command; do not retry another way. When a command is denied this way and a wider mode would let it succeed, retry the exact same command once with `sandbox_permissions` (the narrowest wider mode that suffices) plus a one-sentence `justification` — the approval prompt raised by that retry is how the user consents, so do not detour through chat to ask permission first. An escalated command runs as a one-shot invocation WITHOUT this shell\'s persistent state (cwd, exported variables); chain everything it needs into the command itself. A rejected escalation is final for that command — stop and explain, never work around it — but does not forbid escalating other commands later. Never escalate speculatively: ground the request in a real denial. Never use sudo: privilege escalation is blocked in this environment. For reading or modifying FILES outside the workspace, prefer the read/write/edit tools — they raise the same approval prompt automatically.'

/** True when the composition can escalate: a confining shell executor plus the policy service. */
export function escalationAvailableFor(shell, sandboxPolicy) {
  return shell !== undefined && shell !== null
    && shell.sandboxMode !== undefined
    && sandboxPolicy !== undefined && sandboxPolicy !== null
}

/**
 * The persistent PTY surfaces sandbox denials only as raw OS errors; EROFS on
 * this stack comes from the sandbox's read-only bind mounts. This heuristic
 * only decides whether to APPEND the standard escalation hint to a failed
 * command's output — it never gates execution.
 */
const EROFS_PATTERN = /read-only file system|只读文件系统|EROFS/i

export function outputLooksSandboxDenied(text) {
  return EROFS_PATTERN.test(text)
}

/** Render a one-shot ShellRunResult the way the bash tools report outcomes. */
export function renderShellRun(result) {
  const out = result.stdout?.text ?? ''
  const err = result.stderr?.text ?? ''
  let body = out
  if (err.length > 0) {
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += `[stderr]\n${err}`
  }
  if (body.length === 0) body = '(no output)'
  const markers = []
  if (result.sandbox?.runnerFailed === true) {
    markers.push(`[sandbox: the sandbox runner itself failed under ${result.sandbox.mode} mode — the command did not run; this is a sandbox problem, not a command failure]`)
  }
  if (result.timedOut === true) markers.push(`[timed out after ${result.timeoutMs}ms]`)
  if (result.signal !== undefined && result.signal !== null) {
    markers.push(`[killed by signal: ${result.signal}]`)
  } else if (result.exitCode !== undefined && result.exitCode !== null && result.exitCode !== 0) {
    markers.push(`[exit code: ${result.exitCode}]`)
  }
  if (markers.length === 0) return body
  return (body.endsWith('\n') ? body : body + '\n') + markers.join('\n')
}

const shimmedAgents = new WeakSet()

function shimBashFor(ctx, agent) {
  if (agent === undefined || agent?.ctx?.tools === undefined) return
  if (shimmedAgents.has(agent)) return
  const original = ctx.tools.get('bash', agent)
  if (original === undefined) return
  shimmedAgents.add(agent)

  const shell = ctx.get('shell')
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const available = escalationAvailableFor(shell, sandboxPolicy)
  const commandParameter = original.parameters?.command
    ?? { type: 'string', required: true, description: 'The command to execute' }

  agent.ctx.tools.register(defineTool({
    name: 'bash',
    description: (typeof bashDescriptionProvider === 'function'
      ? bashDescriptionProvider()
      : original.description) + (available ? ESCALATION_GUIDANCE : ''),
    parameters: {
      command: commandParameter,
      ...(available ? ESCALATION_PARAMETERS : {}),
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      validateEscalationArgs(args.sandbox_permissions, args.justification)
      if (args.sandbox_permissions === undefined) {
        const value = await original.execute({ command: args.command }, exec)
        if (available && typeof value === 'string' && outputLooksSandboxDenied(value)) {
          return value + '\n' + escalationHintMarker('command')
        }
        return value
      }
      if (!available) {
        throw new Error('sandbox_permissions is not available in this composition (no sandboxing executor to escalate)')
      }
      if (exec.agent === undefined) {
        throw new Error('bash escalation requires an owning agent session')
      }
      const standing = sandboxPolicy.resolve({ session: exec.agent.session })
      const granted = await approveEscalation(
        {
          requestedMode: args.sandbox_permissions,
          justification: args.justification,
          effectiveMode: standing.mode,
          subject: 'command',
        },
        {
          approver: ctx.get('approval'),
          agent: exec.agent,
          callId: exec.callId,
          toolName: 'bash',
          signal: exec.signal,
        },
      )
      // The grant stamps exactly this one call; the persistent PTY keeps its
      // standing mode. One-shot execution carries no shell state.
      const result = await shell.run(shell.resolve({
        command: args.command,
        ...(exec.agent.session.header.cwd === undefined ? {} : { workdir: exec.agent.session.header.cwd }),
        signal: exec.signal,
        sandboxPolicy: { ...standing, mode: granted },
      }))
      return renderShellRun(result)
    },
    ...(typeof original.presentCall === 'function'
      ? { presentCall: args => original.presentCall({ command: args.command }) }
      : {}),
  }), {
    // Same step admission as every other preset tool: a delegated-role allow
    // list or the hidden-name catalog can remove the shell entry.
    when: () => toolVisible(
      'bash', currentToolModel(ctx, agent), restrictionFor(agent), isDelegatedSession(agent),
    ),
  })
}

export function apply(ctx) {
  // Per-agent shim: registered in the agent's OWN tool layer so it shadows the
  // preset's persistent bash without a same-scope duplicate registration
  // (which the tools registry rejects with a mount-failing throw).
  ctx.on('agent/created', ({ agent }) => {
    shimBashFor(ctx, agent)
  })
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const transformed = await next()
    if (context.agent !== undefined) shimBashFor(ctx, context.agent)
    return transformed
  })
}
