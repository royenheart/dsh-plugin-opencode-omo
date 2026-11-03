import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  addFallbackButton,
  attachTripwire,
  fallbackPanel,
  openHarness,
  openOmoSettings,
  primaryModelButton,
  removeAllFallbackChips,
  roleRow,
} from './helpers'

const ROLES = [
  {
    name: 'Sisyphus - Ultraworker',
    description: '主编排者：规划、委托、验证、交付，默认执行角色。',
    hint: 'claude-opus-4-7 / kimi-k3 / kimi-k2.6 / gpt-5.5 / glm-5',
  },
  {
    name: 'Hephaestus - Deep Agent',
    description: '深度自治工作者：充分探索后端到端完成复杂实现。',
    hint: 'gpt-5.6-sol / gpt-5.5',
  },
  {
    name: 'Prometheus - Plan Builder',
    description: '规划顾问：只调研并产出 `.omo/` 下的计划产物，不实施。',
    hint: 'claude-opus-4-7 / gpt-5.5 / glm-5.2 / gemini-3.1-pro',
  },
  {
    name: 'Atlas - Plan Executor',
    description: '总执行编排者：按计划委托任务、验证并自动继续直到完成。',
    hint: 'claude-sonnet-4-6 / kimi-k2.6 / gpt-5.5 / minimax-m3',
  },
  {
    name: 'Sisyphus-Junior',
    description: '轻量 Sisyphus：领域任务 worker。',
    hint: 'claude-sonnet-4-6 / kimi-k2.6 / gpt-5.5 / minimax-m3',
  },
  {
    name: 'Athena - Council',
    description: '委员会评审：多视角评审与决策。',
    hint: 'claude-opus-4-7 / gpt-5.5',
  },
  {
    name: 'Athena-Junior - Council',
    description: '轻量委员会成员。',
    hint: 'claude-sonnet-4-6 / gpt-5.5',
  },
  {
    name: 'council-member',
    description: '通用委员会成员。',
    hint: 'claude-sonnet-4-6 / gpt-5.5',
  },
  {
    name: 'Metis - Plan Consultant',
    description: '规划前咨询：识别隐藏意图、歧义与未声明需求。',
    hint: 'claude-sonnet-4-6 / claude-opus-4-7 / gpt-5.5 / glm-5.2',
  },
  {
    name: 'Momus - Plan Critic',
    description: '计划评审：验证可执行性与引用有效性。',
    hint: 'gpt-5.6-terra / gpt-5.5 / claude-opus-4-7 / gemini-3.1-pro',
  },
  {
    name: 'oracle',
    description: '只读战略技术顾问：架构、自审与疑难调试。',
    hint: 'gpt-5.5 / gemini-3.1-pro / claude-opus-4-7 / glm-5.2',
  },
  {
    name: 'librarian',
    description: '外部文档与开源代码检索。',
    hint: 'gpt-5.4-mini-fast / qwen3.5-plus / minimax-m3 / haiku-4-5',
  },
  {
    name: 'explore',
    description: '代码库搜索专家。',
    hint: 'gpt-5.4-mini-fast / qwen3.5-plus / minimax-m3 / haiku-4-5',
  },
  {
    name: 'multimodal-looker',
    description: '媒体分析：PDF、图片与图表解读。',
    hint: 'gpt-5.5 / kimi-k2.6 / glm-4.6v / gpt-5-nano',
  },
] as const

const FOLLOW_SESSION = '跟随当前'
const OMO_DEFAULT = '使用 omo 默认'
const OMO_DEFAULT_LABEL = /^omo 默认(?: · .+)?$/
const SETTINGS_HEADING = 'opencode-omo'
const SETTINGS_INTRO = 'opencode + omo 对齐设置：为每个 omo 角色配置主模型与 fallback 链。'

/** Open a role's primary-model menu and read its entries. */
async function readModelMenu(page: Page, primary: Locator): Promise<string[]> {
  await primary.click()
  const items = page.getByRole('menuitem')
  await expect(items.first()).toBeVisible()
  // Wait for the asynchronously loaded catalog, not only the two sentinels.
  await expect.poll(async () => items.count()).toBeGreaterThan(2)
  return (await items.allInnerTexts()).map(label => label.trim())
}

/** Open a role's primary-model menu and choose one entry. */
async function chooseModel(page: Page, primary: Locator, label: string): Promise<void> {
  await primary.click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}

