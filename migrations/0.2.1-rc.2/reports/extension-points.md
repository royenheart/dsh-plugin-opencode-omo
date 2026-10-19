# dsh-v0.2.1-rc.2 extension-point map — `@royenheart/dsh-plugin-opencode-omo`

## 1. Extension points the plugin uses now

| Plane | Entry point | Where |
|---|---|---|
| Bundle / host | `dsh.bundle.patch` inserts the `opencode-omo` host row and the official `@deepseek-ai/dsh-agent-preset` row | `package.json`, `cordis.patch.yml` |
| Agent preset | `preset-opencode-omo` declares the preset id, metadata, and complete agent-plane plugin list | `cordis.patch.yml`, generated from `presets/opencode-omo/agent.cordis.yml` |
| Host service | `ctx.settings` (`configure({ auto: false })`, `update('opencode-omo', …)`) plus `ctx.llm` for catalog-based defaults | `src/index.ts`, `src/omo-role-registry.ts` |
| Host service | `ctx.omoRoles` role registry used by the preset loop shim | `src/omo-role-registry.ts`, `presets/opencode-omo/driver.mjs` |
| Client slot | `conversation.input.left` composer role picker | `src/client/index.ts`, `src/client/RoleSelect.tsx` |
| Client slot | `settings.section` “Role Settings” page, with the plugin-owned nested `opencode-omo.settings.tab` | `src/client/index.ts`, `src/client/RoleSettings.tsx`, `src/client/slots.ts` |
| Client data | `ctx.configForms.get('opencode-omo')` for role/session reads and writes | `src/client/index.ts`, `src/client/omo-roles-store.ts` |
| Client RPC | official `remote.session.modelCatalog()` / `selectModel()` | `src/client/index.ts` |
| Preset seams | `ctx.systemPrompt.section({ complete: true })`, `suppressRuntimeContext`, `system-prompt/assemble` | `presets/opencode-omo/driver.mjs` |
| Preset seams | `agent/pre-step`, `agent/request`, `agent/request-error`, `agent/inbox/claimed`, `agent/created` | `driver.mjs`, `escalating-bash.mjs`, `tool-surface.mjs` |
| Preset seams | `tools/pre-execute`, `tools/post-execute`, `ctx.commands.register`, `ctx.skills.registerProvider`, `ctx.subagents`, `ctx.jobs`, `ctx.fs`, `ctx.shell`, `ctx.sandbox`, `ctx.approval`, `ctx.lsp` | preset modules |
| dsh-side change | `patches/0001-agent-pre-step-assistant-prefill.patch`: `PreStepDecision.assistantPrefill`, `EpochHeader.assistantPrefill`, `AgentLoop.supportsAssistantPrefill`, token-pressure pricing, loop regression test | `patches/`, harness checkout |

The previous private `/opencode-omo` connection-RPC channel, `settingsScope`, `webServer`, and raw plugin routes are gone. Role/session state is now the row’s volatile config, addressed through the official settings transport.

## 2. Official extension points it should use on this release

