## 1. Plugin purpose

Per the README, `@royenheart/dsh-plugin-opencode-omo` adds an `opencode-omo` agent preset that reproduces **opencode + omo** for that mode only. Its documented product surface is:

- **`opencode-omo` mode** declared through the official `@deepseek-ai/dsh-agent-preset` bundle row and selected from the mode picker.
- **Complete replacement system prompt**: opencode’s persona plus omo’s Sisyphus identity, with the dsh harness identity and runtime snapshot suppressed, a live `<env>` block recomputed each step, per-role prompt swapping, plan/build prompts, and omo rules folded into the prompt.
- **Composer role picker** in `conversation.input.left`: `sisyphus`, `hephaestus`, `prometheus`, `atlas`, `sisyphus-junior`; specialist roles are reached through `task(subagent_type=...)`.
- **Global “Role Settings” page** in `settings.section`: per-role primary model (`follow current` / omo default / fixed), reasoning effort, fallback add/search/cancel/remove, settings persistence, and legacy settings migration.
- **Complete opencode toolchain**: persistent `bash`, `read`/`write`/`edit`/`read_image`, `apply_patch`, `glob`/`grep`, `todo_write`, `skill`, `web_fetch`/`web_search`, the named LSP navigation tools, `exit_plan_mode`, and `ask_user_question`. Tool descriptions/parameters are shimmed, and GPT-family `apply_patch` vs `edit`/`write` gating is enforced on both the model-visible schema and execution.
- **omo `task()` surface** over dsh’s named subagents and generic delegation.
- **omo multi-role subagents**: `oracle`, `librarian`, `explore`, `metis`, `momus`, `multimodal-looker`, plus generic subagent/fork/workflow/ralph delegation and the hidden `send_message` return channel.
- **Context injection**: AGENTS.md/CLAUDE.md walk-up, bundled skills, and omo’s rules-injector (`.omo/rules`, `.cursor/rules`, `.github/instructions`, `copilot-instructions.md`).
- **omo hooks**: `comment-checker` and `hashline`.
- **Per-mode execution backend**: local filesystem and persistent PTY shell, isolated from other presets.
- **Native-seam loop shim**: complete prompt assembly, ultrawork detection, maxSteps, role model routing/fallback, retryable-error gating, and approved-plan persistence.
- **omo builtin commands and skills**: `/start-work`, `/remove-ai-slops`, `/refactor`, `/stop-continuation`, `/handoff`, `/hyperplan`, `/team-mode`; bundled skills published as `user-dsh`.
- **Bundle/install lifecycle**: `install.py`, bundle patch, optional LSP links, legacy `opencode-omo-roles` → `opencode-omo` migration.
- **Two required dsh-side surfaces**: request-only assistant prefill for `MAX_STEPS_PROMPT`, and in-step role fallback selection. These are product requirements, not optional enhancements.

The README also documents fallback paths on unpatched hosts; those are survivability paths, not permission to delete the patched entry point.

## 2. Official overlap

At `dsh-v0.2.2-alpha.3`, only one documented **entry point** is now covered by the official harness: **`apply_patch`**.

- The v0.2.2-alpha.3 release notes add “`apply_patch`, disabled by default, to create, edit, delete, and move multiple files in one call” — [release v0.2.2-alpha.3](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-alpha.3).
- `packages/fs/tool-fs/src/apply-patch.ts` registers the tool under the same name, `apply_patch`, with `Config.applyPatch` defaulting to `false`; the `tool-fs` README documents `input` as its argument.
- This is the same tool slot and the same patch-application behavior the plugin previously implemented itself in `presets/opencode-omo/apply-patch.mjs`.

The rest of the apparent “official overlap” is infrastructure, not the plugin’s entry point:

- `@deepseek-ai/dsh-client-ui-agent-preset` now owns the **new-session mode picker** and **Settings mode roster**. The plugin’s composer role picker and per-role Role Settings page live in different slots (`conversation.input.left`, `settings.section`); official mode selection is not role selection.
- `@deepseek-ai/dsh-client-ui-skill` adds `/` skill invocation and a skill tool row. It does not register or manage the plugin’s bundled omo skills; the plugin still uses the official `tool-skill` plus its own `omo-skills.mjs` source.
- The unified context-menu extension covers session/workspace/sidebar menus. The plugin documents slash commands and a composer picker, not context-menu entries.
- `settings.section`, `configForms`, and `conversation.input.left` remain official extension points. The harness has no per-role omo settings form or composer role chip in those slots.
- `agent.model.select()` is the new supported **model-selection API**; it does not provide the plugin’s Role Settings UI or fallback behavior. It required migrating the driver, not retiring a capability.
- `agent/request-error` still returns only its existing retry action; `PreStepDecision` still has no assistant-prefill field. The two dsh-side patches remain necessary.

