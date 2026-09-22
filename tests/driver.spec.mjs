/**
 * Loop-shim smoke tests for the pure system-prompt assembly and fallback
 * classification. These lock in the two behaviors that regressed before:
 * omo rules must reach the model even though runtime context is suppressed,
 * and fallback must only advance on omo-style retryable failures.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assistantPrefillSeamFor, fallbackRetryable, gateToolCall, opencodeUsesPatch, persistPlanFile, systemPromptFor, withAssistantPrefill,
} from '../presets/opencode-omo/driver.mjs'
import { renderRulesFor } from '../presets/opencode-omo/rules.mjs'

function roleFace(role = 'sisyphus') {
  return {
    roleFor: () => role,
    configFor: () => ({ fallbackModels: [] }),
    fallbackModelsFor: () => [],
    primaryModelFor: () => undefined,
  }
}

function mockAgent(cwd, events = [], model = 'deepseek-v4') {
  return {
    session: {
      id: 'session-test',
      header: { cwd, createdAt: 1234567890 },
      events,
    },
    options: { provider: 'deepseek-official', model },
  }
}

function mockState() {
  return { fallbackAttempts: new Map(), resolvedRoutes: new Map(), lastRouteTurn: 0, ultraworkTurn: 0 }
}

test('complete system prompt folds omo rules in despite suppressed runtime context', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-driver-'))
  try {
    mkdirSync(join(cwd, '.omo', 'rules'), { recursive: true })
    writeFileSync(join(cwd, '.omo', 'rules', 'house.md'), '# house rule\nAlways verify.\n')
    const ctx = { tools: { schemas: () => [] } }
    const prompt = systemPromptFor(ctx, roleFace(), mockState(), mockAgent(cwd))
    assert.match(prompt, /<omo-rules>/)
    assert.match(prompt, /Rules from: .*\.omo\/rules\/house\.md/)
    assert.match(prompt, /Always verify\./)
    assert.match(prompt, /<env>/)
    assert.match(prompt, /Working directory:/)
    assert.doesNotMatch(prompt, /Current DSH file policy/)
    assert.doesNotMatch(prompt, /Approval prompts are disabled/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('dsh sandbox and approval facts stay out of the omo system prompt', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-policy-'))
  try {
    const ctx = {
      tools: { schemas: () => [] },
      get: (service) => {
        if (service === 'sandboxPolicy') return { resolve: () => ({ mode: 'workspace-write', workspaceRoot: cwd }) }
        if (service === 'approval') return { overrideOf: () => 'never', config: { policy: 'never' } }
        return undefined
      },
    }
    const prompt = systemPromptFor(ctx, roleFace(), mockState(), mockAgent(cwd))
    assert.match(prompt, /<env>/)
    assert.doesNotMatch(prompt, /Current DSH file policy/)
    assert.doesNotMatch(prompt, /Approval prompts are disabled/)
    assert.doesNotMatch(prompt, /sandbox_permissions/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('plan mode injects the verbatim opencode plan-mode prompt with a real plan path', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-plan-'))
  try {
    const events = [{ type: 'plan/mode', data: { active: true } }]
    const ctx = { tools: { schemas: () => [] } }
    const prompt = systemPromptFor(ctx, roleFace(), mockState(), mockAgent(cwd, events))
    assert.match(prompt, /Plan mode is active/)
    assert.match(prompt, /\.opencode\/plans\/1234567890-session-test\.md/)
    assert.match(prompt, /No plan file exists yet/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('leaving plan mode after a logged plan header injects the build-switch prompt once', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-buildswitch-'))
  try {
    const events = [
      { type: 'plan/mode', data: { active: true } },
      { type: 'request/header' },
      { type: 'plan/mode', data: { active: false } },
    ]
    const ctx = { tools: { schemas: () => [] } }
    const prompt = systemPromptFor(ctx, roleFace(), mockState(), mockAgent(cwd, events))
    assert.match(prompt, /operational mode has changed from plan to build/)
    assert.match(prompt, /You are permitted to make file changes/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('approved plans persist at the opencode path and feed the build-switch reminder', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-planfile-'))
  try {
    const agent = mockAgent(cwd)
    assert.equal(persistPlanFile(agent.session, '# My plan\n'), true)
    const events = [
      { type: 'plan/mode', data: { active: true } },
      { type: 'request/header' },
      { type: 'plan/mode', data: { active: false } },
    ]
    const ctx = { tools: { schemas: () => [] } }
    const prompt = systemPromptFor(ctx, roleFace(), mockState(), mockAgent(cwd, events))
    assert.match(prompt, /A plan file exists at .*\.opencode\/plans\/1234567890-session-test\.md/)
    assert.match(prompt, /execute on the plan defined within it/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('fallback advances only on omo-style retryable failure codes', () => {
  assert.equal(fallbackRetryable({ code: 'RATE_LIMIT' }), true)
  assert.equal(fallbackRetryable({ code: 'QUOTA' }), true)
  assert.equal(fallbackRetryable({ code: 'SERVER' }), true)
  assert.equal(fallbackRetryable({ code: 'MODEL_NOT_FOUND' }), true)
  assert.equal(fallbackRetryable({ status: 429 }), true)
  assert.equal(fallbackRetryable({ status: 404 }), true)
  assert.equal(fallbackRetryable({ code: 'AUTH' }), false)
  assert.equal(fallbackRetryable({ code: 'CONTEXT_WINDOW_EXCEEDED' }), false)
  assert.equal(fallbackRetryable(undefined), false)
})

test('tool gate matches opencode model-family gating on both sides', () => {
  assert.equal(opencodeUsesPatch('gpt-5.5'), true)
  assert.equal(opencodeUsesPatch('gpt-5-oss'), false)
  assert.equal(opencodeUsesPatch('gpt-4'), false)
  assert.equal(opencodeUsesPatch('claude-opus-4-7'), false)
  assert.equal(gateToolCall('edit', 'gpt-5.5') !== undefined, true)
  assert.equal(gateToolCall('apply_patch', 'gpt-5.5'), undefined)
  assert.equal(gateToolCall('apply_patch', 'claude-opus-4-7') !== undefined, true)
  assert.equal(gateToolCall('edit', 'claude-opus-4-7'), undefined)
})

test('hephaestus routes to the extracted GPT-5.5 family prompt', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-hephaestus-'))
  try {
    const ctx = { tools: { schemas: () => [] } }
    const prompt = systemPromptFor(ctx, roleFace('hephaestus'), mockState(), mockAgent(cwd, [], 'gpt-5.5'))
    assert.match(prompt, /You are Hephaestus, an autonomous deep worker based on GPT-5\.5/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('atlas routes to the extracted opus-4-7 family prompt', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-atlas-'))
  try {
    const ctx = { tools: { schemas: () => [] } }
    const prompt = systemPromptFor(ctx, roleFace('atlas'), mockState(), mockAgent(cwd, [], 'claude-opus-4-7'))
    assert.match(prompt, /You are Atlas - the Master Orchestrator/)
    assert.match(prompt, /running on Claude Opus 4\.7/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('atlas routes generic Claude to the default variant, not opus-4-7', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-atlas-default-'))
  try {
    const ctx = { tools: { schemas: () => [] } }
    const prompt = systemPromptFor(ctx, roleFace('atlas'), mockState(), mockAgent(cwd, [], 'claude-sonnet-4-6'))
    assert.match(prompt, /You are Atlas - the Master Orchestrator from OhMyOpenCode/)
    assert.doesNotMatch(prompt, /running on Claude Opus 4\.7/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('hephaestus GPT-5.6 hyphen id uses the gpt-5-6 variant', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-heph-56-'))
  try {
    const ctx = { tools: { schemas: () => [] } }
    const prompt = systemPromptFor(ctx, roleFace('hephaestus'), mockState(), mockAgent(cwd, [], 'gpt-5-6'))
    assert.match(prompt, /You are Hephaestus, an autonomous deep worker based on GPT-5\.6/)
    assert.match(prompt, /todo_write/)
    assert.doesNotMatch(prompt, /\$\{todoDiscipline\}/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('unknown model families use the omo dynamic Sisyphus fallback prompt', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-fallback-'))
  try {
    const ctx = { tools: { schemas: () => [] } }
    const prompt = systemPromptFor(ctx, roleFace(), mockState(), mockAgent(cwd, [], 'deepseek-v4'))
    assert.match(prompt, /Powerful AI Agent with orchestration capabilities from OhMyOpenCode/)
    assert.match(prompt, /Phase 2A - Exploration & Research/)
    assert.doesNotMatch(prompt, /You are opencode, an interactive CLI tool/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('maxSteps section appears in the system prompt at the ceiling without the assistant-prefill seam', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-maxsteps-'))
  try {
    // step counting: nextPosition = last step/start + 1; three starts propose step 4.
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'step/start', data: { turn: 1, step: 1 } },
      { type: 'step/start', data: { turn: 1, step: 2 } },
      { type: 'step/start', data: { turn: 1, step: 3 } },
    ]
    const roles = { ...roleFace(), configFor: () => ({ maxSteps: 4, fallbackModels: [] }) }
    const ctx = { tools: { schemas: () => [] } }
    const prompt = systemPromptFor(ctx, roles, mockState(), mockAgent(cwd, events))
    assert.match(prompt, /CRITICAL - MAXIMUM STEPS REACHED/)

    // Below the ceiling the section is absent.
    const below = systemPromptFor(ctx, roles, mockState(), mockAgent(cwd, events.slice(0, 3)))
    assert.doesNotMatch(below, /CRITICAL - MAXIMUM STEPS REACHED/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('agent/pre-step decisions carry the request-only assistantPrefill at the ceiling', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-maxsteps-prefill-'))
  try {
    const events = [
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'step/start', data: { turn: 1, step: 1 } },
      { type: 'step/start', data: { turn: 1, step: 2 } },
      { type: 'step/start', data: { turn: 1, step: 3 } },
    ]
    const roles = { ...roleFace(), configFor: () => ({ maxSteps: 4, fallbackModels: [] }) }
    const enter = { kind: 'enter', messages: [] }

    // Above the cap the decision is untouched (same object, no field).
    const below = withAssistantPrefill(roles, mockAgent(cwd, events.slice(0, 3)).session, enter)
    assert.equal(below, enter)
    assert.equal(below.assistantPrefill, undefined)

    // At the cap the decision keeps acceptance state and gains the opencode text.
    const atCeiling = withAssistantPrefill(roles, mockAgent(cwd, events).session, enter)
    assert.equal(atCeiling.kind, 'enter')
    assert.deepEqual(atCeiling.messages, [])
    assert.match(atCeiling.assistantPrefill, /CRITICAL - MAXIMUM STEPS REACHED/)

    // Reject decisions are never augmented.
    const reject = { kind: 'reject' }
    assert.equal(withAssistantPrefill(roles, mockAgent(cwd, events).session, reject), reject)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('the registry probe is authoritative for the assistant-prefill seam', () => {
  // A checkout whose own node_modules holds an unpatched published loop must
  // still follow the running harness: the host registry probes the dsh
  // installation and answers first.
  assert.equal(assistantPrefillSeamFor({ honorsAssistantPrefill: () => true }), true)
  assert.equal(assistantPrefillSeamFor({ honorsAssistantPrefill: () => false }), false)
  // A throwing probe (detached service) falls back to the local detection.
  assert.equal(typeof assistantPrefillSeamFor({ honorsAssistantPrefill: () => { throw new Error('detached') } }), 'boolean')
  assert.equal(typeof assistantPrefillSeamFor(undefined), 'boolean')
})

test('specialist roles render env plus the specialist body, not Sisyphus identity', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-oracle-child-'))
  try {
    const ctx = { tools: { schemas: () => [] } }
    const prompt = systemPromptFor(ctx, roleFace('oracle'), mockState(), mockAgent(cwd, [], 'claude-opus-4-7'))
    assert.match(prompt, /<env>/)
    assert.match(prompt, /Working directory:/)
    assert.match(prompt, /strategic technical advisor/)
    assert.doesNotMatch(prompt, /Your designated identity for this session is "Sisyphus"/)
    assert.doesNotMatch(prompt, /You are an AI agent powered by DeepSeek Harness/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('explore specialist prompt stays env plus the search-specialist body', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-explore-child-'))
  try {
    const ctx = { tools: { schemas: () => [] } }
    const prompt = systemPromptFor(ctx, roleFace('explore'), mockState(), mockAgent(cwd))
    assert.match(prompt, /<env>/)
    assert.match(prompt, /codebase search specialist/)
    assert.doesNotMatch(prompt, /Your designated identity for this session is "Sisyphus"/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('rules renderer returns empty text when no rule files exist', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'omo-norules-'))
  try {
    assert.equal(renderRulesFor(cwd), '')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