| Documented capability | Official 0.2.1-rc.2 surface | Same slot/menu/RPC/behavior? | Decision |
|---|---|---|---|
| `opencode-omo` mode in the mode picker | `@deepseek-ai/dsh-agent-preset` bundle row and roster/picker | Yes, infrastructure; preset content is plugin-owned | Use official declaration; done |
| Complete opencode + omo prompt with per-step `<env>` | `ctx.systemPrompt.section({ complete: true, text })`, `suppressRuntimeContext()` | Same prompt seam; no official prompt content or role switch | Keep plugin-owned section; done |
| Role picker in the composer | `conversation.input.left` | Same slot; not the new-session `conversation.hero.agentPreset` chip | Keep `conversation.input.left`; do not move to a coarser preset chip |
| Global Role Settings with per-role primary/fallback | `settings.section` plus a plugin-owned nested tab | Same settings page; `settings.plugin.item` is a different menu | Keep `settings.section`; do not substitute a Plugins-page card |
| Role/session persistence | Current-profile plugin config + `ctx.configForms` + `settings/mutate` | Same setting, official transport | Migrated; done |
| Native toolchain and parameter shims | `tool-fs`, `tool-fs-search`, `tool-bash-persistent`, `tool-web`, `tool-lsp`, `tool-skill`, `tool-todo`, etc. | Same tools; descriptions/parameter names are plugin-owned | Keep plugin shims; composition uses official packages |
| `task()` and named omo subagents | `tool-subagent` rows with `provider: spawn` inside the preset | Same delegation mechanism; different tool name/schema and role catalog | Keep plugin `task-shim` and named rows |
| AGENTS.md / skills / omo rules | `dsh-agent-instructions`, `dsh-skill-filesystem`, native skill registry | First two official; omo rules are plugin-owned | Keep plugin rules renderer; official inputs used |
| `comment-checker` and `hashline` | No official equivalent | No | Keep plugin hooks |
| Per-mode local fs and persistent PTY shell | `dsh-fs-local`, `dsh-terminal`, `dsh-terminal-bash`, `dsh-tool-bash-persistent` | Same packages; preset-specific isolation | Keep composition |
| Loop behavior (maxSteps, routing, fallback, ultrawork) | `agent/pre-step`, `agent/request`, `agent/request-error`, `agent/inbox/claimed` | Same seams; behavior is plugin-owned | Keep plugin driver |
| Slash commands | `ctx.commands.register` | Same command registry; omo commands are plugin-owned | Keep plugin commands |
| Plan file persistence | No first-class plan-file seam | No | Keep plugin `.opencode/plans/*` writer |
| `MAX_STEPS_PROMPT` as request-only assistant tail | No official seam; `agent/request` cannot mutate messages | No | **Patch required** |
| Session state reads | `ctx.sessionProjections.stateOf` (plan projection) | Same state; plan projection now used | Plan reads migrated; turn/step reads remain deprecated |
| Icons / client primitives | `*Regular` primitives exports | Yes | Migrated |
| DSH peer compatibility | `^0.2.1-rc.2` DSH peers | Target-specific but admits the exact prerelease | Migrated |

The official surfaces that are coarser or different in kind were not treated as replacements: the composer role picker remains `conversation.input.left`, and Role Settings remains `settings.section`; neither was replaced by a preset chip or a Plugins-page card.

## 3. Edits made

Working-tree migration edits:

- `package.json` — DSH peers moved to the `0.2.1-rc.2` cohort; `dsh.client.inject` moved to `configForms`/`remote`/`remote.session`; `./presets/*` export and shipped patch directory added.
- `src/index.ts`, `src/omo-role-registry.ts`, `src/core/omo-settings.ts`, `src/core/omo-roles.ts` — host row owns volatile `roles`/`sessions`; registry reads/writes through `ctx.settings.update`; `src/core/omo-rpc.ts` deleted.
- `src/client/index.ts`, `omo-roles-store.ts`, `use-omo-roles.ts`, `RoleSelect.tsx`, `RoleSettings.tsx`, `slots.ts`, `index.d.ts` — role data binds through `ctx.configForms.get('opencode-omo')`; picker stays on `conversation.input.left`; Role Settings stays on `settings.section`; current `*Regular` icons.
- `cordis.patch.yml` — declares the host row and official `@deepseek-ai/dsh-agent-preset` row; `scripts/sync-preset-declaration.mjs` regenerates it and `tests/preset-declaration.spec.mjs` guards drift.
- `presets/opencode-omo/agent.cordis.yml` — preset-local modules use package subpaths; `workflow-worker-thread` replaced by `workflow-ptc` + `tool-workflow`; `tool-ralph` restored explicitly; obsolete `toolFilter`/`backgroundMode`/`enableRunInBackground` removed; LSP is an optional module.
- `presets/opencode-omo/driver.mjs`, `task-shim.mjs`, `delegation-surface.mjs`, `start-work-continuation.mjs` — 0.2.1 APIs, scoped subagent/job handling, patched assistant-prefill path with stock-host fallback.
- `patches/0001-agent-pre-step-assistant-prefill.patch` — rebased onto `dsh-v0.2.1-rc.2`; applied on the harness checkout for testing; report at `.dsh-migrate/patch-reports/assistant-prefill/report.md`.
- `install.py`, `README.md`, `design.md`, `patches/README.md`, `docs/remote-settings-hybrid-design.md` — preset declaration, settings transport, patch requirement, and fallback behavior updated.

Additional edits in this pass:

- `presets/opencode-omo/driver.mjs` — plan mode now reads the public `plan` session projection through `ctx.get('sessionProjections').stateOf(session, 'plan')`, with the explicit log read retained only for detached/test hosts. The stale “stock 0.1.2 / no patch path” comment was corrected.
- `tests/driver.spec.mjs` — added a projection-first plan-mode test.
- `tests/e2e-dsh-load.spec.mjs` — the live acceptance test now parses the host-injected `__DSH_BOOT__` graph and finds the bundle entry by package name instead of regexing page HTML.
- `tests/omo-wire.spec.mjs` — comment updated to 0.2.1.
- `.dsh-migrate/runs/39294911293-1/cards.json` — 183-card ledger; all 19 required cards are `done`.
- No design-note files were written into the plugin repository.

