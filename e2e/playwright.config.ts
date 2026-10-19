import { defineConfig, devices } from '@playwright/test'

/**
 * The suite opens the launch URL handed over in DSH_MIGRATE_WEB_URL. It never
 * starts dsh itself: the same suite is run against other dsh releases whose
 * `dsh web` process is already serving these plugins.
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
})
