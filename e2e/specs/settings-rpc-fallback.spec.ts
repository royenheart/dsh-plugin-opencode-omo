/**
 * The authenticated `/opencode-omo` connection RPC channel.
 *
 * `docs/remote-settings-hybrid-design.md` and the README promise a hybrid
 * transport: loopback browsers read/write the `opencode-omo-roles` settings
 * namespace through `settingsScope`, and a non-loopback (memory-mode) browser
 * falls back to the authenticated logical channel the host registers with
 * `ctx.connection.rpc.handle('/opencode-omo', handler)`. This scenario sends
 * exactly the request the memory-mode client sends — a `client-request`
 * envelope on the physical route, carrying the browser session cookie.
 *
 * KNOWN FAILURE on dsh 0.1.6-alpha.1 (pinned below with `test.fail`):
 * `HostConnectionService.register()` reads `owner.webServer`, and the plugin's
 * calling context declares only `['settings', 'omoRoles', 'connection']`, so
 * cordis throws `cannot get property "webServer" without inject` while
 * registering the channel. Nothing is mounted and the request falls through to
 * the SPA fallback, which answers `405` to non-GET. Loopback browsers are
 * unaffected (settings scope is authoritative), which is why every UI scenario
 * still passes and why the 405 is allowlisted in the console tripwire.
 *
 * The pin is intentional: when the channel starts working this test fails as
 * "passed unexpectedly", which is the signal to promote it (and the ledger row)
 * to `passing`.
 */
import { expect, expectCleanConsole, test } from '../fixtures/dsh-app.ts'
import { ensureOmoBlankSession } from '../fixtures/ui.ts'

test.describe('authenticated /opencode-omo RPC channel', () => {
  test('serves catalog/get on the physical channel route', async ({ app, appPage }) => {
    test.fail(
      true,
      'dsh 0.1.6-alpha.1: connection.rpc.handle() throws "cannot get property \\"webServer\\" without inject" '
      + 'in the plugin context, so the /opencode-omo channel is never mounted and POST falls through to the 405 SPA fallback',
    )
    const { page, tripwire } = appPage
    await ensureOmoBlankSession(page, app)
    expectCleanConsole(tripwire)

    const response = await page.evaluate(async () => {
      const result = await fetch('/opencode-omo/catalog/get', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'e2e-omo-catalog',
          method: 'catalog/get',
          payload: { args: { _request: {} } },
        }),
      })
      return { status: result.status, text: await result.text() }
    })

    expect(response.status, 'channel route status').toBe(200)
    const parsed = JSON.parse(response.text) as {
      type?: string
      result?: { ok?: boolean, value?: { roles?: unknown[] } }
    }
    expect(parsed.type).toBe('server-response')
    expect(parsed.result?.ok).toBe(true)
    expect(Array.isArray(parsed.result?.value?.roles)).toBe(true)
  })
})