Validation:

- `npm run typecheck` — pass.
- `npm test` — 126 tests, 125 pass, 1 skipped (live-host e2e with no reachable dsh web).
- `npm run build` — pass.
- Harness `vitest` on assistant-prefill, request-header, token-meter, and interception — 59/59 pass.
- `tsc -b` on the patched harness packages — pass.
- `git apply --check` of the patch against an archived clean `dsh-v0.2.1-rc.2` tree — pass.
- No commit was made.

## 4. Remaining gaps that still need a harness patch or a general-purpose harness change

1. **Assistant-role request tail is still not upstream.** The required patch remains necessary for opencode’s exact `MAX_STEPS_PROMPT` placement. Upstream request: [discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407). Adjacent request-message rewrite discussion: [#3940](https://github.com/deepseek-ai/deepseek-harness/discussions/3940). Prefix-cache/request-assembly context: [#4749](https://github.com/deepseek-ai/deepseek-harness/discussions/4749). No implementing PR found.
2. **`GenerateOptions.format` / `tool_choice` remains absent.** The README documents this as an unpatched proposal; omo’s regular path does not use it, and the separate structured-output plugin covers the common route. A general-purpose request-envelope extension would be needed for full provider-visible parity.
3. **Turn/step state still uses the deprecated synchronous log reader.** Plan mode now uses the public `plan` projection, but `nextPosition()`/`currentPosition()` still read `session.snapshotEvents()` because no public projection exposes the current step number. This is pre-existing deferred logic under the 0.1.6 deprecation policy; a general-purpose `turnBoundary` extension carrying `lastStep` (or an official async read) would retire it.
4. **Child subagent role identity is not carried in dsh descriptors.** Named specialist restrictions are enforced by the plugin’s schema filter and `tools/pre-execute` mirror; per-child sampling inherits the session route. A harness descriptor field for the child role/spawn metadata would be required for full per-role child sampling.
5. **Plan files have no first-class harness seam.** The plugin writes `.opencode/plans/<created>-<session>.md` after `exit_plan_mode` approval. This is functional but remains plugin-owned.
6. **Optional LSP packaging is still a plugin-side fallback.** `lsp-optional.mjs` keeps the preset mountable without the LSP packages or `typescript-language-server`; an installed-but-incomplete set leaves the `lsp_*` tools without a provider until the server is installed.
7. **Base privacy rows are not overridden by this bundle.** A base-backed 0.2.x profile mounts `session-log-deepseek` (uploads by default) and session telemetry; this plugin neither composes nor overrides those rows. Deployments must set their own `enabled: false`/telemetry policy if that egress is not acceptable.

## 5. Risks

- **Core-loop patch maintenance.** `assistantPrefill` touches the loop, header, and token-meter; the patch may need rebasing. The plugin probes `ctx.agentLoop.supportsAssistantPrefill`, so a stock host degrades to the documented system-section fallback rather than breaking.
- **Patch API choice is still a proposal.** The patch uses a plain `assistantPrefill: string`; discussion #2407 raises whether a complete `AssistantMessage` envelope is preferable for provenance. The current patch also leaves the existing request-reconstruction theorem untouched for prefixed requests, so upstream review may request that invariant test update.
- **No live patched-host browser verification.** The patched path was tested through harness unit tests + typecheck, but the live web profile verification used the unpatched npm `0.2.1-rc.2` host. The role picker and Role Settings controls were not clicked through with a configured model/API key.
- **Synchronous session reads.** `currentPosition()` still calls `session.snapshotEvents()`; this is the main deferred 0.1.6 deprecation item.
- **Plan projection fallback.** Detached/test hosts without `sessionProjections` still use the old log scan; this is intentional survivability, not the target production path.
- **Settings merge semantics.** The host registry writes through `settings.update`, which merges nested objects; the browser writes whole `roles`/`sessions` fields through `configForms`. Unedited fields are preserved, but future editors should use path mutations or explicit clears.
- **Optional LSP / install shape.** The install links optional LSP packages into the shared profile tree; an npm-only or partial install can mount without LSP tools, and the user must install `typescript-language-server` to activate them.
- **Peer range specificity.** DSH peers are pinned to `^0.2.1-rc.2` rather than a broad `^0.1.0 || ^0.2.0-rc.1`; this is honest for the APIs the plugin now uses, but it means older 0.1.x hosts are intentionally not installable.