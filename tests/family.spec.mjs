/**
 * Sisyphus family prompts: extracted from oh-my-openagent v5.0.0-beta.31
 * and routed the same way as omo's resolveSisyphusPromptFamily.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { familyFileFor, systemPromptFor } from '../presets/opencode-omo/driver.mjs'

const FAMILY_DIR = new URL('../presets/opencode-omo/roles/prompts/family/', import.meta.url)
const SISYPHUS_VARIANT_DIR = new URL('../presets/opencode-omo/roles/prompts/variants/sisyphus/', import.meta.url)

function roleFace() {
  return {
    roleFor: () => 'sisyphus',
    configFor: () => ({ fallbackModels: [] }),
    fallbackModelsFor: () => [],
    primaryModelFor: () => undefined,
  }
}

function mockAgent(model) {
  return {
    session: { id: 'session-test', header: { cwd: '/tmp', createdAt: 1 }, snapshotEvents: () => [] },
    options: { provider: 'test', model },
  }
}

function collectFamilyMarkdown() {
  const files = [
    ...readdirSync(FAMILY_DIR).filter(name => name.endsWith('.md')).map(name => join(FAMILY_DIR.pathname, name)),
    ...readdirSync(SISYPHUS_VARIANT_DIR).filter(name => name.endsWith('.md')).map(name => join(SISYPHUS_VARIANT_DIR.pathname, name)),
  ]
  return files.map(path => ({ path, text: readFileSync(path, 'utf8') }))
}

test('family files exist for every omo Sisyphus prompt family', () => {
  const expected = [
    'family/claude-opus-4-7.md',
    'family/claude-opus-5.md',
    'family/gpt-5-4.md',
    'family/gpt-5-5.md',
    'family/glm-5-2.md',
    'family/kimi-k3.md',
    'family/grok-4.md',
    'family/fallback.md',
    'family/gemini.md',
    'variants/sisyphus/claude-opus-4-8.md',
    'variants/sisyphus/claude-fable-5.md',
    'variants/sisyphus/kimi-k2-6.md',
    'variants/sisyphus/kimi-k2-7.md',
  ]
  for (const rel of expected) {
    assert.match(readFileSync(new URL(`../presets/opencode-omo/roles/prompts/${rel}`, import.meta.url), 'utf8'), /\S/)
  }
})

test('family and sisyphus-variant prompts do not teach missing tool names', () => {
  for (const { path, text } of collectFamilyMarkdown()) {
    assert.doesNotMatch(text, /interactive_bash/, path)
    assert.doesNotMatch(text, /codegraph_/, path)
    assert.doesNotMatch(text, /LspDiagnostics/, path)
  }
})

test('familyFileFor matches omo resolveSisyphusPromptFamily', () => {
  assert.equal(familyFileFor('kimi-k3'), 'family/kimi-k3.md')
  assert.equal(familyFileFor('kimi-k2.7'), 'variants/sisyphus/kimi-k2-7.md')
  assert.equal(familyFileFor('kimi-k2-6'), 'variants/sisyphus/kimi-k2-6.md')
  assert.equal(familyFileFor('gpt-5.6-sol'), 'family/gpt-5-5.md')
  assert.equal(familyFileFor('gpt-5.5'), 'family/gpt-5-5.md')
  assert.equal(familyFileFor('gpt-5.4'), 'family/gpt-5-4.md')
  assert.equal(familyFileFor('claude-fable-5'), 'variants/sisyphus/claude-fable-5.md')
  assert.equal(familyFileFor('claude-opus-5'), 'family/claude-opus-5.md')
  assert.equal(familyFileFor('claude-opus-4-8'), 'variants/sisyphus/claude-opus-4-8.md')
  assert.equal(familyFileFor('claude-opus-4-7'), 'family/claude-opus-4-7.md')
  assert.equal(familyFileFor('glm-5.2'), 'family/glm-5-2.md')
  assert.equal(familyFileFor('grok-4.6'), 'family/grok-4.md')
  assert.equal(familyFileFor('gemini-3.1-pro'), 'family/gemini.md')
  assert.equal(familyFileFor('deepseek-v4'), 'family/fallback.md')
})

test('assembled Sisyphus prompt uses the new opus-5 and grok families', () => {
  const ctx = { tools: { schemas: () => [] } }
  const state = { fallbackAttempts: new Map(), resolvedRoutes: new Map(), lastRouteTurn: 0, ultraworkTurn: 0 }
  const opus5 = systemPromptFor(ctx, roleFace(), state, mockAgent('claude-opus-5'))
  assert.match(opus5, /Claude Opus 5/)
  assert.match(opus5, /OVER-DELEGATION/)
  assert.doesNotMatch(opus5, /interactive_bash/)
  const grok = systemPromptFor(ctx, roleFace(), state, mockAgent('grok-4.6'))
  assert.match(grok, /Grok 4\.5 \/ Grok 4\.6/)
  assert.match(grok, /VERIFY, THEN ITERATE/)
})
