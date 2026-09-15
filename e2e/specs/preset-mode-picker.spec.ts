/**
 * The shipped `opencode-omo` agent preset as the browser sees it: the hero mode
 * picker entry, the preset roster health page, and the isolation rule that other
 * presets keep their default composer chrome.
 *
 * Determinism: the hero chip is read after the app chrome settles; the menu is a
 * role-based locator; no network-idle wait is used anywhere.
 */
import { expect, expectCleanConsole, OMO_PRESET, test } from '../fixtures/dsh-app.ts'
import {
  closeSettings, ensureOmoBlankSession, modeChip, roleChip, stagePreset, stableAria,
} from '../fixtures/ui.ts'

test.describe('opencode-omo preset surfaces', () => {
  test('the mode picker names the preset, describes it, and stages it', async ({ appPage }) => {
    const { page, tripwire } = appPage
    const chip = modeChip(page)
    await expect(chip).toBeVisible({ timeout: 20_000 })

    await chip.click()
    const menu = page.getByRole('menu')
    const item = menu.getByRole('menuitem', { name: /^opencode-omo/ })
    await expect(item).toBeVisible({ timeout: 10_000 })
    // The description is part of the item's accessible name, so a preset that
    // loses its roster metadata fails here rather than rendering a bare id.
    await expect(item).toContainText('复刻 opencode + omo')
    await expect(item).toContainText('输入框角色选择')

    await item.click()
    await expect(modeChip(page)).toHaveText(OMO_PRESET, { timeout: 15_000 })
    expectCleanConsole(tripwire)
  })

  test('the Agent presets settings page reports the custom preset as loadable', async ({ appPage }) => {
    const { page, tripwire } = appPage
    await closeSettings(page)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('navigation').getByRole('button', { name: 'Agent presets', exact: true }).click()

    // A preset whose rows cannot resolve renders "Failed to load" instead of a
    // usable card; the LSP rows are the usual cause, so this is the tripwire
    // for a broken install (see fixtures/dsh-app.ts install contract).
    await expect(dialog.getByText(OMO_PRESET, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByText(/复刻 opencode \+ omo/)).toBeVisible()
    await expect(dialog.getByText('Failed to load')).toHaveCount(0)
    // Two consecutive agreeing reads before trusting the roster sample.
    const roster = await stableAria(dialog, 'preset roster did not stabilize')
    expect(roster).toContain('opencode-omo')

    expectCleanConsole(tripwire)
  })

  test('other presets keep the default composer chrome (no omo role chip)', async ({ app, appPage }) => {
    const { page, tripwire } = appPage
    await ensureOmoBlankSession(page, app)
    await expect(roleChip(page)).toBeVisible()

    await stagePreset(page, /^Standard mode/, 'Standard mode')
    await expect(roleChip(page)).toHaveCount(0)

    // Restore the mode so the worker's shared home is left in the omo state the
    // other scenarios assume.
    await stagePreset(page, /^opencode-omo/, OMO_PRESET)
    await expect(roleChip(page)).toBeVisible({ timeout: 20_000 })
    expectCleanConsole(tripwire)
  })
})
