/**
 * The omo slash-command and skill catalogs, read from the composer's own
 * trigger menu.
 *
 * These are the shipped command rows (`omo-commands.mjs`) and the omo skills
 * published as `user-dsh` (`omo-skills.mjs`); both are preset rows, so their
 * visibility in a session is a statement about the mounted composition. No
 * model turn runs — the trigger menu is host chrome, so this stays keyless.
 */
import { expect, expectCleanConsole, test } from '../fixtures/dsh-app.ts'
import {
  composerInput, ensureOmoBlankSession, settleApp, stableTexts, stagePreset,
} from '../fixtures/ui.ts'

/** Commands `omo-commands.mjs` registers under this preset. */
const OMO_COMMANDS = [
  'handoff',
  'hyperplan',
  'refactor',
  'remove-ai-slops',
  'start-work',
  'stop-continuation',
  'team-mode',
] as const

/** A sample of the omo skills that must be discoverable through the catalog. */
const OMO_SKILLS = [
  'ast-grep',
  'coding-agent-sessions',
  'programming',
  'ulw-plan',
  'ulw-research',
  'visual-qa',
] as const

/**
 * Type `/` into the composer and read the stabilized suggestion list.
 * @param page - page under test.
 * @returns the option texts.
 */
async function openTriggerMenu(page: import('@playwright/test').Page): Promise<string[]> {
  const input = composerInput(page)
  await expect(input).toBeVisible({ timeout: 20_000 })
  await input.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('/')
  const listbox = page.getByRole('listbox', { name: 'Trigger suggestions' })
  await expect(listbox).toBeVisible({ timeout: 15_000 })
  return await stableTexts(listbox.getByRole('option'), 'trigger menu did not stabilize')
}

/** True when one option belongs to `name` (option text starts with the name). */
function startsWithOption(options: readonly string[], name: string): boolean {
  return options.some(option => option.startsWith(name))
}

test.describe('omo command and skill catalogs', () => {
  test('every omo command is offered by the composer trigger menu', async ({ app, appPage }) => {
    const { page, tripwire } = appPage
    await ensureOmoBlankSession(page, app)

    const options = await openTriggerMenu(page)
    const missing = OMO_COMMANDS.filter(command => !startsWithOption(options, command))
    expect(missing, 'omo commands missing from the trigger menu').toEqual([])

    await page.keyboard.press('Escape')
    expectCleanConsole(tripwire)
  })

  test('omo skills are discoverable in an opencode-omo session', async ({ app, appPage }) => {
    const { page, tripwire } = appPage
    await ensureOmoBlankSession(page, app)

    const options = await openTriggerMenu(page)
    const missing = OMO_SKILLS.filter(skill => !startsWithOption(options, skill))
    expect(missing, 'omo skills missing from the trigger menu').toEqual([])

    await page.keyboard.press('Escape')
    expectCleanConsole(tripwire)
  })

  test('a standard-mode session does not inherit the omo catalogs', async ({ app, appPage }) => {
    const { page, tripwire } = appPage
    await ensureOmoBlankSession(page, app)
    await stagePreset(page, /^Standard mode/, 'Standard mode')
    await settleApp(page)

    const options = await openTriggerMenu(page)
    expect(options.some(option => option.startsWith('start-work')), 'start-work is omo-only').toBe(false)
    expect(options.some(option => option.startsWith('hyperplan')), 'hyperplan is omo-only').toBe(false)
    expect(options.some(option => option.startsWith('ulw-plan')), 'ulw-plan is an omo skill').toBe(false)

    await page.keyboard.press('Escape')
    // Restore the presets this worker's other scenarios expect.
    await stagePreset(page, /^opencode-omo/, 'opencode-omo')
    expectCleanConsole(tripwire)
  })
})
