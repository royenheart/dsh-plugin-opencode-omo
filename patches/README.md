# dsh-side patches

This directory ships the minimal dsh-side change required by the documented
opencode-omo complete surface. Everything else runs on native dsh seams.

## `0001-agent-pre-step-assistant-prefill.patch`

- **Why**: opencode ends the budget-limited last step with an
  assistant-role `MAX_STEPS_PROMPT` continuation. dsh's `PreStepDecision`
  only accepts `UserMessage[]`, and the plugin's complete-surface spec keeps
  the assistant tail rather than demoting it to a system-prompt section.
- **What**: adds optional `PreStepDecision.assistantPrefill`. The loop never
  writes it as a session message; it appends it after the derived history for
  that request and logs it on `request/header`. The reconstruction invariant
  and token-meter fold the same field, so every model-visible byte remains
  reconstructable and priced.
- **Files**:
  - `packages/core/agent/src/runtime-types.ts`
  - `packages/core/agent-loop/src/agent.ts`
  - `packages/core/agent-loop/src/invariant.ts`
  - `packages/core/agent-loop/tests/interception.spec.ts`
  - `packages/core/session/src/types.ts`
  - `packages/core/session/src/request-header.ts`
  - `packages/llm/token-meter/src/estimate.ts`
  - `packages/extensions/tool-cordis/src/api-catalog.ts` (regenerated
    Cordis API catalog so the public `EpochHeader`/`PreStepDecision`
    declarations match the source)
- **Baseline**: `dsh-v0.1.2-alpha.3` (tag, `dd6322d`). Alpha.3 has not
  absorbed the seam; `PreStepDecision` is still `reject | enter` with user
  messages only.
- **Apply** (from a deepseek-harness checkout at the baseline):

  ```sh
  git apply /path/to/dsh-plugin-opencode-omo/patches/0001-agent-pre-step-assistant-prefill.patch
  pnpm install --frozen-lockfile
  pnpm exec vitest run packages/core/agent-loop/tests/interception.spec.ts \
    packages/core/agent-loop/tests/invariant.spec.ts \
    packages/core/session packages/llm/token-meter
  pnpm run gen-cordis-catalog -- --check
  ```

  Verified on this checkout: `interception.spec.ts` 24/24,
  `invariant.spec.ts` 8/8, session and token-meter suites 396/396,
  `tsc -b` for `dsh-agent`, `dsh-agent-loop`, `dsh-session`, and
  `dsh-token-meter`, and `gen-cordis-catalog --check` reports all 97
  generated files/regions up to date.

- **Patchless fallback**: without the patch the plugin still works, but the
  same `MAX_STEPS_PROMPT` text degrades to a system-prompt section on the
  ceiling step. The host registry detects the installed
  `@deepseek-ai/dsh-agent-loop` marker and reports the degradation through
  `/roles` and a one-shot browser Toast. That fallback is runtime survival,
  not the documented product surface.

Upstream feature request:
https://github.com/deepseek-ai/deepseek-harness/discussions/2407
