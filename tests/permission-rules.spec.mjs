import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { doomLoopReason, externalDirectoryReason, isDelegatedSession, outsideWorkspace, pathArgument, settleAsk } from '../presets/opencode-omo/permission-rules.mjs'

function exec(name, args, cwd = '/repo', header = {}) {
  return { name, arguments: args, agent: { session: { header: { cwd, ...header } } } }
}

test('pathArgument reads the first path-bearing parameter', () => {
  assert.equal(pathArgument(exec('read', { file_path: '/repo/a.txt' })), '/repo/a.txt')
  assert.equal(pathArgument(exec('grep', { pattern: 'x', path: 'src' })), 'src')
  assert.equal(pathArgument(exec('bash', { command: 'ls' })), undefined)
  assert.equal(pathArgument(exec('lsp_goto_definition', { filePath: '/repo/a.ts' })), '/repo/a.ts')
  assert.equal(pathArgument(exec('lsp_find_references', { file_path: 'src/a.ts' })), 'src/a.ts')
})

test('pathArgument covers the camelCase shim surface for read/write/edit', () => {
  // The tool-surface shims re-register read/write/edit with opencode's
  // camelCase `filePath` schema; pre-execute sees those arguments verbatim.
  assert.equal(pathArgument(exec('read', { filePath: '/repo/a.txt' })), '/repo/a.txt')
  assert.equal(pathArgument(exec('write', { filePath: '/repo/a.txt', content: 'x' })), '/repo/a.txt')
  assert.equal(pathArgument(exec('edit', { filePath: '/repo/a.txt', oldString: 'a', newString: 'b' })), '/repo/a.txt')
})

test('outsideWorkspace detects absolute and parent-relative escapes', () => {
  assert.equal(outsideWorkspace('/repo/a.txt', '/repo'), false)
  assert.equal(outsideWorkspace('../outside.txt', '/repo'), true)
  assert.equal(outsideWorkspace('/etc/passwd', '/repo'), true)
  assert.equal(outsideWorkspace('src/a.txt', '/repo'), false)
})

test('externalDirectoryReason asks only for path-bearing outside accesses', async () => {
  assert.match(await externalDirectoryReason(exec('read', { file_path: '../secret' })), /requires approval/)
  assert.match(await externalDirectoryReason(exec('read', { filePath: '../secret' })), /requires approval/)
  assert.match(await externalDirectoryReason(exec('write', { filePath: '/etc/x', content: 'y' })), /requires approval/)
  assert.match(await externalDirectoryReason(exec('edit', { filePath: '/etc/x', oldString: 'a', newString: 'b' })), /requires approval/)
  assert.equal(await externalDirectoryReason(exec('read', { file_path: 'src/a.txt' })), undefined)
  assert.equal(await externalDirectoryReason(exec('read', { filePath: 'src/a.txt' })), undefined)
  assert.equal(await externalDirectoryReason(exec('bash', { command: 'cat /etc/passwd' })), undefined)
})

test('externalDirectoryReason anchors relative paths on the child working directory', async () => {
  const call = exec('read', { filePath: 'passwd' }, '/repo', { origin: 'subagent' })
  call.agent.ctx = { get: () => ({ ensure: async () => '/etc' }) }
  assert.match(await externalDirectoryReason(call), /requires approval/)
})

test('permission uses each tool anchor instead of one global cwd', async () => {
  const apply = exec('apply_patch', { patch_text: '*** Add File: ../inside\n' }, '/repo', { origin: 'subagent' })
  apply.agent.ctx = { get: () => ({ ensure: async () => '/repo/sub' }) }
  assert.equal(await externalDirectoryReason(apply), undefined)
  const image = exec('read_image', { file_path: '../inside.png' }, '/repo', { origin: 'subagent' })
  image.agent.ctx = { get: () => ({ ensure: async () => '/repo/sub' }) }
  assert.equal(await externalDirectoryReason(image), undefined)
  const escaping = exec('apply_patch', { patch_text: '*** Add File: ../../outside\n' }, '/repo', { origin: 'subagent' })
  escaping.agent.ctx = { get: () => ({ ensure: async () => '/repo/sub' }) }
  assert.match(await externalDirectoryReason(escaping), /requires approval/)
  const imageOutside = exec('read_image', { file_path: '../../outside.png' }, '/repo', { origin: 'subagent' })
  imageOutside.agent.ctx = { get: () => ({ ensure: async () => '/repo/sub' }) }
  assert.match(await externalDirectoryReason(imageOutside), /requires approval/)
})

test('glob/grep without a path check their working directory', async () => {
  const call = exec('glob', { pattern: '*.ts' }, '/repo', { origin: 'subagent' })
  call.agent.ctx = { get: () => ({ ensure: async () => '/etc' }) }
  assert.match(await externalDirectoryReason(call), /requires approval/)
})

