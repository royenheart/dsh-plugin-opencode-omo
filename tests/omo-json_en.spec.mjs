/**
 * omo.json import parser + importer tests (English surface).
 *
 * The importer is a pure, dependency-injected function so the host routes,
 * the startup auto-import, and the CLI script all share one tested core.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { expandOmoPath, importOmoJson, parseOmoJson, readOmoJsonFile, OMO_JSON_DEFAULT_PATH, OMO_JSON_MAX_BYTES } from '../src/core/omo-json_en.ts'

const SAMPLE = JSON.stringify({
  sisyphus: {
    model: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
    fallbackModels: [],
  },
  oracle: {
    model: { provider: 'tokeness', model: 'gpt-5.5' },
    fallbackModels: [{ provider: 'tokeness', model: 'claude-opus-4-7' }],
    maxSteps: 12,
  },
})

test('default path is ~/.omo/omo.json', () => {
  assert.equal(OMO_JSON_DEFAULT_PATH, '~/.omo/omo.json')
})

test('expandOmoPath expands the home tilde', () => {
  const expanded = expandOmoPath('~/.omo/omo.json')
  assert.ok(!expanded.startsWith('~'))
  assert.ok(expanded.endsWith('/.omo/omo.json'))
  assert.equal(expandOmoPath('/abs/path.json'), '/abs/path.json')
})

test('parseOmoJson extracts every known role entry without errors', () => {
  const result = parseOmoJson(SAMPLE)
  assert.deepEqual(result.errors, [])
  assert.equal(result.entries.sisyphus.model.model, 'deepseek-v4-pro')
  assert.equal(result.entries.oracle.fallbackModels.length, 1)
  assert.equal(result.entries.oracle.maxSteps, 12)
})

test('parseOmoJson reports invalid JSON as an error', () => {
  const result = parseOmoJson('{ nope')
  assert.ok(result.errors.length > 0)
  assert.deepEqual(result.entries, {})
})

test('parseOmoJson reports a non-object root', () => {
  const result = parseOmoJson('[1,2,3]')
  assert.ok(result.errors.length > 0)
})

test('parseOmoJson collects unknown roles as errors and keeps the known ones', () => {
  const result = parseOmoJson(JSON.stringify({
    oracle: { model: { provider: 'tokeness', model: 'gpt-5.5' }, fallbackModels: [] },
    bogus: { model: { provider: 'x', model: 'y' }, fallbackModels: [] },
  }))
  assert.ok(result.errors.some((error) => error.includes('bogus')))
  assert.ok(result.entries.oracle !== undefined)
})

test('parseOmoJson collects malformed model shapes as per-role errors', () => {
  const result = parseOmoJson(JSON.stringify({
    momus: { model: { model: 'missing-provider' }, fallbackModels: [] },
    metis: { model: { provider: 'tokeness', model: 'gpt-5.5' }, fallbackModels: [] },
  }))
  assert.ok(result.errors.some((error) => error.includes('momus')))
  assert.ok(result.entries.metis !== undefined)
})

test('importOmoJson applies every parsed role through the registry', async () => {
  const applied = []
  const registry = {
    async setRoleConfig(role, config) { applied.push([role, config]) },
  }
  const result = await importOmoJson(async () => SAMPLE, registry, '~/.omo/omo.json')
  assert.equal(result.ok, true)
  assert.equal(result.imported, 2)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(applied.map(([role]) => role).sort(), ['oracle', 'sisyphus'])
})

test('importOmoJson is non-fatal on a missing file', async () => {
  const registry = { async setRoleConfig() { throw new Error('must not be called') } }
  const result = await importOmoJson(async () => {
    const error = new Error('ENOENT')
    error.code = 'ENOENT'
    throw error
  }, registry, '/nonexistent.json')
  assert.equal(result.ok, false)
  assert.equal(result.imported, 0)
  assert.ok(result.errors.length > 0)
})

test('importOmoJson still applies valid roles when one role fails validation', async () => {
  const applied = []
  const registry = { async setRoleConfig(role, config) { applied.push(role) } }
  const text = JSON.stringify({
    oracle: { model: { provider: 'tokeness', model: 'gpt-5.5' }, fallbackModels: [] },
    atlas: { model: { model: 'broken' }, fallbackModels: [] },
  })
  const result = await importOmoJson(async () => text, registry, 'x.json')
  assert.equal(result.ok, true)
  assert.equal(result.imported, 1)
  assert.ok(result.errors.some((error) => error.includes('atlas')))
  assert.deepEqual(applied, ['oracle'])
})

test('readOmoJsonFile returns the file text under the cap', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(`${tmpdir()}/omo-read-`)
  const file = `${dir}/omo.json`
  await writeFile(file, '{"oracle":{}}')
  const text = await readOmoJsonFile(file)
  assert.equal(text, '{"oracle":{}}')
})

test('readOmoJsonFile refuses files over the import cap before reading', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(`${tmpdir()}/omo-big-`)
  const file = `${dir}/big.json`
  await writeFile(file, 'x'.repeat(OMO_JSON_MAX_BYTES + 1))
  await assert.rejects(readOmoJsonFile(file), /import cap/)
})

// ── real oh-my-openagent omo.json format ─────────────────────────────────

const OMO_FORMAT_SAMPLE = JSON.stringify({
  $schema: 'https://example/omo.schema.json',
  '[opencode]': {
    team_mode: { enabled: true },
    agents: {
      oracle: {
        model: 'apiyi/gpt-5.6-sol',
        reasoning: 'high',
        fallback_models: [
          { model: 'apiyi/gpt-5.6-terra', reasoning: 'high' },
          { model: 'tokeness/qwen3.7-plus' },
        ],
      },
      hephaestus: {
        model: 'tokeness/gpt-5.6-luna',
        reasoning: 'medium',
        fallback_models: [],
        ultrawork: { model: 'deepseek/deepseek-v4-pro', reasoning: 'max' },
        prompt_append: 'ignored text',
      },
      bogus: { model: 'x/y' },
    },
    categories: {},
  },
  _migrations: {},
  '[codex]': {},
})

test('omo-format parse reads agents from [opencode].agents and ignores other sections', () => {
  const result = parseOmoJson(OMO_FORMAT_SAMPLE)
  assert.equal(result.imported ?? undefined, undefined) // parser-only shape guard
  assert.ok(result.entries.oracle !== undefined)
  assert.ok(result.entries.hephaestus !== undefined)
  assert.ok(result.errors.some((error) => error.includes('bogus')))
  assert.ok(!result.errors.some((error) => error.includes('$schema') || error.includes('[codex]') || error.includes('_migrations')))
})

test('omo-format model strings split into provider/model selections', () => {
  const result = parseOmoJson(OMO_FORMAT_SAMPLE)
  assert.deepEqual(result.entries.oracle.model, { provider: 'apiyi', model: 'gpt-5.6-sol', reasoningEffort: 'high' })
  assert.deepEqual(result.entries.oracle.fallbackModels, [
    { provider: 'apiyi', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
    { provider: 'tokeness', model: 'qwen3.7-plus' },
  ])
})

test('omo-format preserves the official reasoning vocabulary and aliases known providers', () => {
  const result = parseOmoJson(OMO_FORMAT_SAMPLE)
  assert.equal(result.entries.hephaestus.model.reasoningEffort, 'medium') // official value preserved
  assert.deepEqual(result.entries.hephaestus.ultrawork, {
    model: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
    reasoningEffort: 'max',
  })
})

test('omo-format accepts string fallback_models shorthand', () => {
  const result = parseOmoJson(JSON.stringify({
    '[opencode]': { agents: { explore: { model: 'a/b', fallback_models: ['c/d'] } } },
  }))
  assert.deepEqual(result.entries.explore.fallbackModels, [{ provider: 'c', model: 'd' }])
})

test('omo-format reads the top-level agents section when [opencode] is absent', () => {
  const result = parseOmoJson(JSON.stringify({
    $schema: 'x',
    agents: { momus: { model: 'apiyi/gpt-5.6-terra', reasoning: 'high', fallback_models: [] } },
  }))
  assert.deepEqual(result.entries.momus.model, { provider: 'apiyi', model: 'gpt-5.6-terra', reasoningEffort: 'high' })
})

test('omo-format with a non-object agent entry collects a per-role error', () => {
  const result = parseOmoJson(JSON.stringify({ '[opencode]': { agents: { oracle: 'nope' } } }))
  assert.ok(result.errors.some((error) => error.includes('oracle')))
})

test('omo-format accepts a bare-string fallback_models value', () => {
  const result = parseOmoJson(JSON.stringify({
    '[opencode]': { agents: { explore: { model: 'a/b', fallback_models: 'c/d' } } },
  }))
  assert.deepEqual(result.entries.explore.fallbackModels, [{ provider: 'c', model: 'd' }])
})

test('omo-format agent-less official files parse to empty entries without errors', () => {
  const result = parseOmoJson(JSON.stringify({
    $schema: 'https://example/omo.schema.json',
    '[opencode]': { team_mode: { enabled: true } },
  }))
  assert.deepEqual(result.entries, {})
  assert.deepEqual(result.errors, [])
})
