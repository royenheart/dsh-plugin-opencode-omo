# dsh-plugin-opencode-omo on `dsh-v0.2.2-alpha.3`

Baseline: `dsh-v0.2.2-alpha.3` (`05b1cae8db6e674c5685101494d4eec24652424a`), matching `alignment.json` and the README’s **Version baseline**. The documented product surface remains the `opencode-omo` mode, its complete prompt/tool/subagent behavior, the composer role picker, and the global Role Settings page. No design-note files were added to the plugin tree; the per-patch reports live under `.dsh-migrate/patch-reports/`.

## 1. Extension points the plugin uses now

| Surface | Current use | Official seam |
|---|---|---|
| Bundle composition | `package.json` declares `dsh.bundle.patch`; `cordis.patch.yml` inserts the host row and the `opencode-omo` preset row. | Self-contained `dsh.bundle` + `@deepseek-ai/dsh-agent-preset` |
| Preset roster | `cordis.patch.yml` embeds the full preset plugin list generated from `presets/opencode-omo/agent.cordis.yml`. | `@deepseek-ai/dsh-agent-preset` |
| Host settings | `src/index.ts` owns volatile `roles`/`sessions` config, calls `ctx.settings.configure({ auto: false })`, `ctx.settings.update()`, and `ctx.settings.mutate()`. | `settings` service |
| Composer role picker | `src/client/index.ts` registers `RoleSelect` into `conversation.input.left`; it is shown only for `opencode-omo` sessions. | `conversation.input.left` slot |
| Role Settings | `OmoSettingsSection` registers into `settings.section`; `RoleSettingsSection` registers into the plugin-owned `opencode-omo.settings.tab` nested tab. | `settings.section` + local slot map |
| Settings transport | `src/client/omo-roles-store.ts` reads/writes through `ctx.configForms.get('opencode-omo')`. The earlier private connection RPC path is gone. | `configForms` |
| Model catalog / selection | `ctx.remote.session.modelCatalog()` and `selectModel()` power the role model dropdowns and session model changes. | `remote.session` |
| Complete system prompt | `presets/opencode-omo/driver.mjs` uses `systemPrompt.section({ complete: true })`, `systemPrompt.variable()`, and `suppressRuntimeContext()`. | `systemPrompt` |
| Tool gating | `system-prompt/assemble` rewrites the model-visible tool list; `tools/pre-execute` mirrors the gate at execution time. | `system-prompt/assemble`, `tools/pre-execute` |
| maxSteps / ceiling | `agent/pre-step` adds the request-only assistant tail when available; otherwise the same text is rendered as a system section. | `agent/pre-step` (patched for the assistant tail) |
| Role route / ultrawork | `agent/inbox/claimed` calls `agent.model.select()` before step preparation; `agent/request` only applies sampling controls. | `agent/inbox/claimed`, `agent.model.select()`, `agent/request` |
| Fallback chain | `agent/request-error` returns the patched `{ kind: 'retry', modelSelection }` action. | `agent/request-error` (patched) |
| Plan persistence | `tools/post-execute` writes approved plans to `.opencode/plans/`. | `tools/post-execute` |
| Commands | `presets/opencode-omo/omo-commands.mjs` registers the seven omo slash commands. | `ctx.commands.register()` |
| Skills | `presets/opencode-omo/omo-skills.mjs` publishes bundled skills through `ctx.skills.registerProvider()`; `dsh-skill-filesystem` and `dsh-tool-skill` are mounted. | `skills`, `tool-skill` |
| Tools/subagents | `agent.cordis.yml` mounts official `dsh-tool-fs`, `dsh-tool-fs-search`, persistent terminal rows, `dsh-tool-subagent*`, `dsh-workflow-ptc`, `dsh-tool-workflow`, `dsh-tool-ralph`, `dsh-tool-web`, `dsh-tool-goal`, `dsh-plan-mode`, compaction, jobs, todo, and ask-user rows. | Official package rows |
| `apply_patch` | The private `presets/opencode-omo/apply-patch.mjs` was removed; `dsh-tool-fs` is enabled with `applyPatch: true` and uses the official `input` argument. | `dsh-tool-fs` `applyPatch` |

