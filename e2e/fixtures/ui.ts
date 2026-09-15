/**
 * UI helpers shared by the opencode-omo specs.
 *
 * Every helper reaches its state through user-visible chrome (roles, accessible
 * names, visible text) and settles by polling until two consecutive reads
 * agree — never by waiting for network idle, and never by asserting on a single
 * transient DOM sample.
 *
 * Structural traversal (parent/sibling XPath or DOM walks) is used only INSIDE
 * the plugin's own surfaces, where the layout is this repository's contract.
 * Host-owned `data-*` attributes are never used.
 */
import { expect, type Locator, type Page } from '@playwright/test'
import { OMO_PRESET, settleApp, type DshApp } from './dsh-app.ts'

// Re-exported so specs can pull every UI helper from one module.
export { settleApp }

/** The composer's editable input once a workspace is connected. */
export function composerInput(page: Page): Locator {
  return page.getByRole('textbox', { name: /Describe what you want to build/ })
}

/** The locked composer placeholder that opens the workspace picker. */
export function workspacePrompt(page: Page): Locator {
  return page.getByRole('textbox', { name: 'Choose workspace' })
}

/** The hero agent-mode (agent preset) chip. */
export function modeChip(page: Page): Locator {
  return page.getByRole('button', { name: /^(Standard mode|PTC mode|Minimal mode|Creator mode|opencode-omo)$/ })
}

/** The composer's omo role chip (opencode-omo sessions only). */
export function roleChip(page: Page): Locator {
  return page.getByRole('button', { name: /^角色：/ })
}

/** The composer's model control. */
export function modelControl(page: Page): Locator {
  return page.getByRole('button', { name: /^Select model, current / })
}

/**
 * Connect a workspace through the composed directory dialog. Idempotent across
 * the repeated connects a scenario may make.
 * @param page - page under test.
 * @param directory - absolute directory adopted as the workspace.
 */
export async function connectWorkspace(page: Page, directory: string): Promise<void> {
  const prompt = workspacePrompt(page)
  if (await prompt.count() === 0) return
  await prompt.click()
  const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Edit path' }).click()
  const editor = dialog.getByRole('textbox', { name: 'Edit path' })
  await editor.fill(directory)
  await editor.press('Enter')
  const open = dialog.getByRole('button', { name: 'Open', exact: true })
  await expect(open).toBeEnabled({ timeout: 15_000 })
  await open.click()
  await expect(dialog).toBeHidden({ timeout: 20_000 })
  await expect(composerInput(page)).toBeVisible({ timeout: 20_000 })
}

/**
 * Stage an agent preset on the blank session. The hero chip is the only screen
 * where the choice is still switchable; once a session starts the host answers
 * `agent-preset-locked`.
 * @param page - page under test.
 * @param menuName - accessible-name matcher of the menu item.
 * @param chipText - expected chip text once staged (defaults to the menu match source).
 */
export async function stagePreset(page: Page, menuName: RegExp, chipText: string | RegExp): Promise<void> {
  const chip = modeChip(page)
  await expect(chip).toBeVisible({ timeout: 20_000 })
  const current = (await chip.innerText()).trim()
  if (typeof chipText === 'string' ? current === chipText : chipText.test(current)) return
  await chip.click()
  await page.getByRole('menu').getByRole('menuitem', { name: menuName }).click()
  await expect(modeChip(page)).toHaveText(chipText, { timeout: 15_000 })
}

/**
 * {@link stagePreset} for this plugin's preset.
 * @param page - page under test.
 */
export async function stageOmoPreset(page: Page): Promise<void> {
  await stagePreset(page, /^opencode-omo/, OMO_PRESET)
}

/**
 * Reach a blank opencode-omo session deterministically: settle the app, connect
 * the workspace if the composer is still locked, stage the preset, and wait for
 * the omo role chip.
 * @param page - page under test.
 * @param app - booted app (for the workspace directory).
 */
export async function ensureOmoBlankSession(page: Page, app: DshApp): Promise<void> {
  await settleApp(page)
  await connectWorkspace(page, app.workspaceDir)
  await stageOmoPreset(page)
  await expect(roleChip(page)).toBeVisible({ timeout: 20_000 })
}

/**
 * Open the global Settings dialog on the opencode-omo section.
 * @param page - page under test.
 * @returns the Settings dialog locator.
 */
