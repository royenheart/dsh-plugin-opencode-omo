/**
 * Pure-helper and thin execute-path tests for the omo delegation surface:
 * ID prefixes, catalog hiding, and background_output / background_cancel
 * argument contracts over a stub jobs service.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  apply,
  applyOmoDelegationCatalog,
  fromOmoTaskId,
  HIDDEN_DSH_DELEGATION_TOOLS,
  name,
  rewriteJobCompletionNotice,
  rewriteJobsPromptSection,
  toBackgroundTaskId,
  toSessionTaskId,
} from '../presets/opencode-omo/delegation-surface.mjs'

test('module identity', () => {
  assert.equal(name, 'opencode-omo-delegation-surface')
})

test('toBackgroundTaskId prefixes raw dsh ids and leaves omo ids alone', () => {
  assert.equal(toBackgroundTaskId('abc'), 'bg_abc')
  assert.equal(toBackgroundTaskId('bg_abc'), 'bg_abc')
  assert.equal(toBackgroundTaskId('ses_abc'), 'ses_abc')
  assert.equal(toBackgroundTaskId(''), '')
})

test('toSessionTaskId prefixes raw dsh ids and leaves omo ids alone', () => {
  assert.equal(toSessionTaskId('abc'), 'ses_abc')
  assert.equal(toSessionTaskId('ses_abc'), 'ses_abc')
  assert.equal(toSessionTaskId('bg_abc'), 'bg_abc')
  assert.equal(toSessionTaskId(''), '')
})

test('fromOmoTaskId strips prefixes and passes raw dsh ids through', () => {
  assert.deepEqual(fromOmoTaskId('bg_abc'), { kind: 'background', id: 'abc' })
  assert.deepEqual(fromOmoTaskId('ses_abc'), { kind: 'session', id: 'abc' })
  assert.deepEqual(fromOmoTaskId('abc'), { kind: 'raw', id: 'abc' })
})

test('rewriteJobCompletionNotice uses omo names, bg_ ids, and a system-reminder', () => {
  const rewritten = rewriteJobCompletionNotice(
    'background job abc (subagent: explore) finished [status: completed]. Read its output with job_output.',
  )
  assert.match(rewritten, /^<system-reminder>\n/)
  assert.match(rewritten, /background task bg_abc/)
  assert.match(rewritten, /background_output\(task_id="bg_abc"\)/)
  assert.doesNotMatch(rewritten, /job_output/)
  assert.doesNotMatch(rewritten, /background job /)
})

test('rewriteJobCompletionNotice keeps truncated notices actionable', () => {
  const rewritten = rewriteJobCompletionNotice('background job subagent-1\nDone; job_output.')
  assert.match(rewritten, /background task bg_subagent-1/)
  assert.match(rewritten, /Done; background_output/)
})

test('rewriteJobsPromptSection rewrites the dsh tool:jobs copy', () => {
  const rewritten = rewriteJobsPromptSection(
    'collect every still-relevant job with job_output, and job_kill jobs that stopped mattering.',
  )
  assert.match(rewritten, /background_output/)
  assert.match(rewritten, /background_cancel/)
  assert.doesNotMatch(rewritten, /job_output|job_kill/)
})

test('pre-step rewrites tool-jobs notices and leaves other messages alone', async () => {
  const decisions = []
  const ctx = mockDelegationCtx()
  ctx.on = (event, listener) => {
    if (event === 'agent/pre-step') decisions.push(listener)
  }
  apply(ctx)
  assert.equal(decisions.length, 1)
  const notice = {
    source: { kind: 'plugin', plugin: 'tool-jobs', form: 'notice', summary: 'done' },
    content: [{ type: 'text', text: 'background job j1 (bash: test) finished [status: completed]. Read its output with job_output.' }],
  }
  const user = {
    source: { kind: 'user' },
    content: [{ type: 'text', text: 'background job j1. Read its output with job_output.' }],
  }
  const decision = await decisions[0]({}, () => Promise.resolve({
    kind: 'enter',
    messages: [notice, user],
  }))
  assert.match(decision.messages[0].content[0].text, /background_output\(task_id="bg_j1"\)/)
  assert.equal(decision.messages[1].content[0].text, user.content[0].text)
})

test('applyOmoDelegationCatalog drops hidden dsh execution-layer names', () => {
  const kept = { name: 'task', description: 'omo' }
  const catalog = applyOmoDelegationCatalog([
    kept,
    ...HIDDEN_DSH_DELEGATION_TOOLS.map(toolName => ({ name: toolName })),
    { name: 'oracle' },
    { description: 'nameless' },
  ])
  assert.deepEqual(catalog, [kept, { name: 'oracle' }])
})

test('applyOmoDelegationCatalog keeps send_message only for delegated children', () => {
  const tools = [
    { name: 'task' },
    { name: 'send_message' },
    { name: 'list_agents' },
    { name: 'job_list' },
  ]
  assert.deepEqual(applyOmoDelegationCatalog(tools).map(tool => tool.name), ['task'])
  assert.deepEqual(
    applyOmoDelegationCatalog(tools, { allowSendMessage: true }).map(tool => tool.name),
    ['task', 'send_message'],
  )
})

test('send_message pre-execute is allowed for a delegated child and denied for the primary', async () => {
  const listeners = new Map()
  const ctx = {
    jobs: {},
    tools: { register() {} },
    on(event, listener) { listeners.set(event, listener) },
  }
  apply(ctx)
  const listener = listeners.get('tools/pre-execute')
  const next = () => Promise.resolve({ kind: 'accept' })
  const childExec = { name: 'send_message', agent: { session: { header: { origin: 'subagent' } } } }
  assert.deepEqual(await listener(childExec, next), { kind: 'accept' })
  const primaryExec = { name: 'send_message', agent: { session: { header: {} } } }
  assert.equal((await listener(primaryExec, next)).kind, 'deny')
  const hiddenExec = { name: 'list_agents', agent: { session: { header: { delegationDepth: 1 } } } }
  assert.equal((await listener(hiddenExec, next)).kind, 'deny')
})

test('background_output appends the producer terminal result', async () => {
  const ctx = mockDelegationCtx({
    read(id) {
      return {
        chunks: [],
        job: { id, status: 'completed' },
        ...(id === 'job-result' ? { result: 'RESULT' } : {}),
      }
    },
  })
  apply(ctx)
  const tool = ctx.registered.get('background_output')
  const collected = await tool.execute({ task_id: 'bg_job-result' }, { agent: {} })
  assert.equal(collected.text, 'RESULT')
  assert.equal(collected.status, 'completed')
  assert.equal(collected.task_id, 'bg_job-result')
})

function mockDelegationCtx(jobs) {
  const registered = new Map()
  return {
    jobs,
    tools: {
      register(tool) {
        registered.set(tool.name, tool)
      },
    },
    on() {},
    registered,
  }
}

test('background_output rejects ses_ ids and rewrites collected job ids', async () => {
  const ctx = mockDelegationCtx({
    read(id) {
      return { chunks: [{ at: 0, text: `out-${id}` }], job: { id, status: 'completed' } }
    },
  })
  apply(ctx)
  const tool = ctx.registered.get('background_output')
  assert.ok(tool)

  await assert.rejects(
    () => tool.execute({ task_id: 'ses_child' }, { agent: {} }),
    /continuation session id/,
  )

  const collected = await tool.execute({ task_id: 'bg_job1' }, { agent: {} })
  assert.deepEqual(collected, {
    text: 'out-job1',
    task_id: 'bg_job1',
    status: 'completed',
  })

  const fromNotice = await tool.execute({ task_id: 'job1' }, { agent: {} })
  assert.equal(fromNotice.task_id, 'bg_job1')
  assert.equal(fromNotice.status, 'completed')
})

test('background_cancel rejects all=true and cancels one id', async () => {
  const killed = []
  const ctx = mockDelegationCtx({
    kill(id, _agent, reason) {
      killed.push({ id, reason })
      return id === 'done' ? 'already-finished' : 'killed'
    },
  })
  apply(ctx)
  const tool = ctx.registered.get('background_cancel')
  assert.ok(tool)

  await assert.rejects(
    () => tool.execute({ all: true, taskId: 'bg_x' }, { agent: {} }),
    /all=true/,
  )

  const cancelled = await tool.execute({ taskId: 'bg_x' }, { agent: {} })
  assert.deepEqual(cancelled, { outcome: 'cancellation-requested', task_id: 'bg_x' })
  assert.deepEqual(killed, [{ id: 'x', reason: 'background_cancel' }])
})
