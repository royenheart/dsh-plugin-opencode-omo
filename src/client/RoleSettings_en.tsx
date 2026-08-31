/**
 * RoleSettingsSection — the global "Role Settings" page registered as a
 * `settings.section` entry (the dsh settings panel, not per-session chrome).
 *
 * Per role box:
 * - primary model: a single dropdown under a centered "Primary model" label; the
 *   first entry is "Follow session" (follow the session's current model), anything
 *   else pins a fixed model;
 * - fallback models: NO dropdown. A dsh-style circle "+" button (same geometry
 *   and tokens as the composer attach button) opens a model list BELOW that
 *   role's box. Clicking a model appends one fallback and keeps the list open
 *   for repeated additions; closing/cancelling without a valid pick adds
 *   nothing. Existing fallbacks render as removable chips in a separate list
 *   container UNDER the role box (not inside it).
 * Every accepted change persists immediately through the host role-config
 * endpoint. The model catalog comes from the session-independent `llm.models`
 * RPC.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconCloseOutline16, IconPlusOutline16, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  loadOmoRoles, modelKey, parseModelKey, postOmoRoleConfig,
} from './omo-wire.ts'
import type { OmoCatalogModel, OmoRoleView, OmoRoleConfig } from './omo-wire.ts'
import type { OmoModelSelection } from './omo-wire.ts'

/** Injected face delivered by the settings-section outlet. */
export interface RoleSettingsInjected {
  readonly rolesEndpoint: string
  readonly roleConfigEndpoint: string
  /** Session-independent dsh model catalog (llm.models). */
  readonly loadModels: () => Promise<readonly OmoCatalogModel[]>
}

/** Full settings-section props: inject face + the shell's `close` owner share. */
export type RoleSettingsProps = Partial<RoleSettingsInjected> & {
  readonly close?: () => void
}

const FOLLOW_SESSION = '__follow-session__'

const STYLE: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: '#ffffff' },
  hint: { color: '#e6e6e6', fontSize: 12, lineHeight: 1.6 },
  roleWrap: { display: 'flex', flexDirection: 'column' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
    alignItems: 'center',
    gap: 14,
    padding: '10px 12px',
    border: '1px solid #3f3f3f',
    borderRadius: 8,
    background: '#212121',
  },
  rowTitle: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  roleName: { fontWeight: 600, fontSize: 13 },
  roleDesc: { color: '#d5d5d5', fontSize: 11, lineHeight: 1.4 },
  roleHint: { color: '#b3b3b3', fontSize: 10, lineHeight: 1.3 },
  primaryColumn: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  primaryLabel: { color: '#b3b3b3', fontSize: 11, fontWeight: 500, textAlign: 'center' },
  modelPicker: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    maxWidth: 220,
    height: 28,
    padding: '0 20px 0 8px',
    border: 'none',
    borderRadius: 8,
    outline: 'none',
    background: 'transparent',
    color: '#e6e6e6',
    fontSize: 13,
    lineHeight: '20px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  effortSelect: {
    maxWidth: 150,
    height: 22,
    border: '1px solid #3f3f3f',
    borderRadius: 6,
    background: '#212121',
    color: '#e6e6e6',
    fontSize: 11,
    cursor: 'pointer',
  },
  fallbackColumn: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 },
  fallbackRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  // Existing fallbacks live in their OWN container below the role box, not
  // inside the row: the row keeps only the primary-model controls + "+".
  fallbackList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '10px 12px',
    border: '1px solid #3f3f3f',
    borderTop: 'none',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    background: '#212121',
  },
  fallbackListLabel: { color: '#e6e6e6', fontSize: 12, fontWeight: 500 },
  fallbackChips: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  // Same geometry + tokens as the composer attach circle (InputBar .add).
  plusButton: {
    display: 'grid',
    placeItems: 'center',
    flex: 'none',
    width: 28,
    height: 28,
    padding: 0,
    border: 'none',
    borderRadius: 999,
    background: '#2e2e2e',
    color: '#ffffff',
    cursor: 'pointer',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    maxWidth: 220,
    padding: '2px 6px 2px 8px',
    borderRadius: 999,
    background: '#2e2e2e',
    color: '#e6e6e6',
    fontSize: 11,
    lineHeight: '18px',
  },
  chipLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  chipRemove: {
    display: 'inline-flex',
    flex: 'none',
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: '#b3b3b3',
    cursor: 'pointer',
  },
  emptyFallback: { color: '#b3b3b3', fontSize: 11 },
  // The selection list expands below the owning role box.
  addPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '8px 12px 10px',
    border: '1px solid #3f3f3f',
    borderTop: 'none',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    background: '#212121',
  },
  addPanelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  addPanelTitle: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontWeight: 500 },
  addPanelCancel: {
    border: 'none',
    background: 'transparent',
    color: '#b3b3b3',
    fontSize: 12,
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: 6,
  },
  search: {
    boxSizing: 'border-box',
    width: '100%',
    height: 28,
    padding: '0 8px',
    border: '1px solid #3f3f3f',
    borderRadius: 6,
    background: '#212121',
    color: '#ffffff',
    fontSize: 12,
    outline: 'none',
  },
  modelList: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflow: 'auto' },
  modelRow: {
    display: 'block',
    width: '100%',
    padding: '6px 8px',
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: '#ffffff',
    fontSize: 12,
    textAlign: 'left',
    cursor: 'pointer',
  },
  panelError: { color: '#c62828', fontSize: 11 },
  error: { color: '#c62828', fontSize: 12 },
}

