// omo's hashline: tags read output with LINE#HASH content hashes and provides
// hashline_edit (hash-validated replace). Hash algorithm is xxhash32 + the
// 16-char nibble dict, copied faithfully from omo's hashline-core.
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'opencode-omo-hashline'
export const inject = ['tools', 'fs']

const NIBBLE_STR = 'ZPMQVRWSNKTXJBYH'
const HASHLINE_DICT = Array.from({ length: 256 }, (_, i) => NIBBLE_STR[(i >>> 4)] + NIBBLE_STR[(i & 0x0f)])

const PRIME32_1 = 0x9e3779b1
const PRIME32_2 = 0x85ebca77
const PRIME32_3 = 0xc2b2ae3d
const PRIME32_4 = 0x27d4eb2f
const PRIME32_5 = 0x165667b1

async function resolveToolCwd(ctx, exec) {
  try {
    const service = ctx.get?.('workingDirectory')
    if (service?.ensure !== undefined && exec.agent !== undefined) {
      const cwd = await service.ensure(exec.agent, exec.signal)
      if (typeof cwd === 'string' && cwd !== '') return cwd
    }
  } catch {
    // Fall back to the session header.
  }
  return exec.agent?.session.header.cwd
}

function rotl(v, b) { return ((v << b) | (v >>> (32 - b))) >>> 0 }
function read32(b, o) { return ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0 }
function round(acc, v) { return Math.imul(rotl((acc + Math.imul(v, PRIME32_2)) >>> 0, 13), PRIME32_1) >>> 0 }

function xxhash32(bytes, seed) {
  let offset = 0
  const length = bytes.length
  let hash
  if (length >= 16) {
    const limit = length - 16
    let v1 = (seed + PRIME32_1 + PRIME32_2) >>> 0
    let v2 = (seed + PRIME32_2) >>> 0
    let v3 = seed >>> 0
    let v4 = (seed - PRIME32_1) >>> 0
    while (offset <= limit) {
      v1 = round(v1, read32(bytes, offset)); offset += 4
      v2 = round(v2, read32(bytes, offset)); offset += 4
      v3 = round(v3, read32(bytes, offset)); offset += 4
      v4 = round(v4, read32(bytes, offset)); offset += 4
    }
    hash = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0
  } else {
    hash = (seed + PRIME32_5) >>> 0
  }
  hash = (hash + length) >>> 0
  while (offset + 4 <= length) {
    hash = (hash + Math.imul(read32(bytes, offset), PRIME32_3)) >>> 0
    hash = Math.imul(rotl(hash, 17), PRIME32_4) >>> 0
    offset += 4
  }
  while (offset < length) {
    hash = (hash + Math.imul(bytes[offset] ?? 0, PRIME32_5)) >>> 0
    hash = Math.imul(rotl(hash, 11), PRIME32_1) >>> 0
    offset += 1
  }
  hash = (hash ^ (hash >>> 15)) >>> 0
  hash = Math.imul(hash, PRIME32_2) >>> 0
  hash = (hash ^ (hash >>> 13)) >>> 0
  hash = Math.imul(hash, PRIME32_3) >>> 0
  return (hash ^ (hash >>> 16)) >>> 0
}

const encoder = new TextEncoder()

function computeLineHash(lineNumber, content) {
  const normalized = content.replace(/\r/g, '').trimEnd()
  const seed = /[\p{L}\p{N}]/u.test(normalized) ? 0 : lineNumber
  const hash = xxhash32(encoder.encode(normalized), seed >>> 0)
  return HASHLINE_DICT[hash % 256]
}

function formatHashLine(lineNumber, content) {
  return lineNumber + '#' + computeLineHash(lineNumber, content) + '|' + content
}

function transformReadContent(text) {
  // Tag line-numbered lines (inside a <content> block) with LINE#HASH.
  return text.replace(/(<content>)([\s\S]*?)(<\/content>)/, (_m, open, body, close) => {
    const tagged = body.split(/\n/).map((line) => {
      const m = line.match(/^(\d+): ?(.*)$/)
      if (!m) return line
      return formatHashLine(Number(m[1]), m[2])
    }).join('\n')
    return open + tagged + close
  })
}

export function apply(ctx) {
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (exec.name !== 'read' || downstream.kind !== 'accept' || result.isError) return downstream
    return { ...downstream, content: result.content.map((block) => {
      if (block.type !== 'text') return block
      return { ...block, text: transformReadContent(block.text) }
    }) }
  })

  ctx.tools.register(defineTool({
    name: 'hashline_edit',
    description: 'Edit a file by LINE#HASH references (from a prior read). Validates the hash before replacing, so a stale reference is rejected.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to edit.' },
      ref: { type: 'string', required: true, description: 'The LINE#HASH reference to replace (e.g. "3#ZZ").' },
      new_line: { type: 'string', required: true, description: 'Replacement content for that line (no line number).' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: 'The file ' + value.path + ' has been updated.' }],
    },
    async execute(args, exec) {
      const m = args.ref.match(/^([0-9]+)#([ZPMQVRWSNKTXJBYH]{2})$/)
      if (!m) throw new Error('hashline_edit: invalid ref ' + args.ref + ' (expected N#HH)')
      const lineNumber = Number(m[1])
      const expectedHash = m[2]
      const cwd = await resolveToolCwd(ctx, exec)
      const target = await ctx.fs.resolve(args.file_path, { cwd, signal: exec.signal })
      const content = await ctx.fs.readText(target, exec.signal)
      const lines = content.split(/\r?\n/)
      if (lineNumber < 1 || lineNumber > lines.length) throw new Error('hashline_edit: line ' + lineNumber + ' out of range')
      const actualHash = computeLineHash(lineNumber, lines[lineNumber - 1])
      if (actualHash !== expectedHash) throw new Error('hashline_edit: stale ref ' + args.ref + ' (file changed)')
      lines[lineNumber - 1] = args.new_line
      await ctx.fs.writeText(target, lines.join('\n'), undefined, exec.signal)
      return { path: target.displayPath }
    },
  }))
}
