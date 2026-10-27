// opencode-omo delegation surface: model-visible OpenCode/omo names over the
// dsh execution layer (subagent + jobs), the same way tool-surface.mjs maps
// web_search.query onto dsh web_search.queries.
//
// Hidden from the assembled catalog (and denied if hallucinated):
//   subagent, subagent_fork, job_output, job_list, job_kill,
//   send_message, interrupt_agent, list_agents, list_subagent_models
//
// Visible omo names this module adds:
//   background_output(task_id)  -> ctx.jobs.read/wait
//   background_cancel(taskId)   -> ctx.jobs.kill
// call_omo_agent / task live in task-shim.mjs and share the same execute path.

import { defineTool } from '@deepseek-ai/dsh-tools'
import { isDelegatedSession } from './delegated-session.mjs'

export const name = 'opencode-omo-delegation-surface'
export const inject = ['tools', 'jobs']

export const BG_PREFIX = 'bg_'
export const SES_PREFIX = 'ses_'

/** dsh-native names the model must not see or call. */
export const HIDDEN_DSH_DELEGATION_TOOLS = Object.freeze([
  'subagent',
  'subagent_fork',
  'job_output',
  'job_list',
  'job_kill',
  'send_message',
  'interrupt_agent',
  'list_agents',
  'list_subagent_models',
])

const HIDDEN = new Set(HIDDEN_DSH_DELEGATION_TOOLS)

export function toBackgroundTaskId(raw) {
  const id = String(raw ?? '')
  if (id.length === 0 || id.startsWith(BG_PREFIX) || id.startsWith(SES_PREFIX)) return id
  return BG_PREFIX + id
}

export function toSessionTaskId(raw) {
  const id = String(raw ?? '')
  if (id.length === 0 || id.startsWith(SES_PREFIX) || id.startsWith(BG_PREFIX)) return id
  return SES_PREFIX + id
}

/** Strip the omo prefix, or pass a raw dsh id through (completion notices). */
export function fromOmoTaskId(id) {
  const value = String(id ?? '')
  if (value.startsWith(BG_PREFIX)) return { kind: 'background', id: value.slice(BG_PREFIX.length) }
  if (value.startsWith(SES_PREFIX)) return { kind: 'session', id: value.slice(SES_PREFIX.length) }
  return { kind: 'raw', id: value }
}

export function applyOmoDelegationCatalog(tools, options = {}) {
  if (!Array.isArray(tools)) return tools
  const allowSendMessage = options.allowSendMessage === true
  return tools.filter(tool => {
    if (!tool || typeof tool.name !== 'string') return false
    if (!HIDDEN.has(tool.name)) return true
    // dsh's continuable-subagent return path tells every child to call
    // send_message; the primary surface keeps omo's task()/background_output
    // entry points. Hiding send_message from a child leaves that instruction
    // pointing at a tool the child cannot see.
    return allowSendMessage && tool.name === 'send_message'
  })
}

/** Rewrite dsh `tool:jobs` section copy into the omo collection names. */
export function rewriteJobsPromptSection(text) {
  return String(text ?? '')
    .replaceAll('job_output', 'background_output')
    .replaceAll('job_kill', 'background_cancel')
}

/**
 * Rewrite a dsh tool-jobs completion notice into the omo collection shape
 * family prompts already wait for: `<system-reminder>` + `bg_` + `background_output`.
 */
export function rewriteJobCompletionNotice(text) {
  let out = String(text ?? '')
  if (out.length === 0) return out
  out = out
    .replaceAll(/\bbackground job\b/g, 'background task')
    .replaceAll(/\bjob_output\b/g, 'background_output')
    .replaceAll(/\bjob_kill\b/g, 'background_cancel')
  out = out.replace(/\bbackground task (?!bg_|ses_)(\S+)/g, 'background task bg_$1')
  const idMatch = out.match(/\bbackground task (bg_\S+)/)
  if (idMatch !== null) {
    out = out.replace(
      /Read its output with background_output\./g,
      `Collect with background_output(task_id="${idMatch[1]}").`,
    )
  }
  if (!out.includes('<system-reminder>')) {
    out = `<system-reminder>\n${out}\n</system-reminder>`
  }
  return out
}

function rewriteJobNoticeMessage(message) {
  if (message?.source?.kind !== 'tool-jobs' || message.source.form !== 'notice') return message
  const blocks = Array.isArray(message.content) ? message.content : []
  let changed = false
  const content = blocks.map((block) => {
    if (block?.type !== 'text' || typeof block.text !== 'string') return block
    const text = rewriteJobCompletionNotice(block.text)
    if (text === block.text) return block
    changed = true
    return { ...block, text }
  })
  return changed ? { ...message, content } : message
}

function taskIdFrom(args = {}) {
  if (typeof args.task_id === 'string' && args.task_id.length > 0) return args.task_id
  if (typeof args.taskId === 'string' && args.taskId.length > 0) return args.taskId
  return undefined
}

