// opencode-omo tool surface: makes the MODEL-VISIBLE tool schemas of this preset
// match opencode's tool descriptions/parameters as closely as the dsh execution
// layer allows. Execution shims are registered per agent so they shadow the
// standing preset's inherited read/edit/write definitions in the tool registry;
// the system-prompt/assemble waterfall replaces the authoritative model-visible
// schema text for every matched tool.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname } from 'node:path'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import { defineTool, parameterSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import { ESCALATION_GUIDANCE, ESCALATION_PARAMETERS, escalationAvailableFor } from './escalating-bash.mjs'
import { applyOmoDelegationCatalog } from './delegation-surface.mjs'
import { isDelegatedSession } from './delegated-session.mjs'
import { applyOmoLspCatalog } from './lsp-surface.mjs'

export const name = 'opencode-omo-tool-surface'
export const inject = ['tools']

const REFERENCE_TOOL_DIR = new URL('../../reference/opencode/packages/opencode/src/tool/', import.meta.url)

function referenceText(file, fallback) {
  try {
    return readFileSync(new URL(file, REFERENCE_TOOL_DIR), 'utf8')
  } catch {
    return fallback
  }
}

const READ_TXT_FALLBACK = "Read a file or directory from the local filesystem. If the path does not exist, an error is returned.\n\nUsage:\n- The filePath parameter should be an absolute path.\n- By default, this tool returns up to 2000 lines from the start of the file.\n- The offset parameter is the line number to start from (1-indexed).\n- To read later sections, call this tool again with a larger offset.\n- Use the grep tool to find specific content in large files or files with long lines.\n- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.\n- Contents are returned with each line prefixed by its line number as `<line>: <content>`. For example, if a file has contents \"foo\\n\", you will receive \"1: foo\\n\". For directories, entries are returned one per line (without line numbers) with a trailing `/` for subdirectories.\n- Any line longer than 2000 characters is truncated.\n- Call this tool in parallel when you know there are multiple files you want to read.\n- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.\n- This tool can read image files and PDFs and return them as file attachments.\n";
const EDIT_TXT_FALLBACK = "Performs exact string replacements in files. \n\nUsage:\n- You must use your `Read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. \n- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + colon + space (e.g., `1: `). Everything after that space is the actual file content to match. Never include any part of the line number prefix in the oldString or newString.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.\n- The edit will FAIL if `oldString` is not found in the file with an error \"oldString not found in content\".\n- The edit will FAIL if `oldString` is found multiple times in the file with an error \"Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match.\" Either provide a larger string with more surrounding context to make it unique or use `replaceAll` to change every instance of `oldString`. \n- Use `replaceAll` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.\n";
const WRITE_TXT_FALLBACK = "Writes a file to the local filesystem.\n\nUsage:\n- This tool will overwrite the existing file if there is one at the provided path.\n- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.\n- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.\n";
const GLOB_TXT_FALLBACK = "- Fast file pattern matching tool that works with any codebase size\n- Supports glob patterns like \"**/*.js\" or \"src/**/*.ts\"\n- Returns matching file paths\n- Use this tool when you need to find files by name patterns\n- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead\n- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.\n";
const GREP_TXT_FALLBACK = "- Fast content search tool that works with any codebase size\n- Searches file contents using regular expressions\n- Supports full regex syntax (eg. \"log.*Error\", \"function\\s+\\w+\", etc.)\n- Filter files by pattern with the include parameter (eg. \"*.js\", \"*.{ts,tsx}\")\n- Returns file paths and line numbers with matching lines\n- Use this tool when you need to find files containing specific patterns\n- If you need to identify/count the number of matches within files, use the Bash tool with `rg` (ripgrep) directly. Do NOT use `grep`.\n- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead\n";
const TODOWRITE_TXT_FALLBACK = "Create and maintain a structured task list for the current coding session. Tracks progress, organizes multi-step work, and surfaces status to the user.\n\n## When to use\nUse proactively when:\n- The task requires 3+ distinct steps or actions (not just 3 tool calls for a single conceptual step)\n- The work is non-trivial and benefits from planning\n- The user provides multiple tasks (numbered or comma-separated) or explicitly asks for a todo list\n- New instructions arrive - capture them as todos\n- You start a task - mark it `in_progress` (only one at a time) before working\n- You finish a task - mark it `completed` and add any follow-ups discovered during the work\n\n## When NOT to use\nSkip when:\n- The work is a single, straightforward task (or <3 trivial steps)\n- The request is purely informational or conversational\n- Tracking adds no organizational value\n\n## States\n- `pending` - not started\n- `in_progress` - actively working (exactly ONE at a time)\n- `completed` - finished successfully\n- `cancelled` - no longer needed\n\n## Rules\n- Update status in real time; don't batch completions\n- Mark `completed` only after the required work is actually done, including any required verification. Never based on intent.\n- Keep exactly one `in_progress` while work remains\n- If blocked or partial, keep it `in_progress` and add a follow-up todo describing the blocker\n- Preserve user-provided commands verbatim (flags, args, order)\n- Items should be specific and actionable; break large work into smaller steps\n\n## Examples\n\nUse it:\n- \"Add a dark mode toggle and run the tests\" -> multi-step feature + explicit verification\n- \"Rename getCwd -> getCurrentWorkingDirectory across the repo\" -> grep reveals 15 occurrences in 8 files\n- \"Implement registration, catalog, cart, checkout\" -> multiple complex features\n\nSkip it:\n- \"How do I print Hello World in Python?\" -> informational\n- \"Add a comment to calculateTotal\" -> single edit\n- \"Run npm install and tell me what happened\" -> one command\n\nWhen in doubt, use it.\n";
const SKILL_TXT_FALLBACK = "Load a specialized skill when the task at hand matches one of the skills listed in the system prompt.\n\nUse this tool to inject the skill's instructions and resources into current conversation. The output may contain detailed workflow guidance as well as references to scripts, files, etc in the same directory as the skill.\n\nThe skill name must match one of the skills listed in your system prompt.\n";
const WEBFETCH_TXT_FALLBACK = "- Fetches content from a specified URL\n- Takes a URL and optional format as input\n- Fetches the URL content, converts to requested format (markdown by default)\n- Returns the content in the specified format\n- Use this tool when you need to retrieve and analyze web content\n\nUsage notes:\n  - IMPORTANT: if another tool is present that offers better web fetching capabilities, is more targeted to the task, or has fewer restrictions, prefer using that tool instead of this one.\n  - The URL must be a fully-formed valid URL\n  - HTTP URLs will be automatically upgraded to HTTPS\n  - Format options: \"markdown\" (default), \"text\", or \"html\"\n  - This tool is read-only and does not modify any files\n  - Results may be summarized if the content is very large\n";
const WEBSEARCH_TXT_FALLBACK = "- Search the web using the session's web search provider - performs real-time web searches and can scrape content from specific URLs\n- Provides up-to-date information for current events and recent data\n- Supports configurable result counts and returns the content from the most relevant websites\n- Use this tool for accessing information beyond knowledge cutoff\n- Searches are performed automatically within a single API call\n\nUsage notes:\n  - Supports live crawling modes when available: 'fallback' (backup if cached unavailable) or 'preferred' (prioritize live crawling)\n  - Search types when available: 'auto' (balanced), 'fast' (quick results), 'deep' (comprehensive search)\n  - Configurable context length for optimal LLM integration\n  - Domain filtering and advanced search options available\n\nThe current year is {{year}}. You MUST use this year when searching for recent information or current events\n- Example: If the current year is 2026 and the user asks for \"latest AI news\", search for \"AI news 2026\", NOT \"AI news 2025\"\n";
const SHELL_TXT_FALLBACK = "${intro}\n\nBe aware: OS: ${os}, Shell: ${shell}\n\n${workdirSection}\n\nUse `${tmp}` for temporary work outside the workspace. This directory has already been created, already exists, and is pre-approved for external directory access.\n\nIMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.\n\n${commandSection}\n\n# Git and GitHub\n- Only commit, amend, push, or create PRs when explicitly requested.\n- Before committing, inspect `git status`, `git diff`, and `git log --oneline -10`; stage only intended files and never commit secrets.\n- Write a concise commit message that matches the repo style.\n- Do not update git config, skip hooks, use interactive `-i`, force-push, or create empty commits unless explicitly requested.\n- If a commit fails or hooks reject it, fix the issue and create a new commit; do not amend the failed commit.\n- Before creating a PR, inspect status, diff, remote tracking, recent commits, and the diff from the base branch.\n- Review all commits included in the PR, not just the latest commit.\n- Use `gh` for GitHub tasks, including PRs, issues, checks, and releases; return the PR URL when done.\n";
const BASH_INTRO = "Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.";
const BASH_WORKDIR_SECTION = "All commands run in the current working directory by default. Use the `workdir` parameter if you need to run a command in a different directory. AVOID using `cd <directory> && <command>` patterns - use `workdir` instead.";
const BASH_CHAIN = "If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together (e.g., `git add . && git commit -m \"message\" && git push`). For instance, if one operation must complete before another starts (like mkdir before cp, Write before Bash for git operations, or git add before git commit), run these operations sequentially instead.";
const BASH_COMMAND_SECTION_TEMPLATE = "Before executing the command, please follow these steps:\n\n1. Directory Verification:\n   - If the command will create new directories or files, first use `ls` to verify the parent directory exists and is the correct location\n   - For example, before running \"mkdir foo/bar\", first use `ls foo` to check that \"foo\" exists and is the intended parent directory\n\n2. Command Execution:\n   - Always quote file paths that contain spaces with double quotes (e.g., rm \"path with spaces/file.txt\")\n   - Examples of proper quoting:\n     - mkdir \"/Users/name/My Documents\" (correct)\n     - mkdir /Users/name/My Documents (incorrect - will fail)\n     - python \"/path/with spaces/script.py\" (correct)\n     - python /path/with spaces/script.py (incorrect - will fail)\n   - After ensuring proper quoting, execute the command.\n   - Capture the output of the command.\n\nUsage notes:\n  - The command argument is required.\n  - You can specify an optional timeout in milliseconds. If not specified, commands will time out after ${defaultTimeoutMs}ms.\n  - If the output exceeds ${limits.maxLines} lines or ${limits.maxBytes} bytes, it will be truncated and the full output will be written to a file. You can use Read with offset/limit to read specific sections or Grep to search the full content. Do NOT use `head`, `tail`, or other truncation commands to limit output; the full output will already be captured to a file for more precise searching.\n\n  - Avoid using Bash with the `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or when these commands are truly necessary for the task. Instead, always prefer using the dedicated tools for these commands:\n    - File search: Use Glob (NOT find or ls)\n    - Content search: Use Grep (NOT grep or rg)\n    - Read files: Use Read (NOT cat/head/tail)\n    - Edit files: Use Edit (NOT sed/awk)\n    - Write files: Use Write (NOT echo >/cat <<EOF)\n    - Communication: Output text directly (NOT echo/printf)\n  - When issuing multiple commands:\n    - If the commands are independent and can run in parallel, make multiple bash tool calls in a single message. For example, if you need to run \"git status\" and \"git diff\", send a single message with two bash tool calls in parallel.\n    - ${chain}\n    - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail\n    - DO NOT use newlines to separate commands (newlines are ok in quoted strings)\n  - AVOID using `cd <directory> && <command>`. Use the `workdir` parameter to change directories instead.\n    <good-example>\n    Use workdir=\"/foo/bar\" with command: pytest tests\n    </good-example>\n    <bad-example>\n    cd /foo/bar && pytest tests\n    </bad-example>";
const IMAGE_GUIDANCE_LINE = "- This tool can read image files and PDFs and return them as file attachments.";

