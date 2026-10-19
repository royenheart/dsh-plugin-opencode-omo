/**
 * Hand-maintained public types for the browser half (tsdown's CJS client
 * bundle does not emit d.ts). Keep in sync with src/client/index.ts exports.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { OmoModelSelection } from '../core/omo-roles'
import type { OmoConfigForm } from './omo-roles-store'

export declare const name: string
export declare const inject: ['slots', 'configForms', 'remote', 'remote.session']
export declare function apply(ctx: Context): void

export interface RoleSelectInjected {
  readonly sessionId: SessionId
  readonly form: OmoConfigForm
  readonly selectModel: (selection: OmoModelSelection) => Promise<boolean>
}

export interface RoleSettingsInjected {
  readonly form: OmoConfigForm
  readonly loadModels: () => Promise<readonly {
    provider: string
    model: string
    label: string
  }[]>
}

export { RoleSelect, default as RoleSelectDefault } from './RoleSelect.tsx'
export { RoleSettingsSection, default as RoleSettingsSectionDefault } from './RoleSettings.tsx'
