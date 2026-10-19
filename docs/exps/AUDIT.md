> Historical audit (2026-08-15, dsh 0.1.2-alpha.2 era). The current shipped
> surface and dsh-side patch are documented in the root README, `design.md`, and
> `patches/README.md`; this file is retained as bench/audit provenance.

# opencode-omo 与 opencode + omo 对齐审计（2026-08-15，修复轮次后）

审计对象：`presets/opencode-omo/`、`src/`、`cordis.patch.yml`、`driver.mjs`、`tests/`。
参考：`reference/opencode` = v1.17.11（`67aec22`）；`reference/oh-my-openagent` = `14083b8`（v4.19.0 source state）。
宿主：`/home/royenheart/softwares/deepseek-harness`，branch `dev`，工作树干净（master + `3811c90` + `1a9442d`）。

结论：**本轮已把可插件侧修复的 LLM 可见差距基本补齐，并把确认必需的最小 dsh seam（assistant prefill）落到 harness 工作树；剩余仅 #5 structured output 提案与低影响插件尾巴。** `npm test` 24/24、`npm run build`、`npx tsc --noEmit` 通过；dsh harness `npm run build:lib:host` 通过、`packages/core/agent-loop/tests/interception.spec.ts` 24/24。

## 1. 本轮修复（全部插件侧，零 dsh 改动）

| 问题 | 修复 | 验证 |
|---|---|---|
| omo rules-injector 被 `suppressRuntimeContext()` 丢弃 | `rules.mjs` 改为纯 renderer；`driver.mjs` 把 `<omo-rules>` 折叠进 complete system prompt；`agent.cordis.yml` 不再挂载 rules 行 | `tests/driver.spec.mjs`：临时 `.omo/rules/house.md` 出现在渲染后的 prompt |
| 角色默认不切 omo 主模型 | `OmoRoleRegistry.primaryModelFor()`：无配置→`AGENT_MODEL_REQUIREMENTS` 首个目录匹配；`model:null`→显式跟随会话；fallback 链从主模型之后开始（omo `attachFallbackModels` 语义） | `tests/host.spec.mjs` primary/fallback/显式跟随三组断言 |
| 缺角色采样默认值 | `agent/request`：sisyphus/hephaestus GPT `reasoningEffort:medium`、atlas `temperature:0.1`；ultrawork effort 仍最高优先级 | build/typecheck；逻辑集中于 `defaultRoleSampling()` |
| plan-mode 文案压缩、路径硬编码 | `plan-mode.txt` 逐字还原（含 `${planInfo}`）；`build-switch.txt` 逐字复制；driver 按 `session.header.createdAt + session.id` 生成 `.opencode/plans/<created>-<slug>.md`，并在“上一请求头为 plan、当前已退出”的第一步注入 BUILD_SWITCH；`exit_plan_mode` 获批后经 `tools/post-execute` 把计划落盘到同一路径 | driver tests 4 条 |
| 任意错误都切 fallback | `fallbackRetryable()`：仅 `RATE_LIMIT/QUOTA/SERVER/TRANSPORT/TIMEOUT/EMPTY_RESPONSE/MODEL_NOT_FOUND` 或 404/408/425/429/5xx 前进 fallback；AUTH/CONTEXT_WINDOW_EXCEEDED/abort 交给 dsh 自身策略 | driver tests 1 条 |
| 过滤后的工具仍可被幻觉调用 | `system-prompt/assemble` 只改模型可见 schema；新增 `tools/pre-execute` deny mirror：GPT 家族 deny edit/write，非 GPT 家族 deny apply_patch | `gateToolCall`/`opencodeUsesPatch` tests |
| 缺角色模型家族 prompt | 子代理从 omo 源码提取 27 个 variant 文件：Sisyphus 新增 claude-4-8/fable-5/kimi-k2-6/k2-7；Hephaestus GPT 4 变体；Atlas 8 变体逐字复制；oracle/metis/momus 模型变体；librarian/explore/looker 原文。`driver.mjs` 按实际路由模型选择变体并渲染动态占位符 | 全角色×全模型扫描无残留 `${}`/`{{}}`；driver tests 2 条 |
| env workspace root 退化为 cwd | `gitRoot()` 向上找 `.git`，env 块 Workspace root 使用 git root（opencode `ctx.worktree` 语义） | 代码路径；非 git 回退 cwd |
| UI 显示与路由不一致 | roles endpoint 返回 `defaults`；设置页未配置角色显示“omo 默认 · <model>”，显式跟随显示“跟随当前” | build/typecheck |

## 2. dsh seam 审计结论（12 项，由独立 subagent 完成）

| 差距 | 裁决 |
|---|---|
| ASSISTANT-role MAX_STEPS prefill | **已在 harness 工作树实现**：`PreStepDecision.assistantPrefill` + loop 落盘 + interception 测试；插件 `driver.mjs` 已改用该 seam |
| provider 可见 `format`/`tool_choice` | **需 dsh 修改**：`GenerateOptions`/`LlmCallConfig`/adapter 均无字段（提案见 `DSH_CHANGE_PROPOSALS.md`；omo 常规路径不使用） |
| per-tool allow/ask/deny / external_directory | 部分可完成：`tools/pre-execute` 可返回 allow/deny/ask；`tools.restrict` 可见性；external dir 需插件自行解析路径 |
| workspace root | 插件侧可完成（本轮已做：git root） |
| plan 文件路径 / build-switch | 部分可完成：build-switch 已做；plan 文件由插件在 `exit_plan_mode` 获批后自行落盘（dsh 本体仍不落） |
| tool schema 覆盖 | 插件侧可完成：assemble 替换 schema + 同名 scoped `tools.register` shadow |
| per-subagent temperature/permission | 部分可完成：preset 的 `agent/request` + `tools/pre-execute` 对子代理同样生效；`tool-subagent` 配置缺 temperature/permission |
| 错误分类 | 部分可完成（本轮已按 code/status 分类）；dsh 无 MODEL_NOT_FOUND 专用 code |
| `agent/request` 采样字段 | 插件侧可完成（本轮已做） |
| complete+suppress 丢 context | 确认且插件侧可修复（本轮已做） |
| schema 过滤后执行仍派发 | 确认且插件侧可修复（本轮已做） |
| created/slug | 部分：只有 `createdAt`；slug 插件自拟（本轮以 session id 作 slug） |

## 3. 仍未对齐（已知且有意或待 dsh 提案）

1. **dsh 侧（已在工作树实现，待提交/评审）**：`PreStepDecision.assistantPrefill` — MAX_STEPS_PROMPT 恢复 opencode 的 assistant-role prefill 语义。
2. **dsh 提案 medium**：`GenerateOptions.format` + `toolChoice`（omo 常规路径不使用；standalone structured-output 插件覆盖）。
3. 子代理 per-role 采样（oracle/librarian/explore/momus/looker 的 0.1、metis 0.3 等）保持“继承会话模型”：dsh 子代理 header 与 one-shot descriptor 不携带角色 id，无法可靠反查角色；主角色采样已在 `driver.mjs` 实现。
4. 持久化/压缩/team-mode TUI/comment-checker CLI/hashline diff enhancer 为宿主平面或非 LLM 差异，不在本模式对齐范围内。

## 4. dev 分支两个提交

`3811c90`（sidebar.workspaces.entry）与 `1a9442d`（skill source exposure）**不被 opencode-omo 自身使用**；它们是同 profile 安装的 `@maintainall/dsh-plugin-skills-manager` 的依赖（workspace 技能入口、`skill.list({cwd})`、wire `source`、deny-wins 阴影）。opencode-omo 运行所需 seam 全部存在于 master。
