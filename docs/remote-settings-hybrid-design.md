# opencode-omo settings transport

Status: superseded on dsh 0.2.1-rc.2.

The plugin originally used a hybrid transport: `settingsScope` on loopback and
a private authenticated `/opencode-omo` connection-RPC channel elsewhere. That
kept the plugin working before the official settings document existed, but it
duplicated the settings write path and required a private channel.

On 0.2.1 the host row owns two volatile fields (`roles`, `sessions`) and the
browser reads/writes them through `ctx.configForms.get('opencode-omo')` — the
official `settings/mutate` Remote under `/api`. The official transport already
has the browser-trust fence and session-cookie authentication for every browser,
loopback or remote, so:

- the private `/opencode-omo` RPC channel is removed;
- the raw `/plugins/.../roles`, `/plugins/.../role`, and
  `/plugins/.../role-config` routes are removed;
- role/session writes carry the settings revision fence and are visible to the
  host registry through the live volatile config.

See `src/index.ts`, `src/client/index.ts`, and
`src/client/omo-roles-store.ts` for the shipped implementation.
