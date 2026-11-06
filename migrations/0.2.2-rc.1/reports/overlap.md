# dsh 0.2.2-rc.1 review: `@royenheart/dsh-plugin-opencode-omo`

## 1. Plugin purpose

The plugin documents an `opencode-omo` agent preset that reproduces opencode + oh-my-openagent behavior, scoped to that preset. Its stated capabilities and entry points are:

- **Complete opencode + omo system prompt** — opencode’s `default.txt` persona and omo Sisyphus identity, a live `<env>` block recomputed per assembly, suppression of the harness identity/runtime snapshot, model-family tool gating, maxSteps, role model routing/fallback, ultrawork detection, and the plan/build prompts (`driver.mjs`, `persona.md`, `roles/`).
- **Composer role picker** — the primary/all omo role selector in the existing `conversation.input.left` slot, mounted as entry `opencode-omo-role`. Selecting a role changes the session’s complete system prompt and applies that role’s configured model.
- **Global “Role Settings”** — a section in dsh’s `settings.section` panel, entry id `opencode-omo`, with a nested `opencode-omo.settings.tab` tab. Each role gets a primary model choice (follow current / omo default / fixed), a repeatable fallback-model list, and reasoning-effort controls, persisted in the `opencode-omo` settings entry.
- **opencode toolchain** — persistent `bash`, `read`/`write`/`edit`/`read_image`, `apply_patch`, `glob`/`grep`, `todo_write`, `skill`, `web_fetch`/`web_search`, named LSP navigation tools, `exit_plan_mode`, and `ask_user_question`. `tool-surface.mjs` replaces model-visible descriptions/parameters with opencode’s text and shims `read`/`edit`/`write`/`web_search` to opencode parameter names.
- **omo `task()` surface** — `task(category/subagent_type/load_skills/run_in_background/task_id)` over dsh named subagents and generic delegation.
- **omo multi-role subagents** — `oracle`, `librarian`, `explore`, `metis`, `momus`, `multimodal-looker`, `athena`, `athena-junior`, `council-member`, plus `subagent`/`subagent_fork`, `workflow`, and `ralph`; delegated children keep `send_message` while the primary surface hides it behind `task()`/`background_output`.
- **omo context injection** — AGENTS.md/CLAUDE.md walk-up, `skills/`, and the omo rules-injector sources (`.omo/rules`, `.cursor/rules`, `.github/instructions`, `copilot-instructions.md`).
- **omo hooks** — `comment-checker` and `hashline` (`N#HH|content` read tags plus `hashline_edit` stale-reference guard).
- **Per-mode execution backend** — an isolated local filesystem (`dsh-fs-local`) and persistent PTY shell for this preset only.
- **Native-seam loop shim** — no dsh driver subclass; the preset uses `ctx.systemPrompt.section({ complete: true })`, `system-prompt/assemble`, `agent/inbox/claimed`, `agent/pre-step`, `agent/request`, and `agent/request-error`.
- **omo builtin commands** — `/start-work`, `/remove-ai-slops`, `/refactor`, `/stop-continuation`, `/handoff`, `/hyperplan`, `/team-mode`.
- **`user-dsh` skill publication** — the shipped omo skills are registered through the native skill registry with `source: 'user-dsh'` so the third-party `@maintainall/dsh-plugin-skills-manager` can manage them through its global/workspace/session override store.
- **Legacy settings migration** — one-time per-profile merge of the old `opencode-omo-roles` entry into `opencode-omo`, working around the host importer’s preservation of unknown sections in `settings.yaml.imported`.
- **Plan-file persistence** — approved plans are written to `.opencode/plans/<created>-<session>.md`; dsh itself does not persist plan files.
- **Optional LSP** — named LSP tools mount when the packages and TypeScript server are available, and self-disable otherwise.
- **Required dsh-side patch** — `patches/0001-agent-pre-step-assistant-prefill.patch` adds a request-only assistant tail for opencode’s `MAX_STEPS_PROMPT`. The plugin documents the system-prompt-section behavior on unpatched hosts as survivability, not as a replacement for the complete surface.

The plugin also documents that the agent-preset declaration uses the official `@deepseek-ai/dsh-agent-preset` row and that the base bundle already supplies the `web_fetch` provider; those are already official integrations, not plugin-owned duplicates.

## 2. Official overlap

