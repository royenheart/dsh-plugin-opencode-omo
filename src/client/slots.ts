/**
 * Local SlotMap declaration for the settings tab this plugin owns.
 *
 * `conversation.input.left` is declared by `@deepseek-ai/dsh-client-ui-conversation`
 * on 0.2.1; the plugin no longer redeclares the owner's seat. The nested tab is
 * plugin-owned and declared here only so this package typechecks independently.
 */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Plugin-owned nested tab inside the opencode-omo settings section. */
    'opencode-omo.settings.tab': {
      kind: 'list'
      scope: 'root'
      owner: { readonly children?: never }
    }
  }
}

export {}
