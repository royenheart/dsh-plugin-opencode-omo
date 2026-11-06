/**
 * Step-admission contract for the opencode-omo tool surface.
 *
 * The 0.2.1+ harness owns tool declarations in `ToolsService.resolve`; a
 * `system-prompt/assemble` listener can no longer add or remove them. This
 * test resolves a real step set for a scoped Agent and checks that the
 * per-agent registrations still implement opencode's hidden names, model
 * family, and description surface, while preserving an inherited tool's own
 * `when` condition.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { apply as applyToolSurface } from '../presets/opencode-omo/tool-surface.mjs'
import { stubToolExecutor } from './support/stub-executor.mjs'

function dshTool(name) {
  return defineTool({
    name,
    description: `dsh ${name}`,
    parameters: { value: { type: 'string', required: true } },
    output: {
      schema: { type: 'json' },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    execute: async () => ({}),
  })
}

const TOOL_NAMES = [
  'read', 'read_image', 'edit', 'write', 'web_search', 'glob', 'grep',
  'todo_write', 'skill', 'web_fetch', 'bash', 'apply_patch',
  'subagent', 'send_message', 'exit_plan_mode',
]

async function stepTools(ctx, agent, model) {
  agent.model = { current: () => ({ provider: 'mock', model }) }
  const toolSet = await ctx.tools.resolve({
    agent,
    modelSelection: { provider: 'mock', model },
    signal: new AbortController().signal,
  })
  try {
    return [...toolSet.view(agent).keys()].sort()
  } finally {
    toolSet.dispose()
  }
}

test('step admission keeps opencode hidden names, model gating, and inherited conditions', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { persona: 'test persona' })
  await ctx.plugin(ToolRuntime)
  ctx.tools.setExecutor(stubToolExecutor())

  const agent = {
    session: {
      id: 'session-admission',
      header: { cwd: '/tmp' },
      snapshotEvents: () => [],
    },
    model: { current: () => ({ provider: 'mock', model: 'deepseek-v4' }) },
    options: { provider: 'mock', model: 'deepseek-v4' },
  }
  const scope = createScope(ctx, agent)
  for (const name of TOOL_NAMES) {
    if (name === 'exit_plan_mode') {
      ctx.tools.register(dshTool(name), { when: ({ agent }) => agent.session.header.plan === true })
    } else {
      ctx.tools.register(dshTool(name))
    }
  }

  let presetCtx
  await new Promise((resolve) => {
    scope.ctx.inject(['tools'], (child) => {
      presetCtx = child
      applyToolSurface(child)
      resolve()
    })
  })
  let agentCtx
  await new Promise((resolve) => {
    scope.ctx.inject(['tools'], (child) => {
      agentCtx = child
      resolve()
    })
  })
  agent.ctx = agentCtx
  presetCtx.emit('agent/created', { agent })

  const deepseek = await stepTools(ctx, agent, 'deepseek-v4')
  assert.ok(deepseek.includes('edit'), 'non-GPT routes expose edit')
  assert.ok(deepseek.includes('write'), 'non-GPT routes expose write')
  assert.ok(!deepseek.includes('apply_patch'), 'non-GPT routes hide apply_patch')
  assert.ok(!deepseek.includes('subagent'), 'the dsh delegation layer stays hidden')
  assert.ok(!deepseek.includes('send_message'), 'the primary surface hides send_message')
  assert.ok(!deepseek.includes('exit_plan_mode'), 'an inherited when condition survives admission')

  const gpt = await stepTools(ctx, agent, 'gpt-5.5')
  assert.ok(!gpt.includes('edit'), 'GPT routes hide edit')
  assert.ok(!gpt.includes('write'), 'GPT routes hide write')
  assert.ok(gpt.includes('apply_patch'), 'GPT routes expose apply_patch')

  agent.session.header.plan = true
  const planning = await stepTools(ctx, agent, 'deepseek-v4')
  assert.ok(planning.includes('exit_plan_mode'), 'the inherited plan condition still admits the tool')

  const admitted = presetCtx.tools.definitions(agent)
  const read = admitted.find(tool => tool.name === 'read')
  assert.ok(read.description.includes('Read a file or directory'), 'opencode read description reaches the definition')
  assert.ok(read.parameters.properties?.filePath !== undefined, 'opencode read parameter names reach the definition')

  await scope.dispose()
  await ctx.fiber.dispose()
})
