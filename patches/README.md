# dsh-side patches

## `0001-agent-pre-step-assistant-prefill.patch`

This patch is required for the documented opencode `MAX_STEPS_PROMPT` surface.
It applies to `dsh-v0.2.1-rc.2` (tag commit `687f282`).

It adds:

- `PreStepDecision.assistantPrefill?: string` on the `enter` branch;
- loop plumbing so the text becomes a request-only assistant message (never a
  session `assistant/message`, never part of later derived history);
- `EpochHeader.assistantPrefill`, preserved by `canonicalHeader`, compared by
  `headerEquals`, and logged on that request's `request/header`;
- token-pressure pricing for the tail (`estimateHeaderTokens`) without adding
  it to the transcript/context-breakdown surface;
- an `AgentLoop.supportsAssistantPrefill` capability marker so a plugin can
  choose the patched path without scanning package source;
- `packages/core/agent-loop/tests/assistant-prefill.spec.ts`.

## Why no official seam replaces it

On 0.2.1 `PreStepDecision` is still
`{ kind: 'reject' } | { kind: 'enter', messages, startsRequestSeries? }`, and
`agent/request` may change route/sampling but not request messages. opencode
puts the ceiling text in an assistant-role request tail; a system prompt is a
different model-visible role and is the documented degrade, not a substitute.

Upstream request: https://github.com/deepseek-ai/deepseek-harness/discussions/2407

## Applying

```sh
cd /path/to/deepseek-harness       # at dsh-v0.2.1-rc.2
git apply /path/to/dsh-plugin-opencode-omo/patches/0001-agent-pre-step-assistant-prefill.patch
```

The plugin selects the patched path only when
`ctx.agentLoop.supportsAssistantPrefill === true`. A stock host keeps the same
text and trigger as a system-prompt section; it does not drop the ceiling.
