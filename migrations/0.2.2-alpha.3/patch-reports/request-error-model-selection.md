# [Feature request] Let `agent/request-error` retry on a different model selection

> English summary: dsh 0.2.2 fixes the step's provider/model/reasoning effort
> before prompt assembly and reuses that selection for every retry. The
> `agent/request-error` waterfall can request `{ kind: 'retry' }`, but it cannot
> move the retry to another route. Add an optional `modelSelection` to
> `RequestErrorAction` so provider failover, per-role fallback chains, and
> similar recovery plugins can keep the retry inside the same step instead of
> ending the turn.

## Background

DSH's request recovery is a plugin waterfall. `agent/request-error` observes a
terminal stream failure and may return `{ kind: 'retry' }`; the loop then
re-prepares the request and tries again. Before 0.2.2 a listener could combine
that retry with a route change in the deprecated `agent/request` waterfall. The
0.2.2 model-selection contract removed that possibility: the step's selection is
captured before assembly, and `agent/request` may no longer change provider,
model, or reasoning effort.

The opencode-omo preset documents a per-role fallback chain. On a request
failure it advances to the next configured model before the harness retry policy
runs. With the current API it cannot do that: `agent.model.select()` records a
choice for the next step, while the current retry keeps the failed step's
captured selection.

## Current state

- `PreStepDecision`/`agent/pre-step` receive the captured `modelSelection` but
  cannot replace it for the retry.
- `Agent.model.select()` is the supported model-selection API, but the loop
  reads `decision.selection` for the in-flight retry.
- `RequestErrorAction` is only `{ kind: 'retry' } | undefined`.
- As a result, a stock 0.2.2-alpha.3 host stays on the failed route under the
  harness retry policy; a plugin fallback chain is not consumed in-step.

## Proposal

Extend the recovery action with an optional complete selection:

```ts
export type RequestErrorAction =
  | {
    kind: 'retry'
    /** Optional route for the retry; omission keeps the captured selection. */
    modelSelection?: Readonly<ModelSelection>
  }
  | undefined
```

When the loop sees `{ kind: 'retry', modelSelection }` it should:

1. record the selection through `agent.model.select()` so the session log is
   reconstructable;
2. use it when preparing the retry; and
3. expose a capability marker on `AgentLoop` (for example
   `supportsRequestErrorSelection = true`) so plugins can choose the patched
   path without scanning package source.

The retry continues to reuse the step's assembled prompt/tool surface, which is
already the documented behavior for an in-step retry; only the request route
changes. The model-visible prompt for that retry remains the primary assembly
until the next step, as it did before 0.2.2.

## Appendix: patch