function labelFor(models: readonly OmoCatalogModel[], selection: OmoModelSelection | undefined): string {
  if (selection === undefined) return 'Follow session'
  return models.find(model => model.provider === selection.provider && model.model === selection.model)?.label
    ?? `${selection.provider}/${selection.model}`
}

/**
 * The global role configuration page.
 * @param props - injected + settings shell owner props.
 * @returns the settings section content.
 */
export function RoleSettingsSection({
  rolesEndpoint, roleConfigEndpoint, loadModels, close,
}: RoleSettingsProps): ReactElement {
  const [roles, setRoles] = useState<readonly OmoRoleView[]>([])
  const [configs, setConfigs] = useState<Record<string, OmoRoleConfig>>({})
  const [defaults, setDefaults] = useState<Record<string, OmoModelSelection | null>>({})
  const [models, setModels] = useState<readonly OmoCatalogModel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [openFallbackFor, setOpenFallbackFor] = useState<string | null>(null)
  const [fallbackQuery, setFallbackQuery] = useState('')
  const [panelError, setPanelError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  void close

  useEffect(() => {
    if (rolesEndpoint === undefined || loadModels === undefined) return
    let stale = false
    void Promise.all([loadOmoRoles(rolesEndpoint, undefined), loadModels()])
      .then(([data, catalog]) => {
        if (stale) return
        setRoles(data.roles)
        setConfigs(data.configs)
        setDefaults(data.defaults ?? {})
        setModels(catalog)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (stale) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => { stale = true }
  }, [rolesEndpoint, loadModels])

  // A close/cancel without a valid pick must add nothing; outside click or
  // Escape is exactly that cancellation.
  useEffect(() => {
    if (openFallbackFor === null) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      closeFallback()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeFallback()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openFallbackFor])

  const choices = useMemo<MenuEntry[]>(() => models.map(model => ({
    id: modelKey(model),
    label: model.label,
  })), [models])

  const modelLabel = (role: OmoRoleView): string => {
    const selection = configs[role.id]?.model
    if (selection !== undefined) {
      return models.find(model => model.provider === selection.provider && model.model === selection.model)?.label
        ?? `${selection.provider}/${selection.model}`
    }
    const omoDefault = defaults[role.id]
    if (omoDefault !== null && omoDefault !== undefined) return `omo default · ${labelFor(models, omoDefault)}`
    return 'Follow session'
  }

  const save = (role: OmoRoleView, next: OmoRoleConfig): void => {
    if (roleConfigEndpoint === undefined) return
    setSaving(role.id)
    setError(null)
    void postOmoRoleConfig(roleConfigEndpoint, role.id, next)
      .then((data) => {
        if (data.config !== undefined) {
          setConfigs(previous => ({ ...previous, [role.id]: data.config as OmoRoleConfig }))
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => { setSaving(null) })
  }

  const chooseModel = (role: OmoRoleView, id: string): void => {
    setOpenMenu(null)
    const current = configs[role.id] ?? { fallbackModels: [] }
    const selection = id === FOLLOW_SESSION ? undefined : parseModelKey(id)
    if (selection === undefined && id !== FOLLOW_SESSION) return
    const catalog = selection === undefined
      ? undefined
      : models.find(model => model.provider === selection.provider && model.model === selection.model)
    const next: OmoRoleConfig = {
      ...(selection === undefined
        ? {}
        : {
          model: {
            provider: selection.provider,
            model: selection.model,
            ...(catalog?.defaultEffort === undefined ? {} : { reasoningEffort: catalog.defaultEffort }),
          },
        }),
      fallbackModels: current.fallbackModels ?? [],
    }
    save(role, next)
  }

  const chooseEffort = (role: OmoRoleView, effort: string): void => {
    const current = configs[role.id] ?? { fallbackModels: [] }
    const model = current.model
    if (model === undefined) return
    const nextModel: OmoModelSelection = effort === ''
      ? { provider: model.provider, model: model.model }
      : { provider: model.provider, model: model.model, reasoningEffort: effort }
    save(role, { model: nextModel, fallbackModels: current.fallbackModels ?? [] })
  }

  const closeFallback = (): void => {
    setOpenFallbackFor(null)
    setFallbackQuery('')
    setPanelError(null)
  }

  const openFallback = (roleId: string): void => {
    setOpenMenu(null)
    setFallbackQuery('')
    setPanelError(null)
    setOpenFallbackFor(openFallbackFor === roleId ? null : roleId)
  }

  const addFallback = (role: OmoRoleView, model: OmoCatalogModel): void => {
    if (saving === role.id) return
    const current = configs[role.id] ?? { fallbackModels: [] }
    const existing = current.fallbackModels ?? []
    if (existing.some(entry => modelKey(entry) === modelKey(model))) {
      setPanelError('That model is already in the fallback list')
      return
    }
    setPanelError(null)
    save(role, {
      ...(current.model === undefined ? {} : { model: current.model }),
      fallbackModels: [...existing, {
        provider: model.provider,
        model: model.model,
        ...(model.defaultEffort === undefined ? {} : { reasoningEffort: model.defaultEffort }),
      }],
    })
  }

  const removeFallback = (role: OmoRoleView, selection: OmoModelSelection): void => {
    const current = configs[role.id] ?? { fallbackModels: [] }
    const key = modelKey(selection)
    save(role, {
      ...(current.model === undefined ? {} : { model: current.model }),
      fallbackModels: (current.fallbackModels ?? []).filter(entry => modelKey(entry) !== key),
    })
  }

  const filteredModels = useMemo(() => {
    const query = fallbackQuery.trim().toLowerCase()
    if (query === '') return models
    return models.filter(model => model.label.toLowerCase().includes(query) || model.model.toLowerCase().includes(query))
  }, [models, fallbackQuery])

  const fallbackChips = (role: OmoRoleView): ReactNode => {
    const selected = (configs[role.id]?.fallbackModels ?? []) as readonly OmoModelSelection[]
    if (selected.length === 0) return null
    return selected.map(entry => (
      <span key={modelKey(entry)} style={STYLE.chip}>
        <span style={STYLE.chipLabel}>{labelFor(models, entry)}</span>
        <button
          type="button"
          style={STYLE.chipRemove}
          aria-label={`Remove ${labelFor(models, entry)}`}
          disabled={saving === role.id}
          onClick={() => { removeFallback(role, entry) }}
        >
          <IconCloseOutline16 size={12} />
        </button>
      </span>
    ))
  }

  const roleRows: ReactNode[] = roles.map(role => {
    const current = configs[role.id]
    const currentModel = current?.model
    const fallbacks = (current?.fallbackModels ?? []) as readonly OmoModelSelection[]
    const chips = fallbackChips(role)
    const currentCatalog = currentModel === undefined
      ? undefined
      : models.find(model => model.provider === currentModel.provider && model.model === currentModel.model)
    const effortChoices = currentCatalog?.efforts ?? []
    const expanded = openFallbackFor === role.id
    return (
      <div key={role.id} style={STYLE.roleWrap}>
        <div style={STYLE.row}>
          <div style={STYLE.rowTitle}>
            <div style={STYLE.roleName}>{role.displayName}</div>
            <div style={STYLE.roleDesc}>{role.description}</div>
            <div style={STYLE.roleHint}>{`omo default chain: ${role.fallbackHint}`}</div>
          </div>
          <div style={STYLE.primaryColumn}>
            <div style={STYLE.primaryLabel}>Primary model</div>
            <Menu
              open={openMenu === `${role.id}:model`}
              items={[{ id: FOLLOW_SESSION, label: 'Follow session' }, ...choices]}
              selectedId={currentModel === undefined ? FOLLOW_SESSION : modelKey(currentModel)}
              onSelect={id => { chooseModel(role, id) }}
              onClose={() => { setOpenMenu(null) }}
              compact
              anchor={(
                <button
                  type="button"
                  style={STYLE.modelPicker}
                  disabled={saving === role.id}
                  onClick={() => { setOpenMenu(openMenu === `${role.id}:model` ? null : `${role.id}:model`) }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelLabel(role)}</span>
                  <IconChevronDownOutline14 />
                </button>
              )}
            />
            {currentModel !== undefined && effortChoices.length > 0 && (
              <select
                style={STYLE.effortSelect}
                value={currentModel.reasoningEffort ?? ''}
                disabled={saving === role.id}
                onChange={(event) => { chooseEffort(role, event.target.value) }}
              >
                <option value="">Default effort</option>
                {effortChoices.map(effort => (
                  <option key={effort.id} value={effort.id}>{effort.name}</option>
                ))}
              </select>
            )}
          </div>
          <div style={STYLE.fallbackColumn}>
            <div style={STYLE.fallbackRow}>
              <button
                type="button"
                style={STYLE.plusButton}
                aria-label={`Add fallback model for ${role.displayName}`}
                aria-expanded={expanded}
                title="Add fallback model"
                disabled={saving === role.id || models.length === 0}
                onClick={() => { openFallback(role.id) }}
              >
                <IconPlusOutline16 size={14} />
              </button>
              <span style={STYLE.emptyFallback}>{fallbacks.length === 0 ? 'No fallback models' : 'Fallback'}</span>
            </div>
          </div>
        </div>
        {fallbacks.length > 0 && (
          <div style={STYLE.fallbackList}>
            <div style={STYLE.fallbackListLabel}>Fallback models</div>
            <div style={STYLE.fallbackChips}>{chips}</div>
          </div>
        )}
        {expanded && (
          <div style={{
            ...STYLE.addPanel,
            ...(fallbacks.length > 0
              ? { marginTop: 8, borderTop: '1px solid #3f3f3f', borderTopLeftRadius: 8, borderTopRightRadius: 8 }
              : {}),
          }}>
            <div style={STYLE.addPanelHeader}>
              <span style={STYLE.addPanelTitle}>{`Choose a fallback model for ${role.displayName}`}</span>
              <button type="button" style={STYLE.addPanelCancel} onClick={closeFallback}>Cancel</button>
            </div>
            <input
              style={STYLE.search}
              value={fallbackQuery}
              placeholder="Search models…"
              spellCheck={false}
              autoFocus
              onChange={(event) => { setFallbackQuery(event.target.value) }}
            />
            {panelError !== null && <div style={STYLE.panelError}>{panelError}</div>}
            <div style={STYLE.modelList}>
              {filteredModels.map(model => (
                <button
                  key={modelKey(model)}
                  type="button"
                  style={{ ...STYLE.modelRow, ...(saving === role.id ? { opacity: 0.5, cursor: 'default' } : {}) }}
                  disabled={saving === role.id}
                  onClick={() => { addFallback(role, model) }}
                >
                  {model.label}
                </button>
              ))}
              {filteredModels.length === 0 && <span style={STYLE.emptyFallback}>No matching models</span>}
            </div>
          </div>
        )}
      </div>
    )
  })

  return (
    <div ref={rootRef} style={STYLE.root}>
      <div style={STYLE.hint}>
        Configure the primary model and fallback models for each omo role. Choosing "Follow session" for the primary model uses the session's current model selection; click ＋ to pick a fallback below the role box, add several in a row, and clicking cancel or outside closes without adding.
      </div>
      {error !== null && <div style={STYLE.error}>{error}</div>}
      {roleRows}
    </div>
  )
}

export default RoleSettingsSection
