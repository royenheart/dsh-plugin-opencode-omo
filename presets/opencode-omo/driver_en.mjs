// opencode-omo loop shim: a PURE PRESET PLUGIN on the native dsh seams —
// no dsh-side driver seam and no ReactLoopAgent subclass.
//
// Native seams used:
// - `ctx.systemPrompt.section({ complete: true })` replaces the persona row:
//   the section text provider receives the agent, so the opencode+omo whole
//   system prompt (env block + role prompt + plan prompt) is computed at every
//   assembly instead of being built by an overridden loop method.
// - `system-prompt/assemble` waterfall applies opencode's per-model tool gating
//   (apply_patch vs edit/write) to the request's tool schemas.
// - `agent/inbox/claimed` detects omo ultrawork keywords before assembly.
// - `agent/pre-step` injects opencode's MAX_STEPS_PROMPT when a role's
//   maxSteps ceiling is reached (assistant-role prefill on a patched harness;
//   a system-prompt section otherwise).
// - `agent/request` / `agent/request-error` route through the role's primary
//   model and advance the fallback chain, exactly like the previous subclass.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { renderRulesFor } from './rules.mjs'

export const name = 'opencode-omo-loop'

export const inject = ['systemPrompt', 'tools']

const PERSONA_SECTION = 'deployment:persona'
const PERSONA_ORDER = 0

const PROMPT_DIR = new URL('roles/prompts/', import.meta.url)
const LEGACY_PROMPT_DIR = new URL('roles/', import.meta.url)
const FAMILY_PROMPT_DIR = new URL('roles/prompts/family/', import.meta.url)
const VARIANT_PROMPT_DIR = new URL('roles/prompts/variants/', import.meta.url)
const PERSONA_FILE = new URL('persona.md', import.meta.url)

const familyPromptCache = new Map()
const planPromptCache = new Map()
const rolePromptCache = new Map()
const personaCache = new Map()

/** dsh folds plan mode from the durable `plan/mode` event stream. */
function planModeActive(session) {
  const event = session.events.findLast(item => item.type === 'plan/mode')
  return event?.data?.active === true
}

/** Plan state at the last logged request header (mirrors dsh plan-mode narration). */
function planModeAtLastHeader(session) {
  let lastHeader = -1
  let index = 0
  for (const event of session.events) {
    if (event.type === 'request/header') lastHeader = index
    index += 1
  }
  if (lastHeader < 0) return undefined
  let active
  for (index = 0; index < lastHeader; index += 1) {
    const event = session.events[index]
    if (event?.type === 'plan/mode') active = event.data?.active === true
  }
  return active
}

/**
 * opencode's plan file location. dsh has no worktree field, so the session cwd
 * is the workspace root (the same fallback the env block already uses).
 */
function planFilePath(session) {
  const cwd = session.header.cwd
  if (cwd === undefined) return undefined
  const created = Number.isSafeInteger(session.header.createdAt) ? session.header.createdAt : Date.now()
  return join(cwd, '.opencode', 'plans', `${created}-${session.id}.md`)
}

function planPrompt(file) {
  const cached = planPromptCache.get(file)
  if (cached !== undefined) return cached
  try {
    const text = readFileSync(new URL(file, PROMPT_DIR), 'utf8')
    planPromptCache.set(file, text)
    return text
  } catch {
    planPromptCache.set(file, undefined)
    return undefined
  }
}

function activePlanPrompt(session) {
  if (!planModeActive(session)) return undefined
  const template = planPrompt('plan-mode.txt') ?? planPrompt('plan.txt')
  if (template === undefined) return undefined
  if (!template.includes('${planInfo}')) return template
  const plan = planFilePath(session)
  const planInfo = plan === undefined
    ? 'No plan file exists yet.'
    : existsSync(plan)
      ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.`
      : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`
  return template.replace('${planInfo}', planInfo)
}

/** opencode's build-switch reminder after the plan agent hands off to build. */
function buildSwitchPrompt() {
  return planPrompt('build-switch.txt')
}

function buildSwitchFor(session) {
  // The step immediately after plan mode was committed off: the last logged
  // request header described plan mode, the current durable state does not.
  if (planModeActive(session)) return undefined
  if (planModeAtLastHeader(session) !== true) return undefined
  const plan = planFilePath(session)
  const reminder = buildSwitchPrompt() ?? ''
  if (plan === undefined || !existsSync(plan)) return reminder
  return reminder + '\n\nA plan file exists at ' + plan + '. You should execute on the plan defined within it'
}

/** Write the approved plan next to the same path the plan-mode prompt names. */
function persistPlanFile(session, planText) {
  const plan = planFilePath(session)
  if (plan === undefined) return false
  mkdirSync(dirname(plan), { recursive: true })
  writeFileSync(plan, String(planText))
  return true
}

export { persistPlanFile }

function personaText() {
  const cached = personaCache.get('persona.md')
  if (cached !== undefined) return cached
  try {
    const text = readFileSync(PERSONA_FILE, 'utf8')
    personaCache.set('persona.md', text)
    return text
  } catch {
    personaCache.set('persona.md', '')
    return ''
  }
}

/** Read and cache one prompt file under a prompt directory (relative `file` is the cache key). */
function promptFile(dir, file) {
  if (file === undefined) return undefined
  const cached = familyPromptCache.get(file)
  if (cached !== undefined) return cached
  try {
    const text = readFileSync(new URL(file, dir), 'utf8')
    familyPromptCache.set(file, text)
    return text
  } catch {
    familyPromptCache.set(file, undefined)
    return undefined
  }
}

/**
 * High-fidelity extracted omo Sisyphus family templates. The returned string
 * is `family/<file>` or `variants/sisyphus/<file>` relative to PROMPT_DIR, so
 * the prompt cache key stays unique across directories.
 */
