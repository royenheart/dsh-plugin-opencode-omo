import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/** Launch URL carrying the one-time browser token. Supplied by the runner. */
export const APP_URL = process.env.DSH_MIGRATE_WEB_URL

/** Directory offered to the host's workspace picker when no workspace exists yet. */
export const WORKSPACE_PATH = process.env.GITHUB_WORKSPACE ?? process.cwd()

const MODE_BUTTON = /^(Standard mode|PTC mode|Minimal mode|Creator mode|opencode-omo)$/

/**
 * Register the console + pageerror tripwire. The returned list is asserted in
 * each spec's final `check:` step.
 * @param page - browser page under test.
 * @returns collected error descriptions.
 */
export function attachTripwire(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`)
  })
  return errors
}

/**
 * Read repeatedly until two consecutive reads agree. Used instead of waiting
 * for network idle while the host boots and while plugin panels settle.
 * @param read - reader producing a comparable string.
 * @returns the last stable value.
 */
export async function waitForStable(read: () => Promise<string>): Promise<string> {
  let previous = await read()
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    const next = await read()
    if (next === previous) return next
    previous = next
  }
  return previous
}

/**
 * Open the launch URL and leave the host on a usable new-session composer.
 * Also completes the one-time preview notice and, only when the host has no
 * workspace yet, the host's directory picker.
 * @param page - browser page under test.
 */
export async function openHarness(page: Page): Promise<void> {
  if (APP_URL === undefined || APP_URL === '') {
    throw new Error('DSH_MIGRATE_WEB_URL is not set')
  }
  await page.goto(APP_URL)
  await expect(page.getByRole('button', { name: 'New session' }).first()).toBeVisible()
  await waitForStable(() => page.locator('body').innerText())

  const preview = page.getByRole('dialog').filter({ hasText: 'Preview Notice' })
  if (await preview.isVisible().catch(() => false)) {
    await preview.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(preview).toHaveCount(0)
  }

  const needsWorkspace = await page
    .getByText('Choose a workspace to start', { exact: true })
    .isVisible()
    .catch(() => false)
  if (needsWorkspace) {
    await page.getByRole('button', { name: 'Choose workspace', exact: true }).first().click()
    const picker = page.getByRole('dialog').filter({ hasText: 'Select Workspace Directory' })
    await expect(picker).toBeVisible()
    await picker.getByRole('button', { name: 'Edit path' }).click()
    const pathInput = picker.locator('input').first()
    await pathInput.fill(WORKSPACE_PATH)
    await pathInput.press('Enter')
    await expect(picker.getByRole('button', { name: 'Open', exact: true })).toBeEnabled()
    await picker.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(picker).toHaveCount(0)
  }

  await expect(page.getByRole('textbox', { name: /Describe what you want to build/ }).first()).toBeVisible()
  await waitForStable(() => page.locator('body').innerText())
}

/**
 * Put the current new session into the `opencode-omo` preset. Idempotent: if
 * the composer already shows the omo role chip it does nothing.
 * @param page - browser page under test.
 */
export async function openOmoSession(page: Page): Promise<void> {
  const selected = page.getByRole('button', { name: 'opencode-omo', exact: true })
  if (await selected.isVisible().catch(() => false)) return

  const modeButton = page.getByRole('button', { name: MODE_BUTTON }).first()
  await expect(modeButton).toBeVisible()
  await modeButton.click()
  const preset = page.getByRole('menuitem', { name: /^opencode-omo\b/ })
  await expect(preset).toBeVisible()
  await preset.click()
  await expect(selected).toBeVisible()
  await waitForStable(() => page.locator('body').innerText())
}

/**
 * Open the host settings dialog and select the plugin's `opencode-omo`
 * section. The dialog and its navigation are host UI (reach); the returned
 * dialog is the scope for plugin-rendered assertions.
 * @param page - browser page under test.
 * @returns the settings dialog locator.
 */
export async function openOmoSettings(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Account menu' }).click()
  const settingsItem = page.getByRole('menuitem', { name: 'Settings', exact: true })
  await expect(settingsItem).toBeVisible()
  await settingsItem.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'opencode-omo', exact: true }).click()
  await waitForStable(() => dialog.innerText())
  return dialog
}

/**
 * Locate one plugin-rendered role box by its display name.
 * @param dialog - settings dialog containing the plugin section.
 * @param displayName - omo role display name.
 * @returns the role box.
 */
export function roleRow(dialog: Locator, displayName: string): Locator {
  return dialog.getByText(displayName, { exact: true }).first().locator('xpath=../..')
}

/**
 * The primary-model button of a role box (the button before the fallback "+").
 * @param dialog - settings dialog containing the plugin section.
 * @param displayName - omo role display name.
 * @returns the primary model menu trigger.
 */
export function primaryModelButton(dialog: Locator, displayName: string): Locator {
  return roleRow(dialog, displayName).getByRole('button').first()
}

/**
 * The circle "+" button that opens a role's fallback model panel.
 * @param dialog - settings dialog containing the plugin section.
 * @param displayName - omo role display name.
 * @returns the add-fallback button.
 */
export function addFallbackButton(dialog: Locator, displayName: string): Locator {
  return dialog.getByRole('button', { name: `添加 ${displayName} fallback 模型`, exact: true })
}

/**
 * The plugin-rendered fallback panel that expands below a role box.
 * @param dialog - settings dialog containing the plugin section.
 * @param displayName - omo role display name.
 * @returns the panel locator.
 */
export function fallbackPanel(dialog: Locator, displayName: string): Locator {
  return dialog.getByText(`选择 ${displayName} 的 fallback 模型`, { exact: true }).locator('xpath=../..')
}

/**
 * Remove every fallback chip currently rendered (state cleanup between specs).
 * @param dialog - settings dialog containing the plugin section.
 */
export async function removeAllFallbackChips(dialog: Locator): Promise<void> {
  const chips = dialog.getByRole('button', { name: /^移除 / })
  for (let guard = 0; guard < 20 && (await chips.count()) > 0; guard += 1) {
    await waitForStable(async () => String(await chips.count()))
    const label = await chips.first().getAttribute('aria-label')
    await chips.first().click()
    if (label !== null) {
      await expect(dialog.getByRole('button', { name: label, exact: true })).toHaveCount(0)
    }
  }
}