const READ_TXT = referenceText('read.txt', READ_TXT_FALLBACK)
const READ_TXT_WITHOUT_IMAGES = READ_TXT
  .split('\n')
  .filter(line => line.trimEnd() !== IMAGE_GUIDANCE_LINE)
  .join('\n')
const EDIT_TXT = referenceText('edit.txt', EDIT_TXT_FALLBACK)
const WRITE_TXT = referenceText('write.txt', WRITE_TXT_FALLBACK)
const GLOB_TXT = referenceText('glob.txt', GLOB_TXT_FALLBACK)
const GREP_TXT = referenceText('grep.txt', GREP_TXT_FALLBACK)
const TODOWRITE_TXT = referenceText('todowrite.txt', TODOWRITE_TXT_FALLBACK)
const SKILL_TXT = referenceText('skill.txt', SKILL_TXT_FALLBACK)
const WEBFETCH_TXT = referenceText('webfetch.txt', WEBFETCH_TXT_FALLBACK)
const WEBSEARCH_TXT = referenceText('websearch.txt', WEBSEARCH_TXT_FALLBACK)
const SHELL_TXT = referenceText('shell/shell.txt', SHELL_TXT_FALLBACK)

// ── read_image repair shim ─────────────────────────────────────────────────
// dsh-tool-fs registers `read_image` through `ctx.inject(['attachments'], cb)`.
// Inside this preset's `filesystem` isolate realm (`isolate: { fs: true }`),
// cordis' property walk (`ctx.fs`) from that injected child context throws
// "cannot get property fs without inject", while `ctx.get('fs')` resolves fine.
// Per-agent we therefore shadow the broken global read_image with the same
// schema/render/presenters, but execute through `ctx.get('fs')`.

