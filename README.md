<p align="center">
  <img src="https://raw.githubusercontent.com/royenheart/dsh-plugin-opencode-omo/main/assets/banner.png" width="100%" alt="dsh-plugin-opencode-omo" />
</p>

# @royenheart/dsh-plugin-opencode-omo

[![dsh](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Froyenheart%2Fdsh-plugin-opencode-omo%2Frefs%2Fheads%2Fdsh-migrate%2Fstate%2Fbadge.json)](https://github.com/royenheart/dsh-plugin-opencode-omo/tree/dsh-migrate/state)

A DeepSeek Harness plugin that adds an `opencode-omo` agent preset (mode) to the web profile. The mode replicates the behavior of **opencode** + the **omo** plugin ([oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)), scoped to this mode only — other presets (`standard`/…) keep the default dsh loop, sandboxed fs, and no omo hooks.

## What the mode provides

- **opencode + omo system prompt** — the real opencode `default.txt` persona (tone, style, proactiveness, conventions, code style, task guidance) + omo's Sisyphus orchestrator identity, declared as the **complete** system prompt: the dsh harness identity and runtime-context snapshot are suppressed for this mode. The loop shim additionally prepends opencode's **live environment block** (exact model id, working dir, workspace root, git, platform, date, recomputed every step).
- **omo role picker in the composer** — in dsh's existing `conversation.input.left` tool-row slot (after the access/plan chips): `sisyphus`, `hephaestus` (Deep Agent), `prometheus` (Plan Builder), `atlas` (Plan Executor), `sisyphus-junior`, `athena`/`athena-junior`/`council-member`, `metis`, `momus`, `oracle`, `librarian`, `explore`, `multimodal-looker`. Selecting a role swaps the session's complete system prompt and applies that role's configured model.
- **Global "Role Settings"** in the dsh settings panel (`settings.section`): per-role primary model dropdown (follow current / fixed) under a centered "Primary model" label; a dsh-style circle "+" button opens a fallback model list below the role box (repeatable additions, cancel/close adds nothing). The page is the plugin's own; the durable data is the `opencode-omo-roles` profile entry's volatile Config (`roles` + `sessions`), edited through dsh 0.1.7's Config-derived form (`ctx.configForms.get(entryId)`) on loopback and through the authenticated `/opencode-omo` channel on a non-loopback page, where dsh deliberately keeps settings forms process-local. On request failure the loop shim advances through the role's fallback chain before the harness retry policy runs.
- **opencode toolchain (complete)** — persistent `bash`, `read`/`write`/`edit`/`read_image`, `apply_patch`, `glob`/`grep`, `todo_write`, `skill`, `web_fetch`/`web_search`, `lsp`, `exit_plan_mode` (plan), `ask_user_question`. `tool-surface.mjs` overwrites the model-visible descriptions/parameters with opencode's `tool/*.txt` text and shims `read`/`edit`/`write`/`web_search` to opencode's parameter names (`web_search.query` → dsh `queries`).
- **omo `task()` surface** — `task-shim.mjs` registers the omo-style `task(category/subagent_type/load_skills/run_in_background/task_id)` invocation, mapping it onto dsh named subagents + generic delegation.
- **omo multi-role subagents** — `oracle` (read-only advisor), `librarian` (external docs/code search), `explore` (codebase grep), `metis` (pre-planning), `momus` (plan reviewer), `multimodal-looker` (media), plus generic `subagent`/`subagent_fork` + `workflow`/`ralph`.
- **omo context injection** — AGENTS.md/CLAUDE.md walk-up + `skills/` + omo's `rules-injector` (`.omo/rules`, `.cursor/rules`, `.github/instructions`, `copilot-instructions.md`).
- **omo hooks** — `comment-checker` (rejects AI-slop comments on write/edit), `hashline` (read tagging `N#HH|content` + `hashline_edit` stale-ref guard).
- **per-mode execution backend** — local filesystem (`dsh-fs-local`) + persistent PTY shell, isolated from other modes' sandboxed fs/shell.
- **native-seam loop shim** — no dsh-side driver seam. `driver.mjs` is an ordinary preset plugin using the shipped seams: a dynamic `ctx.systemPrompt.section({ complete: true })` recomputes opencode's env block and the selected omo role prompt per assembly; `system-prompt/assemble` applies opencode's model tool gating; `agent/inbox/claimed`, `agent/pre-step`, `agent/request`, and `agent/request-error` provide ultrawork detection, maxSteps (request-only assistant prefill when the harness ships patch 0001, system-prompt section otherwise), role model routing, and fallback retry. Other presets are untouched by construction.

## Layout

```
cordis.patch.yml                 # GENERATED bundle patch: host row + preset declaration
cordis.patch.template.yml        # committed host-row half of the bundle patch
install.py                       # idempotent install/uninstall (profile link + bundle entry)
locale/                          # plugin display metadata for the Plugins page (en/zh)
src/                             # host + client plugin halves (role registry, settings, picker UI)
lib/                             # built host/client bundles (npm run build)
scripts/build.sh                 # typecheck + tsdown build + preset patch generation
scripts/build-preset-patch.mjs   # generates cordis.patch.yml from the template + composition
presets/opencode-omo/
  agent.cordis.yml               # the composition (tools, roles, hooks, LSP)
  preset.yml                     # display metadata (feeds the declaration row)
  persona.md                     # opencode default.txt + omo Sisyphus persona
  roles/*.md                     # subagent personas (also main-role prompts)
  roles/prompts/*.md             # primary-role complete prompts (hephaestus/prometheus/atlas/…)
  skills/                        # omo shared skills
  driver.mjs                     # native-seam loop shim (prompt/route/fallback/maxSteps/ultrawork)
  rules.mjs                      # rules-injector
  comment-checker.mjs            # comment-checker hook
  apply-patch.mjs                # apply_patch tool
  hashline.mjs                   # omo hashline read-tagging + hashline_edit
```

## Install

`lib/` is generated locally and is not committed. `install.py` always builds the repository's own toolchain first (`npm install` when the toolchain is missing, then `npm run build`) and only reports an error when npm itself is missing:

```sh
python3 install.py install --profile web              # install (idempotent)
python3 install.py uninstall --profile web            # remove
```

`install.py` symlinks the package into `~/.dsh/profiles/<profile>/node_modules/`, edits the profile's `package.json` (adds/removes the dependency + bundle entry), and the bundle patch declares the `opencode-omo` preset as a `@deepseek-ai/dsh-agent-preset`-shaped declaration row: the package's own `presets/opencode-omo/preset-row.mjs`, which keeps the official config and `EntryGroup` contract but activates without the preset registry and submits the definition through `agentPresets.register()` once it exists, so a headless composition never leaves a pending loader entry. `cordis.patch.yml` is generated during `npm run build` from `cordis.patch.template.yml` plus `presets/opencode-omo/agent.cordis.yml`; the loader resolves the preset's `./driver.mjs`-style rows through the package subpath export, so updates stay live without touching `$DSH_HOME`.

The package is self-contained as a bundle: `dsh.bundle.patch` points at the generated `cordis.patch.yml`, every row it inserts resolves inside the package (host row → `lib/index.js`, client half → `./client`, preset rows → the `./presets/*` export), and a `prepare` script builds `lib/` from source so a git/pnpm install produces the same artifacts (pnpm asks the user to allowlist that build).

Manual alternative — the package is a dsh **bundle**: it declares `dsh.bundle.patch` and ships the patch that declares the preset. Build it first (`npm install && npm run build`), then:

```sh
dsh plugin --profile web add link:/path/to/dsh-plugin-opencode-omo
```

No separate preset publication step exists on 0.1.7: the former `$DSH_HOME/.agent-presets` directory root is no longer read by the harness, and `install.py` retires it (removing only symlinks it previously created).

Restart dsh and select **opencode-omo** from the mode picker.

**Optional LSP server.** The preset preconfigures `typescript-language-server` for the `lsp` tool. `install.py` checks `PATH` and warns when it is missing; the preset then self-disables its `lsp-stdio` row so the mode still mounts (LSP queries fail gracefully instead of blocking the whole preset). Install it to enable LSP:

```sh
npm install -g typescript-language-server typescript
```

then restart dsh.

**web_fetch provider.** The preset enables dsh's native `web_fetch` tool (`fetch: true`). Official 0.1.7 already registers `@deepseek-ai/dsh-web-fetch-http` in the base bundle, so this plugin does **not** insert a second fetch row (that would throw `WEB_DUPLICATE_PROVIDER`). `web_search` keeps using the existing DeepSeek search provider (`DEEPSEEK_API_KEY`). Other presets keep `fetch: false`, so their tool surface is unchanged.

## Required dsh-side changes

**This release ships one dsh patch:** [`patches/0001-agent-pre-step-assistant-prefill.patch`](patches/0001-agent-pre-step-assistant-prefill.patch), rebased onto `dsh-v0.1.7-alpha.1`. It adds the general-purpose request-only assistant continuation opencode's `maxSteps` behavior needs:

- `PreStepDecision.enter.assistantPrefill?: string` — returned by an `agent/pre-step` listener, appended by the loop as one assistant message after the derived history on every attempt of that step;
- `EpochHeader.assistantPrefill?: string` — recorded on the existing `request/header` snapshot, so log reconstruction reproduces the request and the loop's reconstruction invariant stays true;
- no session message: transcript, stats, and compaction omit the text.

The plugin detects the seam by the `assistantPrefill` marker in the **running installation's** resolved `@deepseek-ai/dsh-agent-loop` entry: the host registry probes the dsh install anchor / profile directory (the loop the harness actually loads) and exposes the answer to the preset driver, which falls back to a probe from its own module tree only when the host row is absent. **With the patch**, `MAX_STEPS_PROMPT` is opencode's assistant-role request tail. **Without it**, the same text and trigger render as a system-prompt section on the ceiling step (`ctx.systemPrompt.section`), and the driver logs which path is active. The fallback keeps the mode usable on a stock harness; it is not equivalent, and the surface is not dropped.

### Behavioral gaps on a stock harness

These differences are intentional and remain until [discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407) (or an equivalent) lands upstream:

| Surface | opencode / patched-harness | Stock 0.1.7 |
|---|---|---|
| Role of `MAX_STEPS_PROMPT` | Assistant-role continuation at the end of the request | System-prompt prefix for that step |
| Session transcript / stats / compaction | Request-only (header), not a session message | Also not a session message (system section is reassembled) |
| How strictly models stop / wrap up | Tuned for an assistant tail | May treat a system reminder more weakly or more strongly |
| Token placement | Extra assistant tokens on that request | Extra system tokens on that request |
| Reconstructable-requests | Logged on `request/header` | Rebuilt from the live prompt assembly |

Provider-visible `format`/`toolChoice` remains an unpatched proposal; omo's regular path does not use it.

Everything else runs on unmodified dsh seams: the preset is declared as a `@deepseek-ai/dsh-agent-preset`-shaped row in the generated bundle patch (registered through the official `agentPresets` service), the composer picker occupies the existing `conversation.input.left` slot, and the role page occupies the existing `settings.section` slot over the entry's volatile Config form.

## Bench experiments (equivalence validation)

Runners and reproduction notes live in [`tests/benches/`](tests/benches/README.md); reports are written to `docs/exps/`. The scientific methodology (paired design, McNemar/bootstrap/TOST, A/A noise floor, trace alignment, cache and latency protocols) is documented in [`docs/exps/2026-08-16-scientific-bench-methodology.md`](docs/exps/2026-08-16-scientific-bench-methodology.md). Design highlights:

- Run an isolated-port dsh (`opencode-omo` mode, isolated `$DSH_HOME`) and the machine's installed opencode + oh-my-openagent (isolated `XDG_CONFIG_HOME`).
- Both use `deepseek-official/deepseek-v4-pro` (dpsk v4 pro); the API key comes from the `DEEPSEEK_API_KEY` environment variable. Scripts hardcode no machine paths or secrets.
- Tiered benches: L1 HumanEval, L2 MBPP, L3 SWE-bench-verified-mini (sampled), comparing pass@1, CoT/reasoning exposure, tool-call chains (read/edit/write/bash/test/subagents), and final patches/answers.
- Performance: `bench_metrics.mjs` normalizes token usage (including `cacheRead`) and tool timestamps on both sides; `eval_perf.mjs` / `eval_swe_perf.mjs` produce cache hit rate, TTFT, step duration, and per-tool timing offline (see report §5).
- **MBPP fix**: MBPP rows have no `entry_point`; the scripts infer the function name from the first `assert fn(...)` or the reference `def fn`. The old implementation hardcoded `Function name: undefined`, which was the root cause of MBPP behavioral divergence (see report §0 and §6.4).
- Raw bench data is downloaded to `tests/benches/.data/` and is **not versioned**; `fetch-benches.sh` reproduces the downloads and `setup-homes.sh` reproduces both isolated homes.

### Latest results (dpsk v4 pro; L1 30×3, corrected L2 5×2, legacy L3 sample)

| level | dsh pass@1 | opencode+omo pass@1 | per-item agreement |
|---|---|---|---|
| HumanEval (30 tasks × 3 repeats) | 1.00 | 1.00 | 1.00 |
| MBPP (corrected entry_point, 5 tasks × 2 repeats) | 1.00 | 1.00 | 1.00 |
| SWE-bench-verified-mini sample (`sphinx-doc__sphinx-10323`) | same patch | same patch | byte-identical git diff |

Full report: `docs/exps/2026-08-15-opencode-omo-equivalence-bench.md`; raw transcripts are under `tests/benches/.runs/`.

## Alignment status (audited against reference/opencode + reference/oh-my-openagent)

- **Aligned**: opencode default persona (complete system prompt + live env block whose provider/model now follow the same per-step route as the actual request — session live model selection or the role primary/fallback — so prompt and request cannot split; workspace root now derived as the git root); opencode tool families + gpt apply_patch/edit-write tool gating enforced on BOTH the model-visible schema and execution (`tools/pre-execute` deny mirror); opencode maxSteps + verbatim MAX_STEPS_PROMPT; verbatim opencode plan.txt / plan-mode.txt with dynamic `${planInfo}` and the plan→build BUILD_SWITCH reminder; omo role catalog/display names; sisyphus/hephaestus/atlas/sisyphus-junior + specialist subagents; comment-checker/hashline/rules-injector hooks; generated Sisyphus routing sections; extracted omo Sisyphus model-family templates (GPT-5.5/GPT-5.4/claude-opus-4-7/claude-opus-4-8/claude-fable-5/gemini/kimi-k3/kimi-k2-7/kimi-k2-6/glm-5-2, with the dynamic Sisyphus fallback for unknown families) plus hephaestus GPT variants, all 8 atlas variants, and specialist model variants (oracle/metis/momus); omo-default per-role PRIMARY model resolution (provider-scope ordered) and fallback chains that start AFTER the primary; omo role sampling defaults (sisyphus/hephaestus GPT effort medium, atlas temperature 0.1); omo-style retryable-error gating before fallback advance; reasoning-effort selectors in role settings; ultrawork keyword override; `/start-work`, `/remove-ai-slops`, `/refactor`, `/stop-continuation`, `/handoff`, `/hyperplan`, `/team-mode` commands; composer role picker + global per-role model/fallback settings; omo skills published as `user-dsh` so the third-party skills-manager can manage them. The omo rules-injector text is now folded into the complete system prompt (`driver.mjs` + `rules.mjs`) instead of being dropped by `suppressRuntimeContext()`; approved plans are persisted at `.opencode/plans/<created>-<session>.md`; specialist subagent personas now load the extracted reference prompt files (oracle/librarian/explore/metis/momus/multimodal-looker).
- **MCP**: separate plugin [`dsh-plugin-mcp-support`](../dsh-plugin-mcp-support) mounts native `@deepseek-ai/dsh-mcp-client` servers from its bundle-row config or the persisted `mcp-support` settings namespace.
- **Structured output**: separate plugin [`dsh-plugin-structured-output`](../dsh-plugin-structured-output) provides opencode-style `/json-schema` + `StructuredOutput` validation on native seams (no dsh-side format field). Its visibility is opt-in per preset via Settings → 结构化输出工具 (Structured output); no mode is enabled by default.
- **Partial**: extracted family templates keep dynamic sections filled by dsh-native data rather than omo's builder output; structured output is tool-enforced rather than `tool_choice: required`; hooks are regex/simplified ports; AGENTS.md injection is dsh-native; child subagents inherit the session model because dsh child headers/descriptors do not carry the subagent role id (primary-role sampling defaults ARE applied; official 0.1.7 `tool-subagent` `agentOptions`/`modelSelectionSettings` can pin a named row's model statically, which is coarser than the per-role settings below).
- **Settings**: the host half declares `roles` + `sessions` as volatile fields of its own Cordis `Config`, so the entry id `opencode-omo-roles` *is* the form namespace and dsh's `SettingsForms` owns schema validation, profile-patch persistence, and revision fencing; the client reads/writes through `ctx.configForms.get('opencode-omo-roles')`. Rendering the same form for a non-loopback page is the one transport gap (dsh resolves forms to memory mode there), covered by the plugin's own authenticated `/opencode-omo` channel.
- **One dsh-side patch in this repo** ([`patches/0001-agent-pre-step-assistant-prefill.patch`](patches/0001-agent-pre-step-assistant-prefill.patch)): with it, `MAX_STEPS_PROMPT` is opencode's assistant-role request tail; without it, the same text renders as a system-prompt section on the ceiling step (see “Behavioral gaps on a stock harness” above). `format`/`toolChoice` remains a proposal; the standalone structured-output plugin covers the common route.

