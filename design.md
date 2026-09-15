# opencode-omo loop behavior on native dsh seams (no driver seam; one request-tail patch)

## Objective

Give the `opencode-omo` preset a different turn/step behavior than the default
dsh loop — opencode's whole system prompt, per-model tool gating, max steps,
and omo role model routing/fallback — without adding a driver seam to dsh.

## Why the first driver-seam attempt was dropped

The first implementation added a `dsh-agent-driver` package and made
`ReactLoopAgent` subclassable so `OmoLoopAgent` could override `buildRequest`.
Re-scan found that every behavior that override provided already has a native
seam:

| Needed behavior | Native dsh seam |
|---|---|
| Whole opencode+omo system prompt (env block + role prompt + plan prompt) per step | `ctx.systemPrompt.section({ complete: true, text: ctx => ... })` — the text provider receives `context.agent` and is re-evaluated on every assembly |
| Suppress harness identity + runtime snapshot | `complete: true` + `ctx.systemPrompt.suppressRuntimeContext()` |
| opencode per-model tool gating (apply_patch vs edit/write) | `system-prompt/assemble` waterfall mutates `assembly.tools` |
| Ultrawork keyword detection before assembly | `agent/inbox/claimed` (fires inside `preStep` before `systemPrompt.assemble`) |
| maxSteps + verbatim MAX_STEPS_PROMPT | `agent/pre-step` request-only assistant tail on a host carrying patch 0001; system-prompt section on a stock host (feature-detected) |
| Role primary model + ultrawork override | `agent/request` waterfall |
| Fallback chain before harness retry policy | `agent/request-error` waterfall returning `{ kind: 'retry' }` |

All of these are scope-filtered events: a listener registered in the preset's
standing scope receives every agent under that preset (scope parent chain),
which is exactly the isolation the driver seam provided. Verified with three
probe tests against the dsh test harness: complete persona replacement, gpt
tool gating, role route, request-error fallback, max-steps injection, and
ultrawork routing all fire with a plain `ReactLoopAgent`.

## Current fidelity posture (dsh 0.1.6-alpha.1)

1. `PreStepDecision.assistantPrefill` is still absent upstream. This plugin
   **ships** `patches/0001-agent-pre-step-assistant-prefill.patch`, which adds
   the seam; `driver.mjs` samples the patched loop's
   `Agent.supportsAssistantPrefill` marker and attaches `MAX_STEPS_PROMPT` as a
   request-only assistant continuation on the ceiling step. Upstream:
   https://github.com/deepseek-ai/deepseek-harness/discussions/2407

   On a stock (unpatched) harness the same text and trigger ride a
   system-prompt section instead. Behavioral gaps in that fallback mode:
   assistant vs system role, token placement, and reconstructable-requests
   (live assembly vs `request/header`). Transcript/stats/compaction omit the
   ceiling text on both paths. Nothing is silently dropped, and the two
   channels are mutually exclusive.

2. The complete persona text provider has no turn/step argument. The step about
   to run is inferred from the durable log (`turn/start` + last `step/start`),
   and ultrawork is detected one event earlier via `agent/inbox/claimed`, so
   the env block sees the correct route for the step.
3. The env block is computed once per step. On an in-step fallback retry it
   keeps the primary route's model id instead of re-rendering for the fallback
   model (openCode re-renders per attempt). The request itself still routes to
   the fallback model.
4. Tool gating filters the request schemas through the assembly waterfall; the
   default loop's execution registry still knows both tool families, exactly
   as the previous `buildRequest`-level filter did.
5. dsh 0.1.6 removed the `@deepseek-ai/dsh-client-runtime` package. The browser
   halves now type `ctx.slots` through
   `@deepseek-ai/dsh-client-ui-renderer/client` and the session list state
   through `@deepseek-ai/dsh-api-session-controller/client`; the harness peers
   are pinned to `0.1.6-alpha.1`.
6. The role fallback listener prepends on `agent/request-error`: the base
   bundle's `@deepseek-ai/dsh-llm-retry` settles a retryable code in normal mode
   without calling downstream, so an ordinary registration would never advance
   the role's fallback chain.

## Preset publishing without dsh changes

dsh's agent-presets service always appends the user root
`$DSH_HOME/.agent-presets` (`includeUserRoot` defaults true), so the bundle no
longer patches `agent-presets.roots`. `install.py` creates a REAL directory
`$DSH_HOME/.agent-presets/opencode-omo` and symlinks its entries into the
package's `presets/opencode-omo` — discovery requires `dirent.isDirectory()`
and does not follow a symlinked roster row, but nested entry symlinks are fine
and keep shipped updates live.

## dsh-side footprint after the re-scan

One patch: `patches/0001-agent-pre-step-assistant-prefill.patch` (the
request-only assistant tail for opencode maxSteps).

- The preset-root merge, the entire `dsh-agent-driver` + `agent-loop` subclass
  seam, and the `conversation.input.role` composer seat were all dropped in
  favor of the official `$DSH_HOME/.agent-presets` user root, the native
  prompt/event waterfalls, and the existing `conversation.input.left` list slot.
- The `assistantPrefill` seam was restored — rebased onto dsh 0.1.6-alpha.1 —
  because the documented complete maxSteps surface needs it and no official
  extension point provides an assistant-role request tail. The stock-host
  system-prompt section remains as the feature-detected fallback.

Everything else runs on an unmodified 0.1.6-alpha.1 checkout.


