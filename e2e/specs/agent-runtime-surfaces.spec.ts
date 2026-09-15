/**
 * Agent-runtime surfaces that CANNOT be exercised end to end in this lane, and
 * why. Each skipped case maps to a ledger row with `"state": "unknown"`.
 *
 * The blocker is the same for all of them: every one of these behaviors is
 * model-visible (a system prompt section, a tool schema, a hook firing on a
 * tool call, a route decision at request time). Observing them requires an agent
 * turn against a real provider — this lane is deliberately keyless and
 * deterministic, and the plugin ships no replay provider. The repository's Node
 * unit/integration specs cover the pure halves of these modules
 * (`tests/driver.spec.mjs`, `tests/tool-surface.spec.mjs`, `tests/task-shim.spec.mjs`,
 * `tests/comment-checker.spec.mjs`, `tests/delegation-surface.spec.mjs`,
 * `tests/preset-isolation.spec.mjs`, `tests/lsp-surface.spec.mjs`); what remains
 * untested here is only the wiring to a live model turn.
 *
 * The skips are intentional and visible in the Playwright report: they are the
 * lane's explicit ledger of "not covered end to end yet", never silent passes.
 * This file opens no page (every case is skipped), so the per-spec console
 * tripwire lives in the specs that actually drive the browser.
 */
import { test } from '../fixtures/dsh-app.ts'

test.describe('agent-runtime surfaces (needs a model provider)', () => {
  test.skip('opencode toolchain: complete tool surface and parameter shims', () => {
    // `tool-surface.mjs` rewrites the model-visible descriptions/parameters and
    // shims `read`/`edit`/`write`/`web_search`. Asserting the resulting schema
    // requires assembling a real request (agent turn). Unit coverage:
    // tests/tool-surface.spec.mjs. Blocked by: no keyless LLM adapter for a
    // third-party preset.
  })

  test.skip('omo task() invocation maps onto named subagents and delegation', () => {
    // `task-shim.mjs` registers the omo-shaped `task(category/subagent_type/
    // load_skills/run_in_background/task_id)` tool and rewrites background job
    // notices. Exercising it means the model calling the tool. Unit coverage:
    // tests/task-shim.spec.mjs, tests/delegation-surface.spec.mjs.
  })

  test.skip('omo multi-role subagents (oracle/librarian/explore/metis/momus/looker)', () => {
    // Spawning a role subagent is a model decision; the personas and the
    // registry face are covered by tests/host.spec.mjs and the preset unit
    // specs, but the end-to-end spawn needs a live turn.
  })

  test.skip('context injection: AGENTS.md/CLAUDE.md walk-up, skills/, rules-injector', () => {
    // The injected text is a system-prompt section, visible only inside an
    // assembled request. `tests/driver.spec.mjs` covers the assembly inputs.
  })

  test.skip('omo hooks: comment-checker rejection and hashline read tagging', () => {
    // Both fire on write/edit tool execution inside a turn. Unit coverage:
    // tests/comment-checker.spec.mjs (detection) and tests/hashline.spec.mjs if
    // present; the tool-call round trip needs a model.
  })

  test.skip('per-mode execution backend: local filesystem + persistent PTY shell', () => {
    // The preset swaps the sandboxed fs/shell for the local backend per session
    // scope. A browser assertion cannot observe tool execution; a headless run
    // with a live model would be the smallest end-to-end proof.
  })

  test.skip('native-seam loop shim: complete prompt, tool gating, ultrawork, maxSteps, role routing, fallback', () => {
    // `driver.mjs` computes the complete system prompt (persona + live env block
    // + role prompt), applies opencode's model tool gating, detects ultrawork,
    // appends MAX_STEPS_PROMPT (assistant prefill when patch 0001 is applied,
    // system section otherwise), routes the role model, and advances the
    // fallback chain on request errors. Each is a per-step decision observable
    // only from a real request/response pair. Unit coverage: tests/driver.spec.mjs,
    // tests/family.spec.mjs, tests/variants.spec.mjs.
  })

  test.skip('web_fetch tool enabled for the preset', () => {
    // `fetch: true` adds the host row to the preset's tool surface; calling it
    // requires a model turn and a network fetch, which the deterministic lane
    // must not depend on.
  })

  test.skip('lsp surface: named lsp_* tools over the native lsp seam', () => {
    // Preset load health (the LSP rows resolving) IS asserted by
    // preset-mode-picker.spec.ts; invoking a language server needs a model tool
    // call plus an installed server binary.
  })

  test.skip('per-role reasoning-effort selection reaches the request', () => {
    // The settings UI part is covered (settings-role-models.spec.ts); proving the
    // effort rides the request requires inspecting an assembled model request.
  })
})
