# DSH 0.2.1 migration review — `@royenheart/dsh-plugin-opencode-omo`

Source: `dsh-v0.2.1-rc.2` at `687f282`. Plugin tree remains uncommitted; the harness checkout keeps the rebased patch applied for verification.

## 1. Extension points the plugin uses now

**Slots**

- `conversation.input.left` — session-scoped list slot for the omo role picker. The component still receives the standard `sessionId`/`useSessions` kit and only renders for sessions whose `agentPreset` projection is `opencode-omo`.
- `settings.section` — root-scoped settings page for the global “Role Settings” surface.
- `opencode-omo.settings.tab` — plugin-owned nested list tab inside that settings page.

**Settings**

- The plugin’s profile entry `opencode-omo` is now the settings namespace. Its `Config` exposes two volatile fields, `roles` and `sessions`.
- Host: `ctx.settings.configure({ auto: false })`, reads through `Config.roles.get()` / `Config.sessions.get()`, writes through `ctx.settings.update('opencode-omo', patch)`.
- Browser: `ctx.configForms.get('opencode-omo')`; role and session updates go through `set('roles', …)` / `set('sessions', …)`.

**Remote / RPC**

- `ctx.remote.session.modelCatalog()` and `ctx.remote.session.selectModel()` for the model catalog and session model selection.
- The settings form’s reads and writes use the official `/api` settings Remote. The former private `/opencode-omo` connection-RPC channel and raw `/plugins/...` routes are gone.

**Preset publication**

- The package is a bundle whose `cordis.patch.yml` inserts:
  - the host row `opencode-omo`;
  - the official `@deepseek-ai/dsh-agent-preset` row `preset-opencode-omo` with `id: opencode-omo`.

**Host seams used by the preset**

- `ctx.systemPrompt.section({ complete: true })`, `ctx.systemPrompt.variable`, `ctx.systemPrompt.suppressRuntimeContext`.
- `system-prompt/assemble`, `agent/inbox/claimed`, `agent/pre-step`, `agent/request`, `agent/request-error`, `agent/created`, `agent/disposed`.
- `tools/pre-execute`, `tools/post-execute`, `tools/execute`.
- `ctx.subagents.startActivation`, `ctx.subagents.sendMessage`; `ctx.jobs` for background output/cancel.
- `ctx.skills.registerProvider`, `ctx.commands.register`.
- `Session.snapshotEvents()` for prompt-time plan/step state.

**dsh-side change**

- One patch remains: `patches/0001-agent-pre-step-assistant-prefill.patch` adds `PreStepDecision.assistantPrefill`, carries it into the one request, logs it on `request/header`, and prices it in the token meter.

## 2. Official extension points it should use on this release

| Capability | Exact 0.2.1 extension point | State |
|---|---|---|
| Preset appears in the mode picker | `@deepseek-ai/dsh-agent-preset` declaration row in the bundle patch | Migrated; live row verified |
| Composer role picker | `conversation.input.left` | Kept; exact slot retained |
| Global Role Settings page | `settings.section` | Kept; exact slot retained |
| Role/session persistence | `opencode-omo` volatile entry config through `ctx.settings` + `ctx.configForms` | Migrated |
| Model catalog and session model | `ctx.remote.session.modelCatalog` / `selectModel` | Kept |
| Non-loopback browser writes | Official settings Remote (`settings/mutate` under `/api`) | Migrated; private RPC removed |
| Named subagent orchestration | `ctx.subagents.startActivation` / `sendMessage` | Migrated |
| Background job collection | `ctx.jobs.start/read/wait/kill` with session-scoped callers | Migrated |
| Per-role tool restrictions | No public `toolFilter` on `tool-subagent` in 0.2.1; applied through `system-prompt/assemble` + `tools/pre-execute` | Rebased shim |
| opencode `MAX_STEPS_PROMPT` as an assistant tail | No official request-tail decision; local patch | Patch retained |

