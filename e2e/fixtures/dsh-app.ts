/**
 * Playwright fixture that boots a real `dsh web` instance for this plugin.
 *
 * The suite is deliberately an OUT-OF-PROCESS end-to-end lane: it installs the
 * built package into an isolated `$DSH_HOME`, starts the shipped `dsh web`
 * binary, drives the real browser UI over real HTTP, and asserts on roles,
 * accessible names, text, and geometry only — never on the host's internal
 * `data-*` attributes, which drift between harness versions.
 *
 * Install contract (mirrors `install.py`, minus its build step):
 *   1. symlink the package into `$DSH_HOME/profiles/<profile>/node_modules/`
 *   2. add the `link:` dependency and the bundle entry to the profile manifest
 *   3. publish the preset as a REAL directory `$DSH_HOME/.agent-presets/opencode-omo`
 *      with symlinked entries
 *   4. link the optional LSP packages into the shared profile module tree the
 *      preset rows resolve against
 *
 * The fixture never writes into the plugin checkout: the only mutated roots are
 * the isolated temp `$DSH_HOME` and its sibling workspace directory. Run
 * `npm run build` first — the lane refuses to test a stale/missing `lib/`.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test as base, type Browser, type Page } from '@playwright/test'

export { expect }

/** Repository root (the plugin package checkout). */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** Package id used by the profile manifest and node_modules link. */
export const PACKAGE_ID = '@royenheart/dsh-plugin-opencode-omo'

/** The agent preset / mode this plugin ships. */
export const OMO_PRESET = 'opencode-omo'

/** Profile the lane installs into and boots. */
export const PROFILE = 'web'

/** Harness packages the preset's LSP rows resolve; missing ones fail the preset. */
const LSP_PACKAGES = ['dsh-lsp', 'dsh-lsp-stdio', 'dsh-tool-lsp'] as const

/** Browser locale used by every page so host chrome copy stays deterministic. */
export const BROWSER_LOCALE = 'en-US'

/** The workspace folder name created under the temp workspace host. */
export const WORKSPACE_NAME = 'workspace'

/** A booted dsh web app plus the isolated roots it owns. */
export interface DshApp {
  /** Isolated `$DSH_HOME` (settings, sessions, published presets). */
  readonly home: string
  /** Parent directory of the connected workspace folder. */
  readonly workspaceHost: string
  /** Directory connected as the session workspace. */
  readonly workspaceDir: string
  /** Loopback origin, no token. */
  readonly baseUrl: string
  /** Launch token printed by `dsh web`. */
  readonly token: string
  /** `baseUrl` plus the launch token — the URL a user pastes into a browser. */
  readonly authenticatedUrl: string
}

/** Live console/pageerror/HTTP tripwire collectors for one page. */
export interface ConsoleTripwire {
  /** Uncaught page errors (`pageerror`). */
  readonly pageErrors: string[]
  /** `console.error` texts (resource-load failures are checked via `badResponses`). */
  readonly consoleErrors: string[]
  /** `"<status> <method> <pathname>"` for every response >= 400. */
  readonly badResponses: string[]
  /** Connection-loss / gap-repair warnings — a dead wire must not pass silently. */
  readonly connectionWarnings: string[]
}

/** One authenticated page plus its tripwire. */
export interface AppPage {
  readonly page: Page
  readonly tripwire: ConsoleTripwire
}

const RESOURCE_LOAD_FAILURE = /^Failed to load resource:/
const CONNECTION_WARNING = /connection lost|gap repair|discontinuous/i

/**
 * Responses the lane tolerates, with the reason they cannot fail a scenario.
 *
 * `POST /opencode-omo/*` is the plugin's documented authenticated RPC channel.
 * On dsh 0.1.6-alpha.1 the channel is never mounted: `connection.rpc.handle()`
 * reads `owner.webServer` and the plugin's calling context does not inject
 * `webServer`, so cordis throws `cannot get property "webServer" without
 * inject` and the request falls through to the SPA fallback, which answers 405
 * to non-GET. Loopback browsers use the settings scope instead and degrade
 * gracefully, so every UI scenario still passes; the channel itself is pinned
 * by `specs/settings-rpc-fallback.spec.ts` (expected-failure).
 */
