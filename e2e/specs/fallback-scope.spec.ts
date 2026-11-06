import { expect, test } from '@playwright/test'
import {
  addFallbackButton,
  addFallbackModel,
  attachTripwire,
  fallbackChipNames,
  fallbackList,
  fallbackModelChoices,
  openFallbackPanel,
  openHarness,
  openOmoSettings,
  removeAllFallbackChips,
  roleContainer,
} from './helpers'

const ROLE = 'Sisyphus - Ultraworker'
const OTHER_ROLE = 'Hephaestus - Deep Agent'

test('fallback chains stay scoped to their role, keep insertion order, and remove one chip at a time', async ({ page }) => {
  const errors = attachTripwire(page)
  let firstModel = ''
  let secondModel = ''
  let otherModel = ''

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  const dialog = await test.step('reach: open Settings and select the opencode-omo section', async () => {
    return openOmoSettings(page)
  })

  await test.step('check: a cleaned role shows no fallback chips or fallback list', async () => {
    await removeAllFallbackChips(dialog)
    await expect(dialog.getByRole('button', { name: /^移除 / })).toHaveCount(0)
    await expect(fallbackList(dialog, ROLE)).toHaveCount(0)
    await expect(fallbackList(dialog, OTHER_ROLE)).toHaveCount(0)
  })

  await test.step('check: two additions to one role keep their order and leave the other role alone', async () => {
    const plus = addFallbackButton(dialog, ROLE)
    await expect(plus).toHaveAttribute('aria-expanded', 'false')
    const panel = await openFallbackPanel(dialog, ROLE)
    await expect(plus).toHaveAttribute('aria-expanded', 'true')

    const offered = await fallbackModelChoices(panel)
    expect(offered.length).toBeGreaterThan(1)
    firstModel = offered[0]!
    secondModel = offered[1]!

    await addFallbackModel(dialog, ROLE, firstModel)
    await addFallbackModel(dialog, ROLE, secondModel)

    // The panel stays open for repeatable additions while chips accumulate in
    // the list below the role box.
    await expect(panel).toBeVisible()
    await expect(roleContainer(dialog, ROLE).getByRole('button', { name: /^移除 / })).toHaveCount(2)
    expect(await fallbackChipNames(dialog)).toEqual([firstModel, secondModel])
    await expect(fallbackList(dialog, ROLE)).toBeVisible()
    await expect(fallbackList(dialog, OTHER_ROLE)).toHaveCount(0)
    await expect(roleContainer(dialog, OTHER_ROLE).getByRole('button', { name: /^移除 / })).toHaveCount(0)
  })

  await test.step('check: a different role gets its own single-chip chain', async () => {
    const panel = await openFallbackPanel(dialog, OTHER_ROLE)
    const offered = await fallbackModelChoices(panel)
    expect(offered.length).toBeGreaterThan(0)
    otherModel = offered[0]!

    await addFallbackModel(dialog, OTHER_ROLE, otherModel)
    expect(await fallbackChipNames(dialog)).toEqual([firstModel, secondModel, otherModel])
    await expect(fallbackList(dialog, ROLE)).toBeVisible()
    await expect(fallbackList(dialog, OTHER_ROLE)).toBeVisible()

    await panel.getByRole('button', { name: '取消', exact: true }).click()
    await expect(panel).toHaveCount(0)
  })

  await test.step('check: removing one chip keeps the remaining chips of both roles', async () => {
    const chip = roleContainer(dialog, ROLE).getByRole('button', { name: `移除 ${firstModel}`, exact: true })
    await expect(chip).toBeEnabled()
    await chip.click()

    await expect(roleContainer(dialog, ROLE).getByRole('button', { name: /^移除 / })).toHaveCount(1)
    expect(await fallbackChipNames(dialog)).toEqual([secondModel, otherModel])
    await expect(fallbackList(dialog, ROLE)).toBeVisible()
    await expect(fallbackList(dialog, OTHER_ROLE)).toBeVisible()
  })

  await test.step('check: removing the last chips drops both fallback lists', async () => {
    await removeAllFallbackChips(dialog)
    await expect(dialog.getByRole('button', { name: /^移除 / })).toHaveCount(0)
    await expect(fallbackList(dialog, ROLE)).toHaveCount(0)
    await expect(fallbackList(dialog, OTHER_ROLE)).toHaveCount(0)
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})