const READ_IMAGE_DESCRIPTION = 'Read a PNG/JPEG/WebP/GIF file and return the image itself. Requires the current model to accept image input.'

const READ_IMAGE_PARAMETERS = {
  file_path: { type: 'string', required: true, description: 'Path to the image file, resolved by the filesystem backend.' },
}

const READ_IMAGE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    image: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        attachmentId: { type: 'string', required: true },
        mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], required: true },
        bytes: { type: 'integer', required: true },
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
        name: { type: 'string' },
      },
    },
  },
}

const IMAGE_EXTENSIONS = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function imageMediaTypeForPath(filePath) {
  return IMAGE_EXTENSIONS[extname(filePath).toLowerCase()]
}

const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/
const DIRECTORY_READ_LIMIT = 2000

function sessionResolveOptions(exec, requestedPath) {
  const cwd = exec.agent?.session?.header?.cwd
  if (cwd === undefined || (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath))) {
    return { ...(cwd !== undefined ? { cwd } : {}), signal: exec.signal }
  }
  return { cwd: canonicalPath(cwd), signal: exec.signal }
}

async function workingDirectoryResolveOptions(ctx, exec, requestedPath) {
  let service
  try {
    service = ctx.get?.('workingDirectory')
  } catch {
    service = undefined
  }
  if (service !== undefined && typeof service.ensure === 'function' && exec.agent !== undefined) {
    try {
      const cwd = await service.ensure(exec.agent, exec.signal)
      if (typeof cwd === 'string' && cwd !== '') {
        if (!PARENT_PATH_SEGMENT.test(requestedPath)) return { cwd, signal: exec.signal }
        return { cwd: canonicalPath(cwd), signal: exec.signal }
      }
    } catch {
      // Fall back to the header anchor when the service cannot resolve.
    }
  }
  return sessionResolveOptions(exec, requestedPath)
}