function presentJob(job) {
  if (job === undefined || job === null) return undefined
  return { ...job, id: toBackgroundTaskId(job.id) }
}

export function apply(ctx) {
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const transformed = await next()
    const sections = Array.isArray(transformed.sections)
      ? transformed.sections.map((section) => {
        if (section?.name !== 'tool:jobs') return section
        return { ...section, text: rewriteJobsPromptSection(section.text) }
      })
      : transformed.sections
    return {
      ...transformed,
      sections,
      tools: applyOmoDelegationCatalog(transformed.tools, {
        allowSendMessage: isDelegatedSession(context.agent),
      }),
    }
  })

  ctx.on('agent/pre-step', async (_payload, next) => {
    const decision = await next()
    if (decision?.kind !== 'enter' || !Array.isArray(decision.messages)) return decision
    return {
      ...decision,
      messages: decision.messages.map(rewriteJobNoticeMessage),
    }
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (HIDDEN.has(exec.name)) {
      // Children need dsh's return channel; the primary surface still hides it
      // so omo's task()/background_output interface stays the only entry point.
      if (exec.name === 'send_message' && isDelegatedSession(exec)) return next()
      return {
        kind: 'deny',
        reason:
          `opencode-omo: "${exec.name}" is the hidden dsh execution layer. `
          + 'Use task / call_omo_agent to delegate, background_output(task_id) to collect, '
          + 'and background_cancel(taskId) to cancel.',
      }
    }
    return next()
  })

  ctx.tools.register(defineTool({
    name: 'background_output',
    description:
      'Collect the result of a background task started with run_in_background=true. '
      + 'Pass the background task id (bg_...). Call this only after a harness '
      + '<system-reminder> completion notice arrives — never poll a still-running task.',
    parameters: {
      task_id: {
        type: 'string',
        required: true,
        description: 'Background task id returned by task() / call_omo_agent(), usually bg_...',
      },
      wait: {
        type: 'boolean',
        description: 'Block until the task finishes or the timeout expires. Defaults to false.',
      },
      timeout_ms: {
        type: 'number',
        description: 'Max wait in milliseconds when wait is true.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true },
          task_id: { type: 'string', required: true },
          status: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const body = value.text.length > 0 ? value.text : '(no new output)'
        const separator = body.endsWith('\n') ? '' : '\n'
        return [{ type: 'text', text: `${body}${separator}[status: ${value.status}]` }]
      },
    },
    async execute(args, exec) {
      const raw = taskIdFrom(args)
      if (raw === undefined) throw new Error('background_output requires task_id')
      const parsed = fromOmoTaskId(raw)
      if (parsed.kind === 'session') {
        throw new Error(
          `"${raw}" is a continuation session id. Use task(task_id="${raw}", prompt=...) to follow up, `
          + 'not background_output.',
        )
      }
      const jobs = ctx.jobs
      if (jobs === undefined) {
        throw new Error('background_output requires the dsh jobs service')
      }
      const caller = exec.agent?.id
      if (args.wait === true && typeof jobs.wait === 'function') {
        await jobs.wait(parsed.id, typeof args.timeout_ms === 'number' && args.timeout_ms > 0 ? args.timeout_ms : 30_000, caller, exec.signal)
      }
      const read = jobs.read(parsed.id, caller)
      const body = read.chunks
        .filter(chunk => chunk.channel !== 'log')
        .map(chunk => chunk.text)
        .join('')
      const job = presentJob(read.job)
      return {
        text: `${body}${read.result === undefined ? '' : read.result}`,
        task_id: job?.id ?? toBackgroundTaskId(parsed.id),
        status: job?.status ?? 'unknown',
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'background_cancel',
    description:
      'Cancel one disposable background task by id. Cancel individually; '
      + 'never pass all=true — that kills output you have not collected.',
    parameters: {
      taskId: {
        type: 'string',
        description: 'Background task id (bg_...) to cancel.',
      },
      task_id: {
        type: 'string',
        description: 'Alias of taskId.',
      },
      all: {
        type: 'boolean',
        description: 'Forbidden. Must not be true.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outcome: { type: 'string', required: true },
          task_id: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.outcome === 'already-finished'
          ? `background task ${value.task_id} had already finished`
          : `cancelled background task ${value.task_id}`,
      }],
    },
    execute(args, exec) {
      if (args.all === true) {
        throw new Error(
          'background_cancel(all=true) is forbidden: it kills tasks whose output you have not collected. '
          + 'Cancel disposable tasks individually by taskId.',
        )
      }
      const raw = taskIdFrom(args)
      if (raw === undefined) throw new Error('background_cancel requires taskId')
      const parsed = fromOmoTaskId(raw)
      const jobs = ctx.jobs
      if (jobs === undefined) {
        throw new Error('background_cancel requires the dsh jobs service')
      }
      const result = jobs.kill(parsed.id, exec.agent?.id, 'background_cancel')
      return {
        outcome: result === 'already-finished' ? 'already-finished' : 'cancellation-requested',
        task_id: toBackgroundTaskId(parsed.id),
      }
    },
  }))
}
