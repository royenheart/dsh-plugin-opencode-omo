# Mapping `@royenheart/dsh-plugin-opencode-omo` onto `dsh-v0.2.2-rc.1`

## 1. Extension points the plugin uses now

The package is a self-contained dsh bundle: `package.json` declares `dsh.bundle.patch → cordis.patch.yml` and `dsh.client` injects the browser half. The patch inserts the plugin host row and the official `@deepseek-ai/dsh-agent-preset` row; there is no separate user-preset-root copy. `install.py` / `dsh plugin` reconcile `dsh.profile.bundles`.

| Surface | Current use | Location |
|---|---|---|
| Bundle composition | `dsh.bundle.patch`, ordered preset child plugin list | `package.json`, `cordis.patch.yml` |
| Agent preset | Official `@deepseek-ai/dsh-agent-preset` declaration configured with the `opencode-omo` composition | `cordis.patch.yml`, `presets/opencode-omo/agent.cordis.yml` |
| Composer slot | `conversation.input.left` list entry `opencode-omo-role` | `src/client/index.ts` |
| Settings slot | `settings.section` entry `opencode-omo`, plus the plugin-owned nested `opencode-omo.settings.tab` | `src/client/index.ts`, `src/client/OmoSettingsSection.tsx` |
| Settings RPC/data | `ctx.settings.configure({ auto: false })`, `ctx.settings.update/mutate`, `ctx.configForms.get('opencode-omo')` | `src/index.ts`, `src/client/index.ts` |
| Session RPC | `remote.session.modelCatalog()` and `remote.session.selectModel()` | `src/client/index.ts` |
| Host service | `ctx.omoRoles` role registry; `agentLoop.supportsAssistantPrefill` capability probe | `src/omo-role-registry.ts`, `presets/opencode-omo/driver.mjs` |
| Event seams | `system-prompt/assemble` (sections/variables only now), `agent/inbox/claimed`, `agent/pre-step`, `agent/request`, `agent/request-error`, `agent/created`, `tools/pre-execute`, `tools/post-execute`, `tools/execute` | `presets/opencode-omo/*.mjs` |
| Tool registry | Per-agent `ctx.tools.register(..., { when })`, scoped `ctx.tools.restrict`, `ctx.tools.get/schemas/definitions` | `presets/opencode-omo/driver.mjs`, `tool-surface.mjs`, `escalating-bash.mjs` |
| dsh-side change | `PreStepDecision.assistantPrefill`, request-only assistant tail | `patches/0001-agent-pre-step-assistant-prefill.patch` and the baseline variant |

The patch variants are:

- `patches/0001-agent-pre-step-assistant-prefill.patch` — `dsh-v0.2.2-rc.1` (`66491b05`);
- `patches/0001-agent-pre-step-assistant-prefill-0.2.1-rc.2.patch` — declared peer baseline `dsh-v0.2.1-rc.2` (`687f282`).

## 2. Official extension points it should use on this harness release

The release still declares both seats the plugin needs: `conversation.input.left` in `packages/client/ui-conversation/src/client/contract/slots.ts`, and `settings.section` in `packages/client/ui-settings/src/client/contract/slots.ts`. The settings shell also adds optional `settings.section.icon`; that is an icon seat, not a replacement for the Role Settings page, and the plugin documents no icon entry point.

| Documented entry point | Same-entry harness surface on `0.2.2-rc.1`? | Decision |
|---|---|---|
| Complete opencode + omo system prompt, live env block, harness-identity suppression | `ctx.systemPrompt.section({ complete: true })`, variables, `suppressRuntimeContext()` | Keep; already official |
| Composer omo role picker | `conversation.input.left` remains the composer tool-row list; no official role picker exists there | Keep the plugin registration |
| Global Role Settings page with per-role primary/fallback models | `settings.section` plus official `configForms` / settings RPC; no official per-role editor | Keep the plugin page; do not substitute an unrelated settings tab |
| opencode tool descriptions and parameter names | No official tooling rewrites these; per-agent scoped registrations are the correct official mechanism | Migrated to per-agent definitions |
| Model-family gating (`apply_patch` vs `edit`/`write`) and hidden dsh names | `ctx.tools.register(..., { when })` plus scoped `ctx.tools.restrict`; `system-prompt/assemble` no longer owns tool declarations | Migrated to step admission |
| `apply_patch` (`patch_text`) | Official `tool-fs.apply_patch` exists, but uses Codex's single `input` field and is opt-in; not the same schema/entry point | Keep the plugin tool |
| `task()` / `background_output` / `background_cancel` | Official subagent/job tools provide backend capabilities, not this model-facing contract | Keep |
| omo named roles, prompts, restrictions | Official `tool-subagent` supplies delegation, not omo role content | Keep |
| AGENTS.md/CLAUDE.md injection, skills, persistent bash, local fs | Official `dsh-agent-instructions`, `dsh-skill-filesystem`, `dsh-tool-skill`, `dsh-tool-bash-persistent`, `dsh-fs-local` | Keep; already official |
| omo slash commands, comment-checker, hashline, rules injection, plan-file writing | No official same-entry implementations | Keep |
| `web_fetch` | Official base bundle already registers the HTTP fetch provider | Do not insert a second provider |
| Official agent-preset / bundle declaration | `@deepseek-ai/dsh-agent-preset` and `dsh.bundle.patch` are the intended composition points | Keep; already correct |
| `MAX_STEPS_PROMPT` request-only assistant tail | `PreStepDecision` is still `reject | { kind: 'enter', messages, startsRequestSeries? }`; `agent/request` cannot mutate request messages | Keep the patch; do not replace it with a system-prompt section |