async function resolveImageReadTarget(ctx, exec, requestedPath) {
  const fs = ctx.get('fs')
  const target = await fs.resolve(requestedPath, await workingDirectoryResolveOptions(ctx, exec, requestedPath))
  const info = await fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new Error(`cannot read "${target.displayPath}": not found`)
  }
  if (info.type !== 'file') throw new Error(`cannot read "${target.displayPath}": not a regular file`)
  return { target, info }
}

async function assertImageCapableRoute(ctx, exec, requestedPath) {
  const routed = exec.agent?.session?.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error(`cannot read "${requestedPath}" as an image: the current model route could not be resolved`)
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(`cannot read "${requestedPath}" as an image: model "${model}" does not declare image input; switch to an image-capable model to read images`)
  }
}

function formatImageReadOutput(displayPath, image) {
  return `<path>${displayPath}</path>
<type>image</type>
<content>
${image.mediaType} image, ${image.width}x${image.height} px, ${image.bytes} bytes
</content>`
}

function imageRefFromValue(image) {
  return {
    attachmentId: image.attachmentId,
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...(image.name === undefined ? {} : { name: image.name }),
  }
}

function imageReadContent(value) {
  return [
    { type: 'text', text: formatImageReadOutput(value.path, value.image) },
    { type: 'image', attachment: imageRefFromValue(value.image) },
  ]
}

