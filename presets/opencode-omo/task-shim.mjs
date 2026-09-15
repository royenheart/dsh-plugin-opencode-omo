// opencode-omo `task` shim: maps omo's model-facing
// `task(category=..., subagent_type=..., load_skills=[...],
// run_in_background=..., task_id=..., description=..., prompt=...)` surface onto
// dsh's native subagent services.
//
// Routing:
//   task_id        -> continuable follow-up (`ctx.subagents.sendMessage` on
//                     0.1.6; legacy `ctx.subagents.followup` fallback)
//   subagent_type  -> start with the SAME toolFilter as the matching named
//                     row; the child prompt is the driver's complete
//                     `<env>` + specialist body (no static persona overlay)
//   category       -> generic subagent with a small category note in the
//                     user prompt; role pinned to sisyphus
//   neither        -> generic subagent, same sisyphus pin
//
// `load_skills` has no dsh equivalent; the shim prepends a
// `<loaded_skills>` instruction block to the child prompt instead.

import { defineTool } from '@deepseek-ai/dsh-tools'
import { fromOmoTaskId, toBackgroundTaskId, toSessionTaskId } from './delegation-surface.mjs'

export const name = 'opencode-omo-task-shim'
export const inject = ['tools', 'subagents', 'jobs']

/** The subagent provider used by every named row and generic spawn in this preset. */
const PROVIDER = 'spawn'

/** Known named rows from agent.cordis.yml, in the order they appear there. */
export const KNOWN_SUBAGENT_TYPES = [
  'plan',
  'oracle',
  'librarian',
  'explore',
  'metis',
  'momus',
  'multimodal-looker',
  'athena',
  'athena-junior',
  'council-member',
  'sisyphus',
  'hephaestus',
  'atlas',
  'sisyphus-junior',
]

/** Common omo task categories this shim maps to a generic persona note. */
export const KNOWN_CATEGORIES = [
  'visual-engineering',
  'deep',
  'ultrabrain',
  'quick',
  'writing',
  'git',
]

/**
 * toolFilters copied verbatim from agent.cordis.yml.
 * The read-only specialist rows deny every recursion/delegation name; the
 * primary-agent rows deny the whole named roster plus workflow/ralph;
 * multimodal-looker keeps only read/read_image.
 */
const DENY_SPECIALISTS = [
  'write',
  'edit',
  'task',
  'call_omo_agent',
  'subagent',
  'subagent_fork',
  'plan',
  'oracle',
  'librarian',
  'explore',
  'metis',
  'momus',
  'multimodal-looker',
  'athena',
  'athena-junior',
  'council-member',
  'workflow',
  'ralph',
]

const DENY_PRIMARY = [
  'task',
  'call_omo_agent',
  'subagent',
  'subagent_fork',
  'plan',
  'oracle',
  'librarian',
  'explore',
  'metis',
  'momus',
  'multimodal-looker',
  'athena',
  'athena-junior',
  'council-member',
  'sisyphus',
  'hephaestus',
  'atlas',
  'sisyphus-junior',
  'workflow',
  'ralph',
]

/** Prometheus planner: write `.omo/` artifacts and research, never implement. */
const DENY_PLAN = [
  'task',
  'call_omo_agent',
  'subagent',
  'subagent_fork',
  'plan',
  'sisyphus',
  'hephaestus',
  'atlas',
  'sisyphus-junior',
  'workflow',
  'ralph',
]

/**
 * Named-row mapping: omo role id (driver prompt routing) and the exact
 * toolFilter that row configures in agent.cordis.yml. `plan` is the tool
 * name; its role is Prometheus.
 */
export const SUBAGENT_TYPE_TO_ROLE = {
  plan: 'prometheus',
  oracle: 'oracle',
  librarian: 'librarian',
  explore: 'explore',
  metis: 'metis',
  momus: 'momus',
  'multimodal-looker': 'multimodal-looker',
  athena: 'athena',
  'athena-junior': 'athena-junior',
  'council-member': 'council-member',
  sisyphus: 'sisyphus',
  hephaestus: 'hephaestus',
  atlas: 'atlas',
  'sisyphus-junior': 'sisyphus-junior',
}

