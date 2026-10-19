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
| maxSteps + verbatim MAX_STEPS_PROMPT | patched request-only assistant tail; system-prompt section on a stock host |
| Role primary model + ultrawork override | `agent/request` waterfall |
| Fallback chain before harness retry policy | `agent/request-error` waterfall returning `{ kind: 'retry' }` |

All of these are scope-filtered events: a listener registered in the preset's
standing scope receives every agent under that preset (scope parent chain),
which is exactly the isolation the driver seam provided. Verified with three
probe tests against the dsh test harness: complete persona replacement, gpt
tool gating, role route, request-error fallback, max-steps injection, and
ultrawork routing all fire with a plain `ReactLoopAgent`.

## Current fidelity posture (dsh 0.2.1-rc.2)

1. `PreStepDecision.assistantPrefill` is still absent upstream. This plugin
   ships `patches/0001-agent-pre-step-assistant-prefill.patch`, which adds a
   request-only assistant tail, logs it on `request/header`, and prices it in
   token pressure. On a patched host the ceiling step uses that path; on a stock
   host the plugin keeps the same text and trigger as a system-prompt section.
   Upstream: https://github.com/deepseek-ai/deepseek-harness/discussions/2407

   The stock fallback differs in role (assistant vs system), token placement,
   and request reconstruction (header vs live assembly). Transcript, stats, and
   compaction still omit the ceiling text on both paths.

2. The complete persona text provider has no turn/step argument, and 0.2.1's
   `AssembleContext` no longer carries an Agent. The assembly reads the exact
   initiator through `ctx.agents.currentInitiator()`; the step about to run is
   inferred from `session.snapshotEvents()` (`turn/start` + last `step/start`),
   and ultrawork is detected one event earlier via `agent/inbox/claimed`.
3. The env block is computed once per step. On an in-step fallback retry it
   keeps the primary route's model id instead of re-rendering for the fallback
   model (openCode re-renders per attempt). The request itself still routes to
   the fallback model.
4. Tool gating filters the request schemas through the assembly waterfall; the
   default loop's execution registry still knows both tool families, exactly
   as the previous `buildRequest`-level filter did.

## Preset publishing without dsh changes

dsh's agent-presets service always appends the user root
`$DSH_HOME/.agent-presets` (`includeUserRoot` defaults true), so the bundle no
longer patches `agent-presets.roots`. `install.py` creates a REAL directory
`$DSH_HOME/.agent-presets/opencode-omo` and symlinks its entries into the
package's `presets/opencode-omo` — discovery requires `dirent.isDirectory()`
and does not follow a symlinked roster row, but nested entry symlinks are fine
and keep shipped updates live.

## dsh-side footprint after the re-scan

One general-purpose patch: `patches/0001-agent-pre-step-assistant-prefill.patch`
adds a request-only assistant tail. It is a loop capability, not a
plugin-specific branch.

- The preset-root merge and the entire `dsh-agent-driver` + `agent-loop` subclass
  seam were dropped in favor of the official `@deepseek-ai/dsh-agent-preset`
  declaration, the native prompt/event waterfalls, and the existing
  `conversation.input.left` list slot.
- `MAX_STEPS_PROMPT` uses the patched request tail when available and the
  documented system-prompt fallback otherwise. Discussion #2407 is the upstream
  ask for the same seam.

Everything else runs on an unmodified 0.2.1-rc.2 checkout.