Reviewed against the `dsh-v0.2.2-rc.1` checkout (commit `66491b05`). The relevant official surfaces are the settings shell, the agent-preset UI, the subagent settings page, the skill UI, `tool-fs`/`tool-web`/LSP packages, and the agent-loop types.

| Documented plugin capability / entry point | Harness 0.2.2-rc.1 evidence | Coverage |
|---|---|---|
| Composer omo role picker in `conversation.input.left` | The slot is still declared in `packages/client/ui-conversation/src/client/contract/slots.ts`; no official package registers a role picker there. `@deepseek-ai/dsh-client-ui-agent-preset` contributes a preset roster to `settings.section` and a preset seat/session-header label, not a composer role picker. | **Still lacks** the same entry point. |
| Global Role Settings in `settings.section` (`opencode-omo` / `opencode-omo.settings.tab`) | The settings shell declares `settings.section`; official sections are General, Account, Models, Agent presets, and Plugins. `@deepseek-ai/dsh-client-ui-settings-subagent` registers into `plugins.item` over the `subagent` and `subagent-model-selection` namespaces — a global permission switch and exact child-route list, not a per-role primary/fallback editor. | **Still lacks** the same slot and behavior; only the settings primitive overlaps. |
| Complete opencode persona and live env block | `systemPrompt.section({ complete: true })`, variables, and `suppressRuntimeContext()` already exist and are used by the plugin. No official opencode/omo persona content is shipped. | **Still lacks** the content; official primitive already used. |
| opencode toolchain (`read`/`edit`/`write`/`web_search` parameter names, descriptions, `apply_patch`, named LSP tools) | Official `tool-fs` uses `file_path`, `old_string`, `new_string`; official `tool-web` uses `queries`. Official `tool-fs.apply_patch` now exists, but its schema is Codex’s `input` parameter, it defaults to `applyPatch: false`, and `dsh-base`/Web standard enable it while PTC/cordis disable it. The plugin’s model entry point is opencode’s `patch_text`. Official LSP packages provide a service, not the plugin’s named `lsp_*` tools. | **Partially covers** the underlying jobs; **still lacks** the opencode entry points. Keeping the plugin’s `apply_patch` is required by the same-entry-point rule. |
| Persistent `bash` | Official `@deepseek-ai/dsh-tool-bash-persistent` is used directly by the preset; the plugin does not duplicate it. | **Covered** by the official row; no plugin entry point to retire. |
| omo `task()` and `background_output`/`background_cancel` | Official `@deepseek-ai/dsh-tool-subagent` registers named delegation tools and supports `agentPreset`/`modelSelection`, but there is no official `task` tool or omo background aliases. | **Still lacks** the same surface; official delegation is the backend. |
| omo named roles and multi-role subagents | Official `tool-subagent` supports named instances, preset selection, and model selection. It does not ship omo role prompts, role names, or the omo restriction table. | **Partially covers** delegation plumbing; **still lacks** the role-specific entry points. |
| AGENTS.md/CLAUDE.md and skills injection | Official `@deepseek-ai/dsh-agent-instructions` and `@deepseek-ai/dsh-skill-filesystem` are used by the preset. The omo rules-injector and its prompt folding remain plugin-owned. | **Partially covers** the official sources; **still lacks** the omo rules behavior. |
| `comment-checker` and `hashline` hooks | No official comment-checker or hashline implementation was found. | **Still lacks.** |
| Isolated local fs + persistent PTY shell | Official `fs-local`, terminal, and persistent-bash packages supply the primitives; the plugin owns the per-preset isolation realm and composition. | **Covered** at the primitive level; not a duplicate entry point. |
| omo slash commands | No official `start-work`, `remove-ai-slops`, `refactor`, `stop-continuation`, `handoff`, `hyperplan`, or `team-mode` commands. | **Still lacks.** |
| `user-dsh` omo skill publication for the third-party manager | Official `@deepseek-ai/dsh-client-ui-skill` provides the `/` skill menu and `SKILL.md` preview; official skill RPCs expose `skills/list` and source metadata. The official workspace/session overflow menus contain rename/fork/archive/pin-style actions, not skill enable/disable. No official override store or skills-management page was found. | **Still lacks** the management entry point. A coarser official skill menu or overflow menu does not cover the plugin’s third-party override-store integration. |
| Legacy `opencode-omo-roles` migration | `packages/settings/settings/src/index.ts` imports sections with matching entry ids and leaves rejected/unknown sections in `settings.yaml.imported`; it does not merge the old role/session maps. | **Still lacks** the same migration behavior. |
| `.opencode/plans` persistence | Official plan mode/logs and plan cards persist plan state, but no `.opencode/plans` file writer. | **Still lacks** the plugin’s documented plan-file behavior. |
| `MAX_STEPS_PROMPT` request-only assistant tail | `PreStepDecision` in `packages/core/agent/src/runtime-types.ts` remains `reject | { kind: 'enter', messages, startsRequestSeries? }`; `agent/request` returns `LlmCallConfig` only; no official request-only assistant message. | **Still lacks**; patch remains required. |
| `GenerateOptions.format` / `toolChoice` | No such fields in the reviewed release; the plugin already documents this as an unpatched proposal and omo’s regular path does not use it. | **Still lacks**; not a shipped plugin entry point. |
| Official agent-preset declaration | `@deepseek-ai/dsh-agent-preset` is the official declaration row and is already used by `cordis.patch.yml`; the old preset-directory/root merge was retired. | **Covered**; already deduplicated. |
| Official `web_fetch` provider | The base bundle registers the HTTP fetch provider; the plugin deliberately does not insert a second row. | **Covered**; already deduplicated. |

