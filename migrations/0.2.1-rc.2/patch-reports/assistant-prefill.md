# [Feature request] Request-only assistant prefill for `agent/pre-step`

> **English summary.** Add an optional assistant-role tail to
> `PreStepDecision.enter` so a plugin can append request-only continuation text
> (for example opencode's `MAX_STEPS_PROMPT`) without writing a session
> `assistant/message`. The loop should log the tail on `request/header`, append
> it to exactly the request that asked for it, and price it in token pressure;
> later history, compaction, stats, and transcript views must not contain it.

## Background

opencode's max-steps handling appends `MAX_STEPS_PROMPT` as an **assistant**
continuation at the end of the ceiling request. It is request-only: the text is
not written to the session transcript and does not participate in later message
derivation or compaction.

`dsh-plugin-opencode-omo` documents that behavior as part of its opencode
surface. On a stock host it can only approximate it with a system-prompt
section, which is a different model-visible role and a different token
placement. The plugin keeps that fallback for hosts without this seam, but the
fallback is a degrade, not a drop-in equivalent.

## Current state

At `dsh-v0.2.1-rc.2` (`687f282`):

- `PreStepDecision` is still
  `{ kind: 'reject' } | { kind: 'enter'; messages: UserMessage[]; startsRequestSeries?: true }`
  (`packages/core/agent/src/runtime-types.ts`).
- `agent/request` returns `LlmCallConfig`; it can change provider/model/sampling
  but cannot add or rewrite request messages.
- `GenerateOptions` has no assistant-prefill field, and the loop's
  `buildRequest()` derives messages only from the session surface.
- `canonicalHeader()` / `EpochHeader` carry config and tools only.

Related upstream request: [discussion #2407 — Request-only assistant prefill for
agent/pre-step](https://github.com/deepseek-ai/deepseek-harness/discussions/2407).
Adjacent request-message rewrite discussion:
[#3940](https://github.com/deepseek-ai/deepseek-harness/discussions/3940).
No implementing pull request was found. A GitHub issue/PR search for
`assistantPrefill` in `deepseek-ai/deepseek-harness` returned zero results
([search](https://api.github.com/search/issues?q=repo%3Adeepseek-ai%2Fdeepseek-harness+assistantPrefill));
the discussion above is the only matching request found.

## Proposal

Add a general-purpose, opt-in request-tail channel:

1. `PreStepDecision.enter` gains `assistantPrefill?: string`.
2. The loop appends one assistant message built from that text to the request
   only; the session log gets no `assistant/message`.
3. `EpochHeader` gains the same optional field, preserved by
   `canonicalHeader()`, compared by `headerEquals()`, and logged on the
   `request/header` event for the request that used it.
4. Token pressure counts the tail (`estimateHeaderTokens`); transcript,
   compaction, and context-breakdown surface accounting do not.
5. `AgentLoop` exposes `supportsAssistantPrefill: boolean` so callers choose the
   patched path without scanning package source or catching a type error.

Why a core seam rather than a plugin-local patch: the request is built inside
`ReactLoopAgent.buildRequest()` and is frozen before dispatch. A plugin cannot
append a request-only assistant message through `agent/request`; forking the
loop or mutating `GenerateOptions.messages` downstream would violate the
reconstructable-request invariant for one preset.

## Appendix: patch

Patch: [`patches/0001-agent-pre-step-assistant-prefill.patch`](../../../patches/0001-agent-pre-step-assistant-prefill.patch)
(260 lines; applies to `dsh-v0.2.1-rc.2`).

Files:

- `packages/core/agent/src/runtime-types.ts` — decision field.
- `packages/core/agent-loop/src/agent.ts` — carry the field into one request and
  append the assistant message.
- `packages/core/agent-loop/src/index.ts` — capability marker.
- `packages/core/session/src/types.ts` and `request-header.ts` — header field,
  canonicalization, equality.
- `packages/llm/token-meter/src/estimate.ts` and `index.ts` — pressure pricing.
- `packages/core/agent-loop/tests/assistant-prefill.spec.ts` — regression test.

Verification on the checkout:

- `tsc -b packages/core/agent-loop packages/core/session packages/llm/token-meter` — pass.
- `vitest run packages/core/agent-loop/tests/assistant-prefill.spec.ts packages/core/session/tests/request-header.spec.ts packages/llm/token-meter/tests/token-meter.spec.ts packages/core/agent-loop/tests/interception.spec.ts` — 59/59 pass.
- Related suites: `request-header` 10/10, `token-meter` 25/25,
  `agent-loop/interception` 23/23.
- `git apply --check` on an archived clean `dsh-v0.2.1-rc.2` tree — pass.

## Questions to confirm

- Is a plain `string` enough, or should the seam accept a complete
  `AssistantMessage` (e.g. content blocks, provider metadata)? A string keeps
  the loop in control of identity and provider metadata and covers the known
  opencode use.
- Should the tail be allowed on every step or only the first attempt? The patch
  applies it on every attempt of the admitted step; a retry keeps the same
  ceiling semantics.
- Should token breakdown gain a dedicated bucket? The patch prices pressure but
  leaves the three-bucket `contextBreakdown` wire unchanged.
- Is `supportsAssistantPrefill` the preferred capability name, or should this be
  a versioned feature descriptor?

## Related

- [Discussion #2407 — Request-only assistant prefill for agent/pre-step (header-logged, never a session message)](https://github.com/deepseek-ai/deepseek-harness/discussions/2407)
- [Discussion #3940 — message rewrite extension point between session history and model context](https://github.com/deepseek-ai/deepseek-harness/discussions/3940)
- [Discussion #4749 — pre-step batch ordering and prefix cache](https://github.com/deepseek-ai/deepseek-harness/discussions/4749) (adjacent request-assembly context)