function familyFileFor(model) {
  const id = String(model ?? '').toLowerCase()
  if (id.includes('kimi-k3')) return 'family/kimi-k3.md'
  if (id.includes('kimi-k2.7')) return 'variants/sisyphus/kimi-k2-7.md'
  if (id.includes('kimi-k2') || id.includes('kimi')) return 'variants/sisyphus/kimi-k2-6.md'
  if (id.includes('claude-fable-5')) return 'variants/sisyphus/claude-fable-5.md'
  if (id.includes('claude-opus-4-8')) return 'variants/sisyphus/claude-opus-4-8.md'
  if (id.includes('claude') || id.includes('anthropic')) return 'family/claude-opus-4-7.md'
  if (id.includes('gpt-5.6') || id.includes('gpt-5.5')) return 'family/gpt-5-5.md'
  if (id.includes('gpt-5.4') || id.includes('gpt')) return 'family/gpt-5-4.md'
  if (id.includes('gemini')) return 'family/gemini.md'
  if (id.includes('glm')) return 'family/glm-5-2.md'
  // omo's own fallback family: the dynamic Sisyphus prompt built from the
  // live section builders (role/intent, exploration, execution, style).
  return 'family/fallback.md'
}

function familyPromptFor(model) {
  return promptFile(PROMPT_DIR, familyFileFor(model))
}

function keyTriggersMarkdown() {
  return KEY_TRIGGERS.map(line => `- ${line}`).join('\n')
}

function delegationTableMarkdown() {
  return [
    '| agent | use when |',
    '|---|---|',
    ...DELEGATION_TABLE.map(([name, when]) => `| ${name} | ${when} |`),
  ].join('\n')
}

function skillsGuideMarkdown() {
  return [
    'The available skill catalog arrives as a <system-reminder> before this step. Load `frontend` for UI/UX work, `ulw-plan` for planning, `start-work` for plan execution, `remove-ai-slops` for cleanup, and any other skill whose description matches the task. Loading an irrelevant skill is cheap; missing a relevant one produces worse work.',
  ].join('\n')
}

function plannerSectionMarkdown() {
  return [
    'For work that is not yet implementation, use the `ulw-plan` planning workflow: explore first, ask only the forks exploration cannot resolve, wait for explicit approval, then write ONE decision-complete plan under `.omo/`. A plan is not implementation.',
  ].join('\n')
}

function taskSystemGuideMarkdown() {
  return [
    'Create todos before any non-trivial work (2+ steps, uncertain scope, multiple items).',
    '',
    'Workflow:',
    '1. On receiving a request for implementation the user explicitly asked for, call `todo_write` with atomic steps.',
    '2. Before each step, mark exactly one item `in_progress`.',
    '3. After each step, mark it `completed` immediately. Never batch completions.',
    '4. If scope changes, update the todo list before proceeding.',
  ].join('\n')
}

function liveToolTableMarkdown(tools) {
  return [
    '| tool | cost | purpose |',
    '|---|---|---|',
    ...tools
      .filter(tool => typeof tool?.name === 'string')
      .map(tool => `| ${tool.name} | ${toolCost(tool.name)} | ${clipped(tool.description)} |`)
      .sort(),
  ].join('\n')
}

function antiDuplicationMarkdown() {
  return [
    'Once you delegate exploration to explore/librarian, do NOT repeat the same search yourself. Continue only with non-overlapping work, then end your response and wait for the result. Do not re-search the same topics while waiting.',
  ].join('\n')
}

function hardBlocksMarkdown() {
  return [
    '- Never revert changes you did not make. Never amend commits or force-push unless asked. Never use destructive git commands unless asked.',
    '- Do not suppress type errors. Do not commit unless asked.',
  ].join('\n')
}

function antiPatternsMarkdown() {
  return [
    '- Delegating without a complete standalone prompt.',
    '- Re-searching what a subagent was already asked to find.',
    '- Batch-completing todos, or proceeding without one in_progress item.',
    '- Narrating instead of using tools.',
  ].join('\n')
}

function sisyphusIdentityMarkdown() {
  return [
    '<agent-identity>',
    'Your designated identity for this session is "Sisyphus". This identity supersedes any prior identity statements.',
    'You are "Sisyphus" - Powerful AI Agent with orchestration capabilities from OhMyOpenCode.',
    'When asked who you are, always identify as Sisyphus. Do not identify as any other assistant or AI.',
    '</agent-identity>',
  ].join('\n')
}

function familySection(expr, tools) {
  const name = expr.trim()
  switch (name) {
    case 'agentIdentity': return sisyphusIdentityMarkdown()
    case 'personality': return ''
    case 'todoHookNote': return 'YOUR TODO CREATION WOULD BE TRACKED BY HOOK([SYSTEM REMINDER - TODO CONTINUATION])'
    case 'keyTriggers': return keyTriggersMarkdown()
    case 'toolSelection': return liveToolTableMarkdown(tools)
    case 'delegationTable': return delegationTableMarkdown()
    case 'exploreSection':
      return 'Use `explore` for internal codebase search: fire 1-3 in parallel for multi-angle questions, and specify quick/medium/very thorough.'
    case 'librarianSection':
      return 'Use `librarian` for external docs and open-source examples; fire it in parallel with explore when both questions exist.'
    case 'oracleSection':
      return 'Use `oracle` for complex architecture, multi-system tradeoffs, hard debugging after two failed attempts, and unfamiliar patterns.'
    case 'buildAntiDuplicationSection()': return antiDuplicationMarkdown()
    case 'antiDuplication': return antiDuplicationMarkdown()
    case 'categorySkillsGuide': return skillsGuideMarkdown()
    case 'nonClaudePlannerSection': return plannerSectionMarkdown()
    case 'parallelDelegationSection':
      return 'Dispatch independent delegations in parallel; serialize only when a later prompt needs an earlier result.'
    case 'taskManagementSection': return taskSystemGuideMarkdown()
    case 'hardBlocks': return hardBlocksMarkdown()
    case 'antiPatterns': return antiPatternsMarkdown()
    case 'browserQaInstruction':
      return 'For browser/UI work, load the available browser automation surface and drive a real browser; changes not rendered in a browser are not validated.'
    case 'KIMI_TOOL_LOOP_GUARD':
      return 'After every edit, run diagnostics on changed files; never claim completion without verification.'
    case 'GPT_APPLY_PATCH_GUIDANCE':
      return 'Use `apply_patch` for single-file surgical edits. Prefer specialized file tools over shell for file operations.'
    case 'GPT_FILE_EDIT_GUIDANCE':
      return 'Use whichever file-editing tool is exposed in your toolset (`apply_patch`, or `edit`/`write`). Keep each change small and match the surrounding lines exactly so it applies on the first attempt.'
    default:
      return ''
  }
}

