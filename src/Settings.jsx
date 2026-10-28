import { useEffect, useState } from 'react'
import { appConfigDir } from '@tauri-apps/api/path'
import { getVersion } from '@tauri-apps/api/app'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, GearSix, Keyboard, Monitor, Moon, Sun } from '@phosphor-icons/react'
import { BACKUP_DEFAULTS, loadBackupSettings } from './backup.js'
import { deleteImages, unusedImages } from './images.js'
import { ConfirmButton } from './Overview.jsx'
import { View } from './Rows.jsx'
import { accelFromEvent, bindHotkey, hotkeyLabel } from './hotkey.js'
import { applyTheme, getTheme } from './theme.js'
import * as db from './db.js'

const THEMES = [
  { id: 'system', label: 'Wie Windows', icon: Monitor },
  { id: 'light', label: 'Hell', icon: Sun },
  { id: 'dark', label: 'Dunkel', icon: Moon },
]

const INTERVALS = [
  { hours: 1, label: 'jede Stunde' },
  { hours: 4, label: 'alle 4 Stunden' },
  { hours: 24, label: 'täglich' },
  { hours: 168, label: 'wöchentlich' },
]

function BackupSection({ status, onBackupNow }) {
  const [s, setS] = useState(null)
  useEffect(() => {
    loadBackupSettings().then(setS).catch(() => setS({ ...BACKUP_DEFAULTS }))
  }, [status])
  if (!s) return null

  const set = (key, setting, value) => {
    setS((x) => ({ ...x, [key]: value }))
    db.setSetting(setting, String(value)).catch(() => {})
  }
  async function pick() {
    const folder = await open({ directory: true, title: 'Ordner für die Sicherung wählen', defaultPath: s.dir || undefined })
    if (folder) set('dir', 'backupDir', folder)
  }

  return (
    <section className="mb-10">
      <h2 className="mb-1 font-semibold">Sicherung</h2>
      <p className="mb-3 text-muted">
        Legt in regelmäßigen Abständen eine vollständige Kopie der Datenbank im gewählten Ordner ab, Bilder werden einmal mitkopiert. Ein Netzlaufwerk ist als Ziel in Ordnung.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate rounded-md border border-line bg-raised px-3 py-1.5 font-mono text-sm">
          {s.dir || <span className="font-sans text-faint">Noch kein Ordner gewählt, es wird nicht gesichert</span>}
        </span>
        <button onClick={pick} className="flex items-center gap-1.5 rounded-md border border-line bg-raised px-3 py-1.5 hover:border-faint">
          <FolderOpen size={16} /> Ordner wählen
        </button>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <label className="flex items-center gap-2">
          Sichern
          <select value={s.hours} onChange={(e) => set('hours', 'backupHours', Number(e.target.value))} className="rounded-md border border-line bg-raised px-2 py-1">
            {INTERVALS.map((i) => <option key={i.hours} value={i.hours}>{i.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Stände behalten
          <input
            type="number"
            min={1}
            max={365}
            value={s.keep}
            onChange={(e) => Number(e.target.value) >= 1 && set('keep', 'backupKeep', Math.min(365, Math.round(Number(e.target.value))))}
            className="w-20 rounded-md border border-line bg-raised px-2 py-1 text-right tabular-nums"
          />
        </label>
        <button
          disabled={!s.dir || status.busy}
          onClick={onBackupNow}
          className="rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg"
        >
          {status.busy ? 'Sichert …' : 'Jetzt sichern'}
        </button>
      </div>
      <p className={status.error ? 'text-danger' : 'text-muted'} aria-live="polite">
        {status.error
          ? `Letzte Sicherung fehlgeschlagen: ${status.error}`
          : s.last
            ? `Letzte Sicherung: ${new Date(s.last).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}${status.dest ? ` nach ${status.dest}` : ''}`
            : 'Noch keine Sicherung gemacht.'}
      </p>
    </section>
  )
}

// Bilder, auf die keine Seite, kein Papierkorb-Eintrag und keine alte Fassung mehr verweist
function ImageCleanup() {
  const [unused, setUnused] = useState(null)
  const [msg, setMsg] = useState('')
  const find = async () => {
    try {
      setMsg('')
      setUnused(await unusedImages(await db.imageReferences()))
    } catch (e) {
      setMsg(`Suche fehlgeschlagen: ${e}`)
    }
  }
  const remove = async () => {
    try {
      const n = await deleteImages(unused.map((u) => u.name))
      setUnused(null)
      setMsg(`${n} Bilder gelöscht.`)
    } catch (e) {
      setMsg(`Löschen fehlgeschlagen: ${e}`)
    }
  }
  const mb = (unused ?? []).reduce((s, u) => s + u.size, 0) / 1048576
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button onClick={find} className="rounded-md border border-line bg-raised px-3 py-1.5 hover:border-faint">Ungenutzte Bilder suchen</button>
      {unused && (unused.length ? (
        <>
          <span className="text-muted">{unused.length} Bilder ({mb.toFixed(1).replace('.', ',')} MB) werden nirgends mehr verwendet.</span>
          <ConfirmButton onConfirm={remove} />
        </>
      ) : <span className="text-muted">Alle Bilder werden verwendet.</span>)}
      {msg && <span className="text-muted" aria-live="polite">{msg}</span>}
    </div>
  )
}

function UpdateSection({ updates }) {
  const [version, setVersion] = useState('')
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {})
  }, [])
  return (
    <section className="mb-10">
      <h2 className="mb-1 font-semibold">Version und Updates</h2>
      <p className="mb-3 text-muted">Nexora {version} sieht nach dem Start und alle 6 Stunden auf GitHub nach neuen Versionen.</p>
      <div className="flex flex-wrap items-center gap-3">
        {updates.found ? (
          <button onClick={updates.install} disabled={updates.busy} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg">
            {updates.busy ? 'Wird installiert …' : `Version ${updates.found.version} installieren`}
          </button>
        ) : (
          <button onClick={updates.check} disabled={updates.busy} className="rounded-md border border-line bg-raised px-3 py-1.5 hover:border-faint disabled:opacity-50">
            {updates.busy ? 'Sucht …' : 'Nach Updates suchen'}
          </button>
        )}
        <span className={updates.error ? 'text-danger' : 'text-muted'} aria-live="polite">
          {updates.error || (updates.checked && !updates.found ? 'Nexora ist aktuell.' : '')}
        </span>
      </div>
    </section>
  )
}

