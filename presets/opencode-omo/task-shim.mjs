// opencode-omo `task` shim: maps omo's model-facing
// `task(category=..., subagent_type=..., load_skills=[...],
// run_in_background=..., task_id=..., description=..., prompt=...)` surface onto
// dsh's native subagent services.
//
// Routing:
//   task_id        -> continuable follow-up (`ctx.subagents.sendMessage`)
//   subagent_type  -> pin the same role restriction as the matching named
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
import { ROLE_TOOL_FILTERS } from './delegation-restrictions.mjs'
import { INITIAL_BACKGROUND, transitionBackground } from './background-state.mjs'

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
 * Named-row mapping: omo role id (driver prompt routing) and the shared
 * capability filter from delegation-restrictions.mjs. agent.cordis.yml only
 * registers the toolName. `plan` is the tool name; its role is Prometheus.
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
    toolFilter: ROLE_TOOL_FILTERS.prometheus,
  },
  oracle: {
    role: 'oracle',
    toolFilter: ROLE_TOOL_FILTERS.oracle,
  },
  librarian: {
    role: 'librarian',
    toolFilter: ROLE_TOOL_FILTERS.librarian,
  },
  explore: {
    role: 'explore',
    toolFilter: ROLE_TOOL_FILTERS.explore,
  },
  metis: {
    role: 'metis',
    toolFilter: ROLE_TOOL_FILTERS.metis,
  },
  momus: {
    role: 'momus',
    toolFilter: ROLE_TOOL_FILTERS.momus,
  },
  'multimodal-looker': {
    role: 'multimodal-looker',
    toolFilter: ROLE_TOOL_FILTERS['multimodal-looker'],
  },
  athena: {
    role: 'athena',
    toolFilter: ROLE_TOOL_FILTERS.athena,
  },
  'athena-junior': {
    role: 'athena-junior',
    toolFilter: ROLE_TOOL_FILTERS['athena-junior'],
  },
  'council-member': {
    role: 'council-member',
    toolFilter: ROLE_TOOL_FILTERS['council-member'],
  },
  sisyphus: {
    role: 'sisyphus',
    toolFilter: ROLE_TOOL_FILTERS.sisyphus,
  },
  hephaestus: {
    role: 'hephaestus',
    toolFilter: ROLE_TOOL_FILTERS.hephaestus,
  },
  atlas: {
    role: 'atlas',
    toolFilter: ROLE_TOOL_FILTERS.atlas,
  },
  'sisyphus-junior': {
    role: 'sisyphus-junior',
    toolFilter: ROLE_TOOL_FILTERS['sisyphus-junior'],
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

/** Tool restriction inherited by a child created through a named tool / task(). */
export function toolRestrictionForDelegation(name, args = {}) {
  if (name === 'task' || name === 'call_omo_agent') {
    if (typeof args.task_id === 'string' && args.task_id.length > 0) return undefined
    const type = args.subagent_type
    if (typeof type === 'string' && type.length > 0) return SUBAGENT_TYPE_DEFS[type]?.toolFilter
    return ROLE_TOOL_FILTERS.sisyphus
  }
  return SUBAGENT_TYPE_DEFS[name]?.toolFilter
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
  if (note === undefined) throw new Error(`missing category persona note: ${route.category}`)
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

/** Settle a managed activation: collect its result, then dispose it. */
async function settleForegroundRun(activation, signal) {
  let removeAbort = () => {}
  const aborted = signal === undefined ? undefined : new Promise((_, reject) => {
    const onAbort = () => {
      void activation.dispose().catch(() => {})
      reject(signal.reason ?? new Error('subagent run aborted'))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    removeAbort = () => signal.removeEventListener('abort', onAbort)
  })
  let execution
  try {
    const result = await (aborted === undefined ? activation.result : Promise.race([activation.result, aborted]))
    const error = stopReasonError(result)
    if (error !== undefined) throw new Error(withPartialText(error, result.output))
    execution = {
      kind: 'foreground',
      runId: activation.childId,
      output: result.output,
    }
  } catch (error) {
    removeAbort()
    await activation.dispose().catch(() => {})
    throw error
  }
  removeAbort()
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => activation.dispose())])
  if (disposal.status === 'rejected') throw disposal.reason
  return execution
}