The role picker and settings page deliberately remain on their original slots. A different official surface, such as moving the settings page into a Plugins-page card, would be a coarser UX and is not a substitute for the documented entry point.

## 3. Edits made

**Preset publication**

- `cordis.patch.yml`: added the official `preset-opencode-omo` declaration; its `plugins` block is generated inline from `presets/opencode-omo/agent.cordis.yml`.
- `tests/preset-declaration.spec.mjs`: fails if the generated declaration drifts from `agent.cordis.yml`.
- `presets/opencode-omo/agent.cordis.yml`:
  - preset-local modules now use `@royenheart/dsh-plugin-opencode-omo/presets/opencode-omo/*` subpaths, because a 0.2.1 preset resolves relative names against the profile directory;
  - `workflow-worker-thread` replaced by the base `ptc-runtime` + `workflow-ptc`;
  - removed `toolFilter`, `backgroundMode`, and `enableRunInBackground` from `tool-subagent` rows;
  - the optional LSP group self-disables when its three packages are absent.

**Settings and host**

- `src/index.ts`: added `Config` (`roles`/`sessions`, volatile), mounted `OmoRoleRegistry` from the config references, registered `settings.configure({ auto: false })`; removed the custom RPC handler and `webServer` dependency.
- `src/omo-role-registry.ts`: reads the live volatile config and writes through `ctx.settings.update('opencode-omo', …)`.
- `src/core/omo-settings.ts`: names the entry id `opencode-omo`.
- `src/core/omo-rpc.ts`: removed.

**Client**

- `src/client/index.ts`: injects `slots`, `configForms`, `remote`, `remote.session`; binds the official config form; removed `settingsScope`/connection-RPC transport.
- `src/client/RoleSelect.tsx`, `RoleSettings.tsx`: updated types, removed RPC, replaced `*16` icons with `*Regular` exports, and the settings page derives omo default primaries from the live catalog.
- `src/client/omo-roles-store.ts`, `use-omo-roles.ts`: one reactive store over the configuration form.
- `src/client/slots.ts`: dropped the local `conversation.input.left` redeclaration; only the plugin-owned tab remains.
- `src/client/index.d.ts`: updated public inject and injected faces.

**Preset runtime**

- `presets/opencode-omo/driver.mjs`: replaced `session.events` with `snapshotEvents()`, and applies the named-role restriction map to both assembled schemas and `tools/pre-execute`.
- `presets/opencode-omo/task-shim.mjs`: migrated to `startActivation`/`sendMessage`, removed the old `start`/`startContinuable`/`followup` calls, and kept the role restriction map.
- `presets/opencode-omo/delegation-surface.mjs`: migrated `background_output`/`background_cancel` to the 0.2.1 `ctx.jobs` shape.

**Packaging, docs, tests**

- `package.json`: replaced `dsh-client-runtime` with the current client packages, updated all DSH peer floors to `^0.2.0-rc.1`, added exact 0.2.1 dev pins, added `./presets/*` exports, added `js-yaml`, and updated `dsh.client.inject`.
- `install.py`: documents bundle-declared presets; legacy `.agent-presets` remains only for older hosts; optional LSP linking is best-effort.
- Updated `README.md`, `design.md`, `docs/remote-settings-hybrid-design.md`, and `patches/README.md`.
- Updated host/settings/client/delegation/preset/e2e tests; host tests now exercise the config-form write path.
- Regenerated `patches/0001-agent-pre-step-assistant-prefill.patch` and removed the old extra `GenerateOptions.assistantPrefill` property that did not typecheck.

**Verification**

- `npm run typecheck`: pass.
- `npm run build`: pass (`lib/index.js`, `lib/client.js`).
- `npm test`: 127 tests, 125 pass, 2 skipped (the e2e pair skips without a running host).
- Real `dsh-v0.2.1-rc.2` web profile:
  - boot manifest advertises `@royenheart/dsh-plugin-opencode-omo` and its client artifact responds 200;
  - `agentPresets/list` shows `opencode-omo` active and not `broken`;
  - `session/create` with `agentPreset: opencode-omo` succeeds;
  - `settings/describe` lists `opencode-omo` with `autoGenerate: false`;
  - `settings/mutate` on `roles.sisyphus` is accepted;
  - with `DSH_WEB_URL`/`DSH_WEB_TOKEN`, the updated e2e spec passes both tests.
