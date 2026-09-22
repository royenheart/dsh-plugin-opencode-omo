/**
 * dsh-plugin-opencode-omo — browser half.
 *
 * Registers two opencode-omo surfaces:
 * - `conversation.input.left`: the omo agent-type picker in the composer's
 *   existing left tool-row slot (opencode-omo sessions only; no dsh-side
 *   composer seat required);
 * - `settings.section`: the global "角色设置" page in the dsh settings panel,
 *   where each omo role's primary model and fallback models are configured.
 *
 * Role settings use the hybrid transport: `ctx.configForms.get(entryId)` — the
 * Config-derived form over the plugin's own `opencode-omo-roles` profile entry
 * — on loopback, and the authenticated `/opencode-omo` connection RPC channel
 * when the form is memory-mode (non-loopback browser, where dsh deliberately
 * keeps settings process-local). The session model catalog and selection keep
 * using the existing `remote.session` RPC.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the renderer's `slots` service merge (0.1.7 replaced the
// former dsh-client-runtime/client aggregate) plus the standard slot kit.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the composer SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the settings.section SlotMap declaration and the ctx.configForms service merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import { RoleSelect, installTriggerStyles } from './RoleSelect.tsx'
import type { RoleSelectInjected } from './RoleSelect.tsx'
import { OmoSettingsSection } from './OmoSettingsSection.tsx'
import type { OmoSettingsSectionProps } from './OmoSettingsSection.tsx'
import { RoleSettingsSection } from './RoleSettings.tsx'
import type { RoleSettingsInjected } from './RoleSettings.tsx'
import { OMO_ROLE_SETTINGS_NAMESPACE } from '../core/omo-settings.ts'
import type { OmoCatalogModel } from './omo-wire.ts'
import type { OmoConfigForm, OmoRpcCaller } from './omo-roles-store.ts'
import type {} from './slots.ts'
export { RoleSelect, installTriggerStyles } from './RoleSelect.tsx'
export type { RoleSelectInjected, RoleSelectProps } from './RoleSelect.tsx'
export { OmoSettingsSection } from './OmoSettingsSection.tsx'
export type { OmoSettingsSectionProps } from './OmoSettingsSection.tsx'
export { RoleSettingsSection } from './RoleSettings.tsx'
export type { RoleSettingsInjected, RoleSettingsProps } from './RoleSettings.tsx'
export { OMO_ROLE_SETTINGS_NAMESPACE } from '../core/omo-settings.ts'

/** Cordis plugin name. */
export const name = 'opencode-omo-client'

/** Required services: slots + the Config-derived settings forms + connection RPC + the session remote. */
export const inject = ['slots', 'configForms', 'connection', 'remote', 'remote.session']

/** RemoteResult face used by `ctx.remote.session` (no `.result` wrapper). */
type RemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

type ModelCatalogGroup = {
  readonly id: string
  readonly models: readonly {
    readonly id: string
    readonly name: string
    readonly reasoning?: {
      readonly efforts: readonly { readonly id: string; readonly name: string }[]
      readonly defaultEffort?: string
    }
  }[]
}

/** Session remote: Host-generation catalog + per-session model select. */
type SessionRemote = {
  modelCatalog(): Promise<RemoteResult<{ groups: readonly ModelCatalogGroup[] }>>
  selectModel(request: {
    sessionId: SessionId
    provider: string
    model: string
  }): Promise<RemoteResult<unknown>>
}

/** Flatten one model catalog response into the picker vocabulary. */
function catalogOf(
  response: RemoteResult<{ groups: readonly ModelCatalogGroup[] }>,
): readonly OmoCatalogModel[] {
  if (!response.ok) {
    throw new Error(`${response.error.code}: ${response.error.message}`)
  }
  return response.value.groups.flatMap(group =>
    group.models.map(model => ({
      provider: group.id,
      model: model.id,
      label: model.name,
      ...(model.reasoning?.efforts.length
        ? { efforts: model.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name })) }
        : {}),
      ...(model.reasoning?.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort }),
    })),
  )
}

/**
 * Mount the composer role seat and the global settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const session = ctx.get('remote.session') as SessionRemote
  // The Config-derived form for this plugin's own profile entry (0.1.7). On a
  // non-loopback page dsh resolves the form to memory mode, whose snapshot is
  // `unavailable`; the store then uses the authenticated RPC channel below.
  const form = ctx.configForms.get(OMO_ROLE_SETTINGS_NAMESPACE) as unknown as OmoConfigForm
  const connection = ctx.get('connection') as unknown as {
    rpc?: OmoRpcCaller
  } | undefined
  const rpc = connection?.rpc

  const loadModels = async (): Promise<readonly OmoCatalogModel[]> =>
    catalogOf(await session.modelCatalog())

  const selectModel = async (selection: { provider: string; model: string }, sessionId: SessionId): Promise<boolean> => {
    const response = await session.selectModel({
      sessionId,
      provider: selection.provider,
      model: selection.model,
    })
    return response.ok
  }

  // The chip stylesheet belongs to the plugin, not to a component render:
  // register it once here and let unload remove it.
  ctx.effect(() => installTriggerStyles(), 'opencode-omo-client: role chip styles')

  ctx.effect(() => {
    // `slots.inject` waits for the declaring parent entry (ui-conversation /
    // ui-settings) instead of assuming a global apply order. Out-of-tree
    // bundles can compose in an order where the parent applies after this
    // package; direct register() then throws "slot ... is not declared".
    const disposeRole = ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left',
      id: 'opencode-omo-role',
      order: 10,
      label: () => 'opencode-omo',
      inject: (sessionId: SessionId): RoleSelectInjected => ({
        sessionId,
        form,
        rpc,
        selectModel: selection => selectModel(selection, sessionId),
      }),
    }, RoleSelect))

    // The settings page is registered unconditionally, not through
    // `configForms.whileServed`: a non-loopback deployment keeps the form
    // unavailable by design but must still show the page (the store's
    // authenticated RPC transport serves it there), so gating on the served
    // namespace would drop a documented entry point.
    const disposeSettings = ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: 'opencode-omo',
      order: 40,
      label: () => 'opencode-omo',
      children: {
        'opencode-omo.settings.tab': { kind: 'list', scope: 'root' },
      },
    }, OmoSettingsSection))

    const disposeSettingsTab = ctx.slots.inject('opencode-omo.settings.tab', () => ctx.slots.register({
      name: 'opencode-omo.settings.tab',
      id: 'roles',
      order: 0,
      label: () => '角色设置',
      inject: (): RoleSettingsInjected => ({
        form,
        rpc,
        loadModels,
      }),
    }, RoleSettingsSection))

    return () => {
      disposeRole()
      disposeSettingsTab()
      disposeSettings()
    }
  }, 'opencode-omo-client: role slots')
}
