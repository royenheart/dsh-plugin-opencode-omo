import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  addFallbackModel,
  attachTripwire,
  catalogModels,
  chooseModel,
  fallbackModelChoices,
  FOLLOW_SESSION,
  openFallbackPanel,
  openHarness,
  openOmoSettings,
  prepareHarness,
  primaryModelButton,
  readModelMenu,
  removeAllFallbackChips,
  roleContainer,
} from './helpers'

const ROLE = 'Hephaestus - Deep Agent'

/** Choose the first catalog model that exposes adapter reasoning efforts. */
async function pinModelWithEffort(
  page: Page,
  container: Locator,
  primary: Locator,
  models: readonly string[],
): Promise<{ model: string; effort: string }> {
  let model = ''
  for (const candidate of models) {
    await chooseModel(page, primary, candidate)
    await expect(primary).toHaveText(candidate)
    model = candidate
    if ((await container.getByRole('combobox').count()) > 0) break
  }
  expect(model).not.toBe('')

  const effort = container.getByRole('combobox')
  await expect(effort).toBeVisible()
  const options = await effort.locator('option').evaluateAll((elements) =>
    elements.map(element => ({ label: (element.textContent ?? '').trim(), value: (element as HTMLOptionElement).value })))
  expect(options.map(option => option.label)).toContain('默认 effort')
  const nonDefault = options.filter(option => option.value !== '')
  expect(nonDefault.length).toBeGreaterThan(0)
  const chosen = nonDefault[nonDefault.length - 1]!.value

  await effort.selectOption(chosen)
  await expect(effort).toHaveValue(chosen)
  return { model, effort: chosen }
}

test('role settings persist across a full page reload', async ({ page }) => {
  const errors = attachTripwire(page)
  let pinnedModel = ''
  let pinnedEffort = ''
  let fallbackModel = ''

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  let dialog = await test.step('reach: open Settings and select the opencode-omo section', async () => {
    return openOmoSettings(page)
  })

  await test.step('check: pin a model with reasoning effort and add a fallback chip', async () => {
    await removeAllFallbackChips(dialog)
    await expect(dialog.getByRole('button', { name: /^移除 / })).toHaveCount(0)

    const container = roleContainer(dialog, ROLE)
    const primary = primaryModelButton(dialog, ROLE)
    await expect.poll(async () => (await primary.innerText()).trim()).not.toBe('加载中…')
    if ((await primary.innerText()).trim() !== FOLLOW_SESSION) {
      await chooseModel(page, primary, FOLLOW_SESSION)
    }
    await expect(primary).toHaveText(FOLLOW_SESSION)

    const models = catalogModels(await readModelMenu(page, primary))
    expect(models.length).toBeGreaterThan(0)
    // readModelMenu leaves the menu open; close it before the next selection.
    await primary.click()
    await expect(page.getByRole('menuitem')).toHaveCount(0)
    const pinned = await pinModelWithEffort(page, container, primary, models)
    pinnedModel = pinned.model
    pinnedEffort = pinned.effort

    const panel = await openFallbackPanel(dialog, ROLE)
    const offered = await fallbackModelChoices(panel)
    expect(offered.length).toBeGreaterThan(0)
    fallbackModel = offered[0]!
    await addFallbackModel(dialog, ROLE, fallbackModel)
    await panel.getByRole('button', { name: '取消', exact: true }).click()
    await expect(panel).toHaveCount(0)

    await expect(dialog.getByRole('button', { name: `移除 ${fallbackModel}`, exact: true })).toBeVisible()
  })

  await test.step('reach: reload the page and reopen the opencode-omo section', async () => {
    await page.reload()
    await prepareHarness(page)
    dialog = await openOmoSettings(page)
  })

  await test.step('check: the pinned model, effort, and fallback chip survive the reload', async () => {
    const container = roleContainer(dialog, ROLE)
    const primary = primaryModelButton(dialog, ROLE)
    await expect(primary).toHaveText(pinnedModel)

    const effort = container.getByRole('combobox')
    await expect(effort).toBeVisible()
    await expect(effort).toHaveValue(pinnedEffort)

    await expect(dialog.getByRole('button', { name: `移除 ${fallbackModel}`, exact: true })).toBeVisible()
    await expect(container.getByText('Fallback 模型', { exact: true })).toBeVisible()
  })

  await test.step('check: the role resets to follow-current and the chip can be removed', async () => {
    const container = roleContainer(dialog, ROLE)
    const primary = primaryModelButton(dialog, ROLE)
    await chooseModel(page, primary, FOLLOW_SESSION)
    await expect(primary).toHaveText(FOLLOW_SESSION)
    await expect(container.getByRole('combobox')).toHaveCount(0)

    await removeAllFallbackChips(dialog)
    await expect(dialog.getByRole('button', { name: /^移除 / })).toHaveCount(0)
    await expect(container.getByText('Fallback 模型', { exact: true })).toHaveCount(0)
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})