- Patch: `git apply --check` and full apply on a fresh `dsh-v0.2.1-rc.2` worktree pass; modified source files typecheck against 0.2.1 declarations. The loop regression test ships with the patch but was not executed because the checkout has no pnpm/vitest toolchain.

## 4. Remaining gaps that still need a harness patch or general-purpose harness change

1. **Request-only assistant prefill is still not official.** `PreStepDecision` has no request-tail channel, and `agent/request` cannot mutate messages. The plugin keeps the documented assistant-role behavior through `patches/0001` and keeps the system-section fallback only for unpatched hosts. Upstream: [discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407). Adjacent request-message rewrite discussion: [#3940](https://github.com/deepseek-ai/deepseek-harness/discussions/3940); the request-tail role/placement contract is still specific to #2407.
2. **Synchronous session reads are deprecated.** `Session.eventAt()`, `snapshotEvents()`, and `ownEvents()` are deprecated from 0.1.6. This plugin uses `snapshotEvents()` during prompt assembly to derive plan-mode and turn/step state. A projection or a documented synchronous prompt-state read would remove that dependency.
3. **No public per-child tool restriction.** 0.2.1 `tool-subagent` rejects `toolFilter`, and `SubagentStartRequest` has no per-child filter. The plugin reproduces the old allow/deny lists in its own assembly and execution listeners. A general harness change would be a per-child tool restriction on the subagent request (or a documented inheriting-child preset mechanism).
4. **Plan files remain plugin-owned.** dsh has no first-class plan-file persistence seam; the plugin writes `.opencode/plans/*` after `exit_plan_mode` approval.
5. **Optional LSP packaging.** The preset’s LSP group self-disables when `dsh-lsp`, `dsh-lsp-stdio`, and `dsh-tool-lsp` are not installed. This preserves a bootable mode but does not make LSP available to npm-only installs that do not provide the optional trio.
6. **Full browser-slot interaction was not clicked through.** The client bundle, boot manifest entry, settings-form namespace, and preset session creation were verified against a real host; the role picker’s visual interaction was not exercised because the test profile had no configured model/API key.

## 5. Risks

- **Core-loop patch risk.** `assistantPrefill` is a local core change. A future upstream request-tail design may supersede its vocabulary or accounting; the capability marker keeps stock hosts on the fallback.
- **Patch test not executed.** The included `assistant-prefill.spec.ts` was not run in this review. The patch applies cleanly and typechecks, but that is not the same as a passing loop test.
- **Deprecated session reads.** `snapshotEvents()` may disappear or become more expensive; prompt assembly currently depends on it synchronously.
- **Generated declaration duplication.** The preset’s `plugins` block is a generated copy of `agent.cordis.yml`. The drift test guards it, but a release process that edits only one file will fail the test rather than silently diverge.
- **Settings writes are profile writes.** Role/session configuration now lives in the active profile patch through the official settings service. Concurrent edits rely on the settings revision fence; a browser that ignores `writable` would surface refused writes.
- **Role restriction parity.** The old `toolFilter` lists now live in `task-shim.mjs` and are enforced by `driver.mjs`. This preserves schema visibility and execution denial, but it is a plugin-maintained mirror of behavior the release no longer exposes as a first-class field.
- **Peer-range breadth.** `^0.2.0-rc.1` admits later 0.2.x prereleases; that is the documented install rule, but a later 0.2.x surface change can still require a plugin release.
- **LSP fallback.** On hosts without the optional LSP packages, the whole LSP group disappears rather than failing the preset. That is intentional graceful degradation, but it is a behavior difference from a fully provisioned install.