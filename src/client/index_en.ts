/**
 * dsh-plugin-opencode-omo — browser half.
 *
 * Registers two opencode-omo surfaces:
 * - `conversation.input.left`: the omo agent-type picker in the composer's
 *   existing left tool-row slot (opencode-omo sessions only; no dsh-side
 *   composer seat required);
 * - `settings.section`: the global "Role Settings" page in the dsh settings panel,
 *   where each omo role's primary model and fallback models are configured.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves the slots service merge + standard slot kit.
import type {} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the composer SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the settings.section SlotMap declaration.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import { RoleSelect } from './RoleSelect_en.tsx'
import type { RoleSelectInjected } from './RoleSelect_en.tsx'
import { OmoSettingsSection } from './OmoSettingsSection_en.tsx'
import type { OmoSettingsSectionProps } from './OmoSettingsSection_en.tsx'
import { RoleSettingsSection } from './RoleSettings_en.tsx'
import type { RoleSettingsInjected } from './RoleSettings_en.tsx'
import { GeneralSettingsSection } from './GeneralSettings_en.tsx'
import type { GeneralSettingsInjected } from './GeneralSettings_en.tsx'
import type { OmoCatalogModel } from './omo-wire.ts'
import type {} from './slots.ts'
export { RoleSelect } from './RoleSelect_en.tsx'
export type { RoleSelectInjected, RoleSelectProps } from './RoleSelect_en.tsx'
export { OmoSettingsSection } from './OmoSettingsSection_en.tsx'
export type { OmoSettingsSectionProps } from './OmoSettingsSection_en.tsx'
export { RoleSettingsSection } from './RoleSettings_en.tsx'
export type { RoleSettingsInjected, RoleSettingsProps } from './RoleSettings_en.tsx'
export { GeneralSettingsSection } from './GeneralSettings_en.tsx'
export type { GeneralSettingsInjected } from './GeneralSettings_en.tsx'

/** Cordis plugin name. */
export const name = 'opencode-omo-client'

/** Required services: slot registry + the model wire. */
export const inject = ['slots', 'connection']

export const ROLES_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/roles'
export const ROLE_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/role'
export const ROLE_CONFIG_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/role-config'
export const OMO_JSON_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/omo-json'
export const OMO_JSON_IMPORT_ENDPOINT = '/plugins/@royenheart/dsh-plugin-opencode-omo/omo-json/import'

/** Minimal shape of the rc.2 `llm.models` catalog payload. The published
 * `@deepseek-ai/dsh-client-connection` ships no `.d.ts`, so these callbacks
 * are annotated explicitly instead of flowing through `any`. */
interface LlmEffortEntry { id: string; name: string }
interface LlmModelEntry {
  id: string
  name: string
  reasoning?: { efforts?: LlmEffortEntry[]; defaultEffort?: string }
}
interface LlmModelGroup { id: string; models: LlmModelEntry[] }

/** Flatten one model catalog response into the picker vocabulary. */
function catalogOf(
  response: Awaited<ReturnType<ConnectionHandle['api']['llm']['models']>>,
): readonly OmoCatalogModel[] {
  if (!response.result.ok) {
    throw new Error(`${response.result.error.code}: ${response.result.error.message}`)
  }
  return response.result.value.groups.flatMap((group: LlmModelGroup) =>
    group.models.map((model: LlmModelEntry) => ({
      provider: group.id,
      model: model.id,
      label: model.name,
      ...(model.reasoning?.efforts?.length
        ? { efforts: model.reasoning.efforts.map((effort: LlmEffortEntry) => ({ id: effort.id, name: effort.name })) }
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
  const connection = ctx.get('connection') as ConnectionHandle

  const loadModels = async (): Promise<readonly OmoCatalogModel[]> =>
    catalogOf(await connection.api.llm.models({}))

  const selectModel = async (selection: { provider: string; model: string }, sessionId: SessionId): Promise<boolean> => {
    const response = await connection.api.sessions.selectModel({
      sessionId,
      provider: selection.provider,
      model: selection.model,
    })
    return response.result.ok
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
      inject: (sessionId: SessionId): RoleSelectInjected => ({
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

    const disposeGeneralTab = ctx.slots.inject('opencode-omo.settings.tab', () => ctx.slots.register({
      name: 'opencode-omo.settings.tab',
      id: 'general',
      order: 0,
      label: () => 'General',
      inject: (): GeneralSettingsInjected => ({
        omoJsonEndpoint: OMO_JSON_ENDPOINT,
        omoJsonImportEndpoint: OMO_JSON_IMPORT_ENDPOINT,
      }),
    }, GeneralSettingsSection))

    const disposeSettingsTab = ctx.slots.inject('opencode-omo.settings.tab', () => ctx.slots.register({
      name: 'opencode-omo.settings.tab',
      id: 'roles',
      order: 1,
      label: () => 'Role Settings',
      inject: (): RoleSettingsInjected => ({
        rolesEndpoint: ROLES_ENDPOINT,
        roleConfigEndpoint: ROLE_CONFIG_ENDPOINT,
        loadModels,
      }),
    }, RoleSettingsSection))

    return () => {
      disposeRole()
      disposeSettingsTab()
      disposeGeneralTab()
      disposeSettings()
    }
  }, 'opencode-omo-client: role slots')
}