async function executeReadImage(ctx, args, exec) {
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')

  // Every gate runs before any filesystem I/O so a refusal never leaks
  // partial reads or attachment writes.
  const mediaType = imageMediaTypeForPath(args.file_path)
  if (mediaType === undefined) {
    throw new Error(`cannot read "${args.file_path}": read_image only accepts PNG/JPEG/WebP/GIF paths`)
  }
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new Error(`cannot read "${args.file_path}" as an image: no attachment service is mounted`)
  }
  if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
    throw new Error(`cannot read "${args.file_path}": ${mediaType} images are not accepted by this deployment`)
  }
  await assertImageCapableRoute(ctx, exec, args.file_path)

  const { target, info } = await resolveImageReadTarget(ctx, exec, args.file_path)

  // The tool result is one message carrying one image, so the per-message
  // aggregate bound applies beside the per-image bound.
  const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
  const fs = ctx.get('fs')
  const data = await fs.readBytes(target, exec.signal, byteCap)

  let ref
  try {
    ref = await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) })
  } catch (error) {
    const code = error?.code
    if (typeof code !== 'string') throw error
    if (code === 'IMAGE_DIMENSION_TOO_LARGE') {
      throw new Error(
        `cannot read "${target.displayPath}": at least one image side exceeds the ${attachments.imageLimits.maxImageDimension}px limit; downscale the image and read the smaller copy`,
        { cause: error },
      )
    }
    if (code === 'IMAGE_TOO_MANY_PIXELS') {
      throw new Error(
        `cannot read "${target.displayPath}": the image exceeds the ${attachments.imageLimits.maxImagePixels}-pixel decoded-size limit; downscale the image and read the smaller copy`,
        { cause: error },
      )
    }
    if (code !== 'IMAGE_TYPE_MISMATCH') throw error
    const extension = extname(target.displayPath).toLowerCase()
    throw new Error(
      `cannot read "${target.displayPath}": the ${extension} extension declares ${mediaType}, but the bytes use a different image format; rename the file to match its actual format if it is PNG/JPEG/WebP/GIF, or convert it to one of those formats`,
      { cause: error },
    )
  }
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return {
    path: target.displayPath,
    image: {
      attachmentId: ref.attachmentId,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      width: ref.width,
      height: ref.height,
      ...(ref.name === undefined ? {} : { name: ref.name }),
    },
  }
}

export function createReadImageShim(original, ctx) {
  if (original === undefined) {
    throw new Error(`opencode-omo-tool-surface: cannot shim "read_image" because the original dsh definition is unavailable`)
  }
  return defineTool({
    name: 'read_image',
    description: original.description ?? READ_IMAGE_DESCRIPTION,
    parameters: READ_IMAGE_PARAMETERS,
    output: {
      schema: READ_IMAGE_OUTPUT,
      render: (args, value) => original.output.render(args, value),
      ...(typeof original.output.presentationMeta === 'function'
        ? { presentationMeta: (args, value) => original.output.presentationMeta(args, value) }
        : {}),
    },
    ...(typeof original.isConcurrencySafe === 'function'
      ? { isConcurrencySafe: args => original.isConcurrencySafe(args) }
      : {}),
    ...(typeof original.presentCall === 'function'
      ? { presentCall: args => original.presentCall(args) }
      : {}),
    ...(typeof original.presentResult === 'function'
      ? { presentResult: (args, result) => original.presentResult(args, result) }
      : {}),
    execute: (args, exec) => executeReadImage(ctx, args, exec),
  })
}

function readDescriptionFor(readImagePresent) {
  if (readImagePresent) {
    return READ_TXT_WITHOUT_IMAGES
  }
  return READ_TXT
}

function bashCommandSection(chain, maxLines, maxBytes, defaultTimeoutMs) {
  return BASH_COMMAND_SECTION_TEMPLATE
    .split('${chain}').join(chain)
    .split('${limits.maxLines}').join(String(maxLines))
    .split('${limits.maxBytes}').join(String(maxBytes))
    .split('${defaultTimeoutMs}').join(String(defaultTimeoutMs))
}

/** opencode's rendered bash profile (shell/shell.txt + shell/prompt.ts). */
export function bashDescription(options = {}) {
  const platform = options.platform ?? process.platform
  const commandSection = bashCommandSection(
    BASH_CHAIN,
    options.maxLines ?? 2000,
    options.maxBytes ?? 50 * 1024,
    options.defaultTimeoutMs ?? 120000,
  )
  return SHELL_TXT
    .split('${intro}').join(BASH_INTRO)
    .split('${os}').join(platform)
    .split('${shell}').join('bash')
    .split('${tmp}').join(options.tmp ?? tmpdir())
    .split('${workdirSection}').join(BASH_WORKDIR_SECTION)
    .split('${commandSection}').join(commandSection)
}

/**
 * Author-facing opencode parameter specs. read/edit/write/web_search also
 * have execution shims that convert these names into the dsh contract.
 * glob/grep/skill/bash/web_fetch keep their names, so the overlay is
 * description-only for those.
 */