**dsh-side changes still used:** `patches/0001-agent-pre-step-assistant-prefill.patch` and `patches/0002-request-error-model-selection.patch`.

## 2. Official extension points it should use on this release

Adopted or already correct on `0.2.2-alpha.3`:

- **Bundle and preset:** the package is a self-contained bundle (`dsh.bundle.patch`) and declares the preset through the official `@deepseek-ai/dsh-agent-preset` row. No user-preset-root copy is required.
- **Mode picker:** the official agent-preset roster supplies mode selection. It is not a role picker and must not replace the composer role chip.
- **Composer role picker:** `conversation.input.left` is the exact documented seat. The plugin should keep using it; the official mode picker is a different entry point.
- **Role Settings:** `settings.section` plus `configForms` is the documented settings page. A generic plugin-detail card or the official mode roster is not the same menu and is not a substitute.
- **Model catalog and route selection:** `remote.session` and `agent.model.select()` are the official APIs. The plugin now records the role/ultrawork route before step preparation instead of mutating route through `agent/request`.
- **`apply_patch`:** `dsh-tool-fs` with `applyPatch: true` is the same tool entry point the plugin previously implemented privately. The private executor and its duplicate parser/architecture checks were removed. The official tool takes `input`, not the old private `patch_text`.
- **Prompt and tool assembly:** `systemPrompt.section({ complete: true })`, `system-prompt/assemble`, and `tools/pre-execute` are the correct official seams for the complete prompt and model-family tool gating.
- **Commands, skills, subagents, workflows, plan mode, goals, jobs, web, terminal, and filesystem:** the preset composes the official package rows rather than supplying replacement services.
- **Settings navigation icon:** `settings.section.icon` is available on this release, but no documented capability depends on an icon. It is optional polish, not a replacement for the Role Settings page.

No documented entry point was dropped. In particular, official `apply_patch` covers the same tool slot, while official mode selection does **not** cover the composer role picker and official generic settings cards do **not** cover the per-role Role Settings page.

**Still requiring a harness patch:**

- `MAX_STEPS_PROMPT` as a request-only assistant tail: no official `PreStepDecision.assistantPrefill` field exists, and `agent/request` cannot mutate request messages or change the role of an appended message.
- In-step fallback on a different model: `RequestErrorAction` still only supports `{ kind: 'retry' }`; the loop fixes `decision.selection` before the retry, so `agent.model.select()` alone cannot move the retry to the fallback route.

## 3. Edits made

The working tree contains these migration edits, left uncommitted:

- **Patch 0001** rebased onto `dsh-v0.2.2-alpha.3`: adds `PreStepDecision.assistantPrefill`, request-only assistant request assembly, `EpochHeader.assistantPrefill` canonicalization/equality/logging, token-pressure pricing, `AgentLoop.supportsAssistantPrefill`, and a focused harness test.
- **Patch 0002** added: adds `RequestErrorAction.modelSelection`, records it through `agent.model.select()`, uses it for the retry, exposes `AgentLoop.supportsRequestErrorSelection`, and adds a focused harness test.
- **`apply_patch` migration:** deleted `presets/opencode-omo/apply-patch.mjs`; enabled the official tool in `presets/opencode-omo/agent.cordis.yml` and `cordis.patch.yml`; updated `permission-rules.mjs` for the official `input` argument (with a `patch_text` read fallback for older sessions); updated the architecture and isolation tests.
- **Loop migration:** `driver.mjs` now selects the role route through `agent.model.select()` from `agent/inbox/claimed`, limits `agent/request` to sampling, and returns the patched fallback selection from `agent/request-error`.
- **Release metadata:** updated `alignment.json`, README baseline, `design.md`, `patches/README.md`, package peers/version, and `package-lock.json` to the `0.2.2-alpha.3` / Cordis `4.0.6-alpha.2` cohort.
- **Patch reports:** `.dsh-migrate/patch-reports/assistant-prefill/report.md` links the existing upstream request; `.dsh-migrate/patch-reports/request-error-model-selection/report.md` is the discussion draft.