## 3. Decision: shrink

**Shrink** — retire the duplicate private `apply_patch` implementation because the official harness now ships the same tool entry point. Keep every other documented capability, including the composer role picker, Role Settings, task/subagent surfaces, hooks, commands, skills, execution backend, and both dsh-side patches. No user-facing capability is retired.

## 4. Concrete edits made

- Deleted `presets/opencode-omo/apply-patch.mjs`; enabled the official tool with `tool-fs: { applyPatch: true }`; removed the old preset row and regenerated `cordis.patch.yml`.
- Updated `permission-rules.mjs` to extract patch paths from the official `input` argument, retaining the shared `patch-parser.mjs` for path checks. Updated architecture/isolations tests accordingly.
- Migrated the loop shim to the 0.2.2 model-selection contract:
  - `agent/inbox/claimed` now calls `agent.model.select()` before step preparation for the role primary/ultrawork route.
  - `agent/request` now applies only omo sampling defaults; it no longer changes route/effort.
  - `agent/request-error` returns the patched `{ kind: 'retry', modelSelection }` action when available and otherwise delegates to the harness retry policy.
- Rebased `patches/0001-agent-pre-step-assistant-prefill.patch` onto `dsh-v0.2.2-alpha.3`.
- Added `patches/0002-request-error-model-selection.patch`, adding `RequestErrorAction.modelSelection` and `AgentLoop.supportsRequestErrorSelection`, with focused harness tests.
- Updated `alignment.json`, README baseline, design notes, patch documentation, peer dependencies, plugin version (`0.2.1`), and the lockfile to the `0.2.2-alpha.3` / Cordis `4.0.6-alpha.2` cohort.
- Added `.dsh-migrate/patch-reports/assistant-prefill/report.md` (links existing discussion #2407) and `.dsh-migrate/patch-reports/request-error-model-selection/report.md` (discussion draft; no direct upstream request found, related discussions #2407, #5152, #3544 cited).

Validation performed:

- `npm test`: 150 passed, 1 skipped.
- `npm run typecheck`, `npm run build`, `npm run check:alignment`, `node scripts/check-architecture.mjs`: passed.
- Both patches applied sequentially to a clean alpha.3 worktree; focused harness tests passed.
- Real `dsh --profile web` boot with the linked plugin and live `tests/e2e-dsh-load.spec.mjs` bundle load: passed.
- No commit was made.

## 5. Risks

- **`apply_patch` schema changed**: the official tool takes `input`, while the removed private tool took `patch_text`. This preserves the tool entry point but is a model-visible parameter change; exact opencode `patchText` fidelity is not preserved.
- **`agent/model` timing**: role selection depends on `agent/inbox/claimed` firing before step preparation. Programmatic/edge turn starts without a claimed message may not reassert a role route until the next claimed turn.
- **Fallback patch is an upstream API extension**: if upstream chooses adapter-level fallback or a different retry-selection design, `0002` will need rebasing or retirement.
- **Stock-host fallback degrades**: without `0002`, a request failure stays on the failed route under the harness retry policy; the configured role fallback chain is not consumed in-step.
- **Fallback prompt reuse**: a retry reuses the primary step’s assembled prompt/tool surface, as before; the request route advances but the prompt may still name the primary model.
- **`agent/request` is deprecated**: the plugin still uses it for temperature sampling only. A future harness removal would need another control seam.
- **Real UI surface not browser-tested**: the live host boot and client bundle load passed, but the composer picker, Role Settings form, and slash-menu behavior were not exercised in a browser on alpha.3.
- **Prerelease cohort and lockfile**: peer ranges target `^0.2.2-alpha.3`; older `0.2.1-rc.2` hosts are no longer claimed, and the regenerated lockfile is a large diff.
- **Official `apply_patch` registration inside the preset isolate realm** was verified by config dump, not by a real tool execution against a running session.