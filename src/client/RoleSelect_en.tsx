/**
 * RoleSelect — the omo agent-type picker occupying dsh's existing
 * `conversation.input.left` composer slot (left tool row, after the
 * access/plan chips). Choosing a role persists it for the session via the
 * host and, when that role pins a primary model, submits the same
 * provider/model through the session model RPC so the next step routes there.
 *
 * The trigger styles are copied from ui-conversation's PermissionSelect so the
 * chip looks like the other composer mode chips (same height, padding, radius,
 * label/caption tokens, chevron, and narrow-composer collapse). The stylesheet
 * is injected once from JS — the plugin's CJS client bundle does not ship CSS
 * assets.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconAgentPresetOutline16, IconChevronDownOutline14, IconWarningOutline16, Menu, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { OmoModelSelection } from './omo-wire.ts'
import { loadOmoRoles, postOmoRole } from './omo-wire.ts'
import type { OmoRoleView } from './omo-wire.ts'

/** Injected face delivered by the composer-bar outlet. */
export interface RoleSelectInjected {
  readonly sessionId: SessionId
  readonly rolesEndpoint: string
  readonly roleEndpoint: string
  readonly selectModel: (selection: OmoModelSelection) => Promise<boolean>
}

/** Full component props: inject face + the list-slot owner share + standard kit. */
export type RoleSelectProps = Partial<RoleSelectInjected> & {
  readonly locked?: boolean
  readonly session?: unknown
  readonly input?: unknown
  readonly useSessions?: SnapshotSelectorHook<SessionListState>
}

const OMO_PRESET = 'opencode-omo'
const STYLE_ID = 'opencode-omo-role-select-styles'

/** PermissionSelect-aligned trigger CSS (mirrors PermissionSelect.module.css). */
const TRIGGER_CSS = `
.omo-role-select-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 220px;
  height: 28px;
  padding: 0 4px 0 8px;
  border: none;
  border-radius: 24px;
  outline: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  cursor: pointer;
}
.omo-role-select-trigger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}
.omo-role-select-trigger:focus-visible {
  box-shadow: 0 0 0 2px var(--dsw-alias-border-l3);
}
.omo-role-select-trigger:disabled {
  color: var(--dsw-alias-label-dimmed);
  cursor: default;
}
.omo-role-select-trigger-icon {
  display: inline-flex;
  flex: 0 0 auto;
}
.omo-role-select-trigger-icon svg {
  width: 14px;
  height: 14px;
}
.omo-role-select-trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.omo-role-select-chevron {
  display: inline-flex;
  flex: 0 0 auto;
  color: var(--dsw-alias-label-caption);
  transition: transform 120ms ease;
}
.omo-role-select-chevron-open {
  transform: rotate(180deg);
}
@container (max-width: 460px) {
  .omo-role-select-trigger:has(.omo-role-select-trigger-icon) .omo-role-select-trigger-label {
    display: none;
  }
}
`

function installTriggerStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = TRIGGER_CSS
  document.head.appendChild(style)
}

/**
 * Render the role chip (or nothing outside opencode-omo sessions).
 * @param props - injected + owner + standard slot props.
 * @returns the picker element.
 */
export function RoleSelect({
  sessionId, useSessions, locked = false, rolesEndpoint, roleEndpoint, selectModel,
}: RoleSelectProps): ReactElement | null {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roles, setRoles] = useState<readonly OmoRoleView[]>([])
  const [currentRole, setCurrentRole] = useState<string>('sisyphus')
  // Transient dsh-compat warning; keyed seq restarts the same text on re-show.
  const [notice, setNotice] = useState<{ seq: number; text: string } | null>(null)
  const noticeSeq = useRef(0)

  const summary = useSessions?.(state => (sessionId === undefined ? undefined : state.byId[sessionId]))
  const eligible = summary?.agentPreset === OMO_PRESET

  useEffect(() => { installTriggerStyles() }, [])

  useEffect(() => {
    if (!eligible || sessionId === undefined || rolesEndpoint === undefined) return
    let stale = false
    loadOmoRoles(rolesEndpoint, sessionId)
      .then((data) => {
        if (stale) return
        // omo's composer type selector exposes primary/all agents; specialist
        // subagents stay delegation-only (the global settings page edits all).
        setRoles(data.roles.filter(role => role.mode !== 'subagent'))
        setCurrentRole(data.currentRole ?? data.defaultRole)
        setError(null)
        const warnings = data.compat?.warnings ?? []
        if (warnings.length > 0) {
          const key = `opencode-omo:compat:${warnings.join('|')}`
          let seen: string | null = null
          try { seen = sessionStorage.getItem(key) } catch { /* storage unavailable */ }
          if (seen === null) {
            try { sessionStorage.setItem(key, 'shown') } catch { /* storage unavailable */ }
            noticeSeq.current += 1
            setNotice({ seq: noticeSeq.current, text: warnings.join(' ') })
          }
        }
      })
      .catch((cause: unknown) => {
        if (stale) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => { stale = true }
  }, [eligible, rolesEndpoint, sessionId])

  useEffect(() => {
    if (!locked && open) return
    setOpen(false)
  }, [locked, open])

  if (!eligible || sessionId === undefined || rolesEndpoint === undefined || roleEndpoint === undefined) return null

  const current = roles.find(role => role.id === currentRole)
  const label = current?.displayName ?? currentRole

  const choose = (id: string): void => {
    setOpen(false)
    if (id === currentRole || busy) return
    setBusy(true)
    setError(null)
    void postOmoRole(roleEndpoint, sessionId, id)
      .then((data) => {
        setCurrentRole(data.currentRole ?? id)
        const model = data.config?.model
        if (model !== undefined && selectModel !== undefined) {
          return selectModel(model).then((accepted) => {
            if (!accepted) setError(`Role switched, but model ${model.provider}/${model.model} is unavailable`)
          })
        }
        return undefined
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { setBusy(false) })
  }

  const items: MenuEntry[] = roles.map(role => ({ id: role.id, label: role.displayName }))

  return (
    <>
      {notice !== null && (
        <Toast
          key={notice.seq}
          text={notice.text}
          icon={<IconWarningOutline16 />}
          onDone={() => { setNotice(null) }}
        />
      )}
      <Menu
        open={open && !locked}
        items={items}
        selectedId={currentRole}
        onSelect={choose}
        onClose={() => { setOpen(false) }}
        side="top"
        anchor={(
          <button
            type="button"
            className="omo-role-select-trigger"
            aria-label={`Role: ${label}`}
            title={error ?? current?.description ?? label}
            disabled={locked || busy || roles.length === 0}
            onClick={() => { setOpen(!open) }}
          >
            <span className="omo-role-select-trigger-icon" aria-hidden>
              <IconAgentPresetOutline16 />
            </span>
            <span className="omo-role-select-trigger-label">{label}</span>
            <span className={`omo-role-select-chevron${open ? ' omo-role-select-chevron-open' : ''}`} aria-hidden>
              <IconChevronDownOutline14 />
            </span>
          </button>
        )}
      />
    </>
  )
}

export default RoleSelect
