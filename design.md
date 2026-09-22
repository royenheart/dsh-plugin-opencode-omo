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
| maxSteps + verbatim MAX_STEPS_PROMPT | `agent/pre-step` returning `assistantPrefill` on a harness carrying `patches/0001-agent-pre-step-assistant-prefill.patch`; a system-prompt section is the stock-loop fallback |
| Role primary model + ultrawork override | `agent/request` waterfall |
| Fallback chain before harness retry policy | `agent/request-error` waterfall returning `{ kind: 'retry' }` |

All of these are scope-filtered events: a listener registered in the preset's
standing scope receives every agent under that preset (scope parent chain),
which is exactly the isolation the driver seam provided. Verified with three
probe tests against the dsh test harness: complete persona replacement, gpt
tool gating, role route, request-error fallback, max-steps injection, and
ultrawork routing all fire with a plain `ReactLoopAgent`.

## Current fidelity posture (dsh 0.1.7-alpha.1)

1. Official 0.1.7 still has no `PreStepDecision.assistantPrefill`, no step cap,
   and no assistant-role request injection. The plugin **ships the general-purpose
   patch again** (`patches/0001-agent-pre-step-assistant-prefill.patch`, rebased
   onto 0.1.7-alpha.1) instead of dropping the surface:
   `agent/pre-step` returns the verbatim `MAX_STEPS_PROMPT` as a request-only
   assistant continuation, logged on `request/header` and never written as a
   session message. Upstream: https://github.com/deepseek-ai/deepseek-harness/discussions/2407

   The host registry probes the **running installation's** resolved
   `@deepseek-ai/dsh-agent-loop` entry for the `assistantPrefill` marker (dsh
   install anchor → profile directory → shared module fallback) and exposes the
   answer as `omoRoles.honorsAssistantPrefill()`; `driver.mjs` asks it and keeps
   its own module-tree probe only for a preset mounted without the host row.
   Probing the running installation matters because a plugin checkout can hold
   an unpatched published copy of the loop while the harness runs a patched one.
   Without the patch the same text and trigger render as a system-prompt section
   on the ceiling step, and the driver logs that the fallback is active. Behavioral gaps on a stock
   harness: assistant vs system role, token placement, and
   reconstructable-requests (live assembly vs `request/header`).
   Transcript/stats/compaction still omit the ceiling text on both paths.
   Nothing is silently dropped.

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

## Preset publishing on 0.1.7 (declaration rows)

0.1.7 presets are `@deepseek-ai/dsh-agent-preset` declaration rows carried by a
bundle/profile patch; the former `$DSH_HOME/.agent-presets` directory root
("Nothing reads that directory any more", `editing-cordis-compositions` skill)
is retired by `install.py`.

The row itself is `presets/opencode-omo/preset-row.mjs`, a headless-safe
declaration equivalent: it keeps the official `config` shape and
`EntryGroup.key` semantics (the nested composition keeps its `!!js` nodes for
the registry's mount) but does not statically inject `agentPresets`. A
composition without the preset registry — `dsh-base` + `dsh-headless` — would
otherwise leave the loader entry pending forever, and a `disabled: !!js` guard
evaluates too early to help (the web-app's registry is still initializing when
the row is first read). The wrapper activates immediately and submits the
definition through `agentPresets.register()` once the service exists, holding
the definition disposer until unload.

The composition stays the single source of truth in
`presets/opencode-omo/agent.cordis.yml`. `scripts/build-preset-patch.mjs`
(run by `scripts/build.sh`) nests it as the declaration's `config.plugins`,
rewrites `./driver.mjs`-style rows to
`@royenheart/dsh-plugin-opencode-omo/presets/opencode-omo/...` package subpaths
(the `./presets/*` export), and writes the generated `cordis.patch.yml` from
`cordis.patch.template.yml` plus the preset metadata. A textual transformation
is used deliberately: the composition carries the loader's `!!js` expression
tag, which a generic YAML round-trip would not preserve.

## dsh-side footprint after the 0.1.7 re-scan

One patch: `patches/0001-agent-pre-step-assistant-prefill.patch`.

- The preset-root merge, the entire `dsh-agent-driver` + `agent-loop` subclass
  seam, and the `conversation.input.role` composer seat remain dropped in favor
  of the official declarative preset rows, the native prompt/event waterfalls,
  and the existing `conversation.input.left` list slot.
- The `assistantPrefill` patch is restored and rebased; the system-prompt
  section is a fallback for unpatched harnesses, not the product surface.
- The 0.1.7 settings port landed: the host row declares `roles` + `sessions` as
  volatile fields of its own Cordis `Config` and turns off the auto-generated
  raw-Config page (`ctx.settings.configure({ auto: false })`); the browser half
  reads/writes through `ctx.configForms.get('opencode-omo-roles')`. The row id
  is kept equal to the former settings namespace so the harness's one-time
  `$DSH_HOME/settings.yaml` import (section id → profile entry id) carries a
  pre-0.1.7 section into the Config. The authenticated `/opencode-omo` channel
  is unchanged and remains the non-loopback transport, because dsh resolves
  browser forms to memory mode off loopback; see
  `docs/remote-settings-hybrid-design.md`.

Everything else runs on an unmodified 0.1.7-alpha.1 checkout.