test('doomLoopReason asks on the third identical call inside the window', () => {
  const state = { key: undefined, count: 0, firstAt: 0, lastAt: 0 }
  const call = exec('write', { file_path: 'a.txt', content: 'x' })
  assert.equal(doomLoopReason(state, call, 1000), undefined)
  assert.equal(doomLoopReason(state, call, 2000), undefined)
  assert.match(doomLoopReason(state, call, 3000), /repeated 3 times/)
  assert.equal(doomLoopReason(state, call, 4000), undefined)
})

test('doomLoopReason resets after the window', () => {
  const state = { key: undefined, count: 0, firstAt: 0, lastAt: 0 }
  const call = exec('write', { file_path: 'a.txt', content: 'x' })
  doomLoopReason(state, call, 1000)
  doomLoopReason(state, call, 2000)
  assert.equal(doomLoopReason(state, call, 200_000), undefined)
})

test('isDelegatedSession is true for origin=subagent or depth >= 1', () => {
  assert.equal(isDelegatedSession(exec('read', { file_path: 'a' })), false)
  assert.equal(isDelegatedSession(exec('read', { file_path: 'a' }, '/repo', { origin: 'subagent' })), true)
  assert.equal(isDelegatedSession(exec('read', { file_path: 'a' }, '/repo', { delegationDepth: 1 })), true)
  assert.equal(isDelegatedSession(exec('read', { file_path: 'a' }, '/repo', { delegationDepth: 0 })), false)
})

test('settleAsk keeps ask in the parent and denies in a child', () => {
  const reason = 'opencode-omo: "read" would access a path outside the workspace root and requires approval (opencode external_directory: ask)'
  const parent = settleAsk(exec('read', { filePath: '../secret' }), reason)
  assert.deepEqual(parent, { kind: 'ask', reason })
  const child = settleAsk(exec('read', { filePath: '../secret' }, '/repo', { origin: 'subagent' }), reason)
  assert.equal(child.kind, 'deny')
  assert.match(child.reason, /outside the workspace root/)
  assert.match(child.reason, /delegated session cannot escalate/)
  assert.doesNotMatch(child.reason, /requires approval/)
  assert.doesNotMatch(child.reason, /report the limitation/)
})

test('outsideWorkspace resolves home and symlink targets, not just lexical paths', () => {
  assert.equal(outsideWorkspace('~/.bashrc', '/repo'), true)
  const root = mkdtempSync(join(tmpdir(), 'omo-perm-root-'))
  const outside = mkdtempSync(join(tmpdir(), 'omo-perm-outside-'))
  try {
    mkdirSync(join(root, 'src'))
    symlinkSync(outside, join(root, 'link'))
    symlinkSync(join(outside, 'dangling'), join(root, 'dangling'))
    symlinkSync('~/literal-missing', join(root, 'tilde-target'))
    symlinkSync('../pwn.txt', join(outside, 'relative'))
    assert.equal(outsideWorkspace(join(root, 'src', 'a.txt'), root), false)
    assert.equal(outsideWorkspace(join(root, 'link', 'a.txt'), root), true)
    assert.equal(outsideWorkspace(`${root}/link/../secret.txt`, root), true)
    assert.equal(outsideWorkspace(join(root, 'dangling'), root), true)
    assert.equal(outsideWorkspace(join(root, 'tilde-target'), root), false)
    assert.equal(outsideWorkspace(join(root, 'link', 'relative'), root), true)
    assert.equal(outsideWorkspace(`${root}/link/${Array.from({ length: 35 }, (_, i) => `d${i}`).join('/')}/x`, root), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('apply_patch checks every path in its patch body', async () => {
  const inside = '*** Begin Patch\n*** Add File: src/a.txt\n+x\n*** End Patch'
  const outside = '*** Begin Patch\n*** Update File: ../outside.txt\n@@\n-a\n+b\n*** End Patch'
  assert.equal(await externalDirectoryReason(exec('apply_patch', { patch_text: inside })), undefined)
  assert.match(await externalDirectoryReason(exec('apply_patch', { patch_text: outside })), /requires approval/)
  assert.match(
    await externalDirectoryReason(exec('apply_patch', { patch_text: '*** Delete File: /etc/passwd\n' })),
    /requires approval/,
  )
  for (const header of ['*** Add File:../outside', '*** Add File ../outside', '*** Update File:\t../outside']) {
    assert.match(await externalDirectoryReason(exec('apply_patch', { patch_text: header + '\n' })), /requires approval/, header)
  }
  assert.match(
    await externalDirectoryReason(exec('apply_patch', { patch_text: '*** Update File: src/a\n*** Move to:../outside\n' })),
    /requires approval/,
  )
  for (const separator of ['\r', '\u2028', '\u2029']) {
    assert.match(
      await externalDirectoryReason(exec('apply_patch', { patch_text: `*** Add File:${separator}../outside` })),
      /requires approval/,
    )
  }
})
