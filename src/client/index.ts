/**
 * dsh-plugin-opencode-omo — browser half.
 *
 * Registers two opencode-omo surfaces:
 * - `conversation.input.left`: the omo agent-type picker in the composer's
 *   existing left tool-row slot (opencode-omo sessions only; no dsh-side
 *   composer seat required);
 * - `settings.section`: the global "角色设置" page in the dsh settings panel,
 *   where each omo role's primary model and fallback models are configured.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves the 0.1.2 session controller types (session
// list/projection vocabulary replaced the former dsh-client-runtime).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: declares the web `ctx.slots` service (0.1.2 moved this from the
// retired dsh-client-runtime package into dsh-client-ui-renderer).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the composer SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the settings.section SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionIdOf } from '@deepseek-ai/dsh-client-ui-slots'
import { RoleSelect } from './RoleSelect.tsx'
import type { RoleSelectInjected } from './RoleSelect.tsx'
import { OmoSettingsSection } from './OmoSettingsSection.tsx'
import type { OmoSettingsSectionProps } from './OmoSettingsSection.tsx'
import { RoleSettingsSection } from './RoleSettings.tsx'
import type { RoleSettingsInjected } from './RoleSettings.tsx'
import type { OmoCatalogModel } from './omo-wire.ts'
import type {} from './slots.ts'
export { RoleSelect } from './RoleSelect.tsx'
export type { RoleSelectInjected, RoleSelectProps } from './RoleSelect.tsx'
export { OmoSettingsSection } from './OmoSettingsSection.tsx'
export type { OmoSettingsSectionProps } from './OmoSettingsSection.tsx'
export { RoleSettingsSection } from './RoleSettings.tsx'
export type { RoleSettingsInjected, RoleSettingsProps } from './RoleSettings.tsx'

/** Cordis plugin name. */
export const name = 'opencode-omo-client'

/** Required services: slot registry + the 0.1.2 session remote (catalog + select). */
export const inject = ['slots', 'remote', 'remote.session']

export const ROLES_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/roles'
export const ROLE_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/role'
export const ROLE_CONFIG_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/role-config'

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
    sessionId: SessionIdOf
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
 * Mount the composer role seat and the global settings section. The
 * package-level `dsh.client.inject` edges to ui-conversation and
 * ui-settings-general guarantee both SlotMap declarations exist before this
 * plugin applies.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const session = ctx.get('remote.session') as SessionRemote

  const loadModels = async (): Promise<readonly OmoCatalogModel[]> =>
    catalogOf(await session.modelCatalog())

  const selectModel = async (selection: { provider: string; model: string }, sessionId: SessionIdOf): Promise<boolean> => {
    const response = await session.selectModel({
      sessionId,
      provider: selection.provider,
      model: selection.model,
    })
    return response.ok
  }

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
      inject: (sessionId: SessionIdOf): RoleSelectInjected => ({
        sessionId,
        rolesEndpoint: ROLES_ENDPOINT,
        roleEndpoint: ROLE_ENDPOINT,
        selectModel: selection => selectModel(selection, sessionId),
      }),
    }, RoleSelect))

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
        rolesEndpoint: ROLES_ENDPOINT,
        roleConfigEndpoint: ROLE_CONFIG_ENDPOINT,
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
