import { readFileSync } from 'node:fs'
import { DEFAULT_SCHEMA, Type, load } from 'js-yaml'
import {
  CAPABILITIES,
  DELEGATE_ORCHESTRATOR_TOOLS,
  DELEGATE_SPECIALIST_TOOLS,
  DELEGATE_TOOLS,
  DELEGATE_WORKER_TOOLS,
  DENY_PLAN,
  DENY_PRIMARY,
  DENY_SPECIALISTS,
  TOOL_CAPABILITIES,
  WRITE_TOOLS,
  capabilityOf,
} from '../presets/opencode-omo/delegation-restrictions.mjs'

const failures = []
const read = path => readFileSync(path, 'utf8')
const fail = message => { failures.push(message) }

const readCode = path => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const permission = readCode('presets/opencode-omo/permission-rules.mjs')
const applyPatch = readCode('presets/opencode-omo/apply-patch.mjs')
const taskShim = readCode('presets/opencode-omo/task-shim.mjs')
const driver = readCode('presets/opencode-omo/driver.mjs')
const store = readCode('src/client/omo-roles-store.ts')
const registry = readCode('src/omo-role-registry.ts')
const yaml = read('presets/opencode-omo/agent.cordis.yml')

if (!permission.includes("from './patch-parser.mjs'")) fail('permission-rules must consume the shared patch parser')
if (/PATCH_FILE_LINE|PATCH_MOVE_LINE|\^\\\*\\\*\\\*/.test(permission)) fail('permission-rules must not re-parse patch headers with a regex')
if (!applyPatch.includes("from './patch-parser.mjs'")) fail('apply-patch must consume the shared patch parser')
if (/function parsePatch\b/.test(applyPatch)) fail('apply-patch must not define a second patch parser')

if (!/^\s*import .*from '\.\/delegation-restrictions\.mjs'/m.test(taskShim)) fail('task-shim must import the shared restriction table')
if (/const DENY_|const ALLOW_/.test(taskShim)) fail('task-shim must not maintain a second deny/allow list')
if (!/from '\.\/background-state\.mjs'/.test(taskShim)) fail('task-shim must use the closed background lifecycle')
if (!/restrictionForRole/.test(driver)) fail('driver must use the shared restrictionForRole')
if (/const DENY_|const ALLOW_/.test(driver)) fail('driver must not maintain a second deny/allow list')

const capabilitySet = new Set(CAPABILITIES)
for (const [name, capability] of Object.entries(TOOL_CAPABILITIES)) {
  if (!capabilitySet.has(capability)) fail(`tool capability for ${name} is not in the closed set`)
}
for (const name of ['write', 'edit', 'apply_patch', 'hashline_edit']) {
  if (capabilityOf(name) !== 'write') fail(`write tool not classified: ${name}`)
}
for (const name of DELEGATE_TOOLS) {
  if (!capabilityOf(name).startsWith('delegate')) fail(`delegation tool not classified: ${name}`)
  if (!DENY_SPECIALISTS.includes(name)) fail(`read-only deny list misses delegation tool: ${name}`)
}
for (const name of WRITE_TOOLS) {
  if (!DENY_SPECIALISTS.includes(name)) fail(`read-only deny list misses write tool: ${name}`)
}
for (const name of [...DELEGATE_WORKER_TOOLS, ...DELEGATE_ORCHESTRATOR_TOOLS]) {
  if (!DENY_PLAN.includes(name)) fail(`plan deny list misses worker/orchestrator: ${name}`)
}
for (const name of DELEGATE_TOOLS) {
  if (!DENY_PRIMARY.includes(name)) fail(`primary deny list misses delegation tool: ${name}`)
}
for (const name of [...DELEGATE_SPECIALIST_TOOLS]) {
  if (DENY_PLAN.includes(name)) fail(`plan must keep specialist delegation: ${name}`)
}
const jsType = new Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: data => data,
})
let composition
try {
  composition = load(yaml, { schema: DEFAULT_SCHEMA.extend([jsType]) })
} catch (error) {
  fail(`agent.cordis.yml could not be parsed: ${String(error)}`)
}
function visitToolNames(value) {
  if (Array.isArray(value)) {
    for (const item of value) visitToolNames(item)
    return
  }
  if (value === null || typeof value !== 'object') return
  if (Object.hasOwn(value, 'toolName')) {
    const name = value.toolName
    if (typeof name !== 'string' || !capabilityOf(name).startsWith('delegate')) {
      fail(`agent.cordis toolName ${String(name)} is not classified as delegation`)
    }
  }
  for (const child of Object.values(value)) visitToolNames(child)
}
visitToolNames(composition)

if (!/function reduce\(/.test(store)) fail('client store must have one reducer')
if (!/save\/failed/.test(store)) fail('client store must emit save/failed events')
if (!/reason: OmoRolesErrorReason/.test(store)) fail('client store must carry a closed error reason')
const stateWrites = store.match(/this\.state\s*=/g) ?? []
if (stateWrites.length !== 1) fail(`client store must write state only in dispatch (found ${stateWrites.length})`)
if (/publish\(/.test(store)) fail('client store must not keep a second publish writer')

if (!/transitionMigration/.test(read('src/index.ts'))) fail('legacy migration must use its closed state transition')
if (!/followSession/.test(registry)) fail('host role registry must preserve the tri-state')

if (failures.length > 0) {
  console.error('architecture check failed:')
  for (const message of failures) console.error(`- ${message}`)
  process.exit(1)
}
console.log('architecture check passed')
