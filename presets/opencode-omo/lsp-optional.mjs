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
  const realm = ctx.isolate('lsp')
  // The fallback names live in lsp-surface and are useful precisely when the
  // LSP packages are absent; import them independently of the optional trio.
  let surface
  try {
    surface = await import('./lsp-surface.mjs')
  } catch (error) {
    ctx.logger?.warn(`opencode-omo: LSP surface unavailable (${String(error)})`)
    return
  }

  let lsp
  let stdio
  let tool
  try {
    [lsp, stdio, tool] = await Promise.all([
      import('@deepseek-ai/dsh-lsp'),
      import('@deepseek-ai/dsh-lsp-stdio'),
      import('@deepseek-ai/dsh-tool-lsp'),
    ])
  } catch (error) {
    ctx.logger?.warn(`opencode-omo: LSP packages unavailable; registering fallback names only (${String(error)})`)
    try {
      await realm.plugin(surface)
    } catch (mountError) {
      ctx.logger?.warn(`opencode-omo: LSP fallback surface failed (${String(mountError)})`)
    }
    return
  }

  try {
    await realm.plugin(lsp.default ?? lsp)
    const hasServer = spawnSync('typescript-language-server', ['--version'], {
      stdio: 'ignore',
      timeout: 5000,
    }).error === undefined
    if (hasServer) await realm.plugin(stdio, { servers: TS_SERVER })
    else ctx.logger?.warn('opencode-omo: typescript-language-server is not on PATH; LSP tool has no provider')
    await realm.plugin(tool)
    await realm.plugin(surface)
  } catch (error) {
    ctx.logger?.warn(`opencode-omo: LSP mount failed; registering fallback names (${String(error)})`)
    try {
      await realm.plugin(surface)
    } catch (mountError) {
      ctx.logger?.warn(`opencode-omo: LSP fallback surface failed (${String(mountError)})`)
    }
  }
}
