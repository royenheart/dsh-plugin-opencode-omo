# dsh-side patches

## `0001-agent-pre-step-assistant-prefill.patch` — REQUIRED for the complete maxSteps surface

opencode ends the budget-limited request with `MAX_STEPS_PROMPT` as an
**assistant-role continuation** (`packages/core/src/session/runner/max-steps.ts`,
`runner/llm.ts`). The role is the behavior: the text reads as the assistant
already speaking, so the model wraps up instead of calling tools.

dsh 0.1.6-alpha.1 still cannot produce that message:

- `PreStepDecision` admits only
  `reject | { kind: 'enter'; messages: UserMessage[]; startsRequestSeries?: true }`
  (`packages/core/agent/src/runtime-types.ts`).
- `agent/request` returns `LlmCallConfig` and its documented contract says it
  cannot mutate messages.
- Loop-built `GenerateOptions` is deep-frozen and the agent-loop invariant
  asserts `options.messages` equals `session.deriveMessages()`, so a preset
  cannot append a trailing assistant message by any official extension point.

Upstream request: [discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407).

### Apply

From the harness checkout root (`dsh-v0.1.6-alpha.1`, commit `0a15e36`):

```sh
git apply /path/to/dsh-plugin-opencode-omo/patches/0001-agent-pre-step-assistant-prefill.patch
```

### What the patch adds

| File | Change |
|---|---|
| `packages/core/agent/src/runtime-types.ts` | `PreStepDecision.assistantPrefill?: AssistantMessage` on the enter variant; `Agent.supportsAssistantPrefill?: true` capability marker |
| `packages/core/agent-loop/src/agent.ts` | `ReactLoopAgent.supportsAssistantPrefill = true`; the prefill is threaded through `step()`/`buildRequest()`, appended after the derived history for that request only, frozen with the rest |
| `packages/core/session/src/types.ts` | `EpochHeader.assistantPrefill?: AssistantMessage` — the prefill's sole durable record |
| `packages/core/session/src/request-header.ts` | canonicalization/equality include the prefill (a ceiling step logs a `request/header` change) |
| `packages/core/agent-loop/src/invariant.ts` | the reconstruction invariant expects `derived messages + header.assistantPrefill` |
| `packages/llm/token-meter/src/index.ts` | the header-based pressure estimate prices the prefill (it is not a surface node) |
| tests | prefill rides the request tail and header, never a session message; omission leaves requests byte-for-byte unchanged; the invariant accepts exactly the header-recorded tail |

No session event is written: the surface, transcript, compaction, statistics,
and turn-tail UI are untouched. The field is optional; `undefined` keeps every
request and header byte-for-byte identical.

### Landing requirements inside the harness tree

`EpochHeader` is reachable from the `event:request/header` persistence root, so
this is a structural Session-persistence type change. By
`docs/persistence-changes/README.md` the detected change is "add an optional
event-body property" and needs a **`same-version`** record whose after digest
only `pnpm run persistence-changes` can generate; upstream must add that record
(plus its `.zh.md` / `.i18n.yaml` / `.schema.json` siblings) in the same PR.
`.agents/notes/README.md` likewise requires an Agent Note for a non-trivial
change. Both are deliberately absent here: this repository ships dsh-side
patches, not harness design notes.

### Behavior without the patch (supported fallback)

`driver.mjs` feature-detects `agent.supportsAssistantPrefill` (with
`DSH_OPENCODE_OMO_ASSISTANT_PREFILL=1|0` as a deployment override). On a stock
harness it renders the same text and trigger as a **system-prompt section**
(`maxStepsSectionFor`) instead of the assistant tail. Exactly one channel
carries the ceiling text on either host; the text is never dropped.

Known differences in fallback mode: role/position (system prefix rather than an
assistant tail), token placement, and reconstruction from the live prompt
assembly rather than `request/header`. See
[`docs/exps/AUDIT.md`](../docs/exps/AUDIT.md) and the plugin README.