export const SUBAGENT_TYPE_DEFS = {
  plan: {
    role: 'prometheus',
    toolFilter: { deny: DENY_PLAN },
  },
  oracle: {
    role: 'oracle',
    toolFilter: { deny: DENY_SPECIALISTS },
  },
  librarian: {
    role: 'librarian',
    toolFilter: { deny: DENY_SPECIALISTS },
  },
  explore: {
    role: 'explore',
    toolFilter: { deny: DENY_SPECIALISTS },
  },
  metis: {
    role: 'metis',
    toolFilter: { deny: DENY_SPECIALISTS },
  },
  momus: {
    role: 'momus',
    toolFilter: { deny: DENY_SPECIALISTS },
  },
  'multimodal-looker': {
    role: 'multimodal-looker',
    toolFilter: { allow: ['read', 'read_image'] },
  },
  athena: {
    role: 'athena',
    toolFilter: { deny: DENY_SPECIALISTS },
  },
  'athena-junior': {
    role: 'athena-junior',
    toolFilter: { deny: DENY_SPECIALISTS },
  },
  'council-member': {
    role: 'council-member',
    toolFilter: { deny: DENY_SPECIALISTS },
  },
  sisyphus: {
    role: 'sisyphus',
    toolFilter: { deny: DENY_PRIMARY },
  },
  hephaestus: {
    role: 'hephaestus',
    toolFilter: { deny: DENY_PRIMARY },
  },
  atlas: {
    role: 'atlas',
    toolFilter: { deny: DENY_PRIMARY },
  },
  'sisyphus-junior': {
    role: 'sisyphus-junior',
    toolFilter: { deny: DENY_PRIMARY },
  },
}

/**
 * Role the driver should pin on a freshly spawned child. Follow-ups leave
 * the existing pin alone. Named specialist tools map 1:1; `plan` is
 * Prometheus; generic `task` / `call_omo_agent` workers are Sisyphus.
 */
export function roleForDelegationCall(name, args = {}) {
  if (name === 'task' || name === 'call_omo_agent') {
    if (typeof args.task_id === 'string' && args.task_id.length > 0) return undefined
    const type = args.subagent_type
    if (typeof type === 'string' && type.length > 0) return SUBAGENT_TYPE_TO_ROLE[type]
    return 'sisyphus'
  }
  return SUBAGENT_TYPE_TO_ROLE[name]
}

/**
 * dsh has no task-category system. These notes are prepended to a generic
 * subagent prompt so the child still gets the intended emphasis without
 * silently spawning a specialist.
 */
export const CATEGORY_PERSONA_NOTES = {
  'visual-engineering':
    'This task is about visual/frontend engineering. Prefer frontend skills, validate changes in a real browser when possible, and match the existing UI patterns and design language.',
  deep:
    'This is a deep-work task. Explore before editing, reason carefully about tradeoffs, and verify the result before reporting completion.',
  ultrabrain:
    'This is an ultrabrain task. Maximize reasoning depth and verification; do not take shortcuts, and double-check every non-obvious step.',
  quick:
    'This is a quick task. Make the smallest correct change, keep the blast radius minimal, and finish in one coherent edit.',
  writing:
    'This is a writing task. Prioritize clarity, structure, and reader value; produce prose or documentation rather than code.',
  git:
    'This is a git task. Never amend commits or force-push unless explicitly asked, and never use destructive git commands unless asked.',
}

/**
 * Render the `<loaded_skills>` child-prompt prefix. dsh subagent requests have
 * no `load_skills` field, so the shim tells the child to load the named skills
 * first through dsh's own `skill` tool. An empty array adds nothing.
 */
