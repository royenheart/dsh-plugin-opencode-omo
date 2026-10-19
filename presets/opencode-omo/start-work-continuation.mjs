// dsh stand-in for omo's Codex Stop / SubagentStop continuation hook.
// While `.omo/boulder.json` lists this session and the active plan still has
// column-0 unchecked boxes, `agent/turn-stopping` steers one more step —
// the same "do not ask whether to continue" contract as start-work.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'opencode-omo-start-work-continuation'
export const inject = []

export const SESSION_PREFIX = 'dsh:'
const PREFIXES = /^(codex|dsh|omo|opencode):/

export const MAX_CONSECUTIVE_CONTINUATIONS = 8

const CONTINUATION_TEXT = [
  '<system-reminder>',
  'start-work continuation: this session still has active Boulder work and unchecked plan checkboxes.',
  'Do not ask whether to continue. Read `.omo/boulder.json` and the active plan, then dispatch the next checkbox.',
  '</system-reminder>',
].join('\n')

export function stripSessionPrefix(value) {
  return String(value ?? '').replace(PREFIXES, '')
}

export function sessionMatchesBoulder(sessionId, sessionIds) {
  const mine = stripSessionPrefix(sessionId)
  if (mine.length === 0 || !Array.isArray(sessionIds)) return false
  return sessionIds.some(id => stripSessionPrefix(id) === mine)
}

/** Column-0 unchecked Markdown tasks (implementation `N.` or verifier `F…`). */
export function hasOpenPlanCheckbox(planText) {
  return /^- \[ \] (?:\d+\.|F\S*)/m.test(String(planText ?? ''))
}

export function parseBoulder(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

export function activeBoulderWork(boulder, sessionId) {
  if (boulder === undefined || boulder === null) return undefined
  const works = boulder.works
  if (works === null || typeof works !== 'object') return undefined
  const preferred = typeof boulder.active_work_id === 'string'
    ? works[boulder.active_work_id]
    : undefined
  const candidates = preferred === undefined ? Object.values(works) : [preferred, ...Object.values(works)]
  for (const work of candidates) {
    if (work === null || typeof work !== 'object') continue
    if (work.status !== 'active') continue
    if (!sessionMatchesBoulder(sessionId, work.session_ids)) continue
    return work
  }
  return undefined
}

export function shouldContinueStartWork({ boulder, sessionId, planText, runningJobs = 0 }) {
  if (runningJobs > 0) return false
  const work = activeBoulderWork(boulder, sessionId)
  if (work === undefined) return false
  return hasOpenPlanCheckbox(planText)
}

function optionalJobs(ctx) {
  try {
    return ctx.get('jobs')
  } catch {
    return undefined
  }
}

function sessionCwd(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

function readWorkspaceFile(cwd, relative) {
  try {
    return readFileSync(join(cwd, relative), 'utf8')
  } catch {
    return undefined
  }
}

function runningJobCount(ctx, agent) {
  const jobs = optionalJobs(ctx)
  if (jobs === undefined || typeof jobs.list !== 'function') return 0
  return jobs.list(agent.id).filter(job => job.status === 'running' || job.status === 'stopping').length
}

export function apply(ctx) {
  const spent = new WeakMap()

  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message?.source?.kind === 'user') spent.delete(agent)
  })

  ctx.on('agent/turn-stopping', ({ agent }) => {
    const cwd = sessionCwd(agent)
    const sessionId = agent?.session?.id
    if (cwd === undefined || typeof sessionId !== 'string' || sessionId.length === 0) return
    const boulder = parseBoulder(readWorkspaceFile(cwd, '.omo/boulder.json'))
    const work = activeBoulderWork(boulder, sessionId)
    if (work === undefined) return
    const planPath = typeof work.active_plan === 'string' ? work.active_plan : undefined
    const planText = planPath === undefined ? undefined : readWorkspaceFile(cwd, planPath)
    if (!shouldContinueStartWork({
      boulder,
      sessionId,
      planText,
      runningJobs: runningJobCount(ctx, agent),
    })) return
    const used = spent.get(agent) ?? 0
    if (used >= MAX_CONSECUTIVE_CONTINUATIONS) return
    spent.set(agent, used + 1)
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: CONTINUATION_TEXT }],
      source: {
        kind: 'plugin',
        plugin: name,
        form: 'notice',
        summary: 'start-work continuation',
      },
    }))
  })
}