/** Render an extracted omo family template with live dsh routing sections. */
function renderFamilyPrompt(template, tools) {
  const hasToolTable = template.includes('${toolSelection}') || template.includes('{{ toolSelection }}')
  let body = template
    .replaceAll('{{ personality }}', '')
    .replaceAll('{{ keyTriggers }}', keyTriggersMarkdown())
    .replaceAll('{{ delegationTable }}', delegationTableMarkdown())
    .replaceAll('{{ categorySkillsGuide }}', skillsGuideMarkdown())
    .replaceAll('{{ nonClaudePlannerSection }}', plannerSectionMarkdown())
    .replaceAll('{{ taskSystemGuide }}', taskSystemGuideMarkdown())
    .replaceAll('{{ oracleSection }}', familySection('oracleSection', tools))
    .replaceAll('{{ frontendGuidance }}', familySection('browserQaInstruction', tools))
    .replaceAll('{{ toolSelection }}', liveToolTableMarkdown(tools))
  body = body.replace(/\$\{([^}]+)\}/g, (_match, expr) => familySection(expr, tools))
  return body + (hasToolTable ? '' : '\n\n## Tool selection (live)\n\n' + liveToolTableMarkdown(tools))
}

// Role id -> prompt file. `sisyphus` is the default: the extracted family
// template (or persona.md fallback) supplies it, so it has no static file.
// `hephaestus`/`atlas`/specialists now resolve model-family variant files
// extracted from omo's own agent factories.
const ROLE_PROMPT_FILES = {
  prometheus: 'prometheus.md',
  // Non-GPT fallback for hephaestus (omo itself would not register that agent).
  hephaestus: 'hephaestus.md',
  'sisyphus-junior': 'sisyphus-junior.md',
  athena: 'council.md',
  'athena-junior': 'council.md',
  'council-member': 'council.md',
}

const LEGACY_ROLE_PROMPT_FILES = {
  metis: 'metis.md',
  momus: 'momus.md',
  oracle: 'oracle.md',
  librarian: 'librarian.md',
  explore: 'explore.md',
  'multimodal-looker': 'looker.md',
}

/** omo agent factories choose these variant files by model family. */
function hephaestusVariantFile(model) {
  const id = String(model ?? '').toLowerCase()
  if (id.includes('gpt-5.6')) return 'hephaestus/gpt-5-6.md'
  if (id.includes('gpt-5.5')) return 'hephaestus/gpt-5-5.md'
  if (id.includes('gpt-5.4')) return 'hephaestus/gpt-5-4.md'
  if (id.includes('gpt')) return 'hephaestus/gpt.md'
  return undefined
}

function atlasVariantFile(model) {
  const id = String(model ?? '').toLowerCase()
  if (id.includes('claude-opus-4-7') || id.includes('claude')) return 'atlas/opus-4-7.md'
  if (id.includes('gpt') || id.includes('o1') || id.includes('o3')) return 'atlas/gpt.md'
  if (id.includes('gemini')) return 'atlas/gemini.md'
  if (id.includes('glm')) return 'atlas/glm.md'
  if (id.includes('kimi-k3')) return 'atlas/kimi-k3.md'
  if (id.includes('kimi-k2.7')) return 'atlas/kimi-k2-7.md'
  if (id.includes('kimi')) return 'atlas/kimi.md'
  return 'atlas/default.md'
}

function specialistVariantFile(role, model) {
  const id = String(model ?? '').toLowerCase()
  if (role === 'oracle') {
    if (id.includes('gpt-5.5') || id.includes('gpt-5.6')) return 'specialists/oracle-gpt-5-5.md'
    if (id.includes('gpt')) return 'specialists/oracle-gpt.md'
    return 'specialists/oracle-default.md'
  }
  if (role === 'metis') {
    return id.includes('kimi-k2.7') ? 'specialists/metis-kimi-k2-7.md' : 'specialists/metis-default.md'
  }
  if (role === 'momus') {
    if (id.includes('gpt-5.6')) return 'specialists/momus-gpt-5-6.md'
    if (id.includes('gpt')) return 'specialists/momus-gpt.md'
    return 'specialists/momus-default.md'
  }
  if (role === 'librarian') return 'specialists/librarian.md'
  if (role === 'explore') return 'specialists/explore.md'
  if (role === 'multimodal-looker') return 'specialists/multimodal-looker.md'
  return undefined
}

/** Simplified dsh-tool-facing sections substituted into the atlas variant files. */
function renderAtlasVariant(template, tools) {
  const categorySection = [
    '##### Option A: Use named subagent tools (dsh surface)',
    'This dsh mode has no `task(category=...)` categories; dispatch specialists with the named tools below.',
  ].join('\n')
  const agentSection = [
    '##### Option B: Use a specialist directly',
    ...DELEGATION_TABLE.map(([name, when]) => `- **\`${name}\`** - ${when}`),
  ].join('\n')
  const decisionMatrix = [
    '##### Decision Matrix',
    '- Internal codebase search → `explore` (parallel 1-3).',
    '- External docs/OSS → `librarian`.',
    '- Architecture/hard debugging → `oracle`.',
    '- Plan analysis/review → `metis` / `momus`.',
    '- Media → `multimodal-looker`.',
    '- Independent implementation units → `subagent` / `subagent_fork`; many workers → `workflow` / `ralph`.',
    'Never provide both a named specialist and a generic subagent for the same unit.',
  ].join('\n')
  const skillsSection = skillsGuideMarkdown()
  void tools
  return template
    .replaceAll('{CATEGORY_SECTION}', categorySection)
    .replaceAll('{AGENT_SECTION}', agentSection)
    .replaceAll('{DECISION_MATRIX}', decisionMatrix)
    .replaceAll('{SKILLS_SECTION}', skillsSection)
    .replaceAll('{{CATEGORY_SKILLS_DELEGATION_GUIDE}}', skillsSection)
}