export default function Settings({ hotkey, hotkeyError, onHotkey, backup, onBackupNow, updates }) {
  const [recording, setRecording] = useState(false)
  const [message, setMessage] = useState('')
  const [theme, setTheme] = useState(getTheme)
  const [dir, setDir] = useState('')
  const [digestTime, setDigestTime] = useState('08:00')
  const [autostart, setAutostart] = useState(null)
  useEffect(() => {
    appConfigDir().then(setDir).catch(() => {})
    db.getSetting('digestTime').then((v) => v && setDigestTime(v)).catch(() => {})
    isEnabled().then(setAutostart).catch(() => setAutostart(false))
  }, [])

  async function toggleAutostart(on) {
    try {
      await (on ? enable() : disable())
      setAutostart(on)
    } catch (e) {
      setMessage(`Autostart nicht geändert: ${e}`)
    }
  }

  async function onKey(e) {
    e.preventDefault()
    if (e.key === 'Escape') return setRecording(false)
    const accel = accelFromEvent(e)
    if (!accel) return
    setRecording(false)
    try {
      await bindHotkey(accel)
      await db.setSetting('hotkey', accel)
      onHotkey(accel, '')
      setMessage(`Gespeichert: ${hotkeyLabel(accel)}`)
    } catch {
      setMessage(`${hotkeyLabel(accel)} ist von einem anderen Programm belegt. Bitte eine andere Kombination wählen.`)
      await bindHotkey(hotkey).catch(() => {})
    }
  }

  return (
    <View title="Einstellungen" icon={GearSix}>
      <section className="mb-10">
        <h2 className="mb-1 font-semibold">Schnellerfassung</h2>
        <p className="mb-3 text-muted">Diese Tasten öffnen von überall das Eingabefeld für den Eingang.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => (setRecording(true), setMessage(''))}
            onKeyDown={recording ? onKey : undefined}
            onBlur={() => setRecording(false)}
            className={`flex min-w-56 items-center gap-2 rounded-md border px-3 py-2 text-left ${recording ? 'border-accent bg-accent-soft' : 'border-line bg-raised hover:border-faint'}`}
          >
            <Keyboard size={18} className="text-muted" />
            {recording ? 'Jetzt Tasten drücken …' : hotkeyLabel(hotkey)}
          </button>
          {!recording && <span className="text-muted">Klicken, dann die neue Kombination drücken</span>}
        </div>
        {(message || hotkeyError) && (
          <p className={`mt-2 ${message.startsWith('Gespeichert') ? 'text-accent' : 'text-danger'}`}>{message || hotkeyError}</p>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-1 font-semibold">Erinnerungen</h2>
        <p className="mb-3 text-muted">
          Jeden Morgen eine Sammelmeldung mit Überfälligem, heute Fälligem und Wiedervorlagen. Punkte mit Uhrzeit melden sich zusätzlich genau dann.
          Das klappt nur, solange Nexora läuft, auch versteckt im Tray.
        </p>
        <label className="mb-3 flex items-center gap-3">
          Sammelmeldung um
          <input
            type="time"
            value={digestTime}
            onChange={(e) => {
              setDigestTime(e.target.value)
              if (e.target.value) db.setSetting('digestTime', e.target.value).catch(() => {})
            }}
            className="rounded-md border border-line bg-raised px-2 py-1 focus:border-accent focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={!!autostart}
            disabled={autostart === null || import.meta.env.DEV}
            onChange={(e) => toggleAutostart(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Mit Windows starten (versteckt im Tray)
          {import.meta.env.DEV && <span className="text-xs text-faint">im Testmodus abgeschaltet</span>}
        </label>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 font-semibold">Darstellung</h2>
        <div role="radiogroup" aria-label="Darstellung" className="flex gap-2">
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={theme === t.id}
              onClick={() => (applyTheme(t.id), setTheme(t.id))}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 ${theme === t.id ? 'border-accent bg-accent-soft' : 'border-line bg-raised hover:border-faint'}`}
            >
              <t.icon size={16} /> {t.label}
            </button>
          ))}
        </div>
      </section>

      <BackupSection status={backup} onBackupNow={onBackupNow} />

      <UpdateSection updates={updates} />

      <section>
        <h2 className="mb-1 font-semibold">Daten</h2>
        <p className="text-muted">
          Alles liegt in <code className="font-mono text-sm text-text">{dir ? `${dir}\\nexora.db` : '…'}</code>, Bilder daneben im Ordner <code className="font-mono text-sm text-text">bilder</code>.
        </p>
        <ImageCleanup />
      </section>
    </View>
  )
}
