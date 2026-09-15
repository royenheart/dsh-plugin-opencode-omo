/**
 * Install/composition contract, checked through the shipped CLI.
 *
 * `python3 install.py install` performs three steps the README documents:
 * symlink the package into the profile's `node_modules`, add the `link:`
 * dependency plus the bundle entry to the profile manifest, and publish the
 * preset as a real directory under `$DSH_HOME/.agent-presets` whose entries are
 * symlinks into the checkout (so shipped updates stay live). The e2e fixture
 * performs the same three steps without running a build; these scenarios assert
 * the resulting layout and that `dsh --profile web --dump-config` composes the
 * plugin's bundle row.
 *
 * These are CLI/file-contract scenarios: no browser page is opened, so the
 * page-level console tripwire does not apply — the CLI exit code and stderr are
 * asserted instead. The browser surfaces of the same install are covered by the
 * other specs.
 */
import { spawnSync } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  expect, test, OMO_PRESET, PACKAGE_ID, PROFILE, REPO_ROOT, resolveDshCommand,
} from '../fixtures/dsh-app.ts'

test.describe('install and composition contract (cli)', () => {
  test('the web profile composes the plugin bundle row without errors', async ({ app }) => {
    const dsh = resolveDshCommand()
    const result = spawnSync(
      dsh.command,
      [...dsh.args, '--profile', PROFILE, '--dump-config'],
      { env: { ...process.env, DSH_HOME: app.home, NO_COLOR: '1' }, encoding: 'utf8', timeout: 120_000 },
    )
    expect(result.status, `dsh --dump-config failed:\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('- id: opencode-omo')
    expect(result.stdout).toContain(`name: '${PACKAGE_ID}'`)
    // The preset roster is a shipped row; the preset itself rides the user root.
    expect(result.stdout).toContain('- id: agent-presets')
  })

  test('the profile manifest links the package and lists it as a bundle', async ({ app }) => {
    const manifest = JSON.parse(
      await readFile(join(app.home, 'profiles', PROFILE, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(manifest.dependencies?.[PACKAGE_ID]).toBe(`link:${REPO_ROOT}`)
    expect(manifest.dsh?.profile?.bundles).toContain(PACKAGE_ID)

    const link = await lstat(join(app.home, 'profiles', PROFILE, 'node_modules', PACKAGE_ID))
    expect(link.isSymbolicLink(), 'package is symlinked into the profile').toBe(true)
  })

  test('the preset is published through the user root as a real directory of symlinks', async ({ app }) => {
    const preset = join(app.home, '.agent-presets', OMO_PRESET)
    const presetDir = await lstat(preset)
    // dsh preset discovery requires `dirent.isDirectory()` and does not follow a
    // symlinked roster row: the id must be a REAL directory.
    expect(presetDir.isSymbolicLink(), 'preset id is not a symlink').toBe(false)
    expect(presetDir.isDirectory()).toBe(true)

    const metadata = await readFile(join(preset, 'preset.yml'), 'utf8')
    expect(metadata).toContain(`name: ${OMO_PRESET}`)
    const entry = await lstat(join(preset, 'agent.cordis.yml'))
    expect(entry.isSymbolicLink(), 'preset entries are symlinks into the checkout').toBe(true)
    expect((await readFile(join(preset, 'agent.cordis.yml'), 'utf8'))).toContain('driver.mjs')
  })
})
