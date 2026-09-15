/**
 * Per-role primary model and fallback chain configuration.
 *
 * The README contract this pins:
 * - primary model: one dropdown under a centered "主模型" label whose first
 *   entry is "跟随当前" (follow the session's current model);
 * - fallback models: NO dropdown — a circle "+" opens a model list BELOW the
 *   role box, clicking a model appends one fallback and keeps the list open for
 *   repeated additions, duplicate picks are refused, and cancel/close/outside
 *   adds nothing;
 * - every accepted change persists immediately in the `opencode-omo-roles`
 *   settings namespace.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator } from '@playwright/test'
import { expect, expectCleanConsole, test, type DshApp } from '../fixtures/dsh-app.ts'
import {
  fallbackPanel, openOmoSettings, resetRoleConfig, roleFallbackList, roleRow, settleApp,
} from '../fixtures/ui.ts'

/** Catalog order the primary-model menu renders after "跟随当前". */
const MODELS = [
  'DeepSeek-V41-Flash',
  'DeepSeek-V4-Flash',
  'DeepSeek-V4-Pro',
  'DeepSeek-V4-Flash-Vision-Exp',
] as const

/** The remove-chip controls a role currently owns. */
function chips(dialog: Locator, role: string): Locator {
  return roleFallbackList(dialog, role).getByRole('button', { name: /^移除 / })
}

/** Read the running app's settings document. */
function readSettingsDocument(app: DshApp): Promise<string> {
  return readFile(join(app.home, 'settings.yaml'), 'utf8')
}

