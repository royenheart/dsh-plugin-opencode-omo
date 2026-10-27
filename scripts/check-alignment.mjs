#!/usr/bin/env node
/**
 * Validate the declared upstream alignment contract.
 *
 * This is a zero-network check: it verifies that every registered combination
 * has a resolvable manifest, and that the README table agrees with the active
 * combination. Live upstream traces belong to the later alignment harness.
 */
import { readFileSync, statSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url)
const read = path => readFileSync(new URL(path, ROOT), 'utf8')
const isFile = path => statSync(new URL(path, ROOT), { throwIfNoEntry: false })?.isFile() === true
const fail = message => { throw new Error(`alignment: ${message}`) }
const fullCommit = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
const nonEmpty = value => typeof value === 'string' && value.trim() !== ''

let alignment
try {
  alignment = JSON.parse(read('alignment.json'))
} catch (error) {
  fail(`alignment.json is missing or invalid: ${String(error)}`)
}

if (alignment.schemaVersion !== 2 || !Array.isArray(alignment.combinations) || alignment.combinations.length === 0) {
  fail('expected schemaVersion 2 and a non-empty combinations array')
}
if (!nonEmpty(alignment.active)) fail('active combination id is required')

const ids = new Set()
for (const combination of alignment.combinations) {
  if (!nonEmpty(combination.id)) fail('every combination needs an id')
  if (ids.has(combination.id)) fail(`duplicate combination id ${combination.id}`)
  ids.add(combination.id)
  if (!nonEmpty(combination.dsh?.target)) fail(`${combination.id}: dsh.target is required`)
  if (!fullCommit(combination.dsh?.commit)) fail(`${combination.id}: dsh.commit must be a full commit id`)
  for (const key of ['version', 'tag']) {
    if (!nonEmpty(combination.opencode?.[key])) fail(`${combination.id}: opencode.${key} is required`)
    if (!nonEmpty(combination.omo?.[`prompt${key[0].toUpperCase()}${key.slice(1)}`])) fail(`${combination.id}: omo.prompt${key} is required`)
    if (!nonEmpty(combination.omo?.[`reference${key[0].toUpperCase()}${key.slice(1)}`])) fail(`${combination.id}: omo.reference${key} is required`)
  }
  if (!fullCommit(combination.opencode.commit)) fail(`${combination.id}: opencode.commit must be a full commit id`)
  if (!fullCommit(combination.omo.promptCommit)) fail(`${combination.id}: omo.promptCommit must be a full commit id`)
  if (!fullCommit(combination.omo.referenceCommit)) fail(`${combination.id}: omo.referenceCommit must be a full commit id`)
  if (!nonEmpty(combination.omo.promptManifest)) fail(`${combination.id}: omo.promptManifest is required`)
  if (!isFile(combination.omo.promptManifest)) fail(`${combination.id}: prompt manifest must be a file: ${combination.omo.promptManifest}`)
  if (!Array.isArray(combination.omo.referenceOnlyRoles)) fail(`${combination.id}: omo.referenceOnlyRoles must be an array`)
  if (combination.opencode.tag !== `v${combination.opencode.version}`) fail(`${combination.id}: opencode.tag must be v + version`)
  if (combination.omo.promptTag !== `v${combination.omo.promptVersion}`) fail(`${combination.id}: omo.promptTag must be v + version`)
  if (combination.omo.referenceTag !== `v${combination.omo.referenceVersion}`) fail(`${combination.id}: omo.referenceTag must be v + version`)
  const combinationManifest = read(combination.omo.promptManifest)
  for (const marker of [
    `oh-my-openagent \`v${combination.omo.promptVersion}\``,
    `\`${combination.omo.promptCommit.slice(0, 7)}\``,
    `\`${combination.omo.referenceCommit.slice(0, 8)}\``,
  ]) {
    if (!combinationManifest.includes(marker)) fail(`${combination.id}: manifest is missing ${marker}`)
  }
  for (const entry of combination.omo.referenceOnlyRoles) {
    if (!nonEmpty(entry.role) || !nonEmpty(entry.reason)) fail(`${combination.id}: referenceOnlyRoles entries need role and reason`)
  }
}

