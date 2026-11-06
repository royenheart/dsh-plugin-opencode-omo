import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/** Launch URL carrying the one-time browser token. Supplied by the runner. */
export const APP_URL = process.env.DSH_MIGRATE_WEB_URL

/** Directory offered to the host's workspace picker when no workspace exists yet. */
export const WORKSPACE_PATH = process.env.GITHUB_WORKSPACE ?? process.cwd()

/** Plugin-rendered heading and intro of the `opencode-omo` settings section. */
export const SETTINGS_HEADING = 'opencode-omo'
export const SETTINGS_INTRO = 'opencode + omo 对齐设置：为每个 omo 角色配置主模型与 fallback 链。'

/** Primary-model menu sentinels (exactly one of the three states is active). */
export const FOLLOW_SESSION = '跟随当前'
export const OMO_DEFAULT = '使用 omo 默认'
export const OMO_DEFAULT_LABEL = /^omo 默认(?: · .+)?$/

/** The fallback panel title for one role, rendered by the plugin. */
export function fallbackPanelTitle(displayName: string): string {
  return `选择 ${displayName} 的 fallback 模型`
}

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
 * Wait for an already-loaded page to reach the usable new-session composer.
 * Also completes the one-time preview notice and, only when the host has no
 * workspace yet, the host's directory picker. This does not navigate, so it
 * can be used after a reload without aborting the boot requests.
 * @param page - browser page under test.
 */
export async function prepareHarness(page: Page): Promise<void> {
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
 * Open the launch URL and leave the host on a usable new-session composer.
 * @param page - browser page under test.
 */
export async function openHarness(page: Page): Promise<void> {
  if (APP_URL === undefined || APP_URL === '') {
    throw new Error('DSH_MIGRATE_WEB_URL is not set')
  }
  await page.goto(APP_URL)
  await prepareHarness(page)
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
 * The role wrapper, which owns both the role box and its fallback list that
 * expands below the box.
 * @param dialog - settings dialog containing the plugin section.
 * @param displayName - omo role display name.
 * @returns the wrapper locator.
 */
export function roleContainer(dialog: Locator, displayName: string): Locator {
  return roleRow(dialog, displayName).locator('xpath=..')
}

/**
 * The "Fallback 模型" list a role owns. It only exists while the role has at
 * least one fallback chip.
 * @param dialog - settings dialog containing the plugin section.
 * @param displayName - omo role display name.
 * @returns the list container locator.
 */
export function fallbackList(dialog: Locator, displayName: string): Locator {
  return roleContainer(dialog, displayName)
    .getByText('Fallback 模型', { exact: true })
    .locator('xpath=..')
}

/**
 * Read the fallback chips in DOM order (their `移除 <model>` accessible names).
 * @param scope - dialog or role container.
 * @returns model labels without the remove prefix.
 */
export async function fallbackChipNames(scope: Locator): Promise<string[]> {
  return scope.getByRole('button', { name: /^移除 / }).evaluateAll(elements =>
    elements.map(element => (element.getAttribute('aria-label') ?? '').replace(/^移除 /, '')))
}

/**
 * Open a role's primary-model menu and read every entry. Waits for the
 * asynchronously loaded catalog, not only the two sentinel rows.
 * @param page - browser page under test.
 * @param primary - the role's primary-model button.
 * @returns trimmed menu entry labels.
 */
export async function readModelMenu(page: Page, primary: Locator): Promise<string[]> {
  await primary.click()
  const items = page.getByRole('menuitem')
  await expect(items.first()).toBeVisible()
  await expect.poll(async () => items.count()).toBeGreaterThan(2)
  return (await items.allInnerTexts()).map(label => label.trim())
}

/**
 * Open a role's primary-model menu and choose one entry.
 * @param page - browser page under test.
 * @param primary - the role's primary-model button.
 * @param label - exact menu entry label.
 */
export async function chooseModel(page: Page, primary: Locator, label: string): Promise<void> {
  await primary.click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}

/**
 * The non-sentinel model labels offered by an open primary-model menu.
 * @param menu - labels read from the menu.
 * @returns catalog model labels.
 */
export function catalogModels(menu: readonly string[]): string[] {
  return menu.filter(label => label !== FOLLOW_SESSION && label !== OMO_DEFAULT)
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
  return dialog.getByText(fallbackPanelTitle(displayName), { exact: true }).locator('xpath=../..')
}

/**
 * The plugin-rendered model buttons offered by an open fallback panel.
 * @param panel - the open fallback panel.
 * @returns model labels (the 取消 action is excluded).
 */
export async function fallbackModelChoices(panel: Locator): Promise<string[]> {
  return (await panel.getByRole('button').allInnerTexts())
    .map(label => label.trim())
    .filter(label => label !== '' && label !== '取消')
}

/**
 * Make sure one role's fallback panel is open (opening it only when closed, so
 * the "+" toggle is not accidentally used to close it).
 * @param dialog - settings dialog containing the plugin section.
 * @param displayName - omo role display name.
 * @returns the visible panel locator.
 */
export async function openFallbackPanel(dialog: Locator, displayName: string): Promise<Locator> {
  const panel = fallbackPanel(dialog, displayName)
  if (!(await panel.isVisible().catch(() => false))) {
    await addFallbackButton(dialog, displayName).click()
  }
  await expect(panel).toBeVisible()
  return panel
}

/**
 * Add one model to a role's fallback chain, keeping the panel open for more.
 * @param dialog - settings dialog containing the plugin section.
 * @param displayName - omo role display name.
 * @param label - exact offered model label.
 */
export async function addFallbackModel(dialog: Locator, displayName: string, label: string): Promise<void> {
  const panel = await openFallbackPanel(dialog, displayName)
  await panel.getByRole('button', { name: label, exact: true }).click()
  await expect(roleContainer(dialog, displayName)
    .getByRole('button', { name: `移除 ${label}`, exact: true })).toBeVisible()
}

/**
 * Remove every fallback chip currently rendered (state cleanup between specs).
 * @param dialog - settings dialog containing the plugin section.
 */
export async function removeAllFallbackChips(dialog: Locator): Promise<void> {
  const chips = dialog.getByRole('button', { name: /^移除 / })
  for (let guard = 0; guard < 20; guard += 1) {
    const before = await chips.count()
    if (before === 0) return
    await waitForStable(async () => String(await chips.count()))
    await expect(chips.first()).toBeEnabled()
    await chips.first().click()
    // Two roles may hold a chip with the same model label; only the clicked
    // chip must disappear.
    await expect.poll(async () => chips.count()).toBe(before - 1)
  }
}
