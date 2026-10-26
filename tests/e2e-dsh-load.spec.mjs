/**
 * End-to-end smoke test against a RUNNING dsh web instance.
 *
 * The test reads the target URL from `DSH_WEB_URL` (defaults to the loopback
 * dsh web URL) and never hard-codes a host, IP, token, or cookie. A separate
 * `DSH_WEB_TOKEN` may provide the launch token printed by `dsh web`; the test
 * then performs the same token exchange a browser does and reuses the session
 * cookie. When no authenticated page is reachable, the test is skipped.
 *
 * It:
 * - fetches the served page and reads the host's `__DSH_BOOT__` manifest;
 * - finds the opencode-omo client bundle entry by package name;
 * - downloads that bundle and evaluates it under the same module-loader mock
 *   used by the offline client-bundle test;
 * - asserts the plugin face still exports `apply`, `RoleSelect`, and
 *   `RoleSettingsSection`;
 * - asserts the client uses the official settings form and no longer ships a
 *   private RPC channel.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const DSH_WEB_URL = (process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080').replace(/\/+$/, '')
const DSH_WEB_TOKEN = process.env.DSH_WEB_TOKEN ?? ''
const PACKAGE_ID = '@royenheart/dsh-plugin-opencode-omo'

async function fetchOrNull(url, init) {
  try {
    return await fetch(url, init)
  } catch {
    return null
  }
}

/** Minimal authenticated fetch: performs the launch-token exchange once. */
async function makeAuthenticatedFetch(t) {
  let cookie = null
  let exchanged = false

  async function tryFetch(path, init = {}) {
    const url = `${DSH_WEB_URL}${path}`
    if (cookie !== null) {
      return fetchOrNull(url, {
        ...init,
        headers: { ...(init.headers ?? {}), cookie },
      })
    }
    if (DSH_WEB_TOKEN !== '' && !exchanged) {
      exchanged = true
      const login = await fetchOrNull(`${DSH_WEB_URL}/?token=${encodeURIComponent(DSH_WEB_TOKEN)}`, {
        redirect: 'manual',
      })
      if (login !== null && login.status === 303) {
        const setCookie = login.headers.get('set-cookie')
        if (setCookie !== null) {
          cookie = setCookie.split(';', 1)[0]
          return fetchOrNull(url, {
            ...init,
            headers: { ...(init.headers ?? {}), cookie },
          })
        }
      }
      if (login !== null && login.status === 401) {
        t.skip('dsh web token was rejected')
        return null
      }
    }
    return fetchOrNull(url, init)
  }

  return tryFetch
}

function reactMock() {
  return {
    createElement: () => null,
    useState: () => [null, () => {}],
    useEffect: () => {},
    useMemo: fn => fn(),
    useRef: () => ({}),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
}

function evaluateBundle(code) {
  const modules = {
    'react': reactMock(),
    'react/jsx-runtime': reactMock(),
    '@deepseek-ai/cordis': {
      Context: class {},
      Service: class { constructor(ctx, name) { this.ctx = ctx; this.name = name } },
    },
    '@deepseek-ai/dsh-client-ui-slots': {},
    '@deepseek-ai/dsh-client-web-react': {},
    '@deepseek-ai/dsh-client-ui-primitives': {
      IconAgentPresetOutlineRegular: () => null,
      IconChevronDownOutlineRegular: () => null,
      IconPlusOutlineRegular: () => null,
      IconCloseOutlineRegular: () => null,
      Menu: () => null,
      Modal: () => null,
    },
    '@deepseek-ai/dsh-client-schema-form': {},
  }
  const loaded = {}
  const context = {
    console,
    window: { __ModuleLoader__: { load: ({ id, factory }) => { loaded.id = id; loaded.factory = factory } } },
  }
  vm.createContext(context)
  vm.runInContext(code, context)
  assert.equal(loaded.id, PACKAGE_ID)
  return loaded.factory(id => {
    if (!(id in modules)) throw new Error(`unexpected client require: ${id}`)
    return modules[id]
  })
}

/** Read one row from the host-injected `__DSH_BOOT__` graph. */
function bootEntry(html, id) {
  const marker = 'globalThis["__DSH_BOOT__"] = '
  const markerAt = html.indexOf(marker)
  assert.notEqual(markerAt, -1, 'page has no __DSH_BOOT__ manifest')
  const jsonAt = markerAt + marker.length
  const endAt = html.indexOf('</script>', jsonAt)
  assert.notEqual(endAt, -1, 'page has a truncated __DSH_BOOT__ manifest')
  const graph = JSON.parse(html.slice(jsonAt, endAt).trim().replace(/;$/, ''))
  assert.ok(Array.isArray(graph.entries), 'boot manifest has no entries')
  const entry = graph.entries.find(item => item.id === id)
  assert.ok(entry, `boot manifest does not advertise ${id}`)
  return entry
}

test('loaded plugin survives in dsh web and exposes its components', async (t) => {
  const authFetch = await makeAuthenticatedFetch(t)
  const page = await authFetch('/', { headers: { accept: 'text/html' } })
  if (page === null || !page.ok) {
    t.skip(`dsh web page not reachable at ${DSH_WEB_URL}`)
    return
  }
  const html = await page.text()

  const entry = bootEntry(html, PACKAGE_ID)
  assert.equal(typeof entry.url, 'string', `boot entry for ${PACKAGE_ID} has no bundle URL`)
  // The boot manifest may advertise either an absolute or a root-relative URL.
  const bundlePath = entry.url.startsWith('/') ? entry.url : `/${entry.url}`
  const bundle = await authFetch(bundlePath, { headers: { accept: '*/*' } })
  assert.ok(bundle !== null && bundle.ok, `client bundle fetch failed: ${DSH_WEB_URL}${bundlePath}`)
  const code = await bundle.text()
  const exportsObj = evaluateBundle(code)

  assert.equal(exportsObj.name, 'opencode-omo-client')
  assert.equal(typeof exportsObj.apply, 'function')
  assert.equal(typeof exportsObj.RoleSelect, 'function')
  assert.equal(typeof exportsObj.RoleSettingsSection, 'function')
  const inject = exportsObj.inject
  assert.ok(Array.isArray(inject), 'client inject is an array')
  assert.ok(inject.includes('configForms'), 'client inject includes configForms')
  assert.ok(!inject.includes('settingsScope'), 'retired settingsScope transport is gone')
  assert.ok(!inject.includes('connection'), 'retired private connection RPC is gone')
})
