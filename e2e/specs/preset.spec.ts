import { expect, test } from '@playwright/test'
import { attachTripwire, openHarness } from './helpers'

test('opencode-omo preset is offered and mounts the composer role picker', async ({ page }) => {
  const errors = attachTripwire(page)

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  await test.step('reach: choose opencode-omo from the host mode menu', async () => {
    const modeButton = page.getByRole('button', {
      name: /^(Standard mode|PTC mode|Minimal mode|Creator mode|opencode-omo)$/,
    }).first()
    await expect(modeButton).toBeVisible()
    await modeButton.click()
    const preset = page.getByRole('menuitem', { name: /^opencode-omo\b/ })
    await expect(preset).toBeVisible()
    await expect(preset).toContainText('复刻 opencode + omo')
    await preset.click()
  })

  await test.step('check: the composer gains the omo role chip for the default Sisyphus role', async () => {
    const chip = page.getByRole('button', { name: /^角色：/ })
    await expect(chip).toBeVisible()
    await expect(chip).toHaveAttribute('aria-label', '角色：Sisyphus - Ultraworker')
    await expect(chip).toHaveAttribute('title', '主编排者：规划、委托、验证、交付，默认执行角色。')
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})
