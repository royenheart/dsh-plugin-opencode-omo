import { defineConfig } from '@playwright/test'

/**
 * Playwright + Chromium lane for the opencode-omo web surfaces.
 *
 * One worker: each worker boots a full `dsh web` instance from an isolated
 * `$DSH_HOME` (see `fixtures/dsh-app.ts`), so the lane favors a deterministic
 * single worker. Raise `workers` only when the machine can host several dsh
 * servers at once — every worker owns its own home, workspace, and port.
 *
 * No `webServer` block: the server is started by the fixture because it needs a
 * freshly installed, per-worker profile rather than a shared dev server.
 */
export default defineConfig({
  testDir: './specs',
  // Failure evidence lands in the repo's gitignored artifact area, never in the
  // package's published files.
  outputDir: '../.artifacts/playwright',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI === undefined
    ? [['list']]
    : [['list'], ['html', { open: 'never', outputFolder: '../.artifacts/playwright-report' }]],
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    // English host chrome keeps the harness-owned role locators deterministic;
    // the plugin's own labels stay Chinese and are asserted as shipped.
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium' },
  ],
})
