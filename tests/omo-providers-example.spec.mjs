/**
 * Provider-example documentation test.
 *
 * The shipped provider example must parse as YAML and describe the four
 * omo.json providers (apiyi, zai-coding-plan, moonshotai, minimax) with
 * placeholder key env names, the vendors' real base URLs, and the models
 * the importer expects.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import yaml from 'js-yaml'

const EXAMPLE = new URL('../docs/omo-json-providers.example.yml', import.meta.url)

// Real vendor endpoints, verified against the providers' official docs:
//   apiyi          -> https://docs.apiyi.com/ko/faq/base-url-config
//   zai-coding-plan -> https://docs.z.ai/devpack/quick-start (coding plan)
//   moonshotai     -> https://platform.moonshot.ai/docs/api/overview (international)
//   minimax        -> https://api.minimax.chat/v1 (international endpoint)
const EXPECTED_BASE_URL = {
  apiyi: 'https://api.apiyi.com/v1',
  'zai-coding-plan': 'https://api.z.ai/api/coding/paas/v4',
  moonshotai: 'https://api.moonshot.ai/v1',
  minimax: 'https://api.minimax.chat/v1',
}

test('provider example parses as YAML', async () => {
  const parsed = yaml.load(await readFile(EXAMPLE, 'utf8'))
  assert.ok(parsed !== null && typeof parsed === 'object')
})

test('provider example describes the four omo.json providers with placeholder keys and real base URLs', async () => {
  const parsed = yaml.load(await readFile(EXAMPLE, 'utf8'))
  const providers = parsed.llm_pi_ai?.providers ?? parsed['llm-pi-ai']?.providers
  assert.ok(providers, 'expected a providers map')
  for (const name of Object.keys(EXPECTED_BASE_URL)) {
    const entry = providers[name]
    assert.ok(entry, `missing provider ${name}`)
    assert.match(String(entry.apiKeyEnv), /_API_KEY$/)
    const base = String(entry.baseURL)
    assert.equal(base, EXPECTED_BASE_URL[name], `${name} baseURL must be the real vendor endpoint`)
    assert.match(base, /^https:\/\//, `${name} baseURL must use https`)
    assert.ok(!base.includes('PLACEHOLDER') && !base.includes('.invalid'), `${name} baseURL must not be a placeholder`)
    assert.ok(Array.isArray(entry.models) && entry.models.length > 0, `${name} must list models`)
  }
})

test('provider example models cover the omo.json usage set', async () => {
  const parsed = yaml.load(await readFile(EXAMPLE, 'utf8'))
  const providers = parsed['llm-pi-ai'].providers
  const covered = Object.values(providers).flatMap((entry) => entry.models.map((model) => model.id))
  for (const model of ['gpt-5.6-sol', 'gpt-5.6-terra', 'glm-5.3', 'glm-5.3-flash', 'kimi-k2.7-code', 'kimi-k3', 'MiniMax-M3']) {
    assert.ok(covered.includes(model), `example must cover model ${model}`)
  }
})