/** Resolve one role's prompt body for the model this step routes to. */
function rolePromptFor(role, model, tools) {
  const hephaestus = hephaestusVariantFile(model)
  if (role === 'hephaestus' && hephaestus !== undefined) {
    const key = `variant:${hephaestus}`
    const cached = rolePromptCache.get(key)
    if (cached !== undefined) return cached
    const template = promptFile(VARIANT_PROMPT_DIR, hephaestus)
    if (template !== undefined) {
      const rendered = renderFamilyPrompt(template, tools)
      rolePromptCache.set(key, rendered)
      return rendered
    }
  }
  if (role === 'atlas') {
    const file = atlasVariantFile(model)
    const key = `variant:${file}`
    const cached = rolePromptCache.get(key)
    if (cached !== undefined) return cached
    const template = promptFile(VARIANT_PROMPT_DIR, file)
    if (template !== undefined) {
      const rendered = renderAtlasVariant(template, tools)
      rolePromptCache.set(key, rendered)
      return rendered
    }
  }
  const specialist = specialistVariantFile(role, model)
  if (specialist !== undefined) {
    const key = `variant:${specialist}`
    const cached = rolePromptCache.get(key)
    if (cached !== undefined) return cached
    const template = promptFile(VARIANT_PROMPT_DIR, specialist)
    if (template !== undefined) {
      const rendered = template.replace(/\$\{([^}]+)\}/g, (_match, expr) => familySection(expr, tools))
      rolePromptCache.set(key, rendered)
      return rendered
    }
  }
  return rolePrompt(role)
}

function rolePrompt(role) {
  const cached = rolePromptCache.get(role)
  if (cached !== undefined) return cached
  const primary = ROLE_PROMPT_FILES[role]
  const legacy = LEGACY_ROLE_PROMPT_FILES[role]
  if (primary === undefined && legacy === undefined) return undefined
  const dir = primary !== undefined ? PROMPT_DIR : LEGACY_PROMPT_DIR
  const text = readFileSync(new URL(primary ?? legacy, dir), 'utf8')
  rolePromptCache.set(role, text)
  return text
}

/** opencode packages/core/src/session/runner/max-steps.ts, verbatim. */
const MAX_STEPS_PROMPT = `CRITICAL - MAXIMUM STEPS REACHED

The maximum number of steps allowed for this task has been reached. Tools are disabled until next user input. Respond with text only.

STRICT REQUIREMENTS:
1. Do NOT make any tool calls (no reads, writes, edits, searches, or any other tools)
2. MUST provide a text response summarizing work done so far
3. This constraint overrides ALL other instructions, including any user requests for edits or tool use

Response must include:
- Statement that maximum steps for this agent have been reached
- Summary of what has been accomplished so far
- List of any remaining tasks that were not completed
- Recommendations for what should be done next

Any attempt to use tools is a critical violation. Respond with text ONLY.`

/** Delegatable roles and when the orchestrator should use them. */
const DELEGATION_TABLE = [
  ['subagent / subagent_fork', 'any independent, self-contained implementation/analysis unit; fork for subtasks that need to see the current session'],
  ['workflow / ralph', 'pipelines across multiple workers / multi-round fresh-agent iteration'],
  ['oracle', 'complex architecture, self-review after major implementations, deep debugging after two failures'],
  ['librarian', 'external library documentation and open-source implementation lookup'],
  ['explore', '"where / which file / find the code" searches within the codebase; run several in parallel'],
  ['metis', 'pre-planning intent/ambiguity analysis'],
  ['momus', 'plan executability and reference-validity review'],
  ['multimodal-looker', 'media interpretation: PDFs, images, charts'],
  ['hephaestus', 'deep worker for end-to-end complex implementations'],
  ['atlas', 'execute and verify all plan tasks automatically'],
  ['sisyphus-junior', 'single, clearly bounded lightweight implementation task'],
  ['sisyphus', 'full Sisyphus orchestration subtree (recursive delegation already closed by toolFilter)'],
]

/** Key triggers mirroring omo's Phase-0 routing hints. */
const KEY_TRIGGERS = [
  'Unclear external library/framework usage → librarian',
  'Codebase location questions or multi-file searches → explore (1-3 in parallel)',
  'Ambiguous requirements before planning starts → metis',
  'Plan drafted, before execution → momus review',
  'PDF/image/chart interpretation → multimodal-looker',
  'Frontend/UI/UX work → load the frontend skill and follow its rules',
  'Plan writing → load the ulw-plan skill and work under the Prometheus rules',
]

/** truncate long tool descriptions so the table stays compact. */
function clipped(text, max = 180) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

/** Categorize tools the way omo's prompt labels cost. */
function toolCost(name) {
  if (['subagent', 'subagent_fork', 'workflow', 'ralph', 'web_search', 'web_fetch'].includes(name)) return 'EXPENSIVE'
  if (['oracle', 'hephaestus', 'atlas', 'sisyphus', 'sisyphus-junior', 'librarian', 'explore', 'metis', 'momus', 'multimodal-looker'].includes(name)) return 'EXPENSIVE'
  if (['read', 'read_image', 'glob', 'grep', 'todo_write', 'skill', 'ask_user_question', 'list_agents'].includes(name)) return 'FREE'
  return 'CHEAP'
}

/** Concise model-family calibration notes (opencode/omo model-prompt heads). */
function modelFamilyNote(model) {
  const id = String(model ?? '').toLowerCase()
  if (id.includes('gpt') || id.includes('o1') || id.includes('o3')) {
    return 'Model route GPT: prefer apply_patch for file edits, batch parallel reads, and make the smallest correct change.'
  }
  if (id.includes('claude') || id.includes('anthropic')) {
    return 'Model route Claude: explore before editing, keep edits minimal, and follow the surrounding code style exactly.'
  }
  if (id.includes('gemini')) {
    return 'Model route Gemini: verify library availability from the repo first, and avoid extra summaries after edits.'
  }
  if (id.includes('kimi')) {
    return 'Model route Kimi: default to taking action with tools; delegate focused subtasks with complete standalone prompts.'
  }
  return undefined
}

