// opencode-omo LSP surface: model-visible omo names over dsh's single `lsp`
// tool / ctx.lsp.query. Same pattern as web_search.query → dsh queries.
//
// dsh already ships LSP (dsh-lsp + dsh-tool-lsp + this preset's typescript
// stdio row). It exposes four read-only operations and deliberately omits
// diagnostics, rename, and symbols. This module:
//   - hides the dsh name `lsp`
//   - registers the omo names family prompts already call
//   - maps navigation names onto ctx.lsp.query
//   - returns a fallback for capabilities dsh does not implement

import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'opencode-omo-lsp-surface'
export const inject = ['tools']

export const HIDDEN_DSH_LSP_TOOLS = Object.freeze(['lsp'])

const HIDDEN = new Set(HIDDEN_DSH_LSP_TOOLS)

const NAVIGATION = {
  lsp_goto_definition: 'goToDefinition',
  lsp_find_references: 'findReferences',
  lsp_go_to_implementation: 'goToImplementation',
  lsp_hover: 'hover',
}

export const FALLBACK_LSP_TOOLS = Object.freeze([
  'lsp_diagnostics',
  'lsp_rename',
  'lsp_prepare_rename',
  'lsp_symbols',
  'lsp_status',
])

export function applyOmoLspCatalog(tools) {
  if (!Array.isArray(tools)) return tools
  return tools.filter(tool => tool && typeof tool.name === 'string' && !HIDDEN.has(tool.name))
}

/** Rewrite dsh `tool:lsp` section copy into the omo collection names. */
export function rewriteLspPromptSection(text) {
  return String(text ?? '')
    .replaceAll('Use lsp when', 'Use lsp_goto_definition / lsp_find_references / lsp_hover when')
    .replaceAll(
      'Use search/read for ordinary navigation. Use lsp ',
      'Use grep/read for ordinary navigation. Use lsp_goto_definition / lsp_find_references / lsp_hover ',
    )
}

function filePathFrom(args = {}) {
  if (typeof args.filePath === 'string' && args.filePath.length > 0) return args.filePath
  if (typeof args.file_path === 'string' && args.file_path.length > 0) return args.file_path
  return undefined
}

function positionFrom(args = {}) {
  const line = Number(args.line)
  const character = Number(args.character)
  if (!Number.isInteger(line) || line < 1) {
    throw new Error('line must be a 1-based integer')
  }
  if (!Number.isInteger(character) || character < 1) {
    throw new Error('character must be a 1-based integer')
  }
  return { line: line - 1, character: character - 1 }
}

function optionalLsp(ctx) {
  try {
    return ctx.get('lsp')
  } catch {
    return undefined
  }
}

async function resolveWorkspaceRoot(ctx, exec) {
  try {
    const service = ctx.get?.('workingDirectory')
    if (service?.ensure !== undefined && exec.agent !== undefined) {
      const cwd = await service.ensure(exec.agent, exec.signal)
      if (typeof cwd === 'string' && cwd !== '') return cwd
    }
  } catch {
    // Fall back to the session header.
  }
  return sessionCwd(exec)
}

function sessionCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

const FILE_PARAMETERS = {
  filePath: { type: 'string', description: 'Source file (omo name).' },
  file_path: { type: 'string', description: 'Alias of filePath.' },
}

const CURSOR_PARAMETERS = {
  ...FILE_PARAMETERS,
  line: { type: 'number', required: true, description: 'One-based line of the cursor.' },
  character: { type: 'number', required: true, description: 'One-based UTF-16 column of the cursor.' },
}

function fallbackText(toolName) {
  switch (toolName) {
    case 'lsp_diagnostics':
      return (
        'This harness has no LSP diagnostics. Run the project typechecker via bash '
        + '(tsc --noEmit, cargo check, go test, and so on) on the files you changed. '
        + 'Navigation is available as lsp_goto_definition / lsp_find_references / lsp_hover.'
      )
    case 'lsp_rename':
    case 'lsp_prepare_rename':
      return (
        'This harness has no LSP rename. Find every site with lsp_find_references, '
        + 'then apply the rename with edit.'
      )
    case 'lsp_symbols':
      return (
        'This harness has no LSP symbol index. Use grep / glob, or lsp_goto_definition '
        + 'and lsp_find_references at a known cursor.'
      )
    case 'lsp_status':
      return (
        'This harness has no lsp_status. A failed lsp_goto_definition / lsp_find_references '
        + 'call with LSP_UNAVAILABLE means no language server is configured for that file. '
        + 'This preset preconfigures typescript-language-server when it is on PATH.'
      )
    default:
      return `This harness does not implement ${toolName}.`
  }
}

async function executeNavigation(ctx, operation, args, exec) {
  const lsp = optionalLsp(ctx)
  if (lsp === undefined) {
    throw new Error(`${operation} requires the dsh lsp service`)
  }
  const filePath = filePathFrom(args)
  if (filePath === undefined) throw new Error('filePath is required')
  const workspaceRoot = await resolveWorkspaceRoot(ctx, exec)
  if (workspaceRoot === undefined) {
    throw new Error('lsp tools require a session workspace cwd')
  }
  return lsp.query({
    operation,
    filePath,
    position: positionFrom(args),
    workspaceRoot,
  }, exec.signal)
}

export function apply(ctx) {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const transformed = await next()
    const sections = Array.isArray(transformed.sections)
      ? transformed.sections.map((section) => {
        if (section?.name !== 'tool:lsp') return section
        return { ...section, text: rewriteLspPromptSection(section.text) }
      })
      : transformed.sections
    return { ...transformed, sections, tools: applyOmoLspCatalog(transformed.tools) }
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    if (HIDDEN.has(exec.name)) {
      return {
        kind: 'deny',
        reason:
          'opencode-omo: "lsp" is the hidden dsh name. '
          + 'Use lsp_goto_definition, lsp_find_references, lsp_hover, '
          + 'or lsp_diagnostics (typechecker via bash on this harness).',
      }
    }
    return next()
  })

  for (const [toolName, operation] of Object.entries(NAVIGATION)) {
    ctx.tools.register(defineTool({
      name: toolName,
      description:
        `Language-server ${operation}. filePath + 1-based line/character. `
        + 'Use grep for ordinary search; use this when the cursor position is known.',
      parameters: CURSOR_PARAMETERS,
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: (args, exec) => executeNavigation(ctx, operation, args, exec),
    }))
  }

  for (const toolName of FALLBACK_LSP_TOOLS) {
    ctx.tools.register(defineTool({
      name: toolName,
      description: fallbackText(toolName),
      parameters: FILE_PARAMETERS,
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { text: { type: 'string', required: true } },
        },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: () => ({ text: fallbackText(toolName) }),
    }))
  }
}
