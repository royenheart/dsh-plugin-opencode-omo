// Headless-safe declaration row for the `opencode-omo` agent preset.
//
// The official `@deepseek-ai/dsh-agent-preset` row statically injects
// `agentPresets`. A composition that never mounts the preset registry — the
// migrator's boot probe composes `dsh-base` + `dsh-headless`, which has no
// Host or preset layer — therefore leaves the loader entry pending forever and
// the boot is reported as "did not activate". A `disabled: !!js` guard does not
// fix that either: the expression is evaluated once while the web-app's
// registry is still initializing, so the row would be skipped permanently in
// the very profile that does mount the registry.
//
// This row keeps the official declarative form — the same `config` shape, and
// `EntryGroup` semantics so the nested composition keeps its `!!js` nodes for
// the registry's own mount — but activates immediately and submits the
// definition through the registry's `agentPresets.register()` API once the
// service exists, holding the definition disposer until unload.
import { EntryGroup } from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'

/** Definition submitted to the preset registry (mirrors `@deepseek-ai/dsh-agent-preset`). */
export default class OmoAgentPresetRow {
  /** Keep the nested `plugins` composition as loader data, not host rows. */
  static [EntryGroup.key] = true

  static Config = z.object({
    id: z.string().required(),
    name: z.string(),
    description: z.string(),
    order: z.number(),
    // Cordis owns individual plugin schemas; the registry validates entry structure.
    plugins: z.array(z.any()).required(),
  })

  constructor(ctx, config) {
    ctx.inject(['agentPresets'], (child) => {
      let unregister
      let disposed = false
      child.effect(() => {
        void child.agentPresets.register(config)
          .then((dispose) => {
            if (disposed) return dispose()
            unregister = dispose
            return undefined
          })
          .catch((error) => {
            child.logger?.warn('opencode-omo: agent preset registration failed', error)
          })
        return () => {
          disposed = true
          if (unregister !== undefined) void unregister()
        }
      })
    })
  }
}