export function renderLoadedSkills(loadSkills) {
  const skills = Array.isArray(loadSkills)
    ? loadSkills.filter(skill => typeof skill === 'string' && skill.length > 0)
    : []
  if (skills.length === 0) return ''
  return '\n\n<loaded_skills>\n'
    + `Load and follow these skills first via the skill tool: ${skills.join(', ')}.\n`
    + '</loaded_skills>\n'
}

/**
 * Resolve the model's routing inputs into one execution route.
 * Order: task_id -> subagent_type -> category -> generic.
 * Unknown named types and unknown categories throw with their known-value lists.
 */
export function resolveTaskRoute(args = {}) {
  if (typeof args.task_id === 'string' && args.task_id.length > 0) {
    const parsed = fromOmoTaskId(args.task_id)
    if (parsed.kind === 'background') {
      throw new Error(
        `"${args.task_id}" is a background collection id; use background_output(task_id=...) to collect, not task()`,
      )
    }
    return { kind: 'followup', taskId: parsed.id }
  }
  if (typeof args.subagent_type === 'string' && args.subagent_type.length > 0) {
    if (!KNOWN_SUBAGENT_TYPES.includes(args.subagent_type)) {
      throw new Error(
        `unknown subagent_type "${args.subagent_type}"; known types: ${KNOWN_SUBAGENT_TYPES.join(', ')}`,
      )
    }
    return { kind: 'subagent-type', subagentType: args.subagent_type }
  }
  if (typeof args.category === 'string' && args.category.length > 0) {
    if (!KNOWN_CATEGORIES.includes(args.category)) {
      throw new Error(
        `unknown task category "${args.category}"; known categories: ${KNOWN_CATEGORIES.join(', ')}`,
      )
    }
    return { kind: 'category', category: args.category }
  }
  return { kind: 'generic' }
}

/** Compose the final child prompt for fresh starts (not used for follow-ups). */
function composeChildPrompt(route, args) {
  const skills = renderLoadedSkills(args.load_skills)
  const prompt = String(args.prompt ?? '')
  if (route.kind !== 'category') return skills + prompt
  const note = CATEGORY_PERSONA_NOTES[route.category]
  const categoryBlock = `<omo-task-category category="${route.category}">\n${note}\n</omo-task-category>\n`
  return categoryBlock + skills + prompt
}

/** Label for a subagent request or background job. */
function labelFor(args) {
  return typeof args.description === 'string' && args.description.trim().length > 0
    ? args.description.trim()
    : 'omo task'
}

/** Join the text blocks of a child's final output. */
function outputValueText(values) {
  return (Array.isArray(values) ? values : [])
    .filter(value =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
      && value.type === 'text' && typeof value.text === 'string')
    .map(value => value.text)
    .join('')
}

function textBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter(block => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/** A non-`completed` stop reason means the child did not finish cleanly. */
function stopReasonError(result) {
  switch (result?.stopReason) {
    case 'completed':
      return undefined
    case 'aborted':
      return 'subagent run was cancelled'
    case 'error':
      return 'subagent run failed'
    case 'max-tokens':
      return 'subagent run hit its token limit before finishing'
    case 'refusal':
      return 'subagent declined the task'
    default:
      return `subagent run ended abnormally (${String(result?.stopReason)})`
  }
}

/** Preserve a truncated child's partial text in the error shown to the model. */
function withPartialText(error, output) {
  const text = textBlocks(output)
  return text.length === 0 ? error : `${error}\nPartial output before the run ended:\n${text}`
}

/** Settle a foreground run: collect its result, then dispose it. */
async function settleForegroundRun(run) {
  const [execution] = await Promise.allSettled([
    run.result.then((result) => {
      const error = stopReasonError(result)
      if (error !== undefined) throw new Error(withPartialText(error, result.output))
      return {
        kind: 'foreground',
        runId: run.id,
        output: result.output,
      }
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/** Map a settled one-shot run to the `ctx.jobs` outcome shape. */
function runOutcome(result) {
  switch (result?.stopReason) {
    case 'completed':
      return { status: 'completed', output: textBlocks(result.output) }
    case 'aborted':
      return { status: 'killed' }
    case 'error':
    case 'max-tokens':
    case 'refusal':
      return { status: 'failed', detail: result.stopReason }
    default:
      return { status: 'failed', detail: String(result?.stopReason) }
  }
}

/** Settle a background one-shot run into a job outcome without importing dsh-subagent. */
async function settleRun(run) {
  let outcome
  try {
    outcome = runOutcome(await run.result)
  } catch (error) {
    outcome = { status: 'failed', detail: String(error) }
  }
  try {
    await run.dispose()
  } catch (error) {
    const prefix = outcome.detail === undefined ? '' : `${outcome.detail}; `
    return { status: 'failed', detail: `${prefix}dispose failed: ${String(error)}` }
  }
  return outcome
}

/** Settle pending startup without rejecting the job producer contract. */
async function settleStart(start, signal) {
  try {
    return await settleRun(await start)
  } catch (error) {
    return signal.aborted
      ? { status: 'killed' }
      : { status: 'failed', detail: String(error) }
  }
}

/** Prefer continuable background children; fall back to a one-shot `ctx.jobs` task. */
async function startBackground(ctx, request, label, parent, exec) {
  const provider = typeof ctx.subagents?.getProvider === 'function'
    ? ctx.subagents.getProvider(PROVIDER)
    : undefined
  const canContinue = typeof ctx.subagents?.startContinuable === 'function'
    && (provider === undefined || provider.prepareContinuable !== undefined)
  if (canContinue) {
    const { label: _label, ...continuableRequest } = request
    void _label
    const started = await ctx.subagents.startContinuable({
      provider: PROVIDER,
      label,
      request: continuableRequest,
      signal: exec.signal,
    })
    return { kind: 'continuable', subagentId: toSessionTaskId(started.childId) }
  }

  const jobs = ctx.jobs
  if (jobs === undefined) {
    throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
  }
  const id = jobs.start({
    kind: 'subagent',
    label,
    owner: parent,
    run: () => {
      const controller = new AbortController()
      const start = ctx.subagents.start(PROVIDER, { ...request, signal: controller.signal })
      return {
        cancel: (reason) => {
          controller.abort(reason ?? 'background subagent task killed')
        },
        done: settleStart(start, controller.signal),
      }
    },
  })
  return { kind: 'background', jobId: toBackgroundTaskId(id) }
}

/**
 * Deliver one follow-up to an existing continuable child.
 *
 * dsh 0.1.6 exposes `ctx.subagents.sendMessage(sender, targetId, content,
 * { signal })` (the `send_message` control path: steer the nearest step, or
 * start a turn when the child is idle). Older 0.1.x hosts exposed
 * `ctx.subagents.followup(parent, taskId, content, { source, signal })`; keep
 * it as the legacy fallback so the shim survives both harness generations.
 *
 * @returns which service method served the delivery.
 */
export async function deliverFollowup(ctx, parent, taskId, content, signal) {
  if (typeof ctx.subagents?.sendMessage === 'function') {
    await ctx.subagents.sendMessage(parent, taskId, content, { signal })
    return 'sendMessage'
  }
  if (typeof ctx.subagents?.followup === 'function') {
    await ctx.subagents.followup(parent, taskId, content, { source: { kind: 'user' }, signal })
    return 'followup'
  }
  throw new Error(
    'task_id requires continuable subagent follow-up, but neither ctx.subagents.sendMessage (0.1.6) nor ctx.subagents.followup is available in this composition; only fresh tasks are supported',
  )
}

/** Deliver a follow-up to an existing continuable child. */
async function followup(ctx, args, taskId, parent, exec) {
  const promptText = renderLoadedSkills(args.load_skills) + String(args.prompt ?? '')
  await deliverFollowup(ctx, parent, taskId, [{ type: 'text', text: promptText }], exec.signal)
  return { kind: 'continuable', subagentId: toSessionTaskId(taskId) }
}

const TASK_PARAMETERS = {
  description: {
    type: 'string',
    description: 'A short (3-5 word) description of the delegated task; becomes the subagent label.',
  },
  prompt: {
    type: 'string',
    required: true,
    description:
      'The complete, self-contained task for the child. The child does not share this '
      + 'conversation, so include everything it needs.',
  },
  category: {
    type: 'string',
    description:
      'Optional omo task category. Known: visual-engineering, deep, ultrabrain, quick, writing, git.',
  },
  subagent_type: {
    type: 'string',
    description:
      'Optional named specialist. Known: plan, oracle, librarian, explore, metis, momus, '
      + 'multimodal-looker, sisyphus, hephaestus, atlas, sisyphus-junior.',
  },
  load_skills: {
    type: 'array',
    items: { type: 'string' },
    default: [],
    description:
      'Skills the child should load first via the skill tool. Named in the child prompt.',
  },
  run_in_background: {
    type: 'boolean',
    description:
      'Whether to run in the background and return a durable id immediately (bg_... or ses_...). '
      + 'Defaults to false; set true when the result is not needed before the next action. '
      + 'Collect background ids with background_output after a completion notice.',
  },
  task_id: {
    type: 'string',
    description:
      'Continuation session id (ses_...) from a previous task() / call_omo_agent() call. '
      + 'When set, the prompt is delivered as the next turn of that existing child.',
  },
}

const TASK_OUTPUT = {
  schema: {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'background' },
          jobId: { type: 'string', required: true },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'continuable' },
          subagentId: { type: 'string', required: true },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, const: 'foreground' },
          runId: { type: 'string', required: true },
          output: { type: 'array', required: true, items: { type: 'json' } },
        },
      },
    ],
  },
  render: (_args, value) => [{
    type: 'text',
    text: value.kind === 'background'
      ? `started background task ${value.jobId}; collect with background_output(task_id="${value.jobId}") after the completion notice`
      : value.kind === 'continuable'
        ? `started session ${value.subagentId}; follow up with task(task_id="${value.subagentId}", prompt=...)`
        : outputValueText(value.output),
  }],
}

