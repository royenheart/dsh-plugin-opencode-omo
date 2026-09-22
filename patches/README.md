# dsh-side patches

## `0001-agent-pre-step-assistant-prefill.patch`

Target: `deepseek-ai/deepseek-harness` @ `dsh-v0.1.7-alpha.1`.

Adds the general-purpose seam the `opencode-omo` preset needs for opencode's
`maxSteps` behavior: a **request-only assistant continuation**.

- `PreStepDecision.enter.assistantPrefill?: string` — an `agent/pre-step`
  listener returns the exact text; the loop appends it as one assistant message
  after the derived history on every attempt of that step.
- `EpochHeader.assistantPrefill?: string` — the text is recorded on the existing
  `request/header` snapshot, so log reconstruction still reproduces the request
  exactly. It is never a session message: transcript, stats, and compaction omit
  it.
- The loop invariant reconstructs `deriveMessages()` plus the folded header's
  prefill message, preserving the log-reconstruction guarantee.
- Docs updated: `docs/architecture.md`, `packages/core/agent/README.md` (+ zh),
  `docs/subsystems/core.md` (+ zh `ts type-equiv` paste),
  `packages/core/agent-loop/README.md`.

Apply from the harness checkout root:

```sh
git apply /path/to/dsh-plugin-opencode-omo/patches/0001-agent-pre-step-assistant-prefill.patch
```

### Why the previous deletion is reversed

0.1.2-alpha.2 shipped no `assistantPrefill`, so the 0.1.2 retarget deleted the
original patch and rendered `MAX_STEPS_PROMPT` as a system-prompt section
instead. That fallback exists because the mode must survive a stock harness —
it is not equivalent to opencode's assistant tail. The plugin's own README
documents the resulting gaps (role/position, token accounting, wrap-up
behavior) and tracks upstream
[discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407).
The surface stays in the product, so the patch is restored and rebased.

### Behavior without the patch (stock harness)

`driver.mjs` asks the host registry whether the seam is present; the registry
probes the **running installation's** resolved `@deepseek-ai/dsh-agent-loop`
entry for the `assistantPrefill` marker (dsh install anchor → profile directory
→ shared module fallback). Probing the running installation matters: a plugin
checkout can hold an unpatched published copy of the loop while the harness runs
a patched one. The driver keeps its own module-tree probe as the fallback when
the host row is absent. Without the seam, the ceiling text renders as a
complete-system-prompt section on the step that hits the cap — same text and
trigger, system role instead of a trailing assistant continuation. The driver
logs which path is active.

### Residual inconsistencies vs opencode (and vs a patched harness)

Keep these in mind when comparing traces or benches:

1. **Role / position.** opencode appends the ceiling text as an **assistant**
   continuation. Without the patch it is a **system** prefix on that step. A
   model that obeys “CRITICAL - MAXIMUM STEPS REACHED” more strongly as “its own
   last line” may keep tool-calling longer, or wrap up more timidly, than
   opencode.
2. **Token accounting.** Without the patch the extra tokens sit in the system
   prompt; with it they are extra assistant tokens on that request. Cache-key
   and billing breakdowns differ between the two paths.
3. **Transcript cleanliness is the same.** Neither path writes a session
   `assistant/message` or `user/message` for the ceiling text. Compaction and
   stats still omit it.
4. **No silent drop.** The ceiling still fires at `step >= maxSteps`; only the
   channel changes.
