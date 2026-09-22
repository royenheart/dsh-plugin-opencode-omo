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
 * - fetches the served page and finds the opencode-omo client bundle entry;
 * - downloads that bundle and evaluates it under the same module-loader mock
 *   used by the offline client-bundle test;
 * - asserts the plugin face still exports `apply`, `RoleSelect`, and
 *   `RoleSettingsSection`;
 * - probes the authenticated `/opencode-omo` RPC channel and expects either a
 *   valid RPC answer (200) or an unauthenticated rejection (401), never a
 *   missing-route 404/405.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

const DSH_WEB_URL = (process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080').replace(/\/+$/, '')
const DSH_WEB_TOKEN = process.env.DSH_WEB_TOKEN ?? ''
const PACKAGE_ID = '@royenheart/dsh-plugin-opencode-omo'
const RPC_CHANNEL = '/opencode-omo'
const RPC_ENDPOINT = 'catalog/get'

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
      IconChevronDownOutline14: () => null,
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

test('loaded plugin survives in dsh web and exposes its components', async (t) => {
  const authFetch = await makeAuthenticatedFetch(t)
  const page = await authFetch('/', { headers: { accept: 'text/html' } })
  if (page === null || !page.ok) {
    t.skip(`dsh web page not reachable at ${DSH_WEB_URL}`)
    return
  }
  const html = await page.text()

  // The page serializes each client bundle as a flat JSON entry:
  // {"id":"@royenheart/dsh-plugin-opencode-omo","url":"/plugins/??.../client.js&rev=...","rev":"...","inject":[...]}
  const entryPattern = new RegExp(
    `\\{"id":"${PACKAGE_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}","url":"([^"]+)","rev":"([^"]+)","inject":(\\[[^\\]]*\\])`,
  )
  const match = html.match(entryPattern)
  assert.ok(match, `page does not advertise the ${PACKAGE_ID} client bundle`)

  const bundlePath = match[1]
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
  assert.ok(inject.includes('connection'), 'client inject includes connection')
})

test('authenticated opencode-omo RPC channel is registered in dsh web', async (t) => {
  const authFetch = await makeAuthenticatedFetch(t)
  const page = await authFetch('/', { headers: { accept: 'text/html' } })
  if (page === null || !page.ok) {
    t.skip(`dsh web page not reachable at ${DSH_WEB_URL}`)
    return
  }
  const envelope = {
    type: 'client-request',
    rpcId: `e2e-${Date.now()}`,
    method: RPC_ENDPOINT,
    payload: {},
  }
  const response = await authFetch(`${RPC_CHANNEL}/${RPC_ENDPOINT}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  })
  if (response === null) {
    t.skip(`dsh web not reachable at ${DSH_WEB_URL}`)
    return
  }
  assert.ok(
    response.status === 200 || response.status === 401,
    `RPC channel responded ${response.status}, expected 200 (authenticated) or 401 (registered but unauthenticated)`,
  )
  if (response.status === 200) {
    const body = await response.json()
    assert.equal(body.type, 'server-response')
    assert.equal(body.rpcId, envelope.rpcId)
    assert.equal(body.result.ok, true)
  }
})
