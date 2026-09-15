/**
 * The composer's omo role picker (`conversation.input.left`).
 *
 * Covered end to end: the chip's accessible name carries the current role; the
 * menu lists exactly the primary roles; choosing one persists per session
 * through the `opencode-omo-roles` settings namespace; and a role with a pinned
 * primary model drives the session's model selection through the host RPC.
 *
 * The handoff to the actual per-role system prompt / fallback chain needs a
 * model turn and is listed as `unknown` in the ledger (see
 * `agent-runtime-surfaces.spec.ts`).
 */
import { expect, expectCleanConsole, test } from '../fixtures/dsh-app.ts'
import {
  closeSettings, ensureOmoBlankSession, modelControl, openOmoSettings, resetRoleConfig,
  roleChip, roleRow, settleApp, stableTexts,
} from '../fixtures/ui.ts'

/** Roles the picker offers: catalog entries whose mode is not `subagent`. */
const PRIMARY_ROLES = [
  'Sisyphus - Ultraworker',
  'Hephaestus - Deep Agent',
  'Prometheus - Plan Builder',
  'Atlas - Plan Executor',
  'Sisyphus-Junior',
] as const

test.describe('omo role picker', () => {
  test('names the default role and lists every primary role', async ({ app, appPage }) => {
    const { page, tripwire } = appPage
    await ensureOmoBlankSession(page, app)

    const chip = roleChip(page)
    await expect(chip).toHaveAttribute('aria-label', '角色：Sisyphus - Ultraworker')
    await expect(chip).toBeEnabled()

    await chip.click()
    const items = page.getByRole('menu').getByRole('menuitem')
    await expect(items).toHaveCount(PRIMARY_ROLES.length)
    // Two consecutive agreeing reads: the menu is animated, so a single sample
    // could catch a half-populated list.
    const labels = await stableTexts(items, 'role menu did not stabilize')
    expect(labels.map(text => text.trim())).toEqual([...PRIMARY_ROLES])

    await page.keyboard.press('Escape')
    expectCleanConsole(tripwire)
  })

  test('switching the role updates the chip and survives a reload', async ({ app, appPage }) => {
    const { page, tripwire } = appPage
    await ensureOmoBlankSession(page, app)

    const chip = roleChip(page)
    await chip.click()
    await page.getByRole('menuitem', { name: 'Prometheus - Plan Builder', exact: true }).click()
    await expect(chip).toHaveAttribute('aria-label', '角色：Prometheus - Plan Builder', { timeout: 15_000 })

    await page.reload()
    await settleApp(page)
    // The blank session and its role are restored from the host's settings
    // document, so the assertion is about durability, not in-memory state.
    await expect(roleChip(page)).toHaveAttribute('aria-label', '角色：Prometheus - Plan Builder', { timeout: 20_000 })

    // Leave the default role staged for later scenarios in this worker.
    await roleChip(page).click()
    await page.getByRole('menuitem', { name: 'Sisyphus - Ultraworker', exact: true }).click()
    await expect(roleChip(page)).toHaveAttribute('aria-label', '角色：Sisyphus - Ultraworker', { timeout: 15_000 })
    expectCleanConsole(tripwire)
  })

  test('a pinned role primary model reaches the composer model control', async ({ app, appPage }) => {
    const { page, tripwire } = appPage
    await ensureOmoBlankSession(page, app)

    let dialog = await openOmoSettings(page)
    await resetRoleConfig(dialog, 'Sisyphus - Ultraworker')
    const primary = roleRow(dialog, 'Sisyphus - Ultraworker').getByRole('button').first()
    await primary.click()
    await page.getByRole('menuitem', { name: 'DeepSeek-V4-Pro', exact: true }).click()
    await expect(primary).toHaveText('DeepSeek-V4-Pro', { timeout: 15_000 })
    await closeSettings(page)

    // Select a different role first: re-picking the current role is a no-op by
    // design, so the model RPC only fires on an actual switch.
    const chip = roleChip(page)
    await chip.click()
    await page.getByRole('menuitem', { name: 'Hephaestus - Deep Agent', exact: true }).click()
    await expect(chip).toHaveAttribute('aria-label', '角色：Hephaestus - Deep Agent', { timeout: 15_000 })
    await chip.click()
    await page.getByRole('menuitem', { name: 'Sisyphus - Ultraworker', exact: true }).click()

    await expect(modelControl(page)).toHaveAttribute('aria-label', /current DeepSeek-V4-Pro/, { timeout: 20_000 })

    // Restore the shipped default so the shared worker home stays clean.
    dialog = await openOmoSettings(page)
    await resetRoleConfig(dialog, 'Sisyphus - Ultraworker')
    await closeSettings(page)
    expectCleanConsole(tripwire)
  })
})