/** Generated sections appended to the default Sisyphus system prompt. */
function dynamicSisyphusSections(tools, model) {
  const toolRows = tools
    .filter(tool => typeof tool?.name === 'string')
    .map(tool => `| ${tool.name} | ${toolCost(tool.name)} | ${clipped(tool.description)} |`)
    .sort()
  const delegationRows = DELEGATION_TABLE.map(([name, when]) => `| ${name} | ${when} |`)
  const family = modelFamilyNote(model)
  return [
    '## Dynamic routing (generated every step)',
    '',
    ...(family === undefined ? [] : [family, '']),
    '### Key triggers',
    ...KEY_TRIGGERS.map(line => `- ${line}`),
    '',
    '### Delegation table',
    '| agent | use when |',
    '|---|---|',
    ...delegationRows,
    '',
    '### Tool selection',
    '| tool | cost | purpose |',
    '|---|---|---|',
    ...toolRows,
    '',
    '### Skills',
    '- The available skill catalog arrives as a <system-reminder> before this step; load `frontend` for UI work, `ulw-plan` for planning, and other skills when their description matches.',
    '',
    'Fan out independent work in parallel. Every delegation prompt must be complete and standalone; verify specialist output before acting on it.',
  ].join('\n')
}

/**
 * opencode's model-dependent tool gating (tool/registry.ts):
 * gpt non-oss models (except gpt-4) get apply_patch INSTEAD of edit/write.
 */
function opencodeUsesPatch(model) {
  return typeof model === 'string'
    && model.includes('gpt-')
    && !model.includes('oss')
    && !model.includes('gpt-4')
}

function opencodeTools(tools, model) {
  const usePatch = opencodeUsesPatch(model)
  return tools.filter(tool => {
    if (tool.name === 'apply_patch') return usePatch
    if (tool.name === 'edit' || tool.name === 'write') return !usePatch
    return true
  })
}

/** Execution-side counterpart of the prompt-side gate (model-visible tools only). */
function gateToolCall(name, model) {
  const usePatch = opencodeUsesPatch(model)
  if (name === 'apply_patch' && !usePatch) {
    return 'opencode-omo: apply_patch is not exposed for this model family (edit/write are the file tools)'
  }
  if ((name === 'edit' || name === 'write') && usePatch) {
    return 'opencode-omo: edit/write are not exposed for this GPT model family (apply_patch is the file tool)'
  }
  return undefined
}

export { gateToolCall, opencodeUsesPatch }

// Mirrors opencode's ctx.project.vcs === "git" check: walk up from the session
// cwd looking for a .git entry (handles worktrees/submodules whose .git is a
// file, not a directory).
function gitRoot(dir) {
  let current = dir || process.cwd()
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

function isGitRepo(dir) {
  return gitRoot(dir) !== undefined
}

function omoEnvBlock(session, provider, model) {
  const cwd = session.header.cwd ?? ''
  // dsh has no worktree field; opencode's `ctx.worktree` is the git root when
  // the project is a git repo, so derive the same value from the filesystem.
  const workspaceRoot = gitRoot(cwd) ?? cwd
  return [
    'You are powered by the model named ' + (model ?? '') + '. The exact model ID is ' + (provider ?? '') + '/' + (model ?? ''),
    'Here is some useful information about the environment you are running in:',
    '<env>',
    '  Working directory: ' + cwd,
    '  Workspace root folder: ' + workspaceRoot,
    '  Is directory a git repo: ' + (workspaceRoot !== cwd || isGitRepo(cwd) ? 'yes' : 'no'),
    '  Platform: ' + process.platform,
    "  Today's date: " + new Date().toDateString(),
    '</env>',
  ].join('\n')
}

// The harness communicates the file-sandbox mode and approval policy through
// systemPrompt.context contributions (dsh-sandbox-policy's `sandbox:policy`
// and dsh-user-approval's `approval:policy`), which this preset's
// suppressRuntimeContext() drops. Re-render the same facts here so the model
// knows the boundary it runs under and the sanctioned escalation path. The
// policy sentences mirror dsh-sandbox-policy's renderPolicyContext wording —
// reconcile these strings when dsh changes theirs. Both services are read
// through public APIs (sandboxPolicy.resolve / approval.overrideOf + config).
function omoPolicyBlock(ctx, session) {
  if (typeof ctx.get !== 'function') return undefined
  const sandboxPolicy = ctx.get('sandboxPolicy')
  if (sandboxPolicy === undefined || sandboxPolicy === null) return undefined
  let policy
  try {
    policy = sandboxPolicy.resolve({ session })
  } catch {
    return undefined
  }
  const approval = ctx.get('approval')
  const approvalPolicy = approval === undefined || approval === null
    ? 'ask'
    : (approval.overrideOf?.(session) ?? approval.config?.policy ?? 'ask')
  const lines = []
  if (policy.mode === 'workspace-write') {
    lines.push('Current DSH file policy: workspace-write. Operations enforced by the DSH file sandbox may modify files under the session workspace: '
      + JSON.stringify(policy.workspaceRoot)
      + '. Reads are unrestricted, and some platform temporary areas may also be writable. The persistent bash shell runs inside this sandbox: a file write outside the workspace fails with a "Read-only file system" error — a policy denial, not a command bug. Follow the bash tool\'s `sandbox_permissions` escalation guidance when that happens, and prefer the read/write/edit file tools for out-of-workspace file access (they raise the same user-approval prompt automatically). Never use sudo: privilege escalation is blocked in this environment.')
  } else if (policy.mode === 'read-only') {
    lines.push('Current DSH file policy: read-only. Operations enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.')
  } else if (policy.mode === 'danger-full-access') {
    lines.push('Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.')
  }
  if (approvalPolicy === 'never') {
    lines.push('Approval prompts are disabled in this session: a sandbox denial is final — do not set `sandbox_permissions`.')
  }
  return lines.length === 0 ? undefined : lines.join('\n')
}

/** Flatten one inbox message's text for ultrawork detection. */
function messageText(message) {
  return (message.content ?? [])
    .filter(block => block?.type === 'text')
    .map(block => block.text ?? '')
    .join('\n')
}

/** Infer the current turn/step from the durable log (0 when no step has started yet). */
function currentPosition(session) {
  let turn = 0
  let lastStep = 0
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'turn/start') {
      turn = event.data.turn ?? 0
      break
    }
  }
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'step/start' && event.data.turn === turn) {
      lastStep = event.data.step ?? 0
      break
    }
  }
  return { turn, step: lastStep }
}

