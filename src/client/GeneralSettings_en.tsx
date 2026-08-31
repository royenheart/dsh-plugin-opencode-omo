/**
 * GeneralSettings — the "General" tab of the opencode-omo settings section.
 *
 * Controls for the omo.json defaults file: a Use omo.json ON/OFF toggle
 * (persisted; ON also imports immediately and at host startup), the file
 * location (default ~/.omo/omo.json), and a Re-Import button that applies
 * the file into the running host registry.
 *
 * Dark-theme contract: dark-gray surfaces (#212121/#2e2e2e/#3f3f3f) and
 * white/light wording (#ffffff/#e6e6e6/#b3b3b3) — no light-theme literals.
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

export interface GeneralSettingsInjected {
  /** GET/POST settings endpoint (enabled/path). */
  readonly omoJsonEndpoint: string
  /** POST import endpoint. */
  readonly omoJsonImportEndpoint: string
}

interface OmoJsonState {
  enabled: boolean
  path: string
}

interface ImportResult {
  ok: boolean
  imported: number
  errors: string[]
}

const STYLE: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13, color: '#ffffff' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { color: '#ffffff', fontSize: 13, fontWeight: 500 },
  hint: { color: '#b3b3b3', fontSize: 11, lineHeight: 1.5 },
  toggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 14px',
    border: '1px solid #3f3f3f',
    borderRadius: 999,
    background: '#2e2e2e',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  toggleOn: { borderColor: '#ffffff', background: '#3f3f3f' },
  input: {
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
  importButton: {
    alignSelf: 'flex-start',
    padding: '6px 14px',
    border: '1px solid #3f3f3f',
    borderRadius: 8,
    background: '#2e2e2e',
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  status: { display: 'flex', flexDirection: 'column', gap: 4 },
  success: { color: '#a5d6a7', fontSize: 12 },
  error: { color: '#ff6e6e', fontSize: 12, lineHeight: 1.5 },
}

/** Read the persisted omo.json settings. */
async function loadConfig(endpoint: string): Promise<OmoJsonState | undefined> {
  const response = await fetch(endpoint, { headers: { accept: 'application/json' } })
  const data = await response.json() as { ok?: boolean; enabled?: boolean; path?: string }
  if (!data.ok) return undefined
  return { enabled: Boolean(data.enabled), path: String(data.path ?? '') }
}

/** Persist enabled/path; turning ON triggers an immediate import (host-side). */
async function saveConfig(endpoint: string, next: OmoJsonState): Promise<void> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(next),
  })
  const data = await response.json() as { ok?: boolean; error?: string }
  if (!data.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
}

/** Apply the configured file through the host import endpoint. */
async function runImport(endpoint: string, path: string): Promise<ImportResult> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  const data = await response.json() as ImportResult & { error?: string }
  // A transport/HTTP failure throws; an ok:false payload is a RESULT — the
  // endpoint reports per-role problems inside `errors`, never as a throw.
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
  return data
}

/** The General tab body. */
export function GeneralSettingsSection({ omoJsonEndpoint, omoJsonImportEndpoint }: GeneralSettingsInjected): ReactElement {
  const [config, setConfig] = useState<OmoJsonState | undefined>(undefined)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    void loadConfig(omoJsonEndpoint).then((loaded) => {
      if (loaded !== undefined) {
        setConfig(loaded)
        setPath(loaded.path)
      }
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [omoJsonEndpoint])

  const toggle = (): void => {
    if (config === undefined || busy) return
    const next = { enabled: !config.enabled, path }
    setBusy(true)
    setError(undefined)
    void saveConfig(omoJsonEndpoint, next).then(async () => {
      setConfig(next)
      if (next.enabled) {
        const imported = await runImport(omoJsonImportEndpoint, path)
        setResult(imported)
      }
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { setBusy(false) })
  }

  const commitPath = (): void => {
    if (config === undefined || busy) return
    const next = { enabled: config.enabled, path: path.trim() }
    setBusy(true)
    setError(undefined)
    void saveConfig(omoJsonEndpoint, next).then(() => { setConfig(next) })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setBusy(false) })
  }

  const importNow = (): void => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    setResult(undefined)
    void runImport(omoJsonImportEndpoint, path.trim()).then(setResult)
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setBusy(false) })
  }

  return (
    <div style={STYLE.root}>
      <div style={STYLE.row}>
        <div>
          <div style={STYLE.label}>Use omo.json</div>
          <div style={STYLE.hint}>
            When ON, the file below is imported at host startup and when the toggle is switched on.
          </div>
        </div>
        <button
          type="button"
          style={{ ...STYLE.toggle, ...(config?.enabled === true ? STYLE.toggleOn : {}) }}
          aria-pressed={config?.enabled === true}
          disabled={busy || config === undefined}
          onClick={toggle}
        >
          {config?.enabled === true ? 'ON' : 'OFF'}
        </button>
      </div>

      <div>
        <div style={STYLE.label}>omo.json location</div>
        <input
          style={STYLE.input}
          value={path}
          placeholder="~/.omo/omo.json"
          aria-label="omo.json file location"
          disabled={busy || config === undefined}
          onChange={(event) => { setPath(event.target.value) }}
          onBlur={commitPath}
          onKeyDown={(event) => { if (event.key === 'Enter') commitPath() }}
        />
        <div style={STYLE.hint}>Default: ~/.omo/omo.json. Press Enter or blur to save.</div>
      </div>

      <button
        type="button"
        style={STYLE.importButton}
        disabled={busy || config === undefined}
        onClick={importNow}
      >
        Re-Import omo.json
      </button>

      {(result !== undefined || error !== undefined) && (
        <div style={STYLE.status}>
          {result !== undefined && !result.ok && (
            <div style={STYLE.error}>Import failed</div>
          )}
          {result !== undefined && result.ok && (
            <div style={STYLE.success}>
              Imported {result.imported} role{result.imported === 1 ? '' : 's'}
              {result.errors.length > 0 ? ` (${result.errors.length} warning${result.errors.length === 1 ? '' : 's'})` : ''}
            </div>
          )}
          {result !== undefined && result.errors.some((item) => item.includes('ENOENT')) && (
            <div style={STYLE.hint}>File not found — create the file or change the location above.</div>
          )}
          {result !== undefined && result.errors.map((item) => (
            <div key={item} style={STYLE.error}>{item}</div>
          ))}
          {error !== undefined && <div style={STYLE.error}>{error}</div>}
        </div>
      )}
    </div>
  )
}

export default GeneralSettingsSection
