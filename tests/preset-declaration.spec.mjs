import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')

test('bundle patch declares the host row and the official agent-preset row', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /- id: opencode-omo\n\s+name: '@royenheart\/dsh-plugin-opencode-omo'/)
  assert.match(patch, /- id: preset-opencode-omo\n\s+name: '@deepseek-ai\/dsh-agent-preset'/)
  assert.match(patch, /\n\s+id: opencode-omo\n\s+name: "opencode-omo"/)
})

test('embedded plugin list matches presets/opencode-omo/agent.cordis.yml', () => {
  const patch = read('cordis.patch.yml')
  const lines = patch.split('\n')
  const start = lines.findIndex(line => line === '        plugins:')
  assert.notEqual(start, -1, 'plugins: block missing')
  const embedded = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === '') {
      embedded.push('')
      continue
    }
    assert.ok(line.startsWith('          '), `unexpected indentation at line ${index + 1}`)
    embedded.push(line.slice(10))
  }
  const composition = read('presets/opencode-omo/agent.cordis.yml').replace(/\s+$/, '')
  assert.equal(embedded.join('\n').replace(/\s+$/, ''), composition)
})