/** Infer the step about to be proposed (assembly runs before the loop appends step/start). */
function nextPosition(session) {
  const position = currentPosition(session)
  return { turn: position.turn, step: position.step + 1 }
}

/** Model the current step resolved to, for execution-side gates that carry no turn/step. */
function currentRouteModel(state, session, agent) {
  const position = currentPosition(session)
  const key = `${position.turn}:${position.step}`
  return state.resolvedRoutes.get(key)?.model ?? agent.options?.model
}

/** Render the omo + opencode whole system prompt for one concrete route. */
function renderOmoPrompt(ctx, omoRoles, state, agent, provider, model) {
  const session = agent.session
  const role = omoRoles?.roleFor?.(session.id) ?? 'sisyphus'
  const tools = schemasFor(ctx, agent)
  // The prompt family must follow the model this step actually routes to, not
  // the session's previous route (omo re-bakes the prompt for the live model).
  const roleSystem = rolePromptFor(role, model, tools)
  const family = role === 'sisyphus' ? familyPromptFor(model) : undefined
  const dynamic = roleSystem === undefined && family === undefined
    ? dynamicSisyphusSections(tools, model)
    : ''
  const baseBody = family !== undefined
    ? sisyphusIdentityMarkdown() + '\n\n' + renderFamilyPrompt(family, tools)
    : roleSystem ?? personaText()
  const buildSwitch = buildSwitchFor(session)
  const plan = activePlanPrompt(session)
  const policyBlock = omoPolicyBlock(ctx, session)
  // Patchless maxSteps degradation rides the system prompt (see
  // maxStepsSectionFor); on a patched harness the pre-step listener injects
  // the same text as an assistant continuation instead.
  const maxStepsSection = maxStepsSectionFor(omoRoles, session)
  const body = [
    ...(maxStepsSection === undefined ? [] : [maxStepsSection]),
    ...(buildSwitch === undefined ? [] : [buildSwitch]),
    ...(plan === undefined ? [] : [plan]),
    baseBody,
    ...(dynamic === '' ? [] : [dynamic]),
    renderRulesFor(session.header.cwd),
  ].filter(part => part !== '').join('\n\n')
  return omoEnvBlock(session, provider, model)
    + (policyBlock === undefined ? '' : '\n' + policyBlock)
    + '\n' + body
}

/**
 * Apply the omo + opencode whole system prompt for one assembly using the
 * best model route visible to the section provider itself. During a live
 * agent assembly the `system-prompt/assemble` listener replaces the rendered
 * `{{opencode_omo_prompt}}` variable with the route the request actually
 * resolves to (role primary, fallback entry, or the session's live model
 * selection), so this path is only the pre-waterfall fallback.
 */
export function systemPromptFor(ctx, omoRoles, state, agent) {
  const session = agent.session
  const position = nextPosition(session)
  const route = roleRoute(omoRoles, state, session, position.turn, position.step)
  const provider = route?.provider ?? agent.options.provider ?? ''
  const model = route?.model ?? agent.options.model ?? ''
  return renderOmoPrompt(ctx, omoRoles, state, agent, provider, model)
}

/** Read the model-facing tool schemas as this agent sees them. */
function schemasFor(ctx, agent) {
  try {
    return ctx.tools.schemas(agent) ?? []
  } catch {
    return []
  }
}

/** State per live agent: fallback chain position, ultrawork turn, and the prompt/request-consistent route per turn:step. */
function newState() {
  return {
    fallbackAttempts: new Map(),
    resolvedRoutes: new Map(),
    lastRouteTurn: 0,
    ultraworkTurn: 0,
  }
}

function currentRole(omoRoles, session) {
  if (omoRoles === undefined) return 'sisyphus'
  return omoRoles.roleFor(session.id)
}

function roleConfigFor(omoRoles, session) {
  if (omoRoles === undefined) return undefined
  return omoRoles.configFor(currentRole(omoRoles, session))
}

function maxStepsFor(omoRoles, session) {
  const config = roleConfigFor(omoRoles, session)
  return typeof config?.maxSteps === 'number' && Number.isSafeInteger(config.maxSteps) && config.maxSteps > 0
    ? config.maxSteps
    : Infinity
}

function fallbackModelsFor(omoRoles, session) {
  const config = roleConfigFor(omoRoles, session)
  if (config?.fallbackModels !== undefined && config.fallbackModels.length > 0) {
    return config.fallbackModels
  }
  if (omoRoles?.fallbackModelsFor !== undefined) {
    return omoRoles.fallbackModelsFor(currentRole(omoRoles, session)) ?? []
  }
  return []
}

function ultraworkRouteFor(omoRoles, state, session, turn) {
  if (state.ultraworkTurn !== turn) return undefined
  return roleConfigFor(omoRoles, session)?.ultrawork
}

/** User-pinned role model, or the omo-default primary resolved from the live catalog. */
function primaryModelFor(omoRoles, session) {
  const config = roleConfigFor(omoRoles, session)
  if (config?.model !== undefined) return config.model
  if (omoRoles?.primaryModelFor !== undefined) {
    return omoRoles.primaryModelFor(currentRole(omoRoles, session))
  }
  return undefined
}

