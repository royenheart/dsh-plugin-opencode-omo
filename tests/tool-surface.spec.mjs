/**
 * Pure-function tests for the opencode-omo tool surface. These assert the
 * model-visible descriptions and parameter names without booting dsh: the
 * execution shims are thin defineTool wrappers around the original registry
 * definitions and are covered here through their converters and the surface
 * they project.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyOpencodeSurface,
  bashDescription,
  createReadImageShim,
  createReadShim,
  formatDirectoryListing,
  name,
  opencodeToolSurface,
  toDshEditArgs,
  toDshReadArgs,
  toDshWebSearchArgs,
  toDshWriteArgs,
} from '../presets/opencode-omo/tool-surface.mjs'

test('module identity', () => {
  assert.equal(name, 'opencode-omo-tool-surface')
})

test('descriptions are the opencode .txt texts', () => {
  const surface = opencodeToolSurface({ year: 2026, platform: 'linux', tmp: '/tmp' })
  assert.match(surface.descriptions.read, /Read a file or directory from the local filesystem/)
  assert.match(surface.descriptions.read, /The filePath parameter should be an absolute path/)
  assert.match(surface.descriptions.edit, /Performs exact string replacements in files/)
  assert.match(surface.descriptions.write, /Writes a file to the local filesystem/)
  assert.match(surface.descriptions.glob, /Fast file pattern matching tool that works with any codebase size/)
  assert.match(surface.descriptions.grep, /Fast content search tool that works with any codebase size/)
  assert.match(surface.descriptions.todo_write, /Create and maintain a structured task list for the current coding session/)
  assert.match(surface.descriptions.skill, /Load a specialized skill when the task at hand matches one of the skills listed in the system prompt/)
  assert.match(surface.descriptions.web_fetch, /Fetches content from a specified URL/)
  assert.match(surface.descriptions.web_search, /Search the web using the session's web search provider/)
  assert.match(surface.descriptions.web_search, /The current year is 2026/)
  assert.match(surface.descriptions.bash, /Executes a given bash command in a persistent shell session/)
  assert.match(surface.descriptions.bash, /# Git and GitHub/)
})

test('read carries opencode image guidance only when read_image is absent', () => {
  const without = opencodeToolSurface({ readImagePresent: false })
  const withImage = opencodeToolSurface({ readImagePresent: true })
  assert.match(without.descriptions.read, /This tool can read image files and PDFs and return them as file attachments/)
  assert.doesNotMatch(withImage.descriptions.read, /This tool can read image files and PDFs and return them as file attachments/)
  assert.match(withImage.descriptions.read, /Read a file or directory from the local filesystem/)
})

test('bash surface advertises the escalation contract only when enabled', () => {
  const plain = opencodeToolSurface()
  assert.equal(plain.parameters.bash.sandbox_permissions, undefined)
  assert.doesNotMatch(plain.descriptions.bash, /sandbox_permissions/)

  const escalating = opencodeToolSurface({ bashEscalation: true })
  assert.deepEqual(escalating.parameters.bash.sandbox_permissions.enum, ['workspace-write', 'danger-full-access'])
  assert.ok(escalating.parameters.bash.justification)
  assert.match(escalating.descriptions.bash, /sandbox_permissions/)
  assert.match(escalating.descriptions.bash, /Executes a given bash command in a persistent shell session/)
})

test('parameters use opencode names for shimmed and name-safe tools', () => {
  const { parameters } = opencodeToolSurface()
  assert.ok(parameters.read.filePath.required)
  assert.equal(parameters.read.filePath.description, 'The absolute path to the file or directory to read')
  assert.ok(parameters.read.offset)
  assert.ok(parameters.read.limit)
  assert.equal(parameters.read.file_path, undefined)

  assert.ok(parameters.edit.filePath.required)
  assert.ok(parameters.edit.oldString.required)
  assert.ok(parameters.edit.newString.required)
  assert.equal(parameters.edit.replaceAll.type, 'boolean')
  assert.equal(parameters.edit.file_path, undefined)

  assert.ok(parameters.write.filePath.required)
  assert.ok(parameters.write.content.required)
  assert.equal(parameters.write.file_path, undefined)

  assert.ok(parameters.glob.pattern.required)
  assert.ok(parameters.glob.path)
  assert.equal(parameters.glob.path.type, 'string')

  assert.ok(parameters.grep.pattern.required)
  assert.ok(parameters.grep.path)
  assert.ok(parameters.grep.include)

  assert.ok(parameters.skill.name.required)

  assert.ok(parameters.bash.command.required)
  assert.equal(parameters.bash.command.description, 'The command to execute')

  assert.ok(parameters.web_search.query.required)
  assert.equal(parameters.web_search.query.description, 'Websearch query')
  assert.equal(parameters.web_search.queries, undefined)
  assert.equal(parameters.web_search.numResults.type, 'number')
  assert.deepEqual(parameters.web_search.livecrawl.enum, ['fallback', 'preferred'])
  assert.deepEqual(parameters.web_search.type.enum, ['auto', 'fast', 'deep'])
  assert.equal(parameters.web_search.contextMaxCharacters.type, 'number')

  assert.ok(parameters.web_fetch.url.required)
  assert.equal(parameters.web_fetch.url.description, 'The URL to fetch content from')
})

test('arg converters map opencode names to dsh names', () => {
  assert.deepEqual(toDshReadArgs({ filePath: '/tmp/a.txt', offset: 10, limit: 40 }), {
    file_path: '/tmp/a.txt',
    offset: 10,
    limit: 40,
  })
  assert.deepEqual(toDshReadArgs({ filePath: '/tmp/a.txt' }), { file_path: '/tmp/a.txt' })

  assert.deepEqual(toDshEditArgs({ filePath: '/tmp/a.txt', oldString: 'a', newString: 'b', replaceAll: true }), {
    file_path: '/tmp/a.txt',
    old_string: 'a',
    new_string: 'b',
    replace_all: true,
  })
  assert.deepEqual(toDshEditArgs({ filePath: '/tmp/a.txt', oldString: 'a', newString: 'b' }), {
    file_path: '/tmp/a.txt',
    old_string: 'a',
    new_string: 'b',
  })

  assert.deepEqual(toDshWriteArgs({ filePath: '/tmp/a.txt', content: 'hello' }), {
    file_path: '/tmp/a.txt',
    content: 'hello',
  })

  assert.deepEqual(toDshWebSearchArgs({ query: 'Galaxy on Fire 2 source' }), {
    queries: ['Galaxy on Fire 2 source'],
  })
  assert.deepEqual(
    toDshWebSearchArgs({
      query: 'latest AI news 2026',
      numResults: 4,
      livecrawl: 'preferred',
      type: 'deep',
      contextMaxCharacters: 2000,
    }),
    { queries: ['latest AI news 2026'] },
  )
  assert.deepEqual(toDshWebSearchArgs({ queries: ['a', 'b'] }), { queries: ['a', 'b'] })
  assert.deepEqual(toDshWebSearchArgs({}), { queries: [] })
})

test('applyOpencodeSurface rewrites matched tools and leaves others untouched', () => {
  const original = [
    { name: 'read', description: 'dsh read', parameters: { type: 'object', properties: { file_path: {} } } },
    { name: 'write', description: 'dsh write', parameters: { type: 'object', properties: { file_path: {}, content: {} } } },
    { name: 'todo_write', description: 'dsh todo', parameters: { type: 'object', properties: { todos: {} } } },
    { name: 'web_search', description: 'dsh search', parameters: { type: 'object', properties: { queries: {} } } },
    { name: 'apply_patch', description: 'keep me', parameters: { type: 'object', properties: { patch_text: {} } } },
  ]
  const surface = applyOpencodeSurface(original, { year: 2026 })
  assert.match(surface[0].description, /Read a file or directory from the local filesystem/)
  assert.ok(surface[0].parameters.properties.filePath)
  assert.equal(surface[0].parameters.properties.file_path, undefined)

  assert.match(surface[1].description, /Writes a file to the local filesystem/)
  assert.ok(surface[1].parameters.properties.filePath)
  assert.ok(surface[1].parameters.properties.content)

  assert.match(surface[2].description, /Create and maintain a structured task list for the current coding session/)
  assert.ok(surface[2].parameters.properties.todos)

  assert.match(surface[3].description, /Search the web using the session's web search provider/)
  assert.ok(surface[3].parameters.properties.query)
  assert.equal(surface[3].parameters.properties.queries, undefined)

  assert.equal(surface[4].description, 'keep me')
  assert.ok(surface[4].parameters.properties.patch_text)
})

test('applyOpencodeSurface detects read_image presence for read guidance', () => {
  const tools = [
    { name: 'read', description: 'dsh read', parameters: {} },
    { name: 'read_image', description: 'dsh image', parameters: {} },
  ]
  const surface = applyOpencodeSurface(tools)
  assert.doesNotMatch(surface[0].description, /read image files and PDFs/)
  assert.equal(surface[1].description, 'dsh image')
})

test('bash description renders every shell.txt placeholder', () => {
  const description = bashDescription({ platform: 'linux', tmp: '/tmp', year: 2026 })
  assert.doesNotMatch(description, /\$\{/)
  assert.match(description, /OS: linux, Shell: bash/)
  assert.match(description, /Use `\/tmp` for temporary work outside the workspace/)
})

test('read_image shim executes through ctx.get(fs), not ctx.fs', async () => {
  const emitted = []
  const target = { displayPath: '/tmp/a.png' }
  const fs = {
    async resolve(requestedPath) {
      assert.equal(requestedPath, '/tmp/a.png')
      return target
    },
    async stat(received) {
      assert.equal(received, target)
      return { type: 'file', version: 1 }
    },
    async readBytes(received, _signal, cap) {
      assert.equal(received, target)
      assert.equal(cap, 400)
      return new Uint8Array([1, 2, 3])
    },
  }
  const attachments = {
    imageLimits: {
      mediaTypes: ['image/png'],
      maxImageBytes: 500,
      maxMessageImageBytes: 400,
      maxImageDimension: 2000,
      maxImagePixels: 1000000,
    },
    async saveImage({ data, mediaType, name }) {
      assert.deepEqual(data, new Uint8Array([1, 2, 3]))
      assert.equal(mediaType, 'image/png')
      assert.equal(name, 'a.png')
      return { attachmentId: 'att-1', mediaType, bytes: data.byteLength, width: 1, height: 1, name }
    },
  }
  const llm = {
    async resolveModelInfo(provider, model) {
      assert.equal(provider, 'openai')
      assert.equal(model, 'gpt-image')
      return { inputModalities: ['text', 'image'] }
    },
  }
  const ctx = {
    get(name) {
      return { fs, attachments, llm }[name]
    },
    emit(name, ...args) {
      emitted.push([name, ...args])
    },
  }
  const original = {
    name: 'read_image',
    description: 'original description',
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: `rendered:${value.path}` }],
    },
    isConcurrencySafe: () => true,
    presentCall: args => ({ card: 'generic', title: `Read image ${args.file_path}`, kind: 'read', locations: [{ path: args.file_path }] }),
  }
  const shim = createReadImageShim(original, ctx)
  const exec = {
    agent: { options: { provider: 'openai', model: 'gpt-image' } },
    signal: undefined,
  }
  const value = await shim.execute({ file_path: '/tmp/a.png' }, exec)
  assert.equal(value.path, '/tmp/a.png')
  assert.equal(value.image.attachmentId, 'att-1')
  assert.equal(value.image.bytes, 3)
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0][0], 'fs/observed')
  assert.deepEqual(emitted[0][2], { kind: 'present', version: 1 })
  assert.deepEqual(shim.output.render({}, value), [{ type: 'text', text: 'rendered:/tmp/a.png' }])
})

test('formatDirectoryListing matches the OpenCode one-name-per-line contract', () => {
  assert.equal(
    formatDirectoryListing({
      entries: [
        { name: 'README.md', type: 'file' },
        { name: 'src', type: 'directory' },
      ],
    }),
    'README.md\nsrc/',
  )
  assert.equal(
    formatDirectoryListing({
      offset: 1,
      total: 3,
      entries: [
        { name: 'a', type: 'file' },
        { name: 'b', type: 'directory' },
      ],
    }),
    'a\nb/\n(Showing 1-2 of 3. Use offset=3 to continue.)',
  )
})

test('read shim resolves directory listings through workingDirectory', async () => {
  let resolvedOptions
  const fs = {
    async resolve(_requestedPath, options) {
      resolvedOptions = options
      return { displayPath: '/repo/sub/src' }
    },
    async stat() {
      return { type: 'directory', version: 1 }
    },
    async listDir() {
      return []
    },
  }
  const ctx = {
    get(name) {
      if (name === 'fs') return fs
      if (name === 'workingDirectory') return { ensure: async () => '/repo/sub' }
      return undefined
    },
    emit() {},
  }
  const original = {
    name: 'read',
    description: 'dsh read',
    output: { schema: { type: 'object' }, render: () => [] },
    async execute() { throw new Error('directory listing should not forward') },
  }
  const shim = createReadShim(original, ctx)
  const exec = { agent: { session: { header: { cwd: '/repo' } } }, signal: undefined }
  await shim.execute({ filePath: 'src' }, exec)
  assert.equal(resolvedOptions.cwd, '/repo/sub')
})

test('read shim lists directories and forwards files to the original tool', async () => {
  const emitted = []
  const dirTarget = { displayPath: '/tmp/proj' }
  const fileTarget = { displayPath: '/tmp/proj/a.txt' }
  const fs = {
    async resolve(requestedPath) {
      return requestedPath.endsWith('a.txt') ? fileTarget : dirTarget
    },
    async stat(received) {
      if (received === fileTarget) return { type: 'file', version: 2 }
      return { type: 'directory', version: 7 }
    },
    async listDir(received) {
      assert.equal(received, dirTarget)
      return [
        { name: 'src', type: 'directory' },
        { name: 'README.md', type: 'file' },
        { name: 'z-last', type: 'file' },
      ]
    },
  }
  const ctx = {
    get(name) {
      return name === 'fs' ? fs : undefined
    },
    emit(...args) {
      emitted.push(args)
    },
  }
  let forwarded
  const original = {
    name: 'read',
    description: 'dsh read',
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: `file:${value.path}` }],
    },
    async execute(args) {
      forwarded = args
      return { path: args.file_path, offset: 1, lines: [], totalLines: 0 }
    },
  }
  const shim = createReadShim(original, ctx)
  const exec = { agent: { session: { header: { cwd: '/tmp/proj' } } }, signal: undefined }

  const listing = await shim.execute({ filePath: '/tmp/proj' }, exec)
  assert.deepEqual(listing, {
    kind: 'directory',
    path: '/tmp/proj',
    offset: 1,
    total: 3,
    entries: [
      { name: 'README.md', type: 'file' },
      { name: 'src', type: 'directory' },
      { name: 'z-last', type: 'file' },
    ],
  })
  assert.deepEqual(shim.output.render({ filePath: '/tmp/proj' }, listing), [{
    type: 'text',
    text: 'README.md\nsrc/\nz-last',
  }])
  assert.equal(emitted[0][0], 'fs/observed')
  assert.equal(forwarded, undefined)

  const file = await shim.execute({ filePath: '/tmp/proj/a.txt', offset: 4, limit: 8 }, exec)
  assert.deepEqual(forwarded, { file_path: '/tmp/proj/a.txt', offset: 4, limit: 8 })
  assert.equal(file.path, '/tmp/proj/a.txt')
  assert.deepEqual(shim.output.render({ filePath: '/tmp/proj/a.txt' }, file), [{
    type: 'text',
    text: 'file:/tmp/proj/a.txt',
  }])
})

test('read_image shim preserves route and extension gates', async () => {
  const llm = {
    async resolveModelInfo() {
      return { inputModalities: ['text'] }
    },
  }
  const fs = {
    resolve: async () => assert.fail('fs.resolve must not run before the route gate'),
    stat: async () => assert.fail('fs.stat must not run before the route gate'),
    readBytes: async () => assert.fail('fs.readBytes must not run before the route gate'),
  }
  const ctx = {
    get(name) {
      return { fs, attachments: { imageLimits: { mediaTypes: ['image/png'], maxImageBytes: 1, maxMessageImageBytes: 1, maxImageDimension: 1, maxImagePixels: 1 } }, llm }[name]
    },
    emit() {},
  }
  const original = {
    name: 'read_image',
    description: 'original description',
    output: { schema: { type: 'object' }, render: () => [] },
  }
  const shim = createReadImageShim(original, ctx)
  const exec = { agent: { options: { provider: 'openai', model: 'text-only' } }, signal: undefined }

  await assert.rejects(
    () => shim.execute({ file_path: '/tmp/a.png' }, exec),
    /model "text-only" does not declare image input/,
  )
  await assert.rejects(
    () => shim.execute({ file_path: '/tmp/a.txt' }, exec),
    /read_image only accepts PNG\/JPEG\/WebP\/GIF paths/,
  )
})
