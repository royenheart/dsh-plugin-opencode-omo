<p align="center">
  <img src="https://raw.githubusercontent.com/royenheart/dsh-plugin-opencode-omo/main/assets/banner.png" width="100%" alt="dsh-plugin-opencode-omo" />
</p>

# @royenheart/dsh-plugin-opencode-omo

[![dsh](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Froyenheart%2Fdsh-plugin-opencode-omo%2Frefs%2Fheads%2Fdsh-migrate%2Fstate%2Fbadge.json)](https://github.com/royenheart/dsh-plugin-opencode-omo/tree/dsh-migrate/state)

A DeepSeek Harness plugin that adds an `opencode-omo` agent preset (mode) to the web profile. The mode replicates the behavior of **opencode** + the **omo** plugin ([oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)), scoped to this mode only — other presets (`standard`/…) keep the default dsh loop, sandboxed fs, and no omo hooks.

## What the mode provides

- **opencode + omo system prompt** — the real opencode `default.txt` persona (tone, style, proactiveness, conventions, code style, task guidance) + omo's Sisyphus orchestrator identity, declared as the **complete** system prompt: the dsh harness identity and runtime-context snapshot are suppressed for this mode. The loop shim additionally prepends opencode's **live environment block** (exact model id, working dir, workspace root, git, platform, date, recomputed every step).
- **omo role picker in the composer** — in dsh's existing `conversation.input.left` tool-row slot (after the access/plan chips), the primary/all roles `sisyphus`, `hephaestus` (Deep Agent), `prometheus` (Plan Builder), `atlas` (Plan Executor), and `sisyphus-junior`. Selecting one swaps the session's complete system prompt and applies that role's configured model. Specialist roles (`athena`, `athena-junior`, `council-member`, `metis`, `momus`, `oracle`, `librarian`, `explore`, `multimodal-looker`) are reached through `task(subagent_type=...)`, not the composer picker.
- **Global "Role Settings"** in the dsh settings panel (`settings.section`): per-role primary model dropdown (follow current / omo default / fixed) under a centered "Primary model" label; a dsh-style circle "+" button opens a fallback model list below the role box (repeatable additions, cancel/close adds nothing), persisted in the `opencode-omo` settings entry. On request failure the loop shim advances through the role's fallback chain before the harness retry policy runs.
- **opencode toolchain (complete)** — persistent `bash`, `read`/`write`/`edit`/`read_image`, `apply_patch`, `glob`/`grep`, `todo_write`, `skill`, `web_fetch`/`web_search`, the LSP navigation surface (`lsp_goto_definition` / `lsp_find_references` / `lsp_hover` / `lsp_go_to_implementation`; raw `lsp` is hidden), `exit_plan_mode` (plan), `ask_user_question`. `tool-surface.mjs` overwrites the model-visible descriptions/parameters with opencode's `tool/*.txt` text and shims `read`/`edit`/`write`/`web_search` to opencode's parameter names (`web_search.query` → dsh `queries`).
- **omo `task()` surface** — `task-shim.mjs` registers the omo-style `task(category/subagent_type/load_skills/run_in_background/task_id)` invocation, mapping it onto dsh named subagents + generic delegation.
- **omo multi-role subagents** — `oracle` (write-tool-restricted advisor; shell retained, not a sandbox), `librarian` (external docs/code search), `explore` (codebase grep), `metis` (pre-planning), `momus` (plan reviewer), `multimodal-looker` (media), plus generic `subagent`/`subagent_fork` + `workflow`/`ralph`. Delegated children keep dsh's `send_message` return channel (the harness appends that instruction to every continuable child); the primary surface still hides it behind `task()`/`background_output`.
- **omo context injection** — AGENTS.md/CLAUDE.md walk-up + `skills/` + omo's `rules-injector` (`.omo/rules`, `.cursor/rules`, `.github/instructions`, `copilot-instructions.md`).
- **omo hooks** — `comment-checker` (rejects AI-slop comments on write/edit), `hashline` (read tagging `N#HH|content` + `hashline_edit` stale-ref guard).
- **per-mode execution backend** — local filesystem (`dsh-fs-local`) + persistent PTY shell, isolated from other modes' sandboxed fs/shell.
- **native-seam loop shim** — no dsh-side driver seam. `driver.mjs` is an ordinary preset plugin using the shipped seams: a dynamic `ctx.systemPrompt.section({ complete: true })` recomputes opencode's env block and the selected omo role prompt per assembly; `system-prompt/assemble` applies opencode's model tool gating, and both the request catalog and the prompt's generated tool table run through the same hidden-name/model-family/role filter; `agent/inbox/claimed`, `agent/pre-step`, `agent/request`, and `agent/request-error` provide ultrawork detection, maxSteps, role model routing, and fallback retry. Other presets are untouched by construction.

## Layout

```
cordis.patch.yml                 # bundle patch: host row + official agent-preset declaration
patches/                         # dsh-side patch(es) still required for the complete surface
install.py                       # idempotent install/uninstall (manifest + missing runtime/LSP links)
src/                             # host + client plugin halves (role registry, settings, picker UI)
lib/                             # built host/client bundles (npm run build)
scripts/build.sh                 # architecture check + typecheck + tsdown build
presets/opencode-omo/
  agent.cordis.yml               # the composition (tools, roles, hooks, LSP)
  preset.yml                     # display metadata
  persona.md                     # opencode default.txt + omo Sisyphus persona
  roles/*.md                     # subagent personas (also main-role prompts)
  roles/prompts/*.md             # primary-role complete prompts (hephaestus/prometheus/atlas/…)
  skills/                        # omo shared skills
  driver.mjs                     # native-seam loop shim (prompt/route/fallback/maxSteps/ultrawork)
  delegation-restrictions.mjs    # single tool capability/role restriction table
  patch-parser.mjs               # shared apply_patch parser for execution + permission
  background-state.mjs           # closed background activation lifecycle
  rules.mjs                      # rules-injector
  comment-checker.mjs            # comment-checker hook
  apply-patch.mjs                # apply_patch tool
  hashline.mjs                   # omo hashline read-tagging + hashline_edit
  lsp-optional.mjs               # LSP trio when installed; self-disables otherwise
```

## Install

`lib/` is generated locally and is not committed. `install.py` always builds the repository's own toolchain first (`npm ci` when the toolchain is missing or `package-lock.json` is newer than the installed lock, then `npm run build`) and exits with an actionable error if npm, the build, the artifacts, or a required harness link is missing:

```sh
python3 install.py install --profile web              # install (idempotent)
python3 install.py uninstall --profile web            # remove
```

`install.py` symlinks the package into `~/.dsh/profiles/<profile>/node_modules/`, mirrors runtime packages only when absent, ensures/repoints the LSP links (refusing real directories), and edits the profile's `package.json` (adds/removes the dependency + bundle entry). The bundle patch declares both the host row and the official `@deepseek-ai/dsh-agent-preset` row, so there is no separate user-preset-root copy.

Manual alternative — the package is a dsh **bundle**: it declares `dsh.bundle.patch` and ships the preset. `dsh plugin` reconciles `dsh.profile.bundles` from the installed package automatically:

```sh
dsh plugin --profile web add link:/path/to/dsh-plugin-opencode-omo
```

The bundle patch declares the official `@deepseek-ai/dsh-agent-preset` row for `opencode-omo`, so no `$DSH_HOME/.agent-presets` copy is published. Restart dsh and select **opencode-omo** from the mode picker.

**Upgrading from the pre-0.2.1 row id.** Existing profiles used the
`opencode-omo-roles` settings entry; rc.2's legacy importer preserves that
unknown entry in `$DSH_HOME/settings.yaml.imported`. On boot the host row reads that backup once per profile and merges its
role/session maps into the active `opencode-omo` entry, so old role models and
fallbacks are not silently reset. Profiles migrated by the pre-release
`9ad557c` home-global marker may re-import once because that marker had no
profile identity; review the merged roles after upgrading.

**Optional LSP server.** The preset preconfigures `typescript-language-server` for the `lsp_*` navigation tools. `install.py` checks `PATH` and warns when it is missing; the optional LSP module then mounts without a provider so the mode still loads (LSP queries fail gracefully instead of blocking the whole preset). Install it to enable LSP:

```sh
npm install -g typescript-language-server typescript
```

then restart dsh.

**web_fetch provider.** The preset enables dsh's native `web_fetch` tool (`fetch: true`). Official 0.2.1 already registers `@deepseek-ai/dsh-web-fetch-http` in the base bundle, so this plugin does **not** insert a second fetch row (that would throw `WEB_DUPLICATE_PROVIDER`). `web_search` keeps using the existing DeepSeek search provider (`DEEPSEEK_API_KEY`). Other presets keep `fetch: false`, so their tool surface is unchanged.

## Required dsh-side changes

One patch is still required for the complete opencode surface:

`patches/0001-agent-pre-step-assistant-prefill.patch` (rebased onto
`dsh-v0.2.1-rc.2`) adds `PreStepDecision.assistantPrefill`, a request-only
assistant tail. The loop logs it on `request/header`, appends it to exactly the
request that asked for it, and prices it in token pressure; it is never a
session `assistant/message`, so transcript, compaction, and stats stay clean.

Apply it to the dsh checkout with the instructions in
[`patches/README.md`](patches/README.md); `install.py` does not modify the harness
checkout. Without the patch the preset still loads and uses the fallback below.

**Why the patch is still required.** opencode appends `MAX_STEPS_PROMPT` as an
assistant-role continuation on the ceiling step. Official 0.2.1
`PreStepDecision` is still `reject | { kind: 'enter', messages, startsRequestSeries? }`,
and `agent/request` cannot mutate request messages, so no official extension
point can express a request-only assistant tail. Upstream request:
[discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407).

The plugin probes the runtime capability
(`ctx.agentLoop.supportsAssistantPrefill`). On a patched host the ceiling text is
an assistant tail and no system-prompt section is added. On a stock host it
keeps the same text and trigger as a system-prompt section (see the fallback
table below); that is survivability, not the complete opencode surface.

### Fallback on unpatched hosts

| Surface | opencode / patched harness | This plugin on a stock 0.2.1 host |
|---|---|---|
| Role of `MAX_STEPS_PROMPT` | Assistant-role continuation at the end of the request | System-prompt section for that step |
| Session transcript / stats / compaction | Request-only (header), not a session message | Also not a session message (system section is reassembled) |
| How strictly models stop / wrap up | Tuned for an assistant tail | May treat a system reminder more weakly or more strongly |
| Token placement | Extra assistant tokens on that request | Extra system tokens on that request |
| Reconstructable requests | Logged on `request/header` | Rebuilt from the live prompt assembly |

The fallback is selected at runtime; the patch is not dropped when a host can
run without it.

Provider-visible `format`/`toolChoice` remains an unpatched proposal; omo's
regular path does not use it.

Everything else runs on unmodified dsh seams: the preset is declared by the
official `@deepseek-ai/dsh-agent-preset` row, the role picker occupies the
existing `conversation.input.left` slot, and role settings use the official
settings form Remote.

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

## Version baseline

Active combination: `opencode-1.17.11+omo-5.0.0-beta.31`.

`alignment.json` is the machine-readable registry;
`presets/opencode-omo/roles/prompts/variants/MANIFEST.md` records prompt sources.

| Upstream | Version | Commit | Used for |
|---|---|---|---|
| opencode | `1.17.11` | `67aec221` | tool descriptions, persona, plan/build/MAX_STEPS text |
| oh-my-openagent | `5.0.0-beta.31` | `62ed7952` | Sisyphus family, Atlas, Hephaestus, Oracle/Metis/Momus prompts |
| oh-my-openagent | `4.19.0` | `14083b89` | librarian / explore / multimodal-looker prompts |
| dsh | `0.2.1-rc.2` | `687f282` | host peer target |

`explore` and `multimodal-looker` are identical in both omo versions;
`librarian` stays on v4.19.0 until the context7-specific v5 diff is adapted to
this harness. `npm run check:alignment` validates the active combination.

## Future alignment harness

Tracking: [#17](https://github.com/royenheart/dsh-plugin-opencode-omo/issues/17).

- **Provenance**: per-combination manifest and content hashes.
- **Deterministic contract**: scripted-catalog prompt/tool rendering compared
  with upstream sections and names.
- **Recorded traces**: record real opencode+omo traces once per pin, then replay
  only this plugin and compare normalized events.

## Alignment status (against the declared baseline)

- **Aligned**: opencode default persona (complete system prompt + live env block whose provider/model follow the same assembly-time route as the request — session live model selection or the role primary/fallback (an in-step fallback retry reuses that assembly while the request route advances); workspace root now derived as the git root); opencode tool families + gpt apply_patch/edit-write tool gating enforced on BOTH the model-visible schema and execution (`tools/pre-execute` deny mirror); opencode maxSteps + verbatim MAX_STEPS_PROMPT; verbatim opencode plan.txt / plan-mode.txt with dynamic `${planInfo}` and the plan→build BUILD_SWITCH reminder; omo role catalog/display names; sisyphus/hephaestus/atlas/sisyphus-junior + specialist subagents; comment-checker/hashline/rules-injector hooks; generated Sisyphus routing sections; extracted omo Sisyphus model-family templates (GPT-5.5/GPT-5.4/claude-opus-4-7/claude-opus-4-8/claude-fable-5/gemini/kimi-k3/kimi-k2-7/kimi-k2-6/glm-5-2, with the dynamic Sisyphus fallback for unknown families) plus hephaestus GPT variants, all 8 atlas variants, and specialist model variants (oracle/metis/momus); omo-default per-role PRIMARY model resolution (provider-scope ordered) and fallback chains that start AFTER the primary; omo role sampling defaults (sisyphus/hephaestus GPT effort medium, atlas temperature 0.1); omo-style retryable-error gating before fallback advance; reasoning-effort selectors in role settings; ultrawork keyword override; `/start-work`, `/remove-ai-slops`, `/refactor`, `/stop-continuation`, `/handoff`, `/hyperplan`, `/team-mode` commands; composer role picker + global per-role model/fallback settings; omo skills published as `user-dsh` so the third-party skills-manager can manage them. The omo rules-injector text is now folded into the complete system prompt (`driver.mjs` + `rules.mjs`) instead of being dropped by `suppressRuntimeContext()`; approved plans are persisted at `.opencode/plans/<created>-<session>.md`; specialist subagent personas now load the extracted reference prompt files (oracle/librarian/explore/metis/momus/multimodal-looker).
- **MCP**: separate plugin [`dsh-plugin-mcp-support`](../dsh-plugin-mcp-support) mounts native `@deepseek-ai/dsh-mcp-client` servers from its bundle-row config or the persisted `mcp-support` settings namespace.
- **Structured output**: separate plugin [`dsh-plugin-structured-output`](../dsh-plugin-structured-output) provides opencode-style `/json-schema` + `StructuredOutput` validation on native seams (no dsh-side format field). Its visibility is opt-in per preset via Settings → 结构化输出工具 (Structured output); no mode is enabled by default.
- **Partial**: extracted family templates keep dynamic sections filled by dsh-native data rather than omo's builder output; structured output is tool-enforced rather than `tool_choice: required`; hooks are regex/simplified ports; AGENTS.md injection is dsh-native; child subagents inherit the session model because dsh child headers/descriptors do not carry the subagent role id (primary-role sampling defaults ARE applied).
- **One dsh-side patch in this repo.** `patches/0001-agent-pre-step-assistant-prefill.patch` restores opencode's request-only assistant ceiling text; stock hosts keep the system-section fallback. `format`/`toolChoice` remains a proposal; the standalone structured-output plugin covers the common route.

## Remaining gaps

1. **maxSteps role (patched seam + stock fallback)**: `patches/0001` gives the assistant-role request tail on a patched host. A stock 0.2.1 host still gets the same `MAX_STEPS_PROMPT` text and trigger as a system-prompt section, so models may treat the role differently. Tracked upstream as [discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407).
2. **dsh-side (proposal, medium)**: `GenerateOptions.format` / `toolChoice`. omo's regular path does not use them; the standalone structured-output plugin covers the common route.
3. Child subagent per-role sampling cannot reliably resolve the role id (dsh child headers/descriptors do not carry it); primary-role sampling defaults ARE applied and children inherit the session model.
4. Plan files: dsh itself does not persist them; the plugin writes `.opencode/plans/*` after `exit_plan_mode` approval. A first-class plan-file seam remains an optional improvement.
5. team-mode TUI, comment-checker CLI, and hashline diff enhancer remain non-LLM/editing experience differences.
