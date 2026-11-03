# Assistant prefill patch report

**Patch:** `patches/0001-agent-pre-step-assistant-prefill.patch`

**Capability:** opencode appends `MAX_STEPS_PROMPT` as an assistant-role
continuation on the step that reaches the max-step ceiling. The plugin must keep
that text out of the transcript/compaction surface while sending it in the
request that asks for it.

**Current host:** `dsh-v0.2.2-alpha.3` (`05b1cae8db6e674c5685101494d4eec24652424a`).

## Upstream request

The same seam is already requested upstream:

- [Discussion #2407 — [Feature request] Request-only assistant prefill for agent/pre-step (header-logged, never a session message)](https://github.com/deepseek-ai/deepseek-harness/discussions/2407)

This report therefore does not need a new discussion draft; it records the
rebased patch and the evidence that the request is still unimplemented in
0.2.2-alpha.3.

## Why an official seam still does not cover it

On 0.2.2-alpha.3:

- `PreStepDecision` is still
  `{ kind: 'reject' } | { kind: 'enter', messages, startsRequestSeries? }`;
- `agent/pre-step` can replace admitted user messages, but has no request-only
  assistant tail;
- `agent/request` is deprecated and may adjust controls but cannot mutate
  request messages or move the fixed model selection;
- adding the ceiling text as a system-prompt section changes the role the model
  sees and is the documented degrade, not the opencode surface.

## Patch

The patch adds:

- `PreStepDecision.assistantPrefill?: string`;
- request assembly that appends one assistant message after the derived
  boundary messages, without appending a session `assistant/message`;
- `EpochHeader.assistantPrefill`, canonicalization/equality, and the
  `request/header` log entry;
- token-pressure pricing through `estimateHeaderTokens()` without adding the
  tail to transcript or context-breakdown totals;
- `AgentLoop.supportsAssistantPrefill` so the preset chooses the patched path by
  capability rather than package source scanning;
- `packages/core/agent-loop/tests/assistant-prefill.spec.ts`.

## Validation

Both patches apply cleanly and in order to a pristine
`dsh-v0.2.2-alpha.3` source archive. On the patched worktree:

```sh
vitest run \
  packages/core/agent-loop/tests/assistant-prefill.spec.ts \
  packages/core/agent-loop/tests/request-error-selection.spec.ts
```

Both focused tests pass (2/2). The affected package typechecks
(`tsc -b packages/core/agent-loop packages/core/session packages/llm/token-meter`)
and the session/request-header plus token-meter suites pass (147/147). The
plugin's own `npm test` (150 pass, 1 live-web skip), `npm run typecheck`, and
`npm run build` also pass.