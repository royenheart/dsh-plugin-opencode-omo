/**
 * Pure-helper tests for the omo `task` shim: route resolution and the
 * `load_skills` -> `<loaded_skills>` prompt prefix.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  KNOWN_CATEGORIES,
  KNOWN_SUBAGENT_TYPES,
  deliverFollowup,
  renderLoadedSkills,
  resolveTaskRoute,
  roleForDelegationCall,
  SUBAGENT_TYPE_DEFS,
  SUBAGENT_TYPE_TO_ROLE,
} from '../presets/opencode-omo/task-shim.mjs'

test('renderLoadedSkills returns an empty string for empty or missing input', () => {
  assert.equal(renderLoadedSkills([]), '')
  assert.equal(renderLoadedSkills(undefined), '')
  assert.equal(renderLoadedSkills([null, '', 1]), '')
})

test('renderLoadedSkills renders the exact <loaded_skills> child-prompt prefix', () => {
  assert.equal(
    renderLoadedSkills(['frontend', 'ulw-plan']),
    '\n\n<loaded_skills>\n'
      + 'Load and follow these skills first via the skill tool: frontend, ulw-plan.\n'
      + '</loaded_skills>\n',
  )
})

test('resolveTaskRoute prefers task_id over every other routing input', () => {
  assert.deepEqual(
    resolveTaskRoute({ task_id: 'ses_123', subagent_type: 'explore', category: 'quick' }),
    { kind: 'followup', taskId: '123' },
  )
})

test('resolveTaskRoute accepts a raw dsh id as follow-up (completion-notice fallback)', () => {
  assert.deepEqual(
    resolveTaskRoute({ task_id: '123' }),
    { kind: 'followup', taskId: '123' },
  )
})

test('resolveTaskRoute rejects background ids on task()', () => {
  assert.throws(
    () => resolveTaskRoute({ task_id: 'bg_123' }),
    /background collection id/,
  )
})

test('resolveTaskRoute maps known subagent_type names', () => {
  for (const subagentType of KNOWN_SUBAGENT_TYPES) {
    assert.deepEqual(resolveTaskRoute({ subagent_type: subagentType }), {
      kind: 'subagent-type',
      subagentType,
    })
  }
})

test('resolveTaskRoute rejects unknown subagent_type with the known list', () => {
  assert.throws(
    () => resolveTaskRoute({ subagent_type: 'unknown-type' }),
    /unknown subagent_type "unknown-type"/,
  )
  assert.throws(
    () => resolveTaskRoute({ subagent_type: 'unknown-type' }),
    new RegExp(KNOWN_SUBAGENT_TYPES.join(', ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )
})

test('resolveTaskRoute maps known categories', () => {
  for (const category of KNOWN_CATEGORIES) {
    assert.deepEqual(resolveTaskRoute({ category }), { kind: 'category', category })
  }
})

test('resolveTaskRoute rejects unknown categories with the known list', () => {
  assert.throws(
    () => resolveTaskRoute({ category: 'unknown-category' }),
    /unknown task category "unknown-category"/,
  )
  assert.throws(
    () => resolveTaskRoute({ category: 'unknown-category' }),
    new RegExp(KNOWN_CATEGORIES.join(', ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  )
})

test('resolveTaskRoute falls back to a generic subagent when neither specialist nor category is given', () => {
  assert.deepEqual(resolveTaskRoute({ prompt: 'do a thing' }), { kind: 'generic' })
  assert.deepEqual(resolveTaskRoute({}), { kind: 'generic' })
})

test('subagent_type definitions mirror the named rows in agent.cordis.yml', () => {
  // Same names as the named tool rows.
  assert.deepEqual(KNOWN_SUBAGENT_TYPES, [
    'plan',
    'oracle',
    'librarian',
    'explore',
    'metis',
    'momus',
    'multimodal-looker',
    'athena',
    'athena-junior',
    'council-member',
    'sisyphus',
    'hephaestus',
    'atlas',
    'sisyphus-junior',
  ])
  assert.equal(SUBAGENT_TYPE_DEFS.plan.role, 'prometheus')
  assert.equal(SUBAGENT_TYPE_TO_ROLE.plan, 'prometheus')
  assert.equal(SUBAGENT_TYPE_DEFS.athena.role, 'athena')
  assert.equal(SUBAGENT_TYPE_DEFS['athena-junior'].role, 'athena-junior')
  assert.equal(SUBAGENT_TYPE_DEFS['council-member'].role, 'council-member')
  assert.ok(SUBAGENT_TYPE_DEFS.plan.toolFilter.deny.includes('task'))
  assert.ok(SUBAGENT_TYPE_DEFS.plan.toolFilter.deny.includes('sisyphus'))
  assert.equal(SUBAGENT_TYPE_DEFS.plan.toolFilter.deny.includes('write'), false)
  assert.equal(SUBAGENT_TYPE_DEFS.plan.toolFilter.deny.includes('explore'), false)
  // Read-only specialists deny write/edit and all delegation names.
  for (const subagentType of ['oracle', 'librarian', 'explore', 'metis', 'momus', 'athena', 'athena-junior', 'council-member']) {
    const filter = SUBAGENT_TYPE_DEFS[subagentType].toolFilter
    assert.ok(filter.deny.includes('write'))
    assert.ok(filter.deny.includes('edit'))
    assert.ok(filter.deny.includes('task'))
    assert.ok(filter.deny.includes('call_omo_agent'))
    assert.ok(filter.deny.includes('subagent'))
    assert.ok(filter.deny.includes('subagent_fork'))
    assert.ok(filter.deny.includes('workflow'))
    assert.ok(filter.deny.includes('ralph'))
  }
  const yml = readFileSync(new URL('../presets/opencode-omo/agent.cordis.yml', import.meta.url), 'utf8')
  const registered = new Set([...yml.matchAll(/toolName:\s+([A-Za-z0-9_-]+)/g)].map(match => match[1]))
  for (const subagentType of KNOWN_SUBAGENT_TYPES) {
    assert.equal(registered.has(subagentType), true, `agent.cordis.yml is missing toolName: ${subagentType}`)
  }
  const knownGlobal = new Set([
    ...registered,
    'write',
    'edit',
    'read',
    'read_image',
    'apply_patch',
    'hashline_edit',
    'task',
    'call_omo_agent',
    'workflow',
    'ralph',
  ])
  const denyBlocks = [...yml.matchAll(/deny:\n((?:            - .+\n)+)/g)].map(match => match[1])
  for (const block of denyBlocks) {
    for (const name of [...block.matchAll(/- ([A-Za-z0-9_-]+)/g)].map(match => match[1])) {
      assert.equal(knownGlobal.has(name), true, `deny list names unknown global tool "${name}"`)
    }
  }
  // multimodal-looker only keeps read/read_image.
  assert.deepEqual(SUBAGENT_TYPE_DEFS['multimodal-looker'].toolFilter, {
    allow: ['read', 'read_image'],
  })
  // Primary-agent rows deny the whole named roster.
  for (const subagentType of ['sisyphus', 'hephaestus', 'atlas', 'sisyphus-junior']) {
    const filter = SUBAGENT_TYPE_DEFS[subagentType].toolFilter
    for (const known of KNOWN_SUBAGENT_TYPES) {
      assert.ok(filter.deny.includes(known), `${subagentType} should deny ${known}`)
    }
    assert.ok(filter.deny.includes('task'))
    assert.ok(filter.deny.includes('call_omo_agent'))
    assert.ok(filter.deny.includes('workflow'))
    assert.ok(filter.deny.includes('ralph'))
  }
})

test('roleForDelegationCall maps named tools and task() to omo roles', () => {
  assert.equal(roleForDelegationCall('oracle', {}), 'oracle')
  assert.equal(roleForDelegationCall('plan', {}), 'prometheus')
  assert.equal(roleForDelegationCall('task', { subagent_type: 'explore' }), 'explore')
  assert.equal(roleForDelegationCall('call_omo_agent', { category: 'quick' }), 'sisyphus')
  assert.equal(roleForDelegationCall('task', { prompt: 'do a thing' }), 'sisyphus')
  assert.equal(roleForDelegationCall('task', { task_id: 'ses_123', subagent_type: 'oracle' }), undefined)
  assert.equal(roleForDelegationCall('subagent', {}), undefined)
})

test('deliverFollowup prefers the 0.1.6 sendMessage API and falls back to legacy followup', async () => {
  const parent = { id: 'parent' }
  const content = [{ type: 'text', text: 'continue' }]
  const signal = new AbortController().signal
  const calls = []

  const modern = {
    subagents: {
      sendMessage: async (...args) => { calls.push(['sendMessage', ...args]) },
      followup: async (...args) => { calls.push(['followup', ...args]) },
    },
  }
  assert.equal(await deliverFollowup(modern, parent, 'child-1', content, signal), 'sendMessage')
  assert.deepEqual(calls, [['sendMessage', parent, 'child-1', content, { signal }]])

  calls.length = 0
  const legacy = {
    subagents: {
      followup: async (...args) => { calls.push(['followup', ...args]) },
    },
  }
  assert.equal(await deliverFollowup(legacy, parent, 'child-2', content, signal), 'followup')
  assert.deepEqual(calls, [['followup', parent, 'child-2', content, { source: { kind: 'user' }, signal }]])

  await assert.rejects(
    () => deliverFollowup({ subagents: {} }, parent, 'child-3', content, signal),
    /only fresh tasks are supported/,
  )
})