The closest name collision is `apply_patch`, but it is not the same entry point: official `tool-fs` takes one Codex-style `input` string, while the plugin exposes opencode’s `patch_text` contract. The official tool is also opt-in on its `tool-fs` row. Likewise, the official agent-preset picker, subagent settings page, and skill `/` menu occupy different slots or provide different behavior from the plugin’s composer role picker, Role Settings page, and `user-dsh` publication contract.

Harness evidence used includes:

- `packages/client/ui-conversation/src/client/contract/slots.ts` — `conversation.input.left` declaration.
- `packages/client/ui-settings/src/client/contract/slots.ts` — `settings.section` declaration.
- `packages/client/ui-settings-subagent/src/client/index.ts` — `plugins.item` registration over `subagent` and `subagent-model-selection`.
- `packages/client/ui-agent-preset/src/client/index.ts` — `settings.section` preset roster and session-header seat.
- `packages/client/ui-skill/README.md` — `/` skill invocation and preview, with no management/override surface.
- `packages/client/ui-workspace/README.md` — workspace/session overflow menus with rename/delete/fork/archive-style actions.
- `packages/fs/tool-fs/README.md` and `packages/fs/tool-fs/src/index.ts` — `apply_patch` schema and `applyPatch` default.
- `packages/core/tools/README.md` and `docs/upgrade-guide/v0.2.1-rc.2/conditional-tools/guide.md` — `system-prompt/assemble` no longer carries tools; conditional tools use `register(definition, { when })`.
- Agent Notes: `.agents/notes/implemented/feature/2026-09-28-apply-patch-file-editing.md`, `.agents/notes/implemented/feature/2026-10-29-shipped-fs-mutation-defaults.md`, `.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.md`, and `.agents/notes/implemented/bug-fix/2026-10-25-shared-preset-delegation-tools.md`.
- `.agents/notes/...` and the upgrade guides are the harness’s own statements of the released behavior; the patch request is tracked in [discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407).

## 3. Decision: keep

**Keep all documented entry points.** No plugin capability is covered by an official same-slot, same-menu, same-RPC, or same-setting surface. The official `apply_patch` is a same-job tool through a different schema, the official preset/subagent pages are different settings seats, and official skill UI invokes/previews skills without providing the third-party management store.

The patch is still required for the `MAX_STEPS_PROMPT` complete surface, so it was rebased rather than dropped. The unpatched system-prompt fallback remains documented survivability, not permission to delete the assistant-tail entry point.

The plugin’s active peer baseline remains `0.2.1-rc.2`. On the 0.2.2-rc.1 checkout, one separate compatibility migration is required before claiming runtime support: the plugin’s `system-prompt/assemble` tool filtering must move to the conditional-tool API (`ctx.tools.register(..., { when })`, `ctx.tools.restrict`, and step `toolSet` reads). That is a port of the same documented capability, not a reason to retire it.

## 4. Concrete edits you made or would make

**Made:**

