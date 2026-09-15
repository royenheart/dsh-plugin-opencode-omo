/**
 * Layout invariants for the Role Settings surface — the assertions that do not
 * need a screenshot baseline: boxes that must not overlap, containers that must
 * not clip their content, and the composer-aligned geometry of the "+" control.
 *
 * Every measurement is taken after the panel is open and the role layout helper
 * re-reads the live boxes; nothing is compared against a committed golden.
 */
import { expect, expectCleanConsole, test } from '../fixtures/dsh-app.ts'
import {
  closeSettings, fallbackPanel, measureRoleLayout, openOmoSettings, resetRoleConfig,
} from '../fixtures/ui.ts'

test.describe('Role Settings geometry', () => {
  test('the fallback panel and chip list sit below the role box at its full width', async ({ appPage }) => {
    const { page, tripwire } = appPage
    const dialog = await openOmoSettings(page)
    const role = 'Sisyphus - Ultraworker'
    await resetRoleConfig(dialog, role)

    // One chip makes both stacked containers exist at once.
    await dialog.getByRole('button', { name: `添加 ${role} fallback 模型` }).click()
    const panel = fallbackPanel(dialog, role)
    await panel.getByRole('button', { name: 'DeepSeek-V4-Flash', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '移除 DeepSeek-V4-Flash', exact: true })).toBeVisible()

    const layout = await measureRoleLayout(dialog, role)
    expect(layout.addPanel, 'fallback panel box').not.toBeNull()
    expect(layout.fallbackList, 'fallback chip list box').not.toBeNull()
    const row = layout.row
    const list = layout.fallbackList!
    const addPanel = layout.addPanel!

    // Stacked, not overlapping: list below the row, panel below the list.
    expect(list.top, 'chip list starts below the role box').toBeGreaterThanOrEqual(row.bottom - 1)
    expect(addPanel.top, 'add panel starts below the chip list').toBeGreaterThanOrEqual(list.bottom - 1)
    // Full row width: the containers are the row's continuation, not a popover.
    expect(Math.abs(addPanel.left - row.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(addPanel.right - row.right)).toBeLessThanOrEqual(1)
    expect(Math.abs(list.left - row.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(list.right - row.right)).toBeLessThanOrEqual(1)

    // The chip lives inside the chip list's box (no spill past the row).
    const chip = dialog.getByRole('button', { name: '移除 DeepSeek-V4-Flash', exact: true })
    const chipBox = await chip.boundingBox()
    expect(chipBox).not.toBeNull()
    expect(chipBox!.x).toBeGreaterThanOrEqual(list.left - 1)
    expect(chipBox!.x + chipBox!.width).toBeLessThanOrEqual(list.right + 1)

    // The "+" control keeps the composer attach-button geometry (28px circle).
    const plus = dialog.getByRole('button', { name: `添加 ${role} fallback 模型` })
    const plusBox = await plus.boundingBox()
    expect(plusBox?.width).toBeCloseTo(28, 1)
    expect(plusBox?.height).toBeCloseTo(28, 1)
    const radius = await plus.evaluate(element => getComputedStyle(element).borderRadius)
    expect(radius).toBe('999px')

    await resetRoleConfig(dialog, role)
    expectCleanConsole(tripwire)
  })

  test('the settings surface never overflows horizontally or clips the open panel', async ({ appPage }) => {
    const { page, tripwire } = appPage
    const dialog = await openOmoSettings(page)

    const overflow = await dialog.evaluate(() => ({
      dialogOverflow: document.documentElement.scrollWidth - window.innerWidth,
      surfaceOverflow: (() => {
        const scroller = [...document.querySelectorAll('div')]
          .find(node => {
            const style = getComputedStyle(node)
            return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight
          })
        return scroller === undefined ? 0 : scroller.scrollWidth - scroller.clientWidth
      })(),
    }))
    expect(overflow.dialogOverflow).toBeLessThanOrEqual(1)
    expect(overflow.surfaceOverflow).toBeLessThanOrEqual(1)

    // The last catalog row is the worst case for clipping: opening its panel
    // auto-focuses the search box, which must bring the panel inside the
    // scrollable settings body instead of leaving it sheared off below.
    const role = 'multimodal-looker'
    await dialog.getByRole('button', { name: `添加 ${role} fallback 模型` }).click()
    await expect(fallbackPanel(dialog, role)).toBeVisible()

    const layout = await measureRoleLayout(dialog, role)
    expect(layout.addPanel, 'last role panel box').not.toBeNull()
    const addPanel = layout.addPanel!
    // Not collapsed and not scrolled out of the body: the auto-focused search
    // box must keep the panel's top edge inside the scrollable region.
    expect(addPanel.height).toBeGreaterThan(100)
    if (layout.scrollContainer !== null) {
      const viewport = layout.scrollContainer
      expect(addPanel.top).toBeGreaterThanOrEqual(viewport.top - 1)
      expect(addPanel.top).toBeLessThan(viewport.bottom)
    }
    await fallbackPanel(dialog, role).getByRole('button', { name: '取消', exact: true }).click()
    await closeSettings(page)
    expectCleanConsole(tripwire)
  })
})