const active = alignment.combinations.find(combination => combination.id === alignment.active)
if (active === undefined) fail(`active combination ${alignment.active} is not registered`)
const expectedId = `opencode-${active.opencode.version}+omo-${active.omo.promptVersion}`
if (alignment.active !== expectedId) fail(`active id ${alignment.active} must be ${expectedId}`)

const readme = read('README.md')
function stripInvisible(markdown) {
  const lines = markdown.split('\n')
  const visible = []
  const stripQuotes = (line, depth) => {
    let value = line
    for (let index = 0; index < depth; index += 1) {
      const next = value.replace(/^[ \t]{0,3}>[ \t]?/, '')
      if (next === value) break
      value = next
    }
    return value
  }
  const quoteDepth = line => {
    let depth = 0
    let value = line
    while (true) {
      const next = value.replace(/^[ \t]{0,3}>[ \t]?/, '')
      if (next === value) return depth
      depth += 1
      value = next
    }
  }
  let fence
  let fenceDepth = 0
  let comment = false
  let commentDepth = 0
  for (const line of lines) {
    const depth = quoteDepth(line)
    if (fence !== undefined && depth >= fenceDepth) {
      const candidate = stripQuotes(line, fenceDepth)
      const close = candidate.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (close !== null && close[1][0] === fence[0] && close[1].length >= fence.length && /^[ \t]*$/.test(close[2])) {
        fence = undefined
        fenceDepth = 0
      }
      continue
    }
    if (fence !== undefined) {
      fence = undefined
      fenceDepth = 0
    }
    if (comment) {
      if (depth < commentDepth) {
        comment = false
      } else {
        if (line.includes('-->')) comment = false
        continue
      }
    }
    let normalized = stripQuotes(line, depth)
    if (/^ {0,3}<!--/.test(normalized)) {
      if (!normalized.includes('-->')) {
        comment = true
        commentDepth = depth
      }
      continue
    }
    const marker = normalized.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (marker !== null && !(marker[1][0] === '`' && marker[2].includes('`'))) {
      fence = marker[1]
      fenceDepth = depth
      continue
    }
    normalized = normalized.replace(/<!--[\s\S]*?-->/g, '')
    if (/^(?: {4}|\t)/.test(normalized)) continue
    visible.push(normalized)
  }
  return visible.join('\n')
}

