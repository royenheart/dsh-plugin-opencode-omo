/**
 * The global "opencode-omo" settings section and its nested "角色设置" tab slot.
 *
 * The section is global chrome (not per-session), so every scenario opens it
 * through Settings and asserts on roles/labels: the nav entry, the heading and
 * intro, the tablist, and the per-role catalog rows (display name, description,
 * omo default chain, "主模型" column, and the fallback "+" control).
 */
import { expect, expectCleanConsole, test } from '../fixtures/dsh-app.ts'
import { closeSettings, openOmoSettings, roleRow, stableAria } from '../fixtures/ui.ts'

/** Every role in the shipped catalog, in roster order. */
const ROLE_NAMES = [
  'Sisyphus - Ultraworker',
  'Hephaestus - Deep Agent',
  'Prometheus - Plan Builder',
  'Atlas - Plan Executor',
  'Sisyphus-Junior',
  'Athena - Council',
  'Athena-Junior - Council',
  'council-member',
  'Metis - Plan Consultant',
  'Momus - Plan Critic',
  'oracle',
  'librarian',
  'explore',
  'multimodal-looker',
] as const

test.describe('opencode-omo settings section', () => {
  test('registers a settings nav section with a nested tab', async ({ appPage }) => {
    const { page, tripwire } = appPage
    await closeSettings(page)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })

    const navEntry = dialog.getByRole('navigation').getByRole('button', { name: 'opencode-omo', exact: true })
    await expect(navEntry).toBeVisible({ timeout: 15_000 })
    await navEntry.click()

    await expect(dialog.getByRole('heading', { level: 2, name: 'opencode-omo' })).toBeVisible()
    await expect(dialog.getByText(/opencode \+ omo 对齐设置/)).toBeVisible()

    // The section owns one child tab seat (`opencode-omo.settings.tab`), rendered
    // through the same list-slot mechanism the Plugins section uses.
    const tablist = dialog.getByRole('tablist', { name: 'opencode-omo 设置页' })
    await expect(tablist).toBeVisible()
    const tab = tablist.getByRole('tab', { name: '角色设置' })
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect(tablist.getByRole('tab')).toHaveCount(1)

    // Snapshot stability instead of a single transient sample.
    const aria = await stableAria(dialog, 'settings section aria did not stabilize')
    expect(aria).toContain('角色设置')
    expectCleanConsole(tripwire)
  })

  test('lists the whole role catalog with descriptions and omo default chains', async ({ appPage }) => {
    const { page, tripwire } = appPage
    const dialog = await openOmoSettings(page)

    for (const role of ROLE_NAMES) {
      await expect(dialog.getByText(role, { exact: true }).first(), `role row ${role}`).toBeVisible()
    }
    // Each row owns a centered "主模型" label and one fallback "+" affordance.
    await expect(dialog.getByText('主模型', { exact: true })).toHaveCount(ROLE_NAMES.length)
    await expect(dialog.getByText(/omo 默认链：/)).toHaveCount(ROLE_NAMES.length)
    await expect(dialog.getByRole('button', { name: /^添加 .+ fallback 模型$/ })).toHaveCount(ROLE_NAMES.length)

    // Spot-check copy from both halves of the catalog plus a shipped default chain.
    await expect(dialog.getByText('主编排者：规划、委托、验证、交付，默认执行角色。', { exact: true })).toBeVisible()
    await expect(dialog.getByText('只读战略技术顾问：架构、自审与疑难调试。', { exact: true })).toBeVisible()
    await expect(dialog.getByText(/omo 默认链：claude-opus-4-7 \/ kimi-k3/).first()).toBeVisible()

    // A subagent-only role is configurable here even though the composer chip
    // hides it: its "+" control is per-row and must still exist.
    await expect(roleRow(dialog, 'multimodal-looker')).toBeAttached()
    expectCleanConsole(tripwire)
  })
})
