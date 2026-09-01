/**
 * Hand-maintained public types for the browser half (tsdown's CJS client
 * bundle does not emit d.ts). Keep in sync with src/client/index.ts exports.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { OmoModelSelection } from '../core/omo-roles'

export declare const name: string
export declare const inject: ['slots', 'remote', 'remote.session']
export declare function apply(ctx: Context): void

export declare const ROLES_ENDPOINT: string
export declare const ROLE_ENDPOINT: string
export declare const ROLE_CONFIG_ENDPOINT: string

export interface RoleSelectInjected {
  readonly sessionId: string
  readonly rolesEndpoint: string
  readonly roleEndpoint: string
  readonly selectModel: (selection: OmoModelSelection) => Promise<boolean>
}

export interface RoleSettingsInjected {
  readonly rolesEndpoint: string
  readonly roleConfigEndpoint: string
  readonly loadModels: () => Promise<readonly {
    provider: string
    model: string
    label: string
  }[]>
}

export { RoleSelect, default as RoleSelectDefault } from './RoleSelect.tsx'
export { RoleSettingsSection, default as RoleSettingsSectionDefault } from './RoleSettings.tsx'
