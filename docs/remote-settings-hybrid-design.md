# opencode-omo settings transport: Config-derived form + authenticated RPC

Status: **implemented on dsh 0.1.7-alpha.1.** The client `ctx.settingsScope`
service and the host `ctx.settings.register(namespace, schema)` API are gone;
0.1.7 derives settings forms from a Host plugin entry's Config
(`ctx.configForms.get('<entry-id>')`, `remote.settings`
describe/update/mutate) and persists edits into the active profile patch. The
authenticated `ctx.connection.rpc.handle` `/opencode-omo` channel is unchanged
and remains the non-loopback transport.

## Background

The opencode-omo client needs durable, per-session and per-role data:

- `sessions`: session id → selected omo role.
- `roles`: role id → primary model / fallback chain / maxSteps / ultrawork.

On 0.1.7 this data is the host row's own volatile Config: the bundle patch
declares the row with `id: opencode-omo-roles`, and the plugin exports a
schemastery `Config` whose `roles` and `sessions` fields carry `.volatile()`.
The row id is therefore the settings-form namespace, and the host registry
(`OmoRoleRegistry`) reads the same live references the Loader updates.

Keeping the row id equal to the former namespace string is deliberate: dsh
imports a pre-0.1.7 `$DSH_HOME/settings.yaml` once, mapping each section id to
the profile entry with that id, so an existing `opencode-omo-roles` section
lands in the new Config without a migration step of our own.

## Constraints

dsh deliberately disables Host settings persistence for any browser whose page
URL is not loopback:

- `ui-settings` chooses `persistence = ctx.remote.$host.isLoopback ? 'host' : 'memory'`.
- On a non-loopback page the Config form reports `status: 'unavailable'`,
  `persistence.mode: 'memory'`, and `set`/`unset`/`mutate` resolve `false`
  without a write.

Therefore a client that **only** uses `configForms` would work on loopback and
silently lose writes for a remote browser. A client that **only** uses a custom
RPC channel would work everywhere but would ignore the standard settings
transport on loopback.

## Design

Use the same hybrid as before, with the loopback half re-expressed as the
official Config form:

- form ready (`getSnapshot().status === 'ready'`): read/write through
  `ctx.configForms.get('opencode-omo-roles')`.
- form unavailable (memory mode / namespace not served): read and write through
  the authenticated RPC channel that the host plugin registers with
  `ctx.connection.rpc.handle`.

The authenticated channel reuses dsh's own connection authentication: the
physical route runs every request through the same Host/Origin trust fence and
dsh web session cookie verification as the `/api` RPC. The plugin does **not**
register bare `webServer` write routes.

### Channel contract

Channel: `/opencode-omo` (single path segment, as required by the connection
channel pattern).

Endpoints:

- `catalog/get` — read-only payload `{ sessionId?: string }`. Returns
  `{ defaultRole, roles, configs, defaults, currentRole? }` from the host
  registry.
- `role/set` — payload `{ sessionId: string, role: string }`. Persists the
  session role and returns `{ currentRole, config }`.
- `role-config/set` — payload `{ role: string, config: OmoRoleConfig }`.
  Persists one role's config and returns `{ config }`.

All payloads and responses are JSON-serializable. Responses use the dsh
connection RPC result shape `{ ok: true, value }` or
`{ ok: false, error: { code, message, details } }`.

The client calls the channel with `ctx.connection.rpc.call('/opencode-omo',
'catalog/get', ...)`. The host registers it with
`ctx.connection.rpc.handle('/opencode-omo', handler)`. Host writes go through
`ctx.settings.update(entryId, patch)`, so both transports land in the same
profile patch and the same live Config references.

### Client transport selection

1. `ctx.configForms.get('opencode-omo-roles')`.
2. Read `getSnapshot().status`.
   - `ready`: derive `roles` / `sessions` from the stored section (the decoded
     runtime shape omits `model` for both "follow session" and "no choice"),
     subscribe to form changes, and write with `form.set('roles', …)` /
     `form.set('sessions', …)`. The write stores the **stored** shape, keeping
     `model: null` ("follow the current model") distinct from an absent `model`
     (omo-default primary).
   - `unavailable`: fetch the catalog through the authenticated RPC channel and
     write through `role/set` / `role-config/set`.
3. Static role catalog and live-catalog-derived defaults are not settings data.
   They are read through the authenticated `catalog/get` endpoint on both
   transports.

### Host changes (landed)

- The entry's `Config` declares `roles` and `sessions` with `.volatile()`, so
  `SettingsForms` exposes exactly those fields and refuses non-volatile paths.
- `apply(ctx, config)` reads the volatile references and hands the registry
  accessor closures plus a `persist` callback built from
  `ctx.settings.update(entryId, patch)`.
- `ctx.settings.configure({ auto: false }, ctx.fiber)` suppresses the generic
  raw-Config page, because the plugin ships its own `settings.section` page.
- The malformed legacy `ultrawork: { model: {} }` stays schema-valid (`z.any()`)
  so a pre-0.1.7 settings.yaml section imports; the registry drops the invalid
  inner model on read, as the former boot-time self-heal did.
- The `/opencode-omo` channel registers when `ctx.get('connection')` provides
  `rpc.handle` (web compositions). Headless/minimal compositions skip the
  channel and keep the Config-backed registry behavior.
- No raw `webServer.register` routes exist for role data.

### Client changes (landed)

- `inject` is `['slots', 'configForms', 'connection', 'remote', 'remote.session']`.
- `OmoRolesStore` consumes a structural `OmoConfigForm` face
  (`getSnapshot`/`subscribe`/`set`) and selects the transport from its status.
- `RoleSelect` and `RoleSettingsSection` no longer receive a scope; they consume
  the store through `form` + `rpc` inject faces.
- The session model catalog and model selection keep using the existing
  `remote.session` RPC (already authenticated).

### Proxy / deploy notes

No proxy changes are required. The channel lives under the connection
auth boundary, so the proxy only needs to forward the path and preserve the
same Host/Origin/Cookie behavior it already uses for `/api`.

Security boundary: with a proxy that rewrites Host/Origin and injects the
session cookie, the proxy itself is the trust boundary — the same boundary that
already applies to dsh's own `/api`. The plugin adds no weaker write path.

## Verification

- `tests/host.spec.mjs` boots the built host half with a mock 0.1.7 `settings`
  service that records entry patches and folds them into the same live
  references the Loader would expose, then exercises the registry and RPC
  endpoints.
- `tests/omo-store.spec.mjs` exercises transport selection (ready form vs
  memory-mode fallback), the stored-shape write that preserves
  `model: null` vs absent, and the loud refusal path.
- `tests/omo-settings.spec.mjs` validates the real `Config` schema against the
  legacy settings.yaml shape, asserts the template row id equals the form
  namespace, and covers the pure normalizers.
- End-to-end smoke: load the built plugin into a dsh web profile, confirm the
  plugin survives (no load error), and confirm the composer role chip and the
  settings section entry are still present (`tests/e2e-dsh-load.spec.mjs`).