/** Map a settled activation to the `ctx.jobs` outcome shape. */
export function runOutcome(result) {
  switch (result?.stopReason) {
    case 'completed':
      // dsh 0.2.1 took the former JobOutcome.output string under `result`;
      // jobs-local stores only outcome.result, so keeping `output` drops the
      // background subagent's final report.
      return { status: 'completed', result: textBlocks(result.output) }
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

/** Settle one managed activation into a job outcome; never rejects. */
async function settleActivation(activation) {
  let outcome
  try {
    outcome = runOutcome(await activation.result)
  } catch (error) {
    outcome = { status: 'failed', detail: String(error) }
  }
  try {
    await activation.dispose()
  } catch (error) {
    const prefix = outcome.detail === undefined ? '' : `${outcome.detail}; `
    return { status: 'failed', detail: `${prefix}dispose failed: ${String(error)}` }
  }
  return outcome
}

/** Start and register a background subagent activation as an owned job. */
function startBackground(ctx, request, label, parent, exec) {
  const jobs = ctx.jobs
  if (jobs === undefined) {
    throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
  }
  // Start inside run(): the job registry has then passed ownership, controller
  // and capacity preflight. A registration rejection therefore cannot leave an
  // already-running child without a job id.
  const id = jobs.start({
    kind: 'subagent',
    label,
    owner: parent.id,
    run: () => {
      const controller = new AbortController()
      let activation
      let state = INITIAL_BACKGROUND
      const done = (async () => {
        let outcome
        try {
          activation = await ctx.subagents.startActivation({
            provider: PROVIDER,
            label,
            request,
            signal: controller.signal,
            delivery: 'caller',
          })
          state = transitionBackground(state, { type: 'start' })
          if (state.phase === 'cancelling') {
            await activation.dispose().catch(() => {})
            outcome = { status: 'killed' }
          } else {
            outcome = await settleActivation(activation)
            if (state.phase === 'cancelling') outcome = { status: 'killed' }
          }
        } catch (error) {
          outcome = state.phase === 'cancelling' || controller.signal.aborted
            ? { status: 'killed' }
            : { status: 'failed', detail: String(error) }
        }
        state = transitionBackground(state, { type: 'settle', outcome })
        return outcome
      })()
      return {
        cancel: (reason) => {
          if (state.phase === 'settled') return
          state = transitionBackground(state, { type: 'cancel' })
          controller.abort(reason ?? 'background subagent task killed')
          if (activation !== undefined) void activation.dispose().catch(() => {})
        },
        done,
      }
    },
  })
  return { kind: 'background', jobId: toBackgroundTaskId(id) }
}

/** Deliver a follow-up to an existing continuable child. */
async function followup(ctx, args, taskId, parent, exec) {
  if (typeof ctx.subagents?.sendMessage !== 'function') {
    throw new Error(
      'task_id requires continuable subagent follow-up, but ctx.subagents.sendMessage is unavailable in this composition; only fresh tasks are supported',
    )
  }
  const promptText = renderLoadedSkills(args.load_skills) + String(args.prompt ?? '')
  await ctx.subagents.sendMessage(
    parent,
    taskId,
    [{ type: 'text', text: promptText }],
    { signal: exec.signal },
  )
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
      `Optional omo task category. Known: ${KNOWN_CATEGORIES.join(', ')}.`,
  },
  subagent_type: {
    type: 'string',
    description:
      'Optional named specialist. Known: plan, oracle, librarian, explore, metis, momus, '
      + 'multimodal-looker, athena, athena-junior, council-member, sisyphus, hephaestus, '
      + 'atlas, sisyphus-junior.',
  },
  cwd: {
    type: 'string',
    description:
      'Optional initial child directory for a fresh task. Use an absolute path when the caller must pin a review worktree; '
      + 'omitted inherits the parent directory. Ignored for task_id follow-ups.',
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
      'Whether to run in the background and return a durable bg_... id immediately; collect it with background_output. '
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
    prompt: [{ type: 'text', text: composeChildPrompt(route, args) }],
    parent,
  }
  if (typeof args.cwd === 'string') {
    const cwd = args.cwd.trim()
    if (cwd === '') throw new Error('task cwd must not be blank')
    request.cwd = cwd
  }

  if (args.run_in_background === true) {
    return startBackground(ctx, request, label, parent, exec)
  }

  const activation = await ctx.subagents.startActivation({
    provider: PROVIDER,
    label,
    request,
    signal: exec.signal,
    delivery: 'caller',
  })
  return settleForegroundRun(activation, exec.signal)
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
    + 'background returns bg_.... Collect bg_... with background_output '
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