function roleRoute(omoRoles, state, session, turn, step) {
  if (omoRoles === undefined) return undefined
  if (turn !== state.lastRouteTurn) {
    // A fresh turn never inherits an older step's fallback position, an
    // older step's resolved route, or an older turn's ultrawork override.
    state.fallbackAttempts.clear()
    state.resolvedRoutes.clear()
    if (state.ultraworkTurn !== turn) state.ultraworkTurn = 0
    state.lastRouteTurn = turn
  }
  const ultrawork = ultraworkRouteFor(omoRoles, state, session, turn)
  if (ultrawork?.model !== undefined) return ultrawork.model
  const attempt = state.fallbackAttempts.get(`${turn}:${step}`)
  if (attempt !== undefined) {
    const fallback = fallbackModelsFor(omoRoles, session)[attempt]
    if (fallback !== undefined) return fallback
  }
  return primaryModelFor(omoRoles, session)
}

/**
 * Resolve the route the request will actually use for one turn:step.
 * A role primary/fallback/ultrawork target wins; otherwise the assembly's
 * `provider`/`model` variables (the session's live model selection, set by
 * dsh's model-selection listener) or the agent's declared options are used.
 */
function finalRouteFor(omoRoles, state, session, turn, step, variables, agent) {
  const target = roleRoute(omoRoles, state, session, turn, step)
  const provider = target?.provider ?? variables?.provider ?? agent.options?.provider ?? ''
  const model = target?.model ?? variables?.model ?? agent.options?.model ?? ''
  return { provider, model, target }
}

function advanceFallback(omoRoles, state, session, turn, step) {
  if (omoRoles === undefined) return false
  const key = `${turn}:${step}`
  const attempt = state.fallbackAttempts.get(key)
  const nextIndex = attempt === undefined ? 0 : attempt + 1
  if (fallbackModelsFor(omoRoles, session)[nextIndex] === undefined) {
    state.fallbackAttempts.delete(key)
    return false
  }
  state.fallbackAttempts.set(key, nextIndex)
  return true
}

/** omo reference agent-config sampling defaults applied by the loop shim. */
function defaultRoleSampling(role, model) {
  const id = String(model ?? '').toLowerCase()
  const gpt = id.includes('gpt') || id.includes('o1') || id.includes('o3')
  const gpt56 = id.includes('gpt-5.6')
  if (role === 'atlas') return { temperature: 0.1 }
  if (role === 'sisyphus' && gpt) return { reasoningEffort: 'medium' }
  if (role === 'hephaestus' && gpt) return { reasoningEffort: 'medium' }
  if (role === 'oracle') return { temperature: 0.1, ...(gpt ? { reasoningEffort: 'medium' } : {}) }
  if (role === 'librarian' || role === 'explore' || role === 'multimodal-looker') return { temperature: 0.1 }
  if (role === 'metis') return { temperature: 0.3 }
  if (role === 'momus') {
    return {
      temperature: 0.1,
      ...(gpt56 ? { reasoningEffort: 'high' } : gpt ? { reasoningEffort: 'medium' } : {}),
    }
  }
  return {}
}

/**
 * Failure classes omo advances its fallback chain on. AUTH, context-window
 * overflow, aborts, and malformed requests stay on the same model (or the
 * harness's own retry policy) instead of burning a fallback entry.
 */
const FALLBACK_CODES = new Set([
  'RATE_LIMIT', 'QUOTA', 'SERVER', 'TRANSPORT', 'TIMEOUT', 'EMPTY_RESPONSE', 'MODEL_NOT_FOUND',
])

function fallbackRetryable(failure) {
  if (failure === undefined) return false
  if (typeof failure?.code === 'string' && FALLBACK_CODES.has(failure.code)) return true
  // 404 is the cross-adapter approximation for model-not-found (dsh has no
  // dedicated code yet; the seam audit recommends MODEL_NOT_FOUND upstream).
  const status = failure?.status
  return Number.isInteger(status) && (status === 404 || status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599))
}

export { fallbackRetryable }

function maxStepsPrefillFor(agent) {
  return createAssistantMessage({
    content: [{ type: 'text', text: MAX_STEPS_PROMPT }],
    source: {
      provider: agent.options.provider ?? '',
      model: agent.options.model ?? '',
    },
  })
}

export { maxStepsPrefillFor }

/**
 * Patchless maxSteps degradation: when the harness lacks the assistantPrefill
 * seam, render opencode's MAX_STEPS_PROMPT as a system-prompt section for the
 * step that reaches the ceiling — the same text on the same trigger as the
 * pre-step injection, differing only in position (system prefix instead of a
 * trailing assistant continuation). The omo prompt re-renders every step, so
 * no dsh seam is needed for this.
 */
function maxStepsSectionFor(omoRoles, session) {
  if (omoRoles?.compat?.assistantPrefill === true) return undefined
  const maxSteps = maxStepsFor(omoRoles, session)
  if (!Number.isFinite(maxSteps)) return undefined
  return nextPosition(session).step >= maxSteps ? MAX_STEPS_PROMPT : undefined
}

export { maxStepsSectionFor }

/**
 * Resolve the maxSteps injection the CURRENT harness can honor. The host
 * registry detects the dsh patch at startup and exposes `omoRoles.compat`;
 * without the host row the shim conservatively assumes the patch is missing.
 * A patched harness records the text as an assistant-role continuation;
 * without the seam the system prompt carries it (see maxStepsSectionFor), so
 * the pre-step decision passes through unchanged.
 */
function maxStepsDecisionFor(decision, agent, omoRoles) {
  if (omoRoles?.compat?.assistantPrefill !== true) return decision
  return {
    ...decision,
    assistantPrefill: maxStepsPrefillFor(agent),
  }
}

export { maxStepsDecisionFor }