test.describe('role model settings', () => {
  test('the primary model dropdown follows the session or pins a catalog model', async ({ appPage }) => {
    const { page, tripwire } = appPage
    let dialog = await openOmoSettings(page)
    await resetRoleConfig(dialog, 'Sisyphus - Ultraworker')

    const primary = roleRow(dialog, 'Sisyphus - Ultraworker').getByRole('button').first()
    await expect(primary).toHaveText('跟随当前')
    await primary.click()
    const menu = page.getByRole('menu')
    const entries = menu.getByRole('menuitem')
    await expect(entries).toHaveCount(MODELS.length + 1)
    expect((await entries.allTextContents()).map(text => text.trim())).toEqual(['跟随当前', ...MODELS])

    await menu.getByRole('menuitem', { name: 'DeepSeek-V4-Pro', exact: true }).click()
    await expect(primary).toHaveText('DeepSeek-V4-Pro', { timeout: 15_000 })

    // Reload from the host: the pinned model is durable, not component state.
    await page.reload()
    await settleApp(page)
    dialog = await openOmoSettings(page)
    await expect(roleRow(dialog, 'Sisyphus - Ultraworker').getByRole('button').first())
      .toHaveText('DeepSeek-V4-Pro', { timeout: 20_000 })

    await resetRoleConfig(dialog, 'Sisyphus - Ultraworker')
    await expect(roleRow(dialog, 'Sisyphus - Ultraworker').getByRole('button').first()).toHaveText('跟随当前')
    expectCleanConsole(tripwire)
  })

  test('fallback models are added from the "+" panel, repeatedly, and survive a reload', async ({ appPage }) => {
    const { page, tripwire } = appPage
    let dialog = await openOmoSettings(page)
    const role = 'Hephaestus - Deep Agent'
    await resetRoleConfig(dialog, role)

    const plus = dialog.getByRole('button', { name: `添加 ${role} fallback 模型` })
    await expect(plus).toHaveAttribute('aria-expanded', 'false')
    await plus.click()
    await expect(plus).toHaveAttribute('aria-expanded', 'true')

    const panel = fallbackPanel(dialog, role)
    await expect(panel).toBeVisible()
    await expect(panel.getByText(`选择 ${role} 的 fallback 模型`)).toBeVisible()

    // Search narrows the list (case-insensitive over label and model id).
    const search = panel.getByPlaceholder('搜索模型…')
    await search.fill('Pro')
    await expect(panel.getByRole('button', { name: 'DeepSeek-V4-Pro', exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'DeepSeek-V4-Flash', exact: true })).toHaveCount(0)
    await search.fill('')

    await panel.getByRole('button', { name: 'DeepSeek-V4-Flash', exact: true }).click()
    await expect(chips(dialog, role)).toHaveCount(1, { timeout: 15_000 })
    // The panel stays open so multiple fallbacks can be appended in one pass.
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: 'DeepSeek-V4-Pro', exact: true }).click()
    await expect(chips(dialog, role)).toHaveCount(2, { timeout: 15_000 })

    // A duplicate is refused with an inline reason, not silently ignored.
    await panel.getByRole('button', { name: 'DeepSeek-V4-Flash', exact: true }).click()
    await expect(panel.getByText('该模型已在 fallback 列表中')).toBeVisible({ timeout: 15_000 })
    await expect(chips(dialog, role)).toHaveCount(2)

    await panel.getByRole('button', { name: '取消', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(chips(dialog, role)).toHaveCount(2)

    // Durability: reopen the settings surface after a full reload.
    await page.reload()
    await settleApp(page)
    dialog = await openOmoSettings(page)
    await expect(chips(dialog, role)).toHaveCount(2, { timeout: 20_000 })

    // Removal is immediate and durable too.
    for (const model of ['DeepSeek-V4-Flash', 'DeepSeek-V4-Pro']) {
      await dialog.getByRole('button', { name: `移除 ${model}`, exact: true }).click()
      await expect(dialog.getByRole('button', { name: `移除 ${model}`, exact: true }))
        .toHaveCount(0, { timeout: 15_000 })
    }
    await page.reload()
    await settleApp(page)
    dialog = await openOmoSettings(page)
    await expect(chips(dialog, role)).toHaveCount(0, { timeout: 20_000 })
    expectCleanConsole(tripwire)
  })

  test('cancel, Escape and an outside click add nothing', async ({ appPage }) => {
    const { page, tripwire } = appPage
    let dialog = await openOmoSettings(page)
    const role = 'Prometheus - Plan Builder'
    await resetRoleConfig(dialog, role)

    // Cancel.
    await dialog.getByRole('button', { name: `添加 ${role} fallback 模型` }).click()
    await fallbackPanel(dialog, role).getByRole('button', { name: '取消', exact: true }).click()
    await expect(fallbackPanel(dialog, role)).toHaveCount(0)
    await expect(chips(dialog, role)).toHaveCount(0)

    // Escape (the settings shell may close with the panel — either way nothing
    // may be persisted).
    await dialog.getByRole('button', { name: `添加 ${role} fallback 模型` }).click()
    await page.keyboard.press('Escape')
    await expect(fallbackPanel(dialog, role)).toHaveCount(0)

    // Outside click: navigating the settings nav away from the page closes the
    // panel without a pick.
    if (await dialog.count() === 0) dialog = await openOmoSettings(page)
    await dialog.getByRole('button', { name: `添加 ${role} fallback 模型` }).click()
    await expect(fallbackPanel(dialog, role)).toBeVisible()
    await dialog.getByRole('navigation').getByRole('button', { name: 'General', exact: true }).click()
    await expect(fallbackPanel(dialog, role)).toHaveCount(0)

    dialog = await openOmoSettings(page)
    await expect(chips(dialog, role)).toHaveCount(0)
    expectCleanConsole(tripwire)
  })

  test('accepted changes land in the opencode-omo-roles settings document', async ({ app, appPage }) => {
    const { page, tripwire } = appPage
    let dialog = await openOmoSettings(page)
    const role = 'Metis - Plan Consultant'
    await resetRoleConfig(dialog, role)

    await dialog.getByRole('button', { name: `添加 ${role} fallback 模型` }).click()
    const panel = fallbackPanel(dialog, role)
    await panel.getByRole('button', { name: 'DeepSeek-V4-Flash-Vision-Exp', exact: true }).click()
    await expect(chips(dialog, role)).toHaveCount(1, { timeout: 15_000 })
    await panel.getByRole('button', { name: '取消', exact: true }).click()

    // Read the host's settings document directly: the namespace name and the
    // role-keyed fallback entry are the documented persistence contract.
    await expect.poll(async () => await readSettingsDocument(app), { timeout: 15_000 })
      .toMatch(/opencode-omo-roles:[\s\S]*metis:[\s\S]*fallbackModels:\s*\n\s*-/)

    await resetRoleConfig(dialog, role)
    await expect(chips(dialog, role)).toHaveCount(0)
    await expect.poll(async () => await readSettingsDocument(app), { timeout: 15_000 })
      .toMatch(/opencode-omo-roles:[\s\S]*metis:[\s\S]*fallbackModels:\s*\[\]/)
    expectCleanConsole(tripwire)
  })
})
