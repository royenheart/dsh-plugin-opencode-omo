/**
 * Local SlotMap declaration for the ui-conversation seat this plugin
 * occupies. It mirrors the owning package's declaration — declared here too so
 * the plugin's own typecheck sees the seat even when the installed owner
 * typings resolve through a different package tree (pnpm copies) than the
 * runtime's ui-slots copy. When the installed owner typings resolve to the
 * same physical copy, its declaration already covers the seat and the
 * duplicate property is ignored below. The owning plugin still declares the
 * seat at runtime; this file is type-only.
 */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    // @ts-ignore - duplicate declaration is expected and harmless when the
    // installed ui-conversation typings already declare the same seat.
    'conversation.input.left': {
      kind: 'list'
      scope: 'session'
      owner: { readonly session: unknown; readonly input: unknown }
    }
    // 0.1.2 declares this seat from the settings shell package; keep a local
    // mirror so the plugin typechecks against a pnpm-copied owner tree too.
    // @ts-ignore - duplicate declaration is expected and harmless.
    'settings.section': {
      kind: 'list'
      scope: 'root'
      owner: { readonly close: unknown }
    }
    /** Plugin-owned nested tab inside the opencode-omo settings section. */
    'opencode-omo.settings.tab': {
      kind: 'list'
      scope: 'root'
      owner: { readonly children?: never }
    }
  }
}

export {}