export async function openOmoSettings(page: Page): Promise<Locator> {
  await closeSettings(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('navigation').getByRole('button', { name: OMO_PRESET, exact: true }).click()
  await expect(dialog.getByRole('tablist', { name: 'opencode-omo 设置页' })).toBeVisible({ timeout: 15_000 })
  return dialog
}

/**
 * Close the Settings dialog when it is open.
 * @param page - page under test.
 */
export async function closeSettings(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  if (await dialog.count() === 0) return
  const close = dialog.getByRole('button', { name: 'Close' }).last()
  if (await close.isVisible().catch(() => false)) await close.click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

/**
 * Poll a list of texts until two consecutive reads agree.
 * @param locator - locator whose `allTextContents()` is read.
 * @param message - failure message for the stability poll.
 * @returns the stable list.
 */
export async function stableTexts(locator: Locator, message = 'list did not stabilize'): Promise<string[]> {
  let previous = await locator.allTextContents()
  await expect.poll(async () => {
    const current = await locator.allTextContents()
    const stable = current.length === previous.length && current.every((text, index) => text === previous[index])
    previous = current
    return stable
  }, { timeout: 10_000, message }).toBe(true)
  return previous
}

/**
 * Poll an aria snapshot until two consecutive reads agree.
 * @param locator - region locator.
 * @param message - failure message for the stability poll.
 * @returns the stable snapshot.
 */
export async function stableAria(locator: Locator, message = 'aria snapshot did not stabilize'): Promise<string> {
  let previous = await locator.ariaSnapshot()
  await expect.poll(async () => {
    const current = await locator.ariaSnapshot()
    const stable = current === previous
    previous = current
    return stable
  }, { timeout: 10_000, message }).toBe(true)
  return previous
}

/** A viewport-relative rectangle. */
export interface Box {
  readonly top: number
  readonly left: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

/** One role row's own layout boxes, measured inside the settings dialog. */
export interface RoleLayout {
  /** The circle "+" button that opens the fallback panel. */
  readonly plus: Box
  /** The role's bordered row box (primary picker + "+"). */
  readonly row: Box
  /** The "Fallback 模型" chip container below the row, when chips exist. */
  readonly fallbackList: Box | null
  /** The open model-selection panel below the row. */
  readonly addPanel: Box | null
  /** The nearest scrollable ancestor of the open panel, when one exists. */
  readonly scrollContainer: Box | null
}

/**
 * Measure one role row, its fallback chip list, and its open add panel.
 *
 * Discovery is by the plugin's own accessible names (`添加 <role> fallback 模型`,
 * `选择 <role> 的 fallback 模型`, `Fallback 模型`); the parent/sibling walk only
 * crosses the plugin component's own boxes.
 * @param dialog - the Settings dialog locator.
 * @param roleName - role display name, e.g. `Sisyphus - Ultraworker`.
 * @returns the measured boxes.
 */
export async function measureRoleLayout(dialog: Locator, roleName: string): Promise<RoleLayout> {
  return dialog.evaluate((root, role) => {
    const toBox = (rect: DOMRect) => ({
      top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height,
    })
    const plus = [...root.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === `添加 ${role} fallback 模型`)
    if (plus === undefined) throw new Error(`role row not found for ${role}`)
    const row = plus.parentElement?.parentElement?.parentElement
    if (row === null || row === undefined) throw new Error(`role row box not found for ${role}`)
    const siblingText = (element: Element | null | undefined, text: string): Element | null => {
      if (element === null || element === undefined) return null
      return [...element.querySelectorAll('div')].find(node => node.textContent === text) ?? null
    }
    const fallbackListLabel = siblingText(row.nextElementSibling, 'Fallback 模型')
    const fallbackList = fallbackListLabel?.parentElement ?? null
    const addPanelTitle = [...root.querySelectorAll('span')]
      .find(node => node.textContent === `选择 ${role} 的 fallback 模型`) ?? null
    const addPanel = addPanelTitle?.parentElement?.parentElement ?? null
    let scrollContainer: Element | null = addPanel
    while (scrollContainer !== null) {
      const style = getComputedStyle(scrollContainer)
      if (/(auto|scroll)/.test(style.overflowY) && scrollContainer.scrollHeight > scrollContainer.clientHeight) break
      scrollContainer = scrollContainer.parentElement
    }
    return {
      plus: toBox(plus.getBoundingClientRect()),
      row: toBox(row.getBoundingClientRect()),
      fallbackList: fallbackList === null ? null : toBox(fallbackList.getBoundingClientRect()),
      addPanel: addPanel === null ? null : toBox(addPanel.getBoundingClientRect()),
      scrollContainer: scrollContainer === null ? null : toBox(scrollContainer.getBoundingClientRect()),
    }
  }, roleName)
}

/**
 * The bordered role box for one role.
 *
 * `RoleSettings` renders `row > [title, primaryColumn, fallbackColumn]` and
 * places the chip list / add panel as the row's next siblings, so the "+" button
 * with the role's accessible name is an unambiguous anchor. This traversal
 * stays inside the plugin's own component.
 * @param dialog - the Settings dialog locator.
 * @param roleName - role display name.
 * @returns the row locator.
 */
export function roleRow(dialog: Locator, roleName: string): Locator {
  return dialog
    .getByRole('button', { name: `添加 ${roleName} fallback 模型` })
    .locator('xpath=ancestor::div[3]')
}

/**
 * The fallback chip container that sits directly below one role's row.
 * @param dialog - the Settings dialog locator.
 * @param roleName - role display name.
 * @returns the container locator (empty when the role has no fallbacks).
 */
export function roleFallbackList(dialog: Locator, roleName: string): Locator {
  return roleRow(dialog, roleName).locator('xpath=following-sibling::div[1]')
}

/**
 * The open fallback model picker belonging to one role, found by its own title
 * (`选择 <role> 的 fallback 模型`).
 * @param dialog - the Settings dialog locator.
 * @param roleName - role display name.
 * @returns the panel locator.
 */
export function fallbackPanel(dialog: Locator, roleName: string): Locator {
  return dialog
    .getByText(`选择 ${roleName} 的 fallback 模型`, { exact: true })
    .locator('xpath=ancestor::div[2]')
}

/**
 * Remove every fallback chip of one role and reset its primary model to
 * "跟随当前" through the UI, so a scenario starts from the shipped default.
 * @param dialog - the Settings dialog locator.
 * @param roleName - role display name.
 */
export async function resetRoleConfig(dialog: Locator, roleName: string): Promise<void> {
  const chips = roleFallbackList(dialog, roleName).getByRole('button', { name: /^移除 / })
  let remaining = await chips.count()
  while (remaining > 0) {
    await chips.first().click()
    await expect.poll(async () => await chips.count(), { timeout: 10_000 }).toBeLessThan(remaining)
    remaining = await chips.count()
  }
  const primary = roleRow(dialog, roleName).getByRole('button').first()
  if ((await primary.innerText()).trim() !== '跟随当前') {
    await primary.click()
    await dialog.page().getByRole('menuitem', { name: '跟随当前', exact: true }).click()
    await expect(primary).toHaveText('跟随当前', { timeout: 15_000 })
  }
}