const visibleReadme = stripInvisible(readme)
const headerCount = visibleReadme.split('\n').filter(line => /^ {0,3}\|?\s*Upstream\s*\|\s*Version\s*\|\s*Commit\s*\|[ \t]*[^|\n]+\|/.test(line)).length
if (headerCount !== 1) fail('README.md must have exactly one visible baseline table')
const activeLine = visibleReadme.match(/^Active combination:\s*`([^`]+)`/m)
if (activeLine?.[1] !== alignment.active) fail(`README.md Active combination must be ${alignment.active}`)
const sectionStart = visibleReadme.indexOf('## Version baseline')
const sectionEnd = sectionStart === -1
  ? -1
  : (visibleReadme.indexOf('\n## ', sectionStart + 3) === -1 ? visibleReadme.length : visibleReadme.indexOf('\n## ', sectionStart + 3))
if (sectionStart === -1) fail('README.md has no Version baseline section')
const sectionLines = visibleReadme.slice(sectionStart, sectionEnd).split('\n').map(line => line.trim())
const tableStart = sectionLines.findIndex(line => line.startsWith('|'))
if (tableStart === -1) fail('README.md baseline table is missing')
const tableLines = []
for (const line of sectionLines.slice(tableStart)) {
  if (!line.startsWith('|')) break
  tableLines.push(line)
}
if (sectionLines.slice(tableStart + tableLines.length).some(line => line.startsWith('|'))) fail('README.md has a second baseline table')
const rows = []
let tablePhase = 'header'
for (const line of tableLines) {
  const cells = line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim().replace(/^`|`$/g, ''))
  if (tablePhase === 'header') {
    if (cells[0] !== 'Upstream' || cells.length !== 4) fail(`README.md baseline header is malformed: ${line}`)
    tablePhase = 'separator'
    continue
  }
  if (tablePhase === 'separator') {
    if (!cells.every(cell => /^:?-{1,}:?$/.test(cell)) || cells.length !== 4) fail(`README.md baseline separator is malformed: ${line}`)
    tablePhase = 'rows'
    continue
  }
  if (cells.length !== 4 || cells[0] === 'Upstream' || cells.every(cell => /^:?-{1,}:?$/.test(cell))) {
    fail(`README.md baseline row is malformed: ${line}`)
  }
  rows.push({ upstream: cells[0], version: cells[1], commit: cells[2] })
}
if (tablePhase !== 'rows') fail('README.md baseline table is incomplete')

const expectedRows = [
  { upstream: 'opencode', version: active.opencode.version, commit: active.opencode.commit.slice(0, 8) },
  { upstream: 'oh-my-openagent', version: active.omo.promptVersion, commit: active.omo.promptCommit.slice(0, 8) },
  { upstream: 'oh-my-openagent', version: active.omo.referenceVersion, commit: active.omo.referenceCommit.slice(0, 8) },
  { upstream: 'dsh', version: active.dsh.target, commit: active.dsh.commit.slice(0, 7) },
]
const expectedKeys = new Set(expectedRows.map(row => `${row.upstream}\0${row.version}`))
const seenRows = new Set()
for (const row of rows) {
  const key = `${row.upstream}\0${row.version}`
  if (!expectedKeys.has(key)) fail(`README.md has an unexpected baseline row ${row.upstream} ${row.version}`)
  if (seenRows.has(key)) fail(`README.md has a duplicate baseline row ${row.upstream} ${row.version}`)
  seenRows.add(key)
  const expected = expectedRows.find(item => item.upstream === row.upstream && item.version === row.version)
  if (row.commit !== expected.commit) fail(`README.md ${row.upstream} ${row.version} commit ${row.commit} != ${expected.commit}`)
}
for (const expected of expectedRows) {
  if (!seenRows.has(`${expected.upstream}\0${expected.version}`)) fail(`README.md is missing ${expected.upstream} ${expected.version}`)
}

const dshTags = text => [...text.matchAll(/(?<![A-Za-z0-9])dsh-v[0-9A-Za-z_.+@/-]+/g)]
  .map(match => match[0].replace(/[._]+$/, ''))
const expectedTag = `dsh-v${active.dsh.target}`
const patchNote = read('patches/README.md')
if (!dshTags(patchNote).includes(expectedTag)) fail(`patches/README.md is missing exact ${active.dsh.target} tag`)
const dshShort = new RegExp(`\\b${active.dsh.commit.slice(0, 7)}\\b`)
if (!dshShort.test(patchNote)) fail('patches/README.md is missing the dsh commit')
for (const doc of ['patches/README.md', 'README.md', 'design.md', 'AGENTS.md', 'presets/opencode-omo/roles/prompts/variants/MANIFEST.md']) {
  for (const tag of dshTags(read(doc))) {
    if (tag !== expectedTag) fail(`${doc} names conflicting dsh tag ${tag}`)
  }
}

const packageJson = JSON.parse(read('package.json'))
const dshPeers = Object.entries(packageJson.peerDependencies ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
for (const name of ['@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-sandbox']) {
  if (!dshPeers.some(([peer]) => peer === name)) fail(`package.json must declare ${name}`)
}
for (const [name, range] of dshPeers) {
  if (range !== active.dsh.target && range !== `^${active.dsh.target}`) {
    fail(`package.json peer ${name} ${range} does not accept ${active.dsh.target}`)
  }
}

console.log(`alignment check passed: ${alignment.active}`)