async function executeTask(ctx, args, exec) {
  const parent = exec.agent
  if (parent === undefined) {
    throw new Error('task tool requires a calling agent (exec.agent was undefined)')
  }

  const route = resolveTaskRoute(args)
  if (route.kind === 'followup') {
    return followup(ctx, args, route.taskId, parent, exec)
  }

  const label = labelFor(args)
  const request = {
    label,
    prompt: [{ type: 'text', text: composeChildPrompt(route, args) }],
    parent,
  }
  if (route.kind === 'subagent-type') {
    request.toolFilter = SUBAGENT_TYPE_DEFS[route.subagentType].toolFilter
  }

  if (args.run_in_background === true) {
    return startBackground(ctx, request, label, parent, exec)
  }

  const run = await ctx.subagents.start(PROVIDER, { ...request, signal: exec.signal })
  return settleForegroundRun(run)
}

function registerDelegationTool(ctx, toolName, description) {
  ctx.tools.register(defineTool({
    name: toolName,
    description,
    parameters: TASK_PARAMETERS,
    output: TASK_OUTPUT,
    isConcurrencySafe: () => true,
    execute: (args, exec) => executeTask(ctx, args, exec),
  }))
}

export function apply(ctx) {
  registerDelegationTool(
    ctx,
    'task',
    'Omo task delegation. Start a specialist (subagent_type) or category worker, '
    + 'or continue a child with task_id=ses_.... Foreground waits for the result; '
    + 'background returns bg_... / ses_.... Collect bg_... with background_output '
    + 'only after a completion notice.',
  )
  registerDelegationTool(
    ctx,
    'call_omo_agent',
    'Alias of task(). Same arguments: subagent_type, category, load_skills, '
    + 'run_in_background, task_id, prompt. Prefer this name when a skill example '
    + 'writes call_omo_agent.',
  )
}