const KNOWN_BENIGN_RESPONSES: readonly RegExp[] = [/^405 POST \/opencode-omo\//]

/**
 * Attach the console/pageerror/HTTP tripwire collectors.
 * @param page - the page to watch.
 * @returns live collectors asserted by {@link expectCleanConsole}.
 */
export function watchConsole(page: Page): ConsoleTripwire {
  const tripwire: {
    pageErrors: string[]
    consoleErrors: string[]
    badResponses: string[]
    connectionWarnings: string[]
  } = { pageErrors: [], consoleErrors: [], badResponses: [], connectionWarnings: [] }
  page.on('pageerror', (error) => { tripwire.pageErrors.push(String(error)) })
  page.on('console', (message) => {
    const text = message.text()
    if (CONNECTION_WARNING.test(text)) tripwire.connectionWarnings.push(text)
    if (message.type() === 'error') tripwire.consoleErrors.push(text)
  })
  page.on('response', (response) => {
    if (response.status() < 400) return
    const pathname = new URL(response.url()).pathname
    tripwire.badResponses.push(`${response.status()} ${response.request().method()} ${pathname}`)
  })
  return tripwire
}

/**
 * Assert the page produced no unexpected errors.
 *
 * Resource-load console errors are folded into `badResponses` so their URL is
 * visible in the failure; every other console error is fatal. The one allowed
 * response is documented on {@link KNOWN_BENIGN_RESPONSES}.
 * @param tripwire - collectors from {@link watchConsole}.
 * @param extraAllowedResponses - scenario-specific response allowlist entries.
 */
export function expectCleanConsole(
  tripwire: ConsoleTripwire,
  extraAllowedResponses: readonly RegExp[] = [],
): void {
  const allowed = [...KNOWN_BENIGN_RESPONSES, ...extraAllowedResponses]
  const unexpectedResponses = tripwire.badResponses
    .filter(entry => !allowed.some(pattern => pattern.test(entry)))
  const unexpectedConsole = tripwire.consoleErrors
    .filter(text => !RESOURCE_LOAD_FAILURE.test(text))
  expect(tripwire.pageErrors, 'uncaught page errors').toEqual([])
  expect(unexpectedResponses, 'unexpected HTTP error responses').toEqual([])
  expect(unexpectedConsole, 'unexpected console errors').toEqual([])
  expect(tripwire.connectionWarnings, 'connection-loss warnings').toEqual([])
}

/** How the dsh binary is reached: an explicit path, the local bin, or PATH. */
export interface DshCommand {
  readonly command: string
  readonly args: readonly string[]
}

/**
 * Resolve the dsh CLI for the harness version under test.
 * @returns the executable plus any wrapper arguments.
 */
export function resolveDshCommand(): DshCommand {
  const explicit = process.env.DSH_E2E_DSH_BIN
  if (explicit !== undefined && explicit !== '') return { command: explicit, args: [] }
  const local = join(REPO_ROOT, 'node_modules', '.bin', 'dsh')
  if (existsSync(local)) return { command: local, args: [] }
  return { command: 'dsh', args: [] }
}

/**
 * Locate the optional LSP packages the preset's rows resolve.
 * @returns the directory whose `@deepseek-ai/` scope holds them.
 */
function resolveLspSource(): string {
  const explicit = process.env.DSH_E2E_LSP_ROOT
  if (explicit !== undefined && explicit !== '') return explicit
  return join(REPO_ROOT, 'node_modules')
}

/** The harness release this lane was authored against. */
const TARGET_DSH_VERSION = '0.1.6-alpha.1'

/**
 * Warn (never fail) when the booted dsh is not the version the ledger was
 * recorded for: a newer harness may legitimately change roles or labels, and a
 * warning keeps that visible instead of silently mistaking drift for a defect.
 * @param dsh - resolved CLI.
 */
function warnOnUnexpectedHarnessVersion(dsh: DshCommand): void {
  const probe = spawnSync(dsh.command, [...dsh.args, '--version'], { encoding: 'utf8', timeout: 60_000 })
  const version = probe.stdout.trim()
  if (probe.status === 0 && version !== TARGET_DSH_VERSION) {
    process.stderr.write(
      `e2e: warning — booting dsh ${version}, but this lane's ledger was recorded for ${TARGET_DSH_VERSION}\n`,
    )
  }
}

async function ensureSymlink(link: string, target: string): Promise<void> {
  await mkdir(join(link, '..'), { recursive: true })
  try {
    await symlink(target, link, 'dir')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Install the built package into an isolated `$DSH_HOME` (no build, no writes
 * into the checkout). Throws actionably when `lib/` or the LSP packages are
 * missing instead of letting the mode silently disappear from the picker.
 * @param home - isolated `$DSH_HOME` to populate.
 */
export async function installPluginIntoHome(home: string): Promise<void> {
  for (const artifact of ['index.js', 'client.js']) {
    if (!existsSync(join(REPO_ROOT, 'lib', artifact))) {
      throw new Error(
        `e2e: lib/${artifact} is missing — run \`npm run build\` (or \`python3 install.py install\`) before the e2e lane`,
      )
    }
  }

  const profileDir = join(home, 'profiles', PROFILE)
  await mkdir(join(profileDir, 'node_modules', '@royenheart'), { recursive: true })
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${PROFILE}`,
    private: true,
    type: 'module',
    dependencies: { [PACKAGE_ID]: `link:${REPO_ROOT}` },
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', PACKAGE_ID],
        patchReload: 'live',
      },
    },
  }, null, 2)}\n`)
  await ensureSymlink(join(profileDir, 'node_modules', PACKAGE_ID), REPO_ROOT)

  // dsh's user preset root: the id must be a REAL directory (discovery checks
  // `dirent.isDirectory()` and does not follow a symlinked roster row) whose
  // entries are symlinks, so shipped preset updates stay live.
  const presetRoot = join(home, '.agent-presets', OMO_PRESET)
  await mkdir(presetRoot, { recursive: true })
  const shippedPreset = join(REPO_ROOT, 'presets', OMO_PRESET)
  for (const entry of await readdir(shippedPreset)) {
    await ensureSymlink(join(presetRoot, entry), join(shippedPreset, entry))
  }

  // The preset's LSP rows (`@deepseek-ai/dsh-lsp`, `dsh-lsp-stdio`,
  // `dsh-tool-lsp`) resolve against the shared profile module tree; without
  // them the roster reports "Failed to load" and the mode never reaches the
  // picker. install.py links these from a source checkout; the e2e lane links
  // them from this repo's devDependencies (or DSH_E2E_LSP_ROOT).
  const source = resolveLspSource()
  const scope = join(home, 'profiles', 'node_modules', '@deepseek-ai')
  await mkdir(scope, { recursive: true })
  for (const name of LSP_PACKAGES) {
    const target = join(source, '@deepseek-ai', name)
    if (!existsSync(target)) {
      throw new Error(
        `e2e: ${target} is missing — install @deepseek-ai/${name}@0.1.6-alpha.1 as an e2e devDependency `
        + 'or point DSH_E2E_LSP_ROOT at a node_modules tree that carries it',
      )
    }
    await ensureSymlink(join(scope, name), target)
  }
}

/** Booted server handle. */
interface RunningServer {
  readonly url: string
  readonly token: string
  stop(): Promise<void>
}

/**
 * Start `dsh web` on an OS-assigned loopback port and wait for its URL line.
 * @param options - isolated home, workspace cwd, and the CLI to run.
 * @returns the parsed launch URL and a stop handle.
 */
async function startDshWeb(options: {
  home: string
  cwd: string
  dsh: DshCommand
}): Promise<RunningServer> {
  const child: ChildProcess = spawn(
    options.dsh.command,
    [...options.dsh.args, 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'],
    {
      cwd: options.cwd,
      env: {
        ...process.env,
        DSH_HOME: options.home,
        NO_COLOR: '1',
        // The lane is keyless: no provider credential is forwarded, so no test
        // can accidentally spend a model call.
        DEEPSEEK_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let output = ''
  let settled = false
  const url = await new Promise<string>((resolveUrl, rejectUrl) => {
    const timer = setTimeout(() => {
      rejectUrl(new Error(`dsh web did not print a URL within 90s\n${output}`))
    }, 90_000)
    const onData = (chunk: Buffer): void => {
      output += chunk.toString()
      const match = output.match(/dsh web: (http:\/\/\S+)/)
      if (match === null || settled) return
      settled = true
      clearTimeout(timer)
      resolveUrl(match[1]!)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', (code) => {
      if (settled) return
      clearTimeout(timer)
      rejectUrl(new Error(`dsh web exited with code ${String(code)} before printing a URL\n${output}`))
    })
    child.once('error', (error) => {
      if (settled) return
      clearTimeout(timer)
      rejectUrl(new Error(`dsh web could not start: ${String(error)}\n${output}`))
    })
  })

  const parsed = new URL(url)
  const origin = parsed.origin
  return {
    url: origin,
    token: parsed.searchParams.get('token') ?? '',
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return
      const exited = new Promise<void>((resolveExit) => { child.once('exit', () => { resolveExit() }) })
      child.kill('SIGTERM')
      const forced = setTimeout(() => { child.kill('SIGKILL') }, 10_000)
      await exited
      clearTimeout(forced)
    },
  }
}

/** The fixture's worker-scoped page factory plus booted app. */
export const test = base.extend<{ appPage: AppPage }, { app: DshApp }>({
  app: [async ({}, use, workerInfo) => {
    const home = await mkdtemp(join(tmpdir(), `dsh-omo-e2e-${workerInfo.parallelIndex}-`))
    const workspaceHost = await mkdtemp(join(tmpdir(), 'dsh-omo-ws-'))
    const workspaceDir = join(workspaceHost, WORKSPACE_NAME)
    await mkdir(workspaceDir, { recursive: true })

    let server: RunningServer | undefined
    try {
      const dsh = resolveDshCommand()
      warnOnUnexpectedHarnessVersion(dsh)
      await installPluginIntoHome(home)
      server = await startDshWeb({ home, cwd: workspaceHost, dsh })
      await use({
        home,
        workspaceHost,
        workspaceDir,
        baseUrl: server.url,
        token: server.token,
        authenticatedUrl: server.token === '' ? server.url : `${server.url}/?token=${encodeURIComponent(server.token)}`,
      })
    } finally {
      await server?.stop()
      await rm(home, { recursive: true, force: true })
      await rm(workspaceHost, { recursive: true, force: true })
    }
  }, { scope: 'worker', timeout: 240_000 }],

  appPage: async ({ app, browser }, use, testInfo) => {
    const page = await openAuthenticatedPage(browser, app, testInfo.title)
    const tripwire = watchConsole(page)
    await use({ page, tripwire })
    await page.context().close()
  },
})

/**
 * Open one authenticated page and settle the app chrome.
 * @param browser - Playwright browser fixture.
 * @param app - booted app.
 * @param label - scenario label used for failure screenshots.
 * @returns the settled page.
 */
async function openAuthenticatedPage(browser: Browser, app: DshApp, label: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: BROWSER_LOCALE,
  })
  const page = await context.newPage()
  try {
    await page.goto(app.authenticatedUrl)
    await settleApp(page)
  } catch (error) {
    await context.close()
    throw new Error(`e2e: ${label} could not open an authenticated page: ${String(error)}`)
  }
  return page
}

/**
 * Wait until the app chrome is interactive: the onboarding dialogs answered and
 * the sidebar Settings button visible. Bounded — never a network-idle wait.
 * @param page - page under test.
 */
export async function settleApp(page: Page): Promise<void> {
  await dismissOnboarding(page)
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible({ timeout: 30_000 })
}

/**
 * Answer the first-run dialogs (internal notice, API-key onboarding) with
 * "Configure later" so the lane stays keyless and deterministic.
 * @param page - page under test.
 */
export async function dismissOnboarding(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const notice = page.getByRole('button', { name: 'Continue', exact: true })
    if (await notice.isVisible().catch(() => false)) {
      await notice.click()
      await page.waitForTimeout(300)
      continue
    }
    const configureLater = page.getByRole('button', { name: 'Configure later', exact: true })
    if (await configureLater.isVisible().catch(() => false)) {
      await configureLater.click()
      await page.waitForTimeout(300)
      continue
    }
    const dialog = page.getByRole('dialog')
    if (await dialog.count() === 0) return
    // An unknown dialog would otherwise wedge every scenario; name it loudly.
    if (await dialog.first().getByRole('button', { name: 'Close', exact: true }).isVisible().catch(() => false)) {
      await dialog.first().getByRole('button', { name: 'Close', exact: true }).click()
      await page.waitForTimeout(300)
      continue
    }
    return
  }
}
