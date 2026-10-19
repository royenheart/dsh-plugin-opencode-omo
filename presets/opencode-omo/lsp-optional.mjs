// Optional LSP surface for the opencode-omo preset.
//
// The LSP seam (`dsh-lsp` + `dsh-lsp-stdio` + `dsh-tool-lsp`) is not part of
// the base bundle. A preset row naming a missing package fails the whole mode,
// so this module loads the trio dynamically: an npm-only install without them
// still mounts with LSP absent (the documented graceful-degradation path),
// while a checkout/global install that provides them gets the omo `lsp_*`
// surface inside its own isolate realm.
import { spawnSync } from 'node:child_process'

export const name = 'opencode-omo-lsp-optional'

const TS_SERVER = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensionToLanguage: {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
    },
  },
}

export async function apply(ctx) {
  let lsp
  let stdio
  let tool
  let surface
  try {
    [lsp, stdio, tool, surface] = await Promise.all([
      import('@deepseek-ai/dsh-lsp'),
      import('@deepseek-ai/dsh-lsp-stdio'),
      import('@deepseek-ai/dsh-tool-lsp'),
      import('./lsp-surface.mjs'),
    ])
  } catch (error) {
    ctx.logger?.warn(`opencode-omo: LSP packages unavailable; continuing without LSP (${String(error)})`)
    return
  }

  const realm = ctx.isolate('lsp')
  await realm.plugin(lsp.default ?? lsp)
  const hasServer = spawnSync('typescript-language-server', ['--version'], {
    stdio: 'ignore',
    timeout: 5000,
  }).error === undefined
  if (hasServer) await realm.plugin(stdio, { servers: TS_SERVER })
  else ctx.logger?.warn('opencode-omo: typescript-language-server is not on PATH; LSP tool has no provider')
  await realm.plugin(tool)
  await realm.plugin(surface)
}