## Remaining gaps

1. **maxSteps role (patch restored, fallback kept)**: [`patches/0001-agent-pre-step-assistant-prefill.patch`](patches/0001-agent-pre-step-assistant-prefill.patch) restores the request-only assistant tail on 0.1.7; a stock loop still renders the same text as a system-prompt section, so models may treat the role differently than opencode. Tracked upstream as [discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407).
2. **dsh-side (proposal, medium)**: `GenerateOptions.format` / `toolChoice`. omo's regular path does not use them; the standalone structured-output plugin covers the common route.
3. Child subagent per-role sampling cannot reliably resolve the role id (dsh child headers/descriptors do not carry it); primary-role sampling defaults ARE applied and children inherit the session model.
4. Plan files: dsh itself does not persist them; the plugin writes `.opencode/plans/*` after `exit_plan_mode` approval. A first-class plan-file seam remains an optional improvement.
5. team-mode TUI, comment-checker CLI, and hashline diff enhancer remain non-LLM/editing experience differences.
6. **Non-loopback settings persistence (general-purpose, plugin-side workaround)**: dsh resolves Config-derived settings forms to memory mode for a browser whose page URL is not loopback (`ctx.remote.$host.isLoopback === false`), so a third-party settings page cannot persist there through the official form. The plugin covers the documented behavior with its own authenticated `/opencode-omo` connection-RPC channel (reads and writes both transports); a first-class official non-loopback settings write path would let the page drop the channel. Tracked upstream as [discussion #1196](https://github.com/deepseek-ai/deepseek-harness/discussions/1196).
7. **Legacy settings migration**: the host row keeps the id `opencode-omo-roles` so dsh's one-time `$DSH_HOME/settings.yaml` import (section id → profile entry id) carries a pre-0.1.7 section into the new volatile Config. A section holding the known malformed `ultrawork: { model: {} }` still validates (the schema tolerates it) and the registry drops the malformed model on read; the cleaned shape persists on the next write of that role.