const OPENCODE_PARAMS = {
  read: {
    filePath: { type: 'string', required: true, description: 'The absolute path to the file or directory to read' },
    offset: { type: 'integer', description: 'The line number to start reading from (1-indexed)' },
    limit: { type: 'integer', description: 'The maximum number of lines to read (defaults to 2000)' },
  },
  edit: {
    filePath: { type: 'string', required: true, description: 'The absolute path to the file to modify' },
    oldString: { type: 'string', required: true, description: 'The text to replace' },
    newString: { type: 'string', required: true, description: 'The text to replace it with (must be different from oldString)' },
    replaceAll: { type: 'boolean', description: 'Replace all occurrences of oldString (default false)' },
  },
  write: {
    filePath: { type: 'string', required: true, description: 'The absolute path to the file to write (must be absolute, not relative)' },
    content: { type: 'string', required: true, description: 'The content to write to the file' },
  },
  glob: {
    pattern: { type: 'string', required: true, description: 'The glob pattern to match files against' },
    path: { type: 'string', description: 'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.' },
  },
  grep: {
    pattern: { type: 'string', required: true, description: 'The regex pattern to search for in file contents' },
    path: { type: 'string', description: 'The directory to search in. Defaults to the current working directory.' },
    include: { type: 'string', description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")' },
  },
  skill: {
    name: { type: 'string', required: true, description: 'The name of the skill from available_skills' },
  },
  bash: {
    command: { type: 'string', required: true, description: 'The command to execute' },
  },
  web_search: {
    query: { type: 'string', required: true, description: 'Websearch query' },
    numResults: { type: 'number', description: 'Number of search results to return (default: 8)' },
    livecrawl: {
      type: 'string',
      enum: ['fallback', 'preferred'],
      description: "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
    },
    type: {
      type: 'string',
      enum: ['auto', 'fast', 'deep'],
      description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
    },
    contextMaxCharacters: {
      type: 'number',
      description: 'Maximum characters for context string optimized for LLMs (default: 10000)',
    },
  },
  web_fetch: {
    url: { type: 'string', required: true, description: 'The URL to fetch content from' },
  },
}

/** Argument converters from opencode parameter names to dsh parameter names. */
export function toDshReadArgs(args = {}) {
  const { filePath, offset, limit } = args ?? {}
  return {
    file_path: filePath,
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
  }
}

function directoryEntryLine(entry) {
  const name = String(entry?.name ?? '')
  return entry?.type === 'directory' ? `${name}/` : name
}

/** OpenCode `read` on a directory: one name per line, trailing `/` for dirs. */
export function formatDirectoryListing(listing) {
  const lines = (listing.entries ?? []).map(directoryEntryLine)
  const body = lines.join('\n')
  if (listing.offset === undefined || listing.total === undefined) return body
  const shown = listing.entries?.length ?? 0
  const end = listing.offset + shown - 1
  if (end >= listing.total || shown === 0 && listing.total === 0) return body
  const footer = `(Showing ${listing.offset}-${end} of ${listing.total}. Use offset=${end + 1} to continue.)`
  return body === '' ? footer : `${body}\n${footer}`
}

async function listDirectoryIfNeeded(ctx, converted, exec) {
  const requested = converted?.file_path
  if (typeof requested !== 'string' || requested.trim() === '') return undefined
  const fs = ctx.get('fs')
  if (fs === undefined || typeof fs.listDir !== 'function') return undefined
  const target = await fs.resolve(requested, await workingDirectoryResolveOptions(ctx, exec, requested))
  const info = await fs.stat(target, exec.signal)
  if (info === undefined || info.type !== 'directory') return undefined
  const children = await fs.listDir(target, exec.signal)
  const sorted = [...children].sort((left, right) => String(left.name).localeCompare(String(right.name)))
  const offset = Number.isInteger(converted.offset) && converted.offset >= 1 ? converted.offset : 1
  const limit = Number.isInteger(converted.limit) && converted.limit >= 1 ? converted.limit : DIRECTORY_READ_LIMIT
  const entries = sorted.slice(offset - 1, offset - 1 + limit).map(entry => ({
    name: entry.name,
    type: entry.type,
  }))
  ctx.emit?.('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return {
    kind: 'directory',
    path: target.displayPath,
    offset,
    total: sorted.length,
    entries,
  }
}

export function createReadShim(original, ctx, description, parameters) {
  if (original === undefined) {
    throw new Error('opencode-omo-tool-surface: cannot shim "read" because the original dsh definition is unavailable')
  }
  return defineTool({
    name: 'read',
    description: description ?? original.description,
    parameters: parameters ?? OPENCODE_PARAMS.read,
    output: {
      schema: { type: 'json' },
      render: (args, value) => {
        if (value?.kind === 'directory') {
          return [{ type: 'text', text: formatDirectoryListing(value) }]
        }
        return original.output.render(toDshReadArgs(args), value)
      },
      ...(typeof original.output.presentationMeta === 'function'
        ? {
          presentationMeta: (args, value) => (
            value?.kind === 'directory'
              ? { path: value.path, kind: 'directory', entries: value.entries }
              : original.output.presentationMeta(toDshReadArgs(args), value)
          ),
        }
        : {}),
    },
    ...(typeof original.isConcurrencySafe === 'function'
      ? { isConcurrencySafe: args => original.isConcurrencySafe(toDshReadArgs(args)) }
      : {}),
    ...(typeof original.presentCall === 'function'
      ? { presentCall: args => original.presentCall(toDshReadArgs(args)) }
      : {}),
    ...(typeof original.presentResult === 'function'
      ? {
        presentResult: (args, result) => (
          result?.value?.kind === 'directory' ? undefined : original.presentResult(toDshReadArgs(args), result)
        ),
      }
      : {}),
    execute: async (args, exec) => {
      const converted = toDshReadArgs(args)
      const listing = await listDirectoryIfNeeded(ctx, converted, exec)
      if (listing !== undefined) return listing
      return original.execute(converted, exec)
    },
  })
}

export function toDshEditArgs(args = {}) {
  const { filePath, oldString, newString, replaceAll } = args ?? {}
  return {
    file_path: filePath,
    old_string: oldString,
    new_string: newString,
    ...(replaceAll !== undefined ? { replace_all: replaceAll } : {}),
  }
}

export function toDshWriteArgs(args = {}) {
  const { filePath, content } = args ?? {}
  return {
    file_path: filePath,
    content,
  }
}

/**
 * opencode's websearch takes a single `query` string (plus optional Exa/Parallel
 * knobs). dsh 0.1.1+ takes a required `queries` array and owns result-count /
 * crawl / search-type as deployment config, so those extra fields are accepted
 * then dropped here.
 */
export function toDshWebSearchArgs(args = {}) {
  const { query, queries } = args ?? {}
  if (typeof query === 'string') return { queries: [query] }
  if (Array.isArray(queries)) return { queries }
  return { queries: [] }
}

const SHIM_CONVERTERS = {
  read: toDshReadArgs,
  edit: toDshEditArgs,
  write: toDshWriteArgs,
  web_search: toDshWebSearchArgs,
}

/** Pure surface description/parameter model used by both assembly and tests. */
export function opencodeToolSurface(options = {}) {
  const readImagePresent = options.readImagePresent ?? false
  const year = options.year ?? new Date().getFullYear()
  // The escalating-bash shim owns the execution side; the surface must
  // advertise the same sandbox_permissions contract or the model never sees it.
  const bashEscalation = options.bashEscalation ?? false
  return {
    descriptions: {
      read: readDescriptionFor(readImagePresent),
      edit: EDIT_TXT,
      write: WRITE_TXT,
      glob: GLOB_TXT,
      grep: GREP_TXT,
      todo_write: TODOWRITE_TXT,
      skill: SKILL_TXT,
      web_fetch: WEBFETCH_TXT,
      web_search: WEBSEARCH_TXT.replaceAll('{{year}}', String(year)),
      bash: bashDescription(options) + (bashEscalation ? ESCALATION_GUIDANCE : ''),
    },
    parameters: bashEscalation
      ? { ...OPENCODE_PARAMS, bash: { ...OPENCODE_PARAMS.bash, ...ESCALATION_PARAMETERS } }
      : OPENCODE_PARAMS,
    converters: SHIM_CONVERTERS,
  }
}

/** Replace model-visible descriptions/parameters for every matched tool. */
export function applyOpencodeSurface(tools, options = {}) {
  const readImagePresent = options.readImagePresent
    ?? (Array.isArray(tools) && tools.some(tool => tool?.name === 'read_image'))
  const surface = opencodeToolSurface({ ...options, readImagePresent })
  return tools.map(tool => {
    if (!tool || typeof tool.name !== 'string') return tool
    const description = surface.descriptions[tool.name]
    if (description === undefined) return tool
    const parameters = surface.parameters[tool.name]
    return {
      ...tool,
      description,
      ...(parameters !== undefined
        ? { parameters: parameterSchemaSpecToJsonSchema(parameters) }
        : {}),
    }
  })
}

function createShim(toolName, original, description, parameters) {
  const convert = SHIM_CONVERTERS[toolName]
  if (original === undefined) {
    throw new Error(`opencode-omo-tool-surface: cannot shim "${toolName}" because the original dsh definition is unavailable`)
  }
  return defineTool({
    name: toolName,
    description,
    parameters,
    output: {
      // The shim returns the original definition's value unchanged; the
      // original tool has already produced a canonical value. Accepting any
      // JSON keeps the shim's own output boundary from diverging, while the
      // original render projection below preserves the dsh output text.
      schema: { type: 'json' },
      render: (args, value) => original.output.render(convert(args), value),
      ...(typeof original.output.presentationMeta === 'function'
        ? { presentationMeta: (args, value) => original.output.presentationMeta(convert(args), value) }
        : {}),
    },
    ...(typeof original.isConcurrencySafe === 'function'
      ? { isConcurrencySafe: args => original.isConcurrencySafe(convert(args)) }
      : {}),
    ...(typeof original.presentCall === 'function'
      ? { presentCall: args => original.presentCall(convert(args)) }
      : {}),
    ...(typeof original.presentResult === 'function'
      ? { presentResult: (args, result) => original.presentResult(convert(args), result) }
      : {}),
    execute: (args, exec) => original.execute(convert(args), exec),
  })
}

const shimmedAgents = new WeakSet()

function ensureShimsFor(ctx, agent) {
  if (agent === undefined || agent?.ctx?.tools === undefined) return
  if (shimmedAgents.has(agent)) return
  shimmedAgents.add(agent)

  const readImageOriginal = ctx.tools.get('read_image', agent)
  const readImagePresent = readImageOriginal !== undefined
  if (readImageOriginal !== undefined) {
    agent.ctx.tools.register(createReadImageShim(readImageOriginal, ctx))
  }

  const readOriginal = ctx.tools.get('read', agent)
  if (readOriginal !== undefined) {
    agent.ctx.tools.register(createReadShim(
      readOriginal,
      ctx,
      readDescriptionFor(readImagePresent),
      OPENCODE_PARAMS.read,
    ))
  }

  const editOriginal = ctx.tools.get('edit', agent)
  if (editOriginal !== undefined) {
    agent.ctx.tools.register(createShim('edit', editOriginal, EDIT_TXT, OPENCODE_PARAMS.edit))
  }

  const writeOriginal = ctx.tools.get('write', agent)
  if (writeOriginal !== undefined) {
    agent.ctx.tools.register(createShim('write', writeOriginal, WRITE_TXT, OPENCODE_PARAMS.write))
  }

  const searchOriginal = ctx.tools.get('web_search', agent)
  if (searchOriginal !== undefined) {
    const year = new Date().getFullYear()
    agent.ctx.tools.register(createShim(
      'web_search',
      searchOriginal,
      WEBSEARCH_TXT.replaceAll('{{year}}', String(year)),
      OPENCODE_PARAMS.web_search,
    ))
  }
}

export function apply(ctx) {
  // Composition-level fact: escalation needs a confining shell executor and
  // the sandbox policy service (see escalating-bash.mjs).
  const bashEscalation = escalationAvailableFor(ctx.get('shell'), ctx.get('sandboxPolicy'))

  // Per-agent execution shims: registered in the agent's OWN tool layer so they
  // shadow the preset's inherited read/edit/write/web_search definitions without
  // touching the standing layer (which would reject a same-name insert).
  ctx.on('agent/created', ({ agent }) => {
    ensureShimsFor(ctx, agent)
  })

  // Authoritative model-visible replacement, after the base assembly has run.
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const transformed = await next()
    if (context.agent !== undefined) ensureShimsFor(ctx, context.agent)
    return {
      ...transformed,
      tools: applyOmoLspCatalog(applyOmoDelegationCatalog(
        applyOpencodeSurface(transformed.tools, { bashEscalation }),
        { allowSendMessage: isDelegatedSession(context.agent) },
      )),
    }
  })
}