- Rebased `patches/0001-agent-pre-step-assistant-prefill.patch` from the 0.2.1-rc.2 target onto `dsh-v0.2.2-rc.1`. The patch now carries the same `PreStepDecision.assistantPrefill` field, request-only message plumbing, `EpochHeader` logging/equality/pricing, `AgentLoop.supportsAssistantPrefill`, and the focused test, adjusted for the 0.2.2 test harness.
- Updated `patches/README.md` and `README.md` to describe the 0.2.2-rc.1 rebase while keeping the declared 0.2.1-rc.2 baseline.
- Applied the rebased patch to `/github/workspace/.dsh-migrate/harness` and ran:
  - `assistant-prefill.spec.ts`
  - `interception.spec.ts`
  - `request-header.spec.ts`
  - `token-meter.spec.ts`
  - Result: **4 files, 59 tests passed**.
- `node scripts/check-alignment.mjs` passes.
- No plugin entry point was removed, no plugin source behavior was retired, and the harness checkout was not committed.

**Would make for 0.2.2 runtime support:**

- In `presets/opencode-omo/driver.mjs`, `tool-surface.mjs`, `delegation-surface.mjs`, `lsp-surface.mjs`, and `escalating-bash.mjs`, replace reads/writes of `assembly.tools` / `transformed.tools` with conditional registrations and step-owned tool sets:
  - `ctx.tools.register(definition, { when: ({ agent, modelSelection, signal }) => ... })` for model-family and role gating;
  - `ctx.tools.restrict(...)` for role allow/deny masks where a registration cannot express the gate;
  - `ctx.tools.get(name, scope, toolSet)` / `ctx.tools.schemas(scope, toolSet)` for prompt guidance;
  - keep the existing `tools/pre-execute` deny mirror as the execution-side enforcement.
- Move the opencode description/parameter replacements onto the registered shims (or equivalent per-step definitions), since assembly can no longer rewrite model-visible tool schemas.
- Add a 0.2.2 contract test that a gated tool is absent from the resolved tool set and that a hallucinated call returns `UNKNOWN_TOOL`.
- Update `alignment.json`, the README baseline table, peer ranges, and the lockfile together only after that migration and a real 0.2.2 mount pass; do not claim 0.2.2 support from the patch rebase alone.

## 5. Risks

- **0.2.2 assembly break is release-blocking.** `tool-surface.mjs` calls `applyOpencodeSurface(transformed.tools)`, but `PromptPresentation` no longer carries `tools`; `transformed.tools` is `undefined` and the `.map` in `applyOpencodeSurface` will throw on prompt assembly. Even where a listener tolerates the missing array, a returned `tools` field is ignored by `system-prompt.assemble`, so the documented model-family gate and opencode descriptions silently stop working. The `tools/pre-execute` deny mirror still enforces calls, but the model-visible side is no longer correct.
- **Same-name `apply_patch` collision.** If the official `tool-fs.applyPatch` row is enabled later, the plugin’s scoped `apply_patch` shadows it. The two schemas (`input` vs `patch_text`) must not be mixed; the plugin entry point should be kept and explicitly tested for shadowing.
- **`assistantPrefill` is durable header data.** The patch adds an `EpochHeader` field without a session-format bump. It never becomes a transcript message, but replay/readers and pricing need the same compatibility review as any header change. The patch report asks upstream to confirm whether a format acknowledgement is required.
- **The patch test depends on `NativeToolExecutor`.** The rebased test installs it explicitly; future harness test-harness changes may require another small rebase.
- **Plugin test suite not run in this environment.** `npm test` needs the plugin’s generated `lib/` and installed dependencies; only the harness patch tests, plugin alignment check, and plugin module syntax checks were run. The untested plugin paths are the existing build/client-bundle/bench suites, not the patch content.
- **Checkout state.** The harness checkout has the patch applied, sparse-checkout paths added, and installed dependencies; none of that was committed. The plugin repo itself has only the README/patch changes plus `.dsh-migrate/patch-reports/...` (ignored by git).
- **Partial official overlap may grow.** Official preset, subagent, and skill surfaces are evolving. The current verdict is based on 0.2.2-rc.1’s slots and behavior; re-check if an official release adds per-role models or a skill override UI, because that would be the first genuine same-entry-point replacement.

Patch report: `.dsh-migrate/patch-reports/agent-pre-step-assistant-prefill/report.md` (includes the full rebased patch, the existing [discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407) link, and upstream questions).