export function apply(ctx) {
  const states = new Map()
  let omoRoles
  try {
    omoRoles = ctx.get('omoRoles')
  } catch {
    // Host row absent: the preset still runs; role routing degrades to the
    // default sisyphus prompt and the normal session model.
    omoRoles = undefined
  }

  const stateFor = (agent) => {
    let state = states.get(agent.session.id)
    if (state === undefined) {
      state = newState()
      states.set(agent.session.id, state)
    }
    return state
  }

  // The whole opencode+omo system prompt, replacing the static persona row.
  // The section is a single interpolated variable: prompt section providers
  // run BEFORE the `system-prompt/assemble` waterfall, so only the listener
  // below sees the model-selection variables that carry the session's live
  // route. It re-renders the full omo prompt for the actual request model and
  // stores it in `{{opencode_omo_prompt}}`; `complete: true` then keeps the
  // harness identity/runtime-context sections suppressed.
  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_SECTION,
    order: PERSONA_ORDER,
    complete: true,
    text: (context) => {
      if (context.agent === undefined) return personaText()
      return '{{opencode_omo_prompt}}'
    },
  }), 'opencode-omo-loop: complete persona section')
  ctx.effect(() => ctx.systemPrompt.variable('opencode_omo_prompt', (context) => {
    if (context.agent === undefined) return personaText()
    return systemPromptFor(ctx, omoRoles, stateFor(context.agent), context.agent)
  }), 'opencode-omo-loop: complete persona variable')
  ctx.systemPrompt.suppressRuntimeContext()

  // opencode's per-model tool gating rides the authoritative assembly
  // waterfall: the returned tool list is what the loop sends to the model.
  // Prepend so this listener wraps dsh's model-selection listener (installed
  // before the preset mounts): `next()` then returns the variables carrying
  // the session's live provider/model, and the route stored here is the same
  // one `agent/request` enforces on the actual LLM call.
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const transformed = await next()
    const agent = context.agent
    if (agent === undefined) return transformed
    const state = stateFor(agent)
    const position = nextPosition(agent.session)
    const route = finalRouteFor(
      omoRoles, state, agent.session, position.turn, position.step,
      transformed.variables, agent,
    )
    state.resolvedRoutes.set(`${position.turn}:${position.step}`, route)
    transformed.variables.provider = route.provider
    transformed.variables.model = route.model
    transformed.variables.opencode_omo_prompt = renderOmoPrompt(
      ctx, omoRoles, state, agent, route.provider, route.model,
    )
    return { ...transformed, tools: opencodeTools(transformed.tools, route.model) }
  }, { prepend: true })

  // Execution-side mirror of the model-visible gate: a hallucinated call to a
  // tool this model family does not see must not dispatch through the original
  // registry (assembly filtering alone only changes the request schema).
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.agent === undefined) return next()
    const reason = gateToolCall(exec.name, currentRouteModel(
      stateFor(exec.agent), exec.agent.session, exec.agent,
    ))
    if (reason !== undefined) return { kind: 'deny', reason }
    return next()
  })

  // dsh plan mode never writes a plan file; persist the approved plan at
  // opencode's location so the build-switch reminder can point at it.
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (exec.name === 'exit_plan_mode'
      && downstream.kind === 'accept'
      && result.isError !== true
      && typeof exec.arguments?.plan === 'string'
      && exec.agent !== undefined) {
      persistPlanFile(exec.agent.session, exec.arguments.plan)
    }
    return downstream
  })

  // omo ultrawork keyword detection. inbox/claimed fires inside preStep
  // BEFORE the system-prompt assembly, so the env block and route see the
  // override for this exact step (the same ordering the old subclass had).
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const clean = messageText(message).replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '')
    if (/\b(ultrawork|ulw)\b/i.test(clean)) {
      stateFor(agent).ultraworkTurn = turn
    }
  })

  // maxSteps + MAX_STEPS_PROMPT. On a patched harness the general-purpose dsh
  // seam `PreStepDecision.assistantPrefill` (see DSH_CHANGE_PROPOSALS.md)
  // carries the verbatim opencode text as the assistant-role continuation it
  // is; without the seam the same text rides the system prompt via
  // maxStepsSectionFor, so this listener leaves the decision unchanged.
  ctx.on('agent/pre-step', async ({ agent, step }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    if (step >= maxStepsFor(omoRoles, agent.session)) {
      return maxStepsDecisionFor(decision, agent, omoRoles)
    }
    return decision
  })

  // Role primary model + ultrawork override + omo sampling defaults. Prepend
  // for the same reason as the assembly listener: dsh's model-selection
  // listener would otherwise run last and silently override the role route
  // (and split the request route from the prompt this preset rendered).
  ctx.on('agent/request', async ({ agent, turn, step }, next) => {
    const resolved = await next()
    const state = stateFor(agent)
    const role = currentRole(omoRoles, agent.session)
    const planned = state.resolvedRoutes.get(`${turn}:${step}`)
    const route = planned ?? finalRouteFor(
      omoRoles, state, agent.session, turn, step,
      { provider: resolved.provider, model: resolved.model }, agent,
    )
    const target = route.target
    const ultra = ultraworkRouteFor(omoRoles, state, agent.session, turn)
    const model = route.model
    const sampling = defaultRoleSampling(role, model)
    if (target !== undefined) {
      // A reasoning-effort selected for another model must not leak into
      // the role/fallback route; use the entry's own effort when present.
      const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
      const effort = ultra?.reasoningEffort ?? target.reasoningEffort ?? sampling.reasoningEffort
      return {
        ...withoutInheritedEffort,
        provider: route.provider,
        model: route.model,
        ...(effort !== undefined ? { reasoningEffort: effort } : {}),
        ...(sampling.temperature !== undefined ? { temperature: sampling.temperature } : {}),
      }
    }
    const effort = ultra?.reasoningEffort ?? sampling.reasoningEffort
    return {
      ...resolved,
      ...(effort !== undefined && resolved.reasoningEffort === undefined ? { reasoningEffort: effort } : {}),
      ...(sampling.temperature !== undefined ? { temperature: sampling.temperature } : {}),
    }
  }, { prepend: true })

  ctx.on('agent/request-error', async ({ agent, turn, step, failure, signal }, next) => {
    if (signal?.aborted || !fallbackRetryable(failure)) return next()
    if (advanceFallback(omoRoles, stateFor(agent), agent.session, turn, step)) {
      return { kind: 'retry' }
    }
    return next()
  })

  ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent.session.id)
  })
}
