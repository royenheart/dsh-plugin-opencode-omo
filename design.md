# opencode-omo loop behavior on native dsh seams (no driver seam; one request-tail patch)

Upstream pin: `alignment.json` and README "Version baseline".

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
| Whole opencode+omo system prompt (env block + role prompt + plan prompt) per step | `ctx.systemPrompt.section({ complete: true, text: () => ... })` — the text provider is re-evaluated on every assembly and reads the exact initiator through `ctx.agents.currentInitiator()` |
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
3. The env block and tool table are computed once per step. On an in-step
   fallback retry the reused assembly keeps the primary route's model id and
   tool table instead of re-rendering for the fallback model (openCode
   re-renders per attempt); the request route itself advances to the fallback.
4. Tool gating filters the request schemas through the assembly waterfall and
   is mirrored at execution by `tools/pre-execute` (`gateToolCall`), so a
   hallucinated call outside the model-family/role surface is denied before it
   reaches the default loop's registry.

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


## State and policy authority

The plugin now follows one-authority rules for mutable/security-sensitive data:

- `presets/opencode-omo/patch-parser.mjs` is the only freeform `apply_patch`
  parser. Execution and the external-directory permission hook both consume
  its `path`/`moveTo` result, so a second header regex cannot drift.
- Worker-versus-primary prompt selection is delegation-based, not catalog-based:
  a delegated `atlas`/`sisyphus`/`hephaestus`/`sisyphus-junior` always receives
  the `sisyphus-junior` worker body plus the live tool table; a non-delegated
  session keeps its primary role body even when tool discovery fails.
  Atlas static templates are primary-only; lines naming a missing background
  tool are removed. Shared prose can still mention the background workflow, so
  partial catalogs are a best-effort render, not a full rewrite.
- `review-work` remains the upstream five-lane orchestrator. `visual-qa` is an
  independent optional check; review-work does not consume its verdict or add
  a visual-gate state machine.
- Legacy migration is per-profile. The pre-release home-global marker is
  intentionally ignored; a profile migrated by that pre-release build may
  re-import once. Per-profile markers are the durable authority.
- `presets/opencode-omo/permission-rules.mjs` anchors each path-bearing tool on
  the same `workingDirectory` projection its executor uses, including
  `apply_patch`/`hashline_edit`/`read_image`/`lsp_*`, native
  `read`/`write`/`edit`/`glob`/`grep`, and `glob`/`grep` without `path`. It
  falls back to `header.cwd` when the working-directory service is unavailable,
  fails, or returns an empty path; write tools therefore fail closed only when
  the resolved path itself is outside the header root.
- `presets/opencode-omo/delegation-restrictions.mjs` is the only tool
  capability/role restriction table. `task-shim` and `driver` derive their
  filters from it; every named row in `agent.cordis.yml` must be classified.
  `task(category=...)` children keep the `sisyphus` route; as delegated primary
  roles they receive the worker prompt regardless of catalog shape. DENY_PRIMARY
  is the reason they cannot orchestrate, not the prompt-selection predicate.
  `KNOWN_CATEGORIES` in `task-shim` is the category list rendered by the atlas
  guidance.
  Shell is classified but intentionally retained for write-tool-restricted specialist roles
  (omo parity; not a filesystem sandbox), and unmounted tools default to read.
- `src/client/omo-roles-store.ts` has one reducer and one private `dispatch`;
  form subscriptions, methods and UI handlers only emit events. Errors carry a
  closed `OmoRolesErrorReason` alongside the display message.
- `src/core/migration-state.ts` models the legacy migration as a closed
  `pending/migrating/migrated/skipped/failed` transition; the host row performs
  the effects.
- `presets/opencode-omo/background-state.mjs` models one background activation
  as `queued/running/cancelling/settled`; task-shim handlers/cancel paths emit
  events and only its transition writes the lifecycle.
- `scripts/check-architecture.mjs` is a CI gate for these boundaries, run by
  `npm run check:architecture`, `npm run build` and `npm test`. It rejects a
  second patch parser, local deny lists in the shim/driver, a named row whose capability is not
  delegation, or a second client-state writer.
