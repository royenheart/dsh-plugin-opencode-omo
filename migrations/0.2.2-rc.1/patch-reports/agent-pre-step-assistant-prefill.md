# [Feature request] Request-only assistant prefill for `agent/pre-step` (header-logged, never a session message)

> Add an optional `PreStepDecision.assistantPrefill` on the `enter` branch. The loop logs it on the request's `EpochHeader`, appends it as an assistant-role tail to exactly that request, prices it in token pressure, and never writes a session `assistant/message`. This preserves opencode's `MAX_STEPS_PROMPT` as an assistant continuation without polluting transcript, compaction, or stats.

**Status of this report.** The request already exists upstream as [discussion #2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407). This report is not a duplicate proposal: it records the 0.2.2-rc.1 rebase, the verification run, and the exact patch that `@royenheart/dsh-plugin-opencode-omo` still needs for its documented max-steps surface.

## Background

opencode appends its `MAX_STEPS_PROMPT` as an assistant-role continuation on the ceiling step. The harness `agent/pre-step` seam admits only `UserMessage[]`, and `agent/request` can change route and sampling but not request messages. A complete system-prompt section is a different model-visible role and is the plugin's documented degraded path on unpatched hosts, not an equivalent replacement.

The plugin (`@royenheart/dsh-plugin-opencode-omo`) documents this as a required dsh-side patch in `patches/README.md` and `README.md` (“Required dsh-side changes”). It probes `ctx.agentLoop.supportsAssistantPrefill` and keeps the system-section fallback when the marker is absent, so the patch is part of the complete surface rather than a load-time requirement.

## Current state

Harness `dsh-v0.2.2-rc.1` (commit `66491b05`) still has:

- `PreStepDecision = { kind: 'reject' } | { kind: 'enter', messages, startsRequestSeries? }` with no assistant tail field;
- an `agent/request` waterfall that returns `LlmCallConfig` only;
- no session event or public seam for a request-only assistant message;
- `request/header` carrying config, adapter defaults, and tools, but no request-only assistant text.

The patch applies cleanly to the 0.2.2-rc.1 checkout after rebasing. Verification on that checkout:

```sh
vitest run \
  packages/core/agent-loop/tests/assistant-prefill.spec.ts \
  packages/core/agent-loop/tests/interception.spec.ts \
  packages/core/session/tests/request-header.spec.ts \
  packages/llm/token-meter/tests/token-meter.spec.ts
```

Result: 4 files, 59 tests passed. The patch was applied with `git apply` to the checkout; the checkout was not committed.

Companion plugin update, verified against the same release: the preset's
model-visible tool gate no longer rides `system-prompt/assemble` (that release
removed tool arrays from `PromptPresentation`). The plugin now registers
per-agent `ctx.tools.register(..., { when })` admissions and scoped
restrictions, preserving the hidden-name/model-family/role filter and the
opencode descriptions. `npm run build` and the full plugin test suite pass on
an exact `0.2.2-rc.1` dependency set (150 tests passed, 1 live-web test
skipped); the new `tests/tool-admission.spec.mjs` resolves a real step set and
checks those admissions. This source work does not replace or weaken the
assistant-prefill patch.

The active peer baseline is now `0.2.2-rc.1`, so this single variant is the
supported patch target. The earlier `0.2.1-rc.2` variant and its
`git apply --check` note were retired with that baseline; the appendix below is
the active 0.2.2-rc.1 variant.

## Proposal

1. Extend the `enter` branch of `PreStepDecision` with `assistantPrefill?: string`.
2. Plumb the field through `ReactLoopAgent.preStep`/`step` into `buildRequest`.
3. Append a frozen assistant message after the derived boundary messages only in the request value; keep it out of `session.deriveMessages()`, transcript events, compaction, and surface nodes.
4. Add `EpochHeader.assistantPrefill`, preserve it in `canonicalHeader`, and compare it in `headerEquals` so a changed prefill logs a new request header and request reconstruction sees it.
5. Price the field with `estimateAssistantPrefillTokens` and fold it into `estimateHeaderTokens`; keep it out of the context-breakdown projection.
6. Expose `AgentLoop.supportsAssistantPrefill = true` so plugins can select the seam without package-source scanning.
7. Add `packages/core/agent-loop/tests/assistant-prefill.spec.ts` covering one-request placement, header logging, and absence from session `assistant/message` events.

## Appendix: patch

The patch below is the rebased artifact stored at `patches/0001-agent-pre-step-assistant-prefill.patch`.

```diff
diff --git a/packages/core/agent-loop/src/agent.ts b/packages/core/agent-loop/src/agent.ts
index c4daa50c..9f75441c 100644
--- a/packages/core/agent-loop/src/agent.ts
+++ b/packages/core/agent-loop/src/agent.ts
@@ -68,6 +68,8 @@ type PreparedStep =
     kind: 'enter'
     messages: UserMessage[]
     startsRequestSeries?: true
+    /** Request-only assistant tail admitted for this step's request. */
+    assistantPrefill?: string
     assembly: PromptAssembly
     selection: Readonly<ModelSelection>
     /** Admission shared by the step's declarations and dispatch; the turn disposes it after the step. */
@@ -476,7 +478,10 @@ export class ReactLoopAgent implements Agent {
         this.session.append('user/message', context, { surfaceOp: 'append' })
       }
       firstAttempt = false
-      const request = this.buildRequest(config, preparedCall, assembly.tools, { turn, step }, startsRequestSeries, signal)
+      const request = this.buildRequest(
+        config, preparedCall, assembly.tools, { turn, step }, startsRequestSeries,
+        decision.assistantPrefill, signal,
+      )
       const live = new AssistantStreamAttempt(
         this.session.id,
         ++this.assistantAttemptCounter,
@@ -659,6 +664,7 @@ export class ReactLoopAgent implements Agent {
     tools: GenerateOptions['tools'] & object,
     position: { turn: number; step: number },
     startsRequestSeries: boolean,
+    assistantPrefill: string | undefined,
     signal: AbortSignal,
   ): GenerateOptions {
     const { session } = this
@@ -667,6 +673,7 @@ export class ReactLoopAgent implements Agent {
       config,
       ...preparedCall === undefined ? {} : { adapterDefaults: preparedCall.adapterDefaults },
       ...tools.length > 0 ? { tools } : {},
+      ...assistantPrefill === undefined ? {} : { assistantPrefill },
     })
     const baseline = this.session.requestHeader()
     const startsSeries = startsRequestSeries
@@ -732,9 +739,19 @@ export class ReactLoopAgent implements Agent {
       this.frozenMessages.add(message)
     }
     Object.freeze(boundaryMessages)
+    // Request-only assistant tail: not appended to the session, not part of
+    // later derived history, and not visible to compaction/transcript.
+    const requestMessages = [...boundaryMessages]
+    if (assistantPrefill !== undefined) {
+      requestMessages.push(createAssistantMessage({
+        content: [{ type: 'text', text: assistantPrefill }],
+        source: { provider: config.provider, model: config.model },
+      }))
+    }
+    Object.freeze(requestMessages)
     const request = markAgentLoopRequest(Object.freeze({
       ...header.config,
-      messages: boundaryMessages,
+      messages: requestMessages,
       toolHistory: session.toolHistory(),
       ...header.tools !== undefined ? { tools: header.tools } : {},
       sessionId: this.session.id,
diff --git a/packages/core/agent-loop/src/index.ts b/packages/core/agent-loop/src/index.ts
index 381ef6e9..fdd272ea 100644
--- a/packages/core/agent-loop/src/index.ts
+++ b/packages/core/agent-loop/src/index.ts
@@ -308,6 +308,11 @@ export class AgentLoop extends Service implements AgentFactory {
 
   /** Validated configuration owned by the agent-loop service. */
   readonly config: Config
+  /**
+   * Capability marker for `PreStepDecision.assistantPrefill` (request-only
+   * assistant tail). Plugins probe this instead of scanning package source.
+   */
+  readonly supportsAssistantPrefill: boolean = true
   private readonly ownership: FactoryOwnership
   /** Plain holder prevents Cordis from re-tracing the factory's dependency context through a caller shadow. */
   private readonly runtime: { ctx: Context }
diff --git a/packages/core/agent-loop/tests/assistant-prefill.spec.ts b/packages/core/agent-loop/tests/assistant-prefill.spec.ts
new file mode 100644
index 00000000..63f30159
--- /dev/null
+++ b/packages/core/agent-loop/tests/assistant-prefill.spec.ts
@@ -0,0 +1,64 @@
+import { describe, expect, it } from 'vitest'
+import { Context } from '@deepseek-ai/cordis'
+import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
+import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
+import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
+import ToolRuntime from '@deepseek-ai/dsh-tools'
+import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
+import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
+import AgentLoop from '@deepseek-ai/dsh-agent-loop'
+import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
+import { MockAdapter, textResponse } from './mock-adapter.ts'
+
+async function harness(adapter: MockAdapter) {
+  const ctx = new Context()
+  await ctx.plugin(LlmRuntime)
+  await ctx.plugin(SessionStore)
+  await ctx.plugin(SessionProjectionRegistry)
+  await ctx.plugin(SystemPrompt)
+  await ctx.plugin(ToolRuntime)
+  await ctx.plugin(NativeToolExecutor)
+  await ctx.plugin(AgentRegistry)
+  await ctx.plugin(AgentLoop, { agents: [] })
+  ctx.llm.registerAdapter(['mock'], adapter)
+  return ctx
+}
+
+function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
+  return new Promise((resolve) => {
+    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
+      if (subject === agent && status === 'idle') {
+        dispose()
+        resolve()
+      }
+    })
+  })
+}
+
+describe('PreStepDecision.assistantPrefill', () => {
+  it('appends an assistant tail to exactly one request and logs it on request/header', async () => {
+    const adapter = new MockAdapter([textResponse('ok')])
+    const ctx = await harness(adapter)
+    const agent = await ctx.agentLoop.create(SessionId('prefill'), { provider: 'mock', model: 'mock' })
+
+    ctx.on('agent/pre-step', async ({ messages }, next) => {
+      const decision = await next()
+      return decision.kind === 'enter' && messages.length > 0
+        ? { ...decision, assistantPrefill: 'CEILING' }
+        : decision
+    })
+
+    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } }))
+    await waitForIdle(ctx, agent)
+
+    expect(adapter.requests).toHaveLength(1)
+    expect(adapter.requests[0]!.messages.at(-1)).toMatchObject({
+      role: 'assistant',
+      content: [{ type: 'text', text: 'CEILING' }],
+    })
+    expect(agent.session.requestHeader()?.assistantPrefill).toBe('CEILING')
+    expect(agent.session.snapshotEvents().filter(event => event.type === 'assistant/message')).toHaveLength(1)
+    expect(agent.session.snapshotEvents().some(event =>
+      event.type === 'assistant/message' && JSON.stringify(event.data.message).includes('CEILING'))).toBe(false)
+  })
+})
diff --git a/packages/core/agent/src/runtime-types.ts b/packages/core/agent/src/runtime-types.ts
index 2b1698e3..6da1c699 100644
--- a/packages/core/agent/src/runtime-types.ts
+++ b/packages/core/agent/src/runtime-types.ts
@@ -143,6 +143,12 @@ export type PreStepDecision =
     messages: UserMessage[]
     /** Start a distinct model-message series before this step's admitted messages. */
     startsRequestSeries?: true
+    /**
+     * Request-only assistant tail appended after this step's admitted messages.
+     * The loop logs it on `request/header`, appends it to exactly this request,
+     * and never writes a session `assistant/message`.
+     */
+    assistantPrefill?: string
   }
 
 /** Action returned by a listener that owns model-request recovery. */
diff --git a/packages/core/session/src/request-header.ts b/packages/core/session/src/request-header.ts
index 326165a1..6ffd7f40 100644
--- a/packages/core/session/src/request-header.ts
+++ b/packages/core/session/src/request-header.ts
@@ -26,6 +26,9 @@ export function canonicalHeader(header: EpochHeader): EpochHeader {
       ? { adapterDefaults }
       : {},
     ...header.tools !== undefined && header.tools.length > 0 ? { tools: header.tools } : {},
+    ...typeof header.assistantPrefill === 'string' && header.assistantPrefill.length > 0
+      ? { assistantPrefill: header.assistantPrefill }
+      : {},
   }
 }
 
@@ -45,6 +48,7 @@ export function headerEquals(a: EpochHeader, b: EpochHeader): boolean {
     !callConfigEquals(a.config, b.config)
     || a.adapterDefaults?.reasoningEffort !== b.adapterDefaults?.reasoningEffort
     || a.adapterDefaults?.maxTokens !== b.adapterDefaults?.maxTokens
+    || a.assistantPrefill !== b.assistantPrefill
   ) return false
   const at = a.tools ?? []
   const bt = b.tools ?? []
diff --git a/packages/core/session/src/types.ts b/packages/core/session/src/types.ts
index 7787dd9b..1bf878ac 100644
--- a/packages/core/session/src/types.ts
+++ b/packages/core/session/src/types.ts
@@ -250,6 +250,12 @@ export interface EpochHeader {
   adapterDefaults?: LlmCallConfigAdapterDefaults
   /** Assembled tool schemas; absent for a tool-less request. */
   tools?: ToolSchema[]
+  /**
+   * Request-only assistant tail carried by the next request. It is logged for
+   * reconstruction and pricing but never becomes a session message or surface
+   * node.
+   */
+  assistantPrefill?: string
   /** Retired request text; system prompts belong to system/message events.
    * @persistenceReserved
    */
diff --git a/packages/llm/token-meter/src/estimate.ts b/packages/llm/token-meter/src/estimate.ts
index ca54abf6..998f4b97 100644
--- a/packages/llm/token-meter/src/estimate.ts
+++ b/packages/llm/token-meter/src/estimate.ts
@@ -91,8 +91,8 @@ export function estimateMessage(message: Message): number {
 }
 
 /**
- * Price the tool-schema part of a canonical request envelope — the envelope's
- * only priced field, since the system prompt is a surface node.
+ * Price the tool-schema part of a canonical request envelope; the system
+ * prompt is a surface node rather than an envelope field.
  * @param header - canonical envelope, or undefined before any request.
  * @returns heuristic tool-schema tokens; 0 when absent or empty.
  */
@@ -100,3 +100,22 @@ export function estimateToolsTokens(header: EpochHeader | undefined): number {
   if (header?.tools === undefined || header.tools.length === 0) return 0
   return Math.ceil(JSON.stringify(header.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD
 }
+
+/**
+ * Price the request-only assistant prefill carried by a header.
+ * @param header - canonical envelope, or undefined before any request.
+ * @returns heuristic text and role/block framing tokens; 0 when absent.
+ */
+export function estimateAssistantPrefillTokens(header: EpochHeader | undefined): number {
+  if (typeof header?.assistantPrefill !== 'string' || header.assistantPrefill.length === 0) return 0
+  return Math.ceil(header.assistantPrefill.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD + BLOCK_OVERHEAD
+}
+
+/**
+ * Price every canonical envelope field sent on the wire.
+ * @param header - canonical envelope, or undefined before any request.
+ * @returns heuristic tool-schema plus assistant-prefill tokens.
+ */
+export function estimateHeaderTokens(header: EpochHeader | undefined): number {
+  return estimateToolsTokens(header) + estimateAssistantPrefillTokens(header)
+}
diff --git a/packages/llm/token-meter/src/index.ts b/packages/llm/token-meter/src/index.ts
index 8b4f7fff..33739995 100644
--- a/packages/llm/token-meter/src/index.ts
+++ b/packages/llm/token-meter/src/index.ts
@@ -33,7 +33,7 @@ import type {
 import { contextBreakdownProjectionDefinition } from './breakdown-projection.ts'
 import { contextPressureProjectionDefinition, tokenUsageProjectionDefinition } from './usage-projection.ts'
 import type { ContextPressureState } from './usage-projection.ts'
-import { estimateMessage, estimateToolsTokens } from './estimate.ts'
+import { estimateHeaderTokens, estimateMessage } from './estimate.ts'
 import { advanceMeasurement, measurementProjectionDefinition } from './measurement-projection.ts'
 import type { MeasurementState } from './measurement-projection.ts'
 import { commitSurfaceTokens, planSurfaceTokens } from './surface-fold.ts'
@@ -166,7 +166,7 @@ export class TokenMeter extends Service {
       // compares like with like.
       const anchorSurfaceTokens = priceSurface(state.anchorNodes, pricing, fileText).surfaceTokens
         + anchor.assistantTokens
-      const estimatedAnchorTokens = estimateToolsTokens(header) + anchorSurfaceTokens
+      const estimatedAnchorTokens = estimateHeaderTokens(header) + anchorSurfaceTokens
       const usage = anchor.usage
       // Signed heuristic deltas remain conservative only from an anchor
       // that is at least as large as the matching full heuristic price.
@@ -180,7 +180,7 @@ export class TokenMeter extends Service {
     } else {
       baseline = {
         kind: 'estimated',
-        tokens: estimateToolsTokens(header) + surface.surfaceTokens,
+        tokens: estimateHeaderTokens(header) + surface.surfaceTokens,
       }
       surfaceDeltaTokens = 0
     }
```

## Questions to confirm

1. Is a header-only request field sufficient for the project rule that model-visible input must be reconstructable from the session log, or should this be a dedicated log-only session event?
2. Does adding `EpochHeader.assistantPrefill` require a session-format/version acknowledgement, even though it never becomes a transcript message?
3. Should the capability marker live on `AgentLoop` (`supportsAssistantPrefill`) or be a typed capability/service contract?
4. Should `assistantPrefill` be admitted on every step, or only when a pre-step listener explicitly returns it (as in the patch)?
5. Should pricing count the tail as assistant-role tokens exactly, including per-adapter framing, or remain the shared four-characters-per-token heuristic?
6. Is `assistantPrefill` the intended name, or should the field name the tail's request-only semantics (for example `requestAssistantTail`)?

## Related

- [Discussion #2407 — Request-only assistant prefill for agent/pre-step](https://github.com/deepseek-ai/deepseek-harness/discussions/2407) — the existing upstream request; this report refreshes its patch for 0.2.2-rc.1.
- GitHub issue/PR search on 2026-11-06 for `assistantPrefill`, `MAX_STEPS`, `assistant prefill`, `request-only assistant`, and `PreStepDecision` returned no issues or pull requests in `deepseek-ai/deepseek-harness`; only the discussion above exists.
- Harness source reviewed at `dsh-v0.2.2-rc.1`: `packages/core/agent/src/runtime-types.ts`, `packages/core/agent-loop/src/agent.ts`, `packages/core/session/src/{types,request-header}.ts`, `packages/llm/token-meter/src/{estimate,index}.ts`.
- Plugin evidence: `README.md` (“Required dsh-side changes”, “Fallback on unpatched hosts”), `patches/README.md`, `presets/opencode-omo/driver.mjs` (`supportsAssistantPrefill`, `MAX_STEPS_PROMPT`).