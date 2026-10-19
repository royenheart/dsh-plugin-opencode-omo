import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { attachTripwire, openHarness, openOmoSession, waitForStable } from './helpers'

const OMO_COMMANDS = [
  ['start-work', '从 .omo/plans 选择计划并开始/继续 Atlas 执行（加载 start-work skill）'],
  ['remove-ai-slops', '清除当前工作区中的 AI slop 注释（加载 remove-ai-slops skill）'],
  ['refactor', '按仓库现有模式执行重构（加载 refactor skill）'],
  ['stop-continuation', '停止当前计划的自动续跑，记录 .omo/boulder.json 状态'],
  ['handoff', '生成面向下一个 worker 的交接说明'],
  ['hyperplan', '进入深度规划模式（加载 ulw-plan skill）'],
  ['team-mode', '以 team-mode 并行委托一个 lead + 多个 worker'],
] as const

const OMO_SKILLS = [
  ['ast-grep', 'Use ast-grep (sg) for AST-aware code search'],
  ['coding-agent-sessions', 'MUST USE when asked to find, read, list, search, inspect'],
  ['debugging', 'MUST USE for any real runtime debugging'],
  ['frontend', 'MUST USE for frontend/web UI/UX/visual work'],
  ['git-master', 'MUST USE whenever a task needs a commit or git-history investigation'],
  ['init-deep', '(builtin) Initialize hierarchical AGENTS.md knowledge base'],
  ['lsp-setup', 'Configure a Language Server (LSP) for a specific language'],
  ['programming', 'MUST USE for ANY work on .py .pyi .rs .ts .tsx'],
  ['refactor', 'Intelligent refactor command'],
  ['remove-ai-slops', 'Remove AI-generated code smells (slop)'],
  ['review-work', 'Post-implementation review orchestrator'],
  ['start-work', 'Execute a Prometheus work plan with Boulder state'],
  ['ultimate-browsing', 'Escalation skill for blocked or hard-to-reach web access'],
  ['ulw-plan', 'MUST USE for planning before coding when design uncertainty'],
  ['ulw-research', 'Maximum-saturation research orchestration'],
  ['visual-qa', 'MUST USE after building/changing any UI'],
] as const

async function openSlashMenu(page: Page): Promise<string> {
  const composer = page.getByRole('textbox', { name: /Describe what you want to build/ }).first()
  await expect(composer).toBeVisible()
  await composer.click()
  await page.keyboard.type('/')
  const listbox = page.getByRole('listbox')
  await expect(listbox).toBeVisible()
  await expect(page.getByRole('option').first()).toBeVisible()
  // Host menu: read it here so host menu changes fail in a reach step.
  return waitForStable(() => listbox.innerText())
}

test('composer slash menu offers the seven omo commands', async ({ page }) => {
  const errors = attachTripwire(page)

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  await test.step('reach: open a new session in the opencode-omo preset', async () => {
    await openOmoSession(page)
  })

  const slashMenu = await test.step('reach: type "/" in the composer to open the host slash menu', async () => {
    return openSlashMenu(page)
  })

  await test.step('check: each omo command is offered with its description', async () => {
    for (const [name, description] of OMO_COMMANDS) {
      expect(slashMenu).toContain(name)
      expect(slashMenu).toContain(description)
    }
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})

test('composer slash menu offers the bundled omo skills', async ({ page }) => {
  const errors = attachTripwire(page)

  await test.step('reach: open the launch URL and prepare a session workspace', async () => {
    await openHarness(page)
  })

  await test.step('reach: open a new session in the opencode-omo preset', async () => {
    await openOmoSession(page)
  })

  const slashMenu = await test.step('reach: type "/" in the composer to open the host slash menu', async () => {
    return openSlashMenu(page)
  })

  await test.step('check: every skill shipped beside the preset is offered', async () => {
    for (const [name, marker] of OMO_SKILLS) {
      expect(slashMenu).toContain(name)
      expect(slashMenu).toContain(marker)
    }
    expect(slashMenu).toContain('visual-qa')
  })

  await test.step('check: no console errors or page errors', () => {
    expect(errors).toEqual([])
  })
})