**Validation:**

- `npm test`: 150 passed, 1 skipped (live `dsh web` unavailable).
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Both patches apply cleanly and in order to a pristine `dsh-v0.2.2-alpha.3` source archive.
- Harness focused tests: `assistant-prefill` and `request-error-selection` both pass.
- Session/request-header and token-meter suites: 147 tests pass.
- `tsc -b packages/core/agent-loop packages/core/session packages/llm/token-meter`: passed.

## 4. Remaining gaps that still need a harness patch or general-purpose harness change

1. **Request-only assistant prefill (`0001`).** Needed to keep opencode’s assistant-role `MAX_STEPS_PROMPT` complete. Existing upstream request: [Discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407). The stock-host system-section path is a documented degrade, not a replacement.
2. **Model selection for `agent/request-error` (`0002`).** Needed for the documented in-step role fallback chain. No direct issue, PR, or discussion request was found; the discussion draft is at `.dsh-migrate/patch-reports/request-error-model-selection/report.md`. Related upstream discussions: [dsh-model-pin #5152](https://github.com/deepseek-ai/deepseek-harness/discussions/5152) and [dsh-quota-router #3544](https://github.com/deepseek-ai/deepseek-harness/discussions/3544).
3. **General per-attempt route/prompt handling.** Even with `0002`, the retry advances the request route but reuses the step’s assembled prompt/tool surface. A fully general solution would let a replacement attempt re-assemble the prompt and tool schemas for the new selection, or expose that as part of the retry action. This is noted as a question in the 0002 discussion draft.
4. **Child role metadata.** A cold-resumed child cannot recover a missing omo role pin from dsh child headers/descriptors and falls back to the read-only oracle role. A general harness change could expose child role/preset metadata or persisted delegation identity.
5. **Plan-file seam.** dsh has no first-class plan-file persistence; the plugin writes `.opencode/plans/*` after approval. A general plan-file seam would remove this plugin-owned fallback.
6. **Provider-visible `format` / `toolChoice`.** Still an unpatched proposal and not used by omo’s regular path; a separate structured-output plugin covers the common route.
7. **Non-harness differences.** team-mode TUI, the comment-checker CLI, and the hashline diff enhancer remain editing/UX differences rather than missing dsh extension points.

## 5. Risks

- **Patch maintenance:** both patches extend public loop types; upstream API changes can invalidate them. They need rebasing, focused tests, and capability-marker checks on every harness release.
- **`apply_patch` parameter change:** the official tool uses `input`; old private calls used `patch_text`. The plugin reads both for permission checks and documents the official argument, but model-visible prompts and saved sessions may still carry the old name.
- **Fallback prompt reuse:** the request route advances to the fallback model, but the assembled prompt/env/tool table can still reflect the primary model for that retry. This is a known fidelity gap, not a missing entry point.
- **Route timing:** role and ultrawork selection depend on `agent/inbox/claimed` firing before the loop captures the step selection. Programmatic starts that bypass that path may keep the session route until the next claimed turn.
- **Stock-host degradation:** without `0001`, the ceiling text is a system section; without `0002`, the fallback chain is not consumed in-step. Both are survivability paths, not the complete opencode surface.
- **Prerelease peer cohort:** peers target `^0.2.2-alpha.3`; older `0.2.1-rc.2` profiles are outside the declared support claim. The lockfile diff is large because the whole DSH/Cordis cohort moved.
- **Browser UI coverage:** the client bundle builds and unit tests pass, but the composer picker and Role Settings page were not exercised in a fresh browser E2E run on this alpha.3 pass.
- **No commit:** the harness and plugin changes remain uncommitted, as required.