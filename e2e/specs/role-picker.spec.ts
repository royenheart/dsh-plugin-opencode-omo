import { expect, test } from '@playwright/test'
import { attachTripwire, openHarness, openOmoSession } from './helpers'

test('role picker lists primary omo roles and applies the chosen role', async ({ page }) => {
  const errors = attachTripwire(page)

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  await test.step('reach: open a new session in the opencode-omo preset', async () => {
    await openOmoSession(page)
  })

  await test.step('check: the role menu lists exactly the omo primary/all roles and applies a selection', async () => {
    const chip = page.getByRole('button', { name: /^角色：/ })
    await expect(chip).toHaveAttribute('aria-label', '角色：Sisyphus - Ultraworker')

    await chip.click()
    const items = page.getByRole('menuitem')
    await expect(items).toHaveCount(5)
    expect(await items.allInnerTexts()).toEqual([
      'Sisyphus - Ultraworker',
      'Hephaestus - Deep Agent',
      'Prometheus - Plan Builder',
      'Atlas - Plan Executor',
      'Sisyphus-Junior',
    ])
    // Subagent-only roles belong to the delegation tools, not the composer picker.
    for (const subagent of ['oracle', 'librarian', 'explore', 'metis', 'momus', 'multimodal-looker', 'athena']) {
      await expect(page.getByRole('menuitem', { name: subagent, exact: true })).toHaveCount(0)
    }

    await page.getByRole('menuitem', { name: 'Hephaestus - Deep Agent', exact: true }).click()
    await expect(chip).toHaveAttribute('aria-label', '角色：Hephaestus - Deep Agent')
    await expect(chip).toHaveAttribute('title', '深度自治工作者：充分探索后端到端完成复杂实现。')

    await chip.click()
    await page.getByRole('menuitem', { name: 'Sisyphus - Ultraworker', exact: true }).click()
    await expect(chip).toHaveAttribute('aria-label', '角色：Sisyphus - Ultraworker')
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})

test('role picker is hidden outside opencode-omo sessions', async ({ page }) => {
  const errors = attachTripwire(page)

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  await test.step('reach: open a new session in the opencode-omo preset', async () => {
    await openOmoSession(page)
  })

  await test.step('check: the omo role chip is present before changing preset', async () => {
    await expect(page.getByRole('button', { name: /^角色：/ })).toBeVisible()
  })

  await test.step('reach: switch the host preset back to Standard mode', async () => {
    const modeButton = page.getByRole('button', {
      name: /^(Standard mode|PTC mode|Minimal mode|Creator mode|opencode-omo)$/,
    }).first()
    await modeButton.click()
    const standard = page.getByRole('menuitem', { name: /^Standard mode\b/ })
    await expect(standard).toBeVisible()
    await standard.click()
    await expect(page.getByRole('button', { name: 'Standard mode', exact: true })).toBeVisible()
  })

  await test.step('check: the omo role chip is absent in a Standard mode session', async () => {
    await expect(page.getByRole('button', { name: /^角色：/ })).toHaveCount(0)
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})