The harness change that matters here is the conditional-tool contract: `ctx.tools.register(definition, { when })` resolves availability per step with `{ agent, modelSelection, signal }`, and `system-prompt/assemble` receives sections/contexts/variables without a tool array. The plugin now uses that contract instead of mutating `assembly.tools`.

## 3. Edits you made

- Rebased the assistant-prefill patch onto `dsh-v0.2.2-rc.1`; kept the original variant for the declared `0.2.1-rc.2` baseline; updated `patches/README.md` and `README.md`.
- Added `presets/opencode-omo/tool-policy.mjs` as the single hidden-name/model-family/role predicate, shared by registration conditions and the execution-side gate.
- Refactored `driver.mjs` to:
  - keep per-session route state at module scope;
  - expose `restrictionFor(agent)` and `currentToolModel(ctx, agent)`;
  - stop rewriting `tools` in `system-prompt/assemble`;
  - read the step-admitted `context.toolSet` when rendering the prompt's tool table.
- Refactored `tool-surface.mjs` to register per-agent conditional `read_image`, `read`, `edit`, `write`, `web_search`, `glob`, `grep`, `todo_write`, `skill`, `web_fetch`, and `apply_patch` definitions, and to apply scoped restrictions to inherited tools. This preserves inherited `when` conditions such as plan-mode's `exit_plan_mode`.
- Updated `escalating-bash.mjs` to carry the same admission condition and to use opencode's bash description through a provider installed by `tool-surface.mjs`.
- Removed tool-array rewrites from the `delegation-surface.mjs` and `lsp-surface.mjs` waterfalls.
- Added `tests/tool-admission.spec.mjs` and `tests/support/stub-executor.mjs`; updated `tests/preset-isolation.spec.mjs` for the explicit executor requirement.
- Updated `design.md` and `docs/exps/AUDIT.md` to describe step admission rather than assembly-array mutation.

Verification performed:

- Harness checkout: `git apply --reverse --check` confirms the 0.2.2 patch matches the applied tree; targeted vitest run passed **4 files / 59 tests**.
- Plugin, against an exact `0.2.2-rc.1` dependency set: `npm run build` passed; full suite passed **150 tests, 1 skipped** (the live-web test skips without a running `dsh web`).
- `node scripts/check-alignment.mjs` and `node scripts/check-architecture.mjs` passed.
- The baseline patch variant was checked with `git apply --check` against `dsh-v0.2.1-rc.2`.

No commit was made, and no Agent Note or design-note file was added to the plugin repository.

## 4. Remaining gaps that still need a harness patch or a general-purpose harness change

**Required patch: request-only assistant prefill.** Open code appends `MAX_STEPS_PROMPT` as an assistant-role continuation on the ceiling step. The harness still cannot express that through `agent/pre-step` or `agent/request`, so both patch variants remain required for the complete surface. Upstream request and evidence:

- [Discussion #2407 — Request-only assistant prefill for `agent/pre-step`](https://github.com/deepseek-ai/deepseek-harness/discussions/2407)
- Full patch report: `.dsh-migrate/patch-reports/agent-pre-step-assistant-prefill/report.md`

The 0.2.2 patch report includes the exact rebased patch, the verification run, and the upstream questions about header-only request data and session-format acknowledgement.

No new harness patch is required for tool gating: conditional registrations and step admission are official on this release, and the plugin now uses them. The other items in the plugin README remain optional or product-internal rather than same-entry replacements:

- `GenerateOptions.format` / `toolChoice` is still absent, but omo's regular path does not use it; the separate structured-output plugin covers the common route.
- Child subagent role identity is not carried in child headers/descriptors; primary-role sampling defaults are applied and children inherit the session model.
- Plan files are still plugin-written under `.opencode/plans/`; a first-class plan-file seam would be a general-purpose improvement, not a requirement for the documented entry point.

## 5. Risks

- **Header-only prefill without a format bump.** `EpochHeader.assistantPrefill` is durable request metadata but not a transcript message. Replay/readers and pricing need explicit compatibility review; the patch report asks upstream whether a session-format acknowledgement is required.
- **Two patch variants can drift.** The 0.2.2 variant is runtime-tested; the baseline variant is only `git apply --check`-tested on its tag. Regenerate both from one source change when either target moves.
- **Tool-route timing.** Tool conditions run before `agent/request`; `currentToolModel()` re-derives the role/fallback route so admission and the actual request agree. If a future harness changes condition timing or route ownership, this duplication must be revisited.
- **Late-added tools.** Per-agent shadows and scoped restrictions are established at `agent/created`. Tools registered after that point are not automatically re-gated or given opencode descriptions; the current composition's tools are static, but a future dynamic tool source would need a `tools/change` reconciliation.
- **`apply_patch` name collision.** The official `tool-fs.apply_patch` uses a different schema and is opt-in. If a future composition enables it in the same scope, the plugin's `apply_patch` must continue to shadow it with the `patch_text` contract, and that collision should be tested.
- **Support claim.** The plugin still declares `0.2.1-rc.2` as its active peer baseline even though the source and build/tests pass on `0.2.2-rc.1`. Promote the baseline only after the review and a real mount; do not infer support from the rebase alone.
- **Validation boundary.** The plugin suite and build passed against exact `0.2.2-rc.1` packages, but the live Web registration test was skipped because no `dsh web` instance was running. Client slot registration was typechecked and unit-tested, not exercised in a live browser.