```diff
diff --git a/packages/core/agent-loop/src/agent.ts b/packages/core/agent-loop/src/agent.ts
index 9f75441c..b5e5b4f3 100644
--- a/packages/core/agent-loop/src/agent.ts
+++ b/packages/core/agent-loop/src/agent.ts
@@ -565,6 +565,10 @@ export class ReactLoopAgent implements Agent {
           if (action?.kind !== 'retry') {
             throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
           }
+          if (action.modelSelection !== undefined) {
+            this.model.select(action.modelSelection)
+            decision.selection = action.modelSelection
+          }
           continue
         }
 
diff --git a/packages/core/agent-loop/src/index.ts b/packages/core/agent-loop/src/index.ts
index fdd272ea..b4e7a038 100644
--- a/packages/core/agent-loop/src/index.ts
+++ b/packages/core/agent-loop/src/index.ts
@@ -313,6 +313,11 @@ export class AgentLoop extends Service implements AgentFactory {
    * assistant tail). Plugins probe this instead of scanning package source.
    */
   readonly supportsAssistantPrefill: boolean = true
+  /**
+   * Capability marker for `RequestErrorAction.modelSelection` (retry on a
+   * different model). Plugins probe this instead of scanning package source.
+   */
+  readonly supportsRequestErrorSelection: boolean = true
   private readonly ownership: FactoryOwnership
   /** Plain holder prevents Cordis from re-tracing the factory's dependency context through a caller shadow. */
   private readonly runtime: { ctx: Context }
diff --git a/packages/core/agent-loop/tests/request-error-selection.spec.ts b/packages/core/agent-loop/tests/request-error-selection.spec.ts
new file mode 100644
index 00000000..95c07735
--- /dev/null
+++ b/packages/core/agent-loop/tests/request-error-selection.spec.ts
@@ -0,0 +1,58 @@
+import { describe, expect, it } from 'vitest'
+import { Context } from '@deepseek-ai/cordis'
+import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
+import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
+import type { StreamChunk } from '@deepseek-ai/dsh-llm'
+import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
+import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
+import ToolRuntime from '@deepseek-ai/dsh-tools'
+import AgentRegistry from '@deepseek-ai/dsh-agent'
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
+
+const failed: StreamChunk[] = [
+  { type: 'usage', usage: { inputTokens: 1, outputTokens: 0 } },
+  { type: 'finish', reason: { kind: 'error', failure: { message: 'retry', code: 'SERVER' } } },
+]
+
+describe('RequestErrorAction.modelSelection', () => {
+  it('records the recovery selection and retries the step on that route', async () => {
+    const adapter = new MockAdapter([failed, textResponse('ok')])
+    const ctx = await harness(adapter)
+    const agent = await ctx.agentLoop.create(SessionId('selection-retry'), {
+      provider: 'mock',
+      model: 'primary',
+    })
+
+    ctx.on('agent/request-error', async () => ({
+      kind: 'retry',
+      modelSelection: { provider: 'mock', model: 'fallback' },
+    }))
+
+    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
+    await agent.whenIdle()
+
+    expect(adapter.requests.map(request => request.model)).toEqual(['primary', 'fallback'])
+    expect(agent.session.requestHeader()?.config.model).toBe('fallback')
+    expect(agent.session.snapshotEvents()).toContainEqual(expect.objectContaining({
+      type: 'model/selection',
+      data: { provider: 'mock', model: 'fallback' },
+    }))
+  })
+})
diff --git a/packages/core/agent/src/runtime-types.ts b/packages/core/agent/src/runtime-types.ts
index 6da1c699..fe189dca 100644
--- a/packages/core/agent/src/runtime-types.ts
+++ b/packages/core/agent/src/runtime-types.ts
@@ -152,7 +152,17 @@ export type PreStepDecision =
   }
 
 /** Action returned by a listener that owns model-request recovery. */
-export type RequestErrorAction = { kind: 'retry' } | undefined
+export type RequestErrorAction =
+  | {
+    kind: 'retry'
+    /**
+     * Optional route for the retry. The loop records it through
+     * `agent.model.select()` and prepares the retry with this selection;
+     * omission retries the step's captured selection.
+     */
+    modelSelection?: Readonly<ModelSelection>
+  }
+  | undefined
 
 /** Why a session lifecycle began; seeded creates are `startup`, while persisted loads are `resume`. */
 export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'
```

## Questions to confirm

1. Is a per-attempt route change in `agent/request-error` the intended
   fallback boundary, or should fallback live in the LLM adapter/retry layer?
2. Should the loop record `modelSelection` itself (proposed) or require the
   listener to call `agent.model.select()` before returning the retry action?
3. Should the retry be allowed to re-assemble the prompt/tool surface for the
   new route, or is reusing the step's primary assembly acceptable for a
   same-step retry?
4. Is `supportsRequestErrorSelection` the right capability-marker name?

## Related

- [Discussion #2407 — request-only assistant prefill for `agent/pre-step`](https://github.com/deepseek-ai/deepseek-harness/discussions/2407)
  — sibling loop-extension request for the other opencode-omo patch.
- [Discussion #5152 — dsh-model-pin](https://github.com/deepseek-ai/deepseek-harness/discussions/5152)
  — related model pinning discussion.
- [Discussion #3544 — dsh-quota-router](https://github.com/deepseek-ai/deepseek-harness/discussions/3544)
  — related quota/route fallback discussion.
- Search performed: GitHub issues and pull requests for `fallback`, `model
  fallback`, `request-error`, `assistantPrefill`, and `modelSelection` returned
  no direct request; discussions search surfaced the related items above.