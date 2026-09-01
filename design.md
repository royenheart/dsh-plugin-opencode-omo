# opencode-omo loop behavior on native dsh seams (no driver seam, one request-tail patch)

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
| maxSteps + verbatim MAX_STEPS_PROMPT | `agent/pre-step` returns the assistant-role tail on a patched harness; without the patch the same text degrades to a system-prompt section for the ceiling step |
| Role primary model + ultrawork override | `agent/request` waterfall |
| Fallback chain before harness retry policy | `agent/request-error` waterfall returning `{ kind: 'retry' }` |

All of these are scope-filtered events: a listener registered in the preset's
standing scope receives every agent under that preset (scope parent chain),
which is exactly the isolation the driver seam provided. Verified with three
probe tests against the dsh test harness: complete persona replacement, gpt
tool gating, role route, request-error fallback, max-steps injection, and
ultrawork routing all fire with a plain `ReactLoopAgent`.

## Current fidelity posture (dsh 0.1.2-alpha.3)

1. `PreStepDecision.assistantPrefill` is still absent from the official tag,
   so this plugin ships `patches/0001-agent-pre-step-assistant-prefill.patch`.
   Once applied, `MAX_STEPS_PROMPT` rides the request tail as an
   assistant-role prefill and is logged only on `request/header` (upstream
   proposal: https://github.com/deepseek-ai/deepseek-harness/discussions/2407).
   Without the patch the same text degrades to a complete-prompt section, not
   a synthetic user message and never a session message.

   The patch keeps dsh's own reconstructable-requests and session-prefix
   rules: no `assistant/message`, `user/message`, or any other session event
   is fabricated for the tail.

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

## Preset publishing without dsh changes

dsh's agent-presets service always appends the user root
`$DSH_HOME/.agent-presets` (`includeUserRoot` defaults true), so the bundle no
longer patches `agent-presets.roots`. `install.py` creates a REAL directory
`$DSH_HOME/.agent-presets/opencode-omo` and symlinks its entries into the
package's `presets/opencode-omo` — discovery requires `dirent.isDirectory()`
and does not follow a symlinked roster row, but nested entry symlinks are fine
and keep shipped updates live.

## dsh-side footprint after the re-scan

One, and it is a patch file rather than a source-tree change:

- The preset-root merge, the entire `dsh-agent-driver` + `agent-loop` subclass
  seam, and the `conversation.input.role` composer seat were all dropped in
  favor of the official `$DSH_HOME/.agent-presets` user root, the native
  prompt/event waterfalls, and the existing `conversation.input.left` list slot.
- The only remaining harness change is
  `patches/0001-agent-pre-step-assistant-prefill.patch`
  (`PreStepDecision.assistantPrefill`), needed for opencode's assistant-role
  MAX_STEPS_PROMPT tail. It applies cleanly to `dsh-v0.1.2-alpha.3` and is
  tracked upstream in discussion #2407. The patchless fallback is a system
  prompt section; no session message is ever fabricated.

Everything else runs on an unmodified `dsh-v0.1.2-alpha.3` checkout.