/** The non-sentinel model labels offered by an open primary-model menu. */
function catalogModels(menu: readonly string[]): string[] {
  return menu.filter(label => label !== FOLLOW_SESSION && label !== OMO_DEFAULT)
}

test('role settings page lists the complete omo role catalog', async ({ page }) => {
  const errors = attachTripwire(page)

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  const dialog = await test.step('reach: open Settings and select the opencode-omo section', async () => {
    return openOmoSettings(page)
  })

  await test.step('check: the plugin page renders its heading, intro, tab and all 14 role boxes', async () => {
    await expect(dialog.getByRole('heading', { name: SETTINGS_HEADING, exact: true })).toBeVisible()
    await expect(dialog.getByText(SETTINGS_INTRO, { exact: true })).toBeVisible()
    await expect(dialog.getByText(
      '为每个 omo 角色配置主模型与 fallback 模型。主模型可选择“跟随当前”、使用 omo 默认或固定模型；点击 ＋ 在角色框下方选择 fallback，可连续添加多个，点击取消或空白处关闭不会添加。',
      { exact: true },
    )).toBeVisible()

    await expect(dialog.getByRole('tablist', { name: 'opencode-omo 设置页', exact: true })).toBeVisible()
    const tab = dialog.getByRole('tab', { name: '角色设置', exact: true })
    await expect(tab).toBeVisible()
    await expect(tab).toHaveAttribute('aria-selected', 'true')

    for (const role of ROLES) {
      const row = roleRow(dialog, role.name)
      await expect(row.getByText(role.name, { exact: true })).toBeVisible()
      await expect(row.getByText(role.description, { exact: true })).toBeVisible()
      await expect(row.getByText(`omo 默认链：${role.hint}`, { exact: true })).toBeVisible()
      await expect(row.getByText('主模型', { exact: true })).toBeVisible()
      await expect(row.getByText('Fallback', { exact: true })).toBeVisible()
      await expect(addFallbackButton(dialog, role.name)).toBeVisible()
    }

    await expect(dialog.getByText(/^omo 默认链：/)).toHaveCount(ROLES.length)
    await expect(dialog.getByRole('button', { name: /^添加 .+ fallback 模型$/ })).toHaveCount(ROLES.length)
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})

test('primary model selector offers follow, omo default, and a pinned model with reasoning effort', async ({ page }) => {
  const errors = attachTripwire(page)
  let pinnedModel = ''
  let pinnedEffort = ''

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  let dialog: Locator = await test.step('reach: open Settings and select the opencode-omo section', async () => {
    return openOmoSettings(page)
  })

  await test.step('check: the three primary-model states are offered and a fixed model exposes effort', async () => {
    const row = roleRow(dialog, 'Sisyphus - Ultraworker')
    const primary = primaryModelButton(dialog, 'Sisyphus - Ultraworker')
    await expect.poll(async () => (await primary.innerText()).trim()).not.toBe('加载中…')

    // Start from the documented "follow current" state even after a failed run.
    if ((await primary.innerText()).trim() !== FOLLOW_SESSION) {
      await chooseModel(page, primary, FOLLOW_SESSION)
    }
    await expect(primary).toHaveText(FOLLOW_SESSION)
    await expect(row.getByRole('combobox')).toHaveCount(0)

    await chooseModel(page, primary, OMO_DEFAULT)
    await expect(primary).toHaveText(OMO_DEFAULT_LABEL)
    await expect(row.getByRole('combobox')).toHaveCount(0)

    const menu = await readModelMenu(page, primary)
    expect(menu).toContain(FOLLOW_SESSION)
    expect(menu).toContain(OMO_DEFAULT)
    const models = catalogModels(menu)
    expect(models.length).toBeGreaterThan(0)

    await page.getByRole('menuitem', { name: models[0]!, exact: true }).click()
    await expect(primary).toHaveText(models[0]!)

    // A catalog model may carry adapter reasoning efforts. Find one that does.
    for (const model of models.slice(1)) {
      if ((await row.getByRole('combobox').count()) > 0) break
      await chooseModel(page, primary, model)
      await expect(primary).toHaveText(model)
    }

    pinnedModel = await primary.innerText()
    expect(pinnedModel).not.toBe(FOLLOW_SESSION)
    expect(pinnedModel).not.toBe(OMO_DEFAULT)

    const effort = row.getByRole('combobox')
    await expect(effort).toBeVisible()
    const options = await effort.locator('option').evaluateAll((elements) =>
      elements.map(element => ({ label: (element.textContent ?? '').trim(), value: (element as HTMLOptionElement).value })))
    expect(options.map(option => option.label)).toContain('默认 effort')
    const nonDefault = options.filter(option => option.value !== '')
    expect(nonDefault.length).toBeGreaterThan(0)
    pinnedEffort = nonDefault[nonDefault.length - 1]!.value

    await effort.selectOption(pinnedEffort)
    await expect(effort).toHaveValue(pinnedEffort)
    await expect(primary).toBeEnabled()
  })

  await test.step('reach: close Settings and reopen the opencode-omo section', async () => {
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    dialog = await openOmoSettings(page)
  })

  await test.step('check: the pinned model and effort persist, and follow-current clears them again', async () => {
    const row = roleRow(dialog, 'Sisyphus - Ultraworker')
    const primary = primaryModelButton(dialog, 'Sisyphus - Ultraworker')
    await expect(primary).toHaveText(pinnedModel)

    const effort = row.getByRole('combobox')
    await expect(effort).toHaveValue(pinnedEffort)

    await chooseModel(page, primary, FOLLOW_SESSION)
    await expect(primary).toHaveText(FOLLOW_SESSION)
    await expect(primary).toBeEnabled()
    await expect(effort).toHaveCount(0)
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})

test('fallback add panel appends chips, supports repeated additions, and rejects duplicates', async ({ page }) => {
  const errors = attachTripwire(page)

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  const dialog = await test.step('reach: open Settings and select the opencode-omo section', async () => {
    return openOmoSettings(page)
  })

  await test.step('check: the fallback panel adds models below the role box and rejects a duplicate', async () => {
    await removeAllFallbackChips(dialog)
    await expect(dialog.getByRole('button', { name: /^移除 / })).toHaveCount(0)

    const plus = addFallbackButton(dialog, 'Sisyphus - Ultraworker')
    await plus.click()
    const panel = fallbackPanel(dialog, 'Sisyphus - Ultraworker')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('选择 Sisyphus - Ultraworker 的 fallback 模型', { exact: true })).toBeVisible()
    await expect(panel.getByRole('textbox', { name: '搜索模型…', exact: true })).toBeVisible()

    const offered = (await panel.getByRole('button').allInnerTexts())
      .map(label => label.trim())
      .filter(label => label !== '取消')
    expect(offered.length).toBeGreaterThan(1)
    const [first, second] = offered

    const firstButton = panel.getByRole('button', { name: first!, exact: true })
    await expect(firstButton).toBeEnabled()
    await firstButton.click()
    await expect(dialog.getByRole('button', { name: `移除 ${first}`, exact: true })).toBeVisible()
    // The list stays open so more fallbacks can be appended.
    await expect(panel).toBeVisible()
    await expect(dialog.getByText('Fallback 模型', { exact: true })).toBeVisible()

    await expect(firstButton).toBeEnabled()
    await firstButton.click()
    await expect(panel.getByText('该模型已在 fallback 列表中', { exact: true })).toBeVisible()

    const secondButton = panel.getByRole('button', { name: second!, exact: true })
    await expect(secondButton).toBeEnabled()
    await secondButton.click()
    await expect(dialog.getByRole('button', { name: `移除 ${second}`, exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^移除 / })).toHaveCount(2)

    await panel.getByRole('button', { name: '取消', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /^移除 / })).toHaveCount(2)

    await removeAllFallbackChips(dialog)
    await expect(dialog.getByRole('button', { name: /^移除 / })).toHaveCount(0)
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})

test('fallback model search filters the list and reports no matches', async ({ page }) => {
  const errors = attachTripwire(page)

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  const dialog = await test.step('reach: open Settings and select the opencode-omo section', async () => {
    return openOmoSettings(page)
  })

  await test.step('check: typing in the fallback search filters the offered models', async () => {
    await removeAllFallbackChips(dialog)
    await addFallbackButton(dialog, 'Sisyphus - Ultraworker').click()
    const panel = fallbackPanel(dialog, 'Sisyphus - Ultraworker')
    await expect(panel).toBeVisible()
    const search = panel.getByRole('textbox', { name: '搜索模型…', exact: true })
    await expect(search).toBeVisible()

    const offered = (await panel.getByRole('button').allInnerTexts())
      .map(label => label.trim())
      .filter(label => label !== '取消')
    expect(offered.length).toBeGreaterThan(1)
    const [first, second] = offered
    expect(second).not.toBe(first)

    await search.fill(second!)
    await expect(panel.getByRole('button', { name: second!, exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: first!, exact: true })).toHaveCount(0)

    await search.fill('model-that-does-not-exist')
    await expect(panel.getByText('没有匹配的模型', { exact: true })).toBeVisible()

    await search.fill('')
    await expect(panel.getByRole('button', { name: first!, exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: second!, exact: true })).toBeVisible()

    await panel.getByRole('button', { name: '取消', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /^移除 / })).toHaveCount(0)
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})

test('fallback panel cancel, toggle, outside click, and Escape add nothing', async ({ page }) => {
  const errors = attachTripwire(page)

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  let dialog: Locator = await test.step('reach: open Settings and select the opencode-omo section', async () => {
    return openOmoSettings(page)
  })

  await test.step('check: every dismissal closes the fallback panel without adding a model', async () => {
    await removeAllFallbackChips(dialog)
    const plus = addFallbackButton(dialog, 'Sisyphus - Ultraworker')
    const panel = fallbackPanel(dialog, 'Sisyphus - Ultraworker')
    const chips = dialog.getByRole('button', { name: /^移除 / })

    await plus.click()
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '取消', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(chips).toHaveCount(0)

    await plus.click()
    await expect(panel).toBeVisible()
    await plus.click()
    await expect(panel).toHaveCount(0)
    await expect(chips).toHaveCount(0)

    await plus.click()
    await expect(panel).toBeVisible()
    await dialog.getByRole('heading', { name: SETTINGS_HEADING, exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(chips).toHaveCount(0)

    await plus.click()
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(chips).toHaveCount(0)
  })

  await test.step('reach: reopen Settings when Escape also dismissed the host dialog', async () => {
    if ((await dialog.count()) === 0) dialog = await openOmoSettings(page)
  })

  await test.step('check: the fallback panel is closed and no chip was added', async () => {
    await expect(fallbackPanel(dialog, 'Sisyphus - Ultraworker')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /^移除 / })).toHaveCount(0)
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})

test('fallback chips persist across reopening and can be removed', async ({ page }) => {
  const errors = attachTripwire(page)

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  let dialog: Locator = await test.step('reach: open Settings and select the opencode-omo section', async () => {
    return openOmoSettings(page)
  })

  await test.step('check: a fallback chip is added and kept when the panel closes', async () => {
    await removeAllFallbackChips(dialog)
    await addFallbackButton(dialog, 'Sisyphus - Ultraworker').click()
    const panel = fallbackPanel(dialog, 'Sisyphus - Ultraworker')
    await expect(panel).toBeVisible()
    const first = (await panel.getByRole('button').allInnerTexts())
      .map(label => label.trim())
      .filter(label => label !== '取消')[0]!
    await panel.getByRole('button', { name: first, exact: true }).click()
    const chip = dialog.getByRole('button', { name: `移除 ${first}`, exact: true })
    await expect(chip).toBeVisible()
    await expect(chip).toBeEnabled()
    await panel.getByRole('button', { name: '取消', exact: true }).click()
    await expect(panel).toHaveCount(0)
  })

  await test.step('reach: close Settings and reopen the opencode-omo section', async () => {
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    dialog = await openOmoSettings(page)
  })

  await test.step('check: the chip persists, and removing it drops the fallback list', async () => {
    const chip = dialog.getByRole('button', { name: /^移除 / })
    await expect(chip).toHaveCount(1)
    await expect(dialog.getByText('Fallback 模型', { exact: true })).toBeVisible()

    const label = await chip.first().getAttribute('aria-label')
    await chip.first().click()
    if (label !== null) {
      await expect(dialog.getByRole('button', { name: label, exact: true })).toHaveCount(0)
    }
    await expect(dialog.getByRole('button', { name: /^移除 / })).toHaveCount(0)
    await expect(dialog.getByText('Fallback 模型', { exact: true })).toHaveCount(0)
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})
