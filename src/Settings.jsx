import { useEffect, useState } from 'react'
import { appConfigDir } from '@tauri-apps/api/path'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowCircleUp, Bell, ClockCounterClockwise, Database, EnvelopeSimple, FolderOpen, GearSix, Key, Keyboard, MagnifyingGlass, Monitor, Moon, Palette, SlidersHorizontal, Sun, TerminalWindow, UsersThree } from '@phosphor-icons/react'
import { BACKUP_DEFAULTS, loadBackupSettings } from './backup.js'
import { deleteImages, unusedImages } from './images.js'
import { shells } from './runner.js'
import { useApp } from './ctx.js'
import { vault } from './Vault.jsx'
import { FOLDER as OUTLOOK_FOLDER } from './outlook.js'
import { ConfirmButton } from './Overview.jsx'
import { HOTKEYS, accelFromEvent, hotkeyLabel } from './hotkey.js'
import { DEFAULT_LOOK, setLook, useDark, useLook } from './theme.js'
import { THEMES, palette } from './colors.js'
import * as db from './db.js'

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

// Welche Shells es gibt und ob PowerShell-Blöcke mit 7 statt 5.1 laufen
function RunbookSection() {
  const [list, setList] = useState(null)
  const [pwsh, setPwsh] = useState(false)
  useEffect(() => {
    shells().then(setList)
    db.getSetting('pwsh').then((v) => setPwsh(v === '1')).catch(() => {})
  }, [])
  if (!list) return null
  const names = { powershell: 'PowerShell 5.1', pwsh: 'PowerShell 7', cmd: 'CMD', python: 'Python' }
  return (
    <section className="mb-10">
      <h2 className="mb-1 font-semibold">Runbooks</h2>
      <p className="mb-3 text-muted">
        Codeblöcke in PowerShell, CMD und Python haben einen Ausführen-Knopf. Sie laufen als dein Benutzer, nur auf Klick; „Als Admin“ fragt Windows jedes Mal nach.
        Gefunden auf diesem Rechner: {list.map((s) => names[s]).join(', ')}.
      </p>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={pwsh}
          disabled={!list.includes('pwsh')}
          onChange={(e) => (setPwsh(e.target.checked), db.setSetting('pwsh', e.target.checked ? '1' : '0').catch(() => {}))}
          className="size-4 accent-[var(--accent)]"
        />
        PowerShell-Blöcke mit PowerShell 7 ausführen
        {!list.includes('pwsh') && <span className="text-xs text-faint">nicht installiert</span>}
      </label>
    </section>
  )
}

// Anmeldung am Team-Server (Stufe 5): Microsoft-Anmeldung im Browser, Token bleibt verschlüsselt auf diesem PC
function TeamSection() {
  const [status, setStatus] = useState(null)
  const [server, setServer] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    db.getSetting('team-server').then((s) => s && setServer(s)).catch(() => {})
    invoke('team_status').then((s) => (setStatus(s), s.server && setServer(s.server)), (e) => setError(String(e)))
  }, [])
  async function login() {
    setBusy('Die Microsoft-Anmeldung öffnet sich im Browser …')
    setError('')
    try {
      await db.setSetting('team-server', server.trim())
      setStatus(await invoke('team_login', { server }))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy('')
    }
  }
  async function logout() {
    await invoke('team_logout').catch((e) => setError(String(e)))
    setStatus({ connected: false })
  }
  const user = status?.connected && status.user
  return (
    <section className="mb-10">
      <h2 className="mb-1 font-semibold">Team-Server</h2>
      <p className="mb-3 text-muted">
        Für Team-Notizbücher, die mehrere gemeinsam bearbeiten. Private Notizen bleiben immer nur auf diesem PC.
        Angemeldet wird mit dem Microsoft-Konto der Firma; die Anmeldung bleibt verschlüsselt auf diesem PC gespeichert.
      </p>
      {user ? (
        <div className="flex flex-wrap items-center gap-3">
          <span>
            Angemeldet als <strong>{user.name}</strong>
            {user.email ? ` (${user.email})` : ''} bei {status.server}
          </span>
          <button onClick={logout} className="rounded-md border border-line px-3 py-1.5 hover:bg-hover">Abmelden</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="https://nexora.firma.local"
            aria-label="Adresse des Team-Servers"
            className="w-80 max-w-full rounded-md border border-line bg-raised px-3 py-1.5 outline-none focus:border-accent"
          />
          <button disabled={!server.trim() || !!busy} onClick={login} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg">
            Anmelden
          </button>
        </div>
      )}
      {busy && <p className="mt-2 text-sm text-muted" aria-live="polite">{busy}</p>}
      {(error || status?.error) && <p className="mt-2 text-sm text-danger">{error || `Anmeldung abgelaufen oder Server nicht erreichbar: ${status.error}`}</p>}
    </section>
  )
}

// Über das installierte (klassische) Outlook; Nexora schreibt nur in den eigenen Kalender
function OutlookSection({ state, onChange, onSync }) {
  if (!state) return null
  const box = (key, label) => (
    <label className="mb-1.5 flex items-center gap-3">
      <input type="checkbox" checked={state[key]} onChange={(e) => onChange(key, e.target.checked)} className="size-4 accent-[var(--accent)]" />
      {label}
    </label>
  )
  return (
    <section className="mb-10">
      <h2 className="mb-1 font-semibold">Outlook</h2>
      <p className="mb-3 text-muted">
        Über das installierte Outlook. Offene Punkte mit Fälligkeit kommen in einen eigenen Kalender „{OUTLOOK_FOLDER}“ in deinem Postfach
        (ohne Erinnerung, als „frei“); erledigte verschwinden dort wieder, andere Kalender fasst Nexora nicht an. Outlook-Termine erscheinen in Heute und im Kalender,
        nur angezeigt, nicht gespeichert. Abgleich alle 15 Minuten und kurz nach Änderungen.
      </p>
      {box('push', `Fälligkeiten in den Outlook-Kalender „${OUTLOOK_FOLDER}“`)}
      {box('read', import.meta.env.DEV ? 'Termine anzeigen (Testversion: nur aus „Nexora-Test“)' : 'Outlook-Termine in Nexora anzeigen')}
      <div className="mt-3 flex items-center gap-3">
        <button disabled={state.busy || !(state.push || state.read)} onClick={onSync} className="rounded-md border border-line px-3 py-1.5 hover:bg-hover disabled:opacity-50">
          {state.busy ? 'Gleicht ab …' : 'Jetzt abgleichen'}
        </button>
        {state.error ? <span className="text-sm text-danger">{state.error}</span> : <span className="text-sm text-muted">{state.last}</span>}
      </div>
    </section>
  )
}

const VAULT_MINUTES = [['5', '5 Minuten'], ['15', '15 Minuten'], ['60', '1 Stunde'], ['0', 'Erst beim Beenden']]

// Tresor über die Bitwarden-CLI: Anmelden einmal im Terminal, Nexora entsperrt nur
function VaultSection() {
  const app = useApp()
  const [s, setS] = useState(null)
  const [minutes, setMinutes] = useState('15')
  const load = () => vault.status().then(setS, (e) => setS({ error: String(e) }))
  useEffect(() => {
    load()
    db.getSetting('vault-minutes').then((m) => m && setMinutes(m)).catch(() => {})
  }, [app?.vaultOpen])
  const line = !s
    ? 'Fragt bw …'
    : s.error
      ? `bw meldet einen Fehler: ${s.error}`
      : s.status === 'missing'
        ? 'Die Bitwarden-CLI ist nicht installiert (winget install Bitwarden.CLI).'
        : s.status === 'unauthenticated'
          ? 'bw ist noch nicht angemeldet. Einmal im Terminal:'
          : `${s.email ?? 'Angemeldet'} bei ${s.server ?? 'Bitwarden'}: ${s.status === 'unlocked' ? (s.minutes != null ? `entsperrt, sperrt sich in ${s.minutes} Min.` : 'entsperrt bis zum Beenden') : 'gesperrt'}`
  return (
    <section className="mb-10">
      <h2 className="mb-1 font-semibold">Tresor (Vaultwarden)</h2>
      <p className="mb-3 text-muted">
        Verweise auf Tresor-Einträge mit „/Tresor-Eintrag“, Passwort kopieren per Klick (nach 30 s gelöscht, nicht im Windows-Verlauf),
        in Runbooks <code>{'{{vault:Name}}'}</code> für das Passwort und <code>{'{{vault:Name:benutzer}}'}</code> für den Benutzer; in Ausgabe und Protokoll steht stattdessen ••••••.
        Nexora speichert keine Passwörter.
      </p>
      <p className="mb-2">{line}</p>
      {s?.status === 'unauthenticated' && (
        <pre className="mb-3 rounded-md bg-[var(--code-bg)] px-3 py-2 text-sm">bw config server https://dein-vaultwarden{'\n'}bw login</pre>
      )}
      {s?.status === 'locked' && (
        <button onClick={() => app?.unlockVault().then(load)} className="mb-3 rounded-md border border-line px-3 py-1.5 hover:bg-hover">Entsperren</button>
      )}
      {s?.status === 'unlocked' && (
        <button onClick={() => app?.lockVault().then(load)} className="mb-3 rounded-md border border-line px-3 py-1.5 hover:bg-hover">Jetzt sperren</button>
      )}
      <label className="flex items-center gap-3">
        Automatisch sperren nach
        <select
          value={minutes}
          onChange={(e) => (setMinutes(e.target.value), db.setSetting('vault-minutes', e.target.value).catch(() => {}))}
          className="rounded-md border border-line bg-raised px-2 py-1"
        >
          {VAULT_MINUTES.map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </label>
    </section>
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
      <p className="mb-3 text-muted">Nexora {version} sieht beim Start auf GitHub nach und installiert eine neue Version dann gleich, ohne Rückfrage (immer die neueste). Was unterwegs erscheint (Prüfung alle 6 Stunden), kommt beim nächsten Start oder hier per Knopf.</p>
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

const WINDOW_MODES = [['never', 'Nie'], ['ctrl', 'Mit Strg+Klick'], ['always', 'Immer']]

// Ein Tastenkürzel aufnehmen: klicken, Kombination drücken; belegt ein anderes Programm sie, bleibt die alte
function HotkeyRow({ item, accel, busy, onChange }) {
  const [recording, setRecording] = useState(false)
  const [message, setMessage] = useState('')
  async function onKey(e) {
    e.preventDefault()
    if (e.key === 'Escape') return setRecording(false)
    const next = accelFromEvent(e)
    if (!next) return
    setRecording(false)
    const ok = await onChange(item.id, next)
    setMessage(ok ? `Gespeichert: ${hotkeyLabel(next)}` : `${hotkeyLabel(next)} ist von einem anderen Programm belegt. Bitte eine andere Kombination wählen.`)
  }
  const text = message || (busy ? `${hotkeyLabel(accel)} ist von einem anderen Programm belegt. Bitte eine andere Kombination wählen.` : '')
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-60">{item.label}</span>
        <button
          onClick={() => (setRecording(true), setMessage(''))}
          onKeyDown={recording ? onKey : undefined}
          onBlur={() => setRecording(false)}
          className={`flex min-w-56 items-center gap-2 rounded-md border px-3 py-1.5 text-left ${recording ? 'border-accent bg-accent-soft' : busy ? 'border-danger bg-raised' : 'border-line bg-raised hover:border-faint'}`}
        >
          <Keyboard size={18} className="text-muted" />
          {recording ? 'Jetzt Tasten drücken …' : hotkeyLabel(accel)}
        </button>
      </div>
      {text && <p className={`mt-1 text-sm ${text.startsWith('Gespeichert') ? 'text-accent' : 'text-danger'}`}>{text}</p>}
    </div>
  )
}

// Kategorien links, Suche oben; keys: weitere Suchwörter
const CATEGORIES = [
  { id: 'allgemein', label: 'Allgemein', icon: SlidersHorizontal, keys: 'fenster autostart windows start tray eigenes fenster' },
  { id: 'aussehen', label: 'Aussehen', icon: Palette, keys: 'farbe farbschema schema theme hell dunkel modus darstellung verlauf gradient akzent discord schrift schriftart schriftgröße größe zoom dichte zeilenabstand kompakt breite seitenbreite ecken rund eckig seitenleiste' },
  { id: 'tasten', label: 'Tastenkürzel', icon: Keyboard, keys: 'hotkey kürzel tastatur schnellerfassung zwischenablage snippet picker' },
  { id: 'erinnerungen', label: 'Erinnerungen', icon: Bell, keys: 'meldung sammelmeldung benachrichtigung fällig uhrzeit morgen' },
  { id: 'outlook', label: 'Outlook', icon: EnvelopeSimple, keys: 'kalender termine mail fälligkeiten' },
  { id: 'tresor', label: 'Tresor', icon: Key, keys: 'vaultwarden bitwarden passwort bw cli' },
  { id: 'team', label: 'Team-Server', icon: UsersThree, keys: 'server entra anmelden online geteilt' },
  { id: 'sicherung', label: 'Sicherung', icon: ClockCounterClockwise, keys: 'backup sichern ordner netzlaufwerk' },
  { id: 'runbooks', label: 'Runbooks', icon: TerminalWindow, keys: 'powershell skript ausführen code cmd python admin' },
  { id: 'updates', label: 'Updates', icon: ArrowCircleUp, keys: 'version aktualisieren neue version' },
  { id: 'daten', label: 'Daten', icon: Database, keys: 'ordner export markdown bilder speicherort ungenutzt' },
]
const norm = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export default function Settings({ hotkeys, hotkeyBusy, onHotkey, backup, onBackupNow, updates, windowMode, onWindowMode, outlook, onOutlook, onOutlookSync, tab, onTab }) {
  const [message, setMessage] = useState('')
  const [dir, setDir] = useState('')
  const [digestTime, setDigestTime] = useState('08:00')
  const [autostart, setAutostart] = useState(null)
  const [q, setQ] = useState('')
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

  const words = norm(q).split(/\s+/).filter(Boolean)
  const found = CATEGORIES.filter((c) => words.every((w) => norm(`${c.label} ${c.keys}`).includes(w)))
  const shown = words.length ? found : CATEGORIES.filter((c) => c.id === tab)

  const content = {
    allgemein: (
      <>
        <section className="mb-10">
          <h2 className="mb-1 font-semibold">Fenster</h2>
          <p className="mb-3 text-muted">
            Wann ein Klick auf eine Seite oder einen Punkt ein eigenes Fenster öffnet. Über Rechtsklick und das „…“-Menü geht es immer.
            Offene Fenster kommen beim nächsten Start an derselben Stelle wieder.
          </p>
          <div role="radiogroup" aria-label="Seite in eigenem Fenster öffnen" className="flex flex-wrap gap-2">
            {WINDOW_MODES.map(([id, name]) => (
              <button
                key={id}
                role="radio"
                aria-checked={windowMode === id}
                onClick={() => onWindowMode(id)}
                className={`rounded-md border px-3 py-2 ${windowMode === id ? 'border-accent bg-accent-soft' : 'border-line bg-raised hover:border-faint'}`}
              >
                {name}
              </button>
            ))}
          </div>
        </section>
        <section className="mb-10">
          <h2 className="mb-1 font-semibold">Start</h2>
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
          {message && <p className="mt-2 text-danger">{message}</p>}
        </section>
      </>
    ),
    aussehen: <AppearanceSection />,
    tasten: (
      <section className="mb-10">
        <h2 className="mb-1 font-semibold">Tastenkürzel</h2>
        <p className="mb-3 text-muted">Gelten überall in Windows, solange Nexora läuft (auch im Tray). Klicken, dann die neue Kombination drücken.</p>
        {HOTKEYS.map((h) => (
          <HotkeyRow key={h.id} item={h} accel={hotkeys[h.id]} busy={hotkeyBusy.includes(h.id)} onChange={onHotkey} />
        ))}
        <p className="mt-4 text-sm text-muted">
          In Nexora: Strg+K Suche, Strg+Umschalt+F Fokus-Modus, Strg+Umschalt+L Seitenleiste ein-/ausklappen, / im Text fügt Blöcke ein.
        </p>
      </section>
    ),
    erinnerungen: (
      <section className="mb-10">
        <h2 className="mb-1 font-semibold">Erinnerungen</h2>
        <p className="mb-3 text-muted">
          Jeden Morgen eine Sammelmeldung mit Überfälligem, heute Fälligem und Wiedervorlagen. Punkte mit Uhrzeit melden sich zusätzlich genau dann.
          Das klappt nur, solange Nexora läuft, auch versteckt im Tray.
        </p>
        <label className="flex items-center gap-3">
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
      </section>
    ),
    outlook: <OutlookSection state={outlook} onChange={onOutlook} onSync={onOutlookSync} />,
    tresor: <VaultSection />,
    team: <TeamSection />,
    sicherung: <BackupSection status={backup} onBackupNow={onBackupNow} />,
    runbooks: <RunbookSection />,
    updates: <UpdateSection updates={updates} />,
    daten: (
      <section>
        <h2 className="mb-1 font-semibold">Daten</h2>
        <p className="text-muted">
          Alles liegt in <code className="font-mono text-sm text-text">{dir ? `${dir}\\nexora.db` : '…'}</code>, Bilder daneben im Ordner <code className="font-mono text-sm text-text">bilder</code>.
        </p>
        <ImageCleanup />
        <ExportAll />
      </section>
    ),
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] gap-10 px-6 pb-24 pt-14 md:px-12">
        <nav aria-label="Kategorien" className="sticky top-14 w-52 shrink-0 self-start">
          <h1 className="mb-4 flex items-center gap-2.5 text-[26px] font-semibold leading-tight tracking-tight">
            <GearSix size={24} className="text-accent" /> Einstellungen
          </h1>
          <div className="mb-3 flex items-center gap-2 rounded-md border border-line bg-raised px-2 focus-within:border-accent">
            <MagnifyingGlass size={15} className="shrink-0 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Einstellung suchen" aria-label="Einstellung suchen" className="w-full bg-transparent py-1.5 outline-none placeholder:text-faint" />
          </div>
          <ul>
            {CATEGORIES.map((c) => {
              const active = words.length ? found.includes(c) : tab === c.id
              return (
                <li key={c.id}>
                  <button
                    onClick={() => (setQ(''), onTab(c.id))}
                    aria-current={active && !words.length ? 'page' : undefined}
                    className={`flex h-[var(--row)] w-full items-center gap-2.5 rounded-md px-2 text-left ${active ? 'bg-accent-soft text-text' : words.length ? 'text-faint hover:bg-hover' : 'text-muted hover:bg-hover hover:text-text'}`}
                  >
                    <c.icon size={16} className={active ? 'text-accent' : ''} /> {c.label}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 pt-1">
          {shown.length ? (
            shown.map((c) => (
              <div key={c.id}>
                {words.length > 0 && <div className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">{c.label}</div>}
                {content[c.id]}
              </div>
            ))
          ) : (
            <p className="text-muted">Keine Einstellung zu „{q}“.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Choice({ label, value, options, onChange, styleOf }) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 text-sm text-muted">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map(([id, name, Icon]) => (
          <button
            key={id}
            role="radio"
            aria-checked={value === id}
            onClick={() => onChange(id)}
            style={styleOf?.(id)}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 ${value === id ? 'border-accent bg-accent-soft' : 'border-line bg-raised hover:border-faint'}`}
          >
            {Icon && <Icon size={16} />} {name}
          </button>
        ))}
      </div>
    </div>
  )
}

const FONTS = { geist: '"Geist Variable", sans-serif', segoe: '"Segoe UI Variable Text", "Segoe UI", sans-serif', arial: 'Arial, sans-serif', georgia: 'Georgia, serif' }
const ANGLES = [[90, '→'], [135, '↘'], [180, '↓'], [45, '↗']]

// Kleine Vorschau eines Schemas im gerade aktiven Hell/Dunkel
function Swatch({ theme, active, dark, onClick }) {
  const p = palette({ theme: theme.id }, dark)
  const ground = p.gradient ? `linear-gradient(135deg, ${p.gradient.join(', ')})` : p.bg
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      title={theme.name}
      className={`overflow-hidden rounded-lg border-2 text-left ${active ? 'border-accent' : 'border-transparent hover:border-line'}`}
    >
      <div className="flex h-14 w-28" style={{ background: ground }}>
        <div className="w-8" style={{ background: p.side }} />
        <div className="flex flex-1 flex-col justify-center gap-1.5 px-2">
          <span className="h-1.5 w-12 rounded-full" style={{ background: p.text, opacity: 0.8 }} />
          <span className="h-1.5 w-8 rounded-full" style={{ background: p.muted, opacity: 0.6 }} />
          <span className="h-2.5 w-10 rounded" style={{ background: p.accent }} />
        </div>
      </div>
      <div className="bg-raised px-2 py-1 text-xs">{theme.name}</div>
    </button>
  )
}

function AppearanceSection() {
  const look = useLook()
  const dark = useDark()
  const solid = THEMES.filter((t) => !t.stops)
  const gradients = THEMES.filter((t) => t.stops)
  const current = palette(look, dark)
  const [mine, setMine] = useState(() => look.gradient ?? { colors: ['#ff9f6b', '#e0569a', '#6d5bd6'], angle: 135 })
  const useMine = (g) => (setMine(g), setLook({ theme: 'custom', gradient: g }))
  return (
    <section className="mb-10">
      <h2 className="mb-1 font-semibold">Aussehen</h2>
      <p className="mb-5 text-muted">Gilt für alle Fenster und wird in der Datenbank gespeichert, kommt also mit Sicherungen mit. Gedruckt wird immer im Standard.</p>

      <Choice
        label="Modus"
        value={look.mode}
        onChange={(mode) => setLook({ mode })}
        options={[['system', 'Wie Windows', Monitor], ['light', 'Hell', Sun], ['dark', 'Dunkel', Moon]]}
      />

      <div className="mb-1.5 text-sm text-muted">Farbschema</div>
      <div role="radiogroup" aria-label="Farbschema" className="mb-4 flex flex-wrap gap-2">
        {solid.map((t) => <Swatch key={t.id} theme={t} dark={dark} active={look.theme === t.id} onClick={() => setLook({ theme: t.id })} />)}
      </div>
      <div className="mb-1.5 text-sm text-muted">Mit Verlauf</div>
      <div role="radiogroup" aria-label="Farbschema mit Verlauf" className="mb-5 flex flex-wrap gap-2">
        {gradients.map((t) => <Swatch key={t.id} theme={t} dark={dark} active={look.theme === t.id} onClick={() => setLook({ theme: t.id })} />)}
      </div>

      <div className="mb-5 rounded-lg border border-line bg-raised p-3">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">Eigener Verlauf</span>
          {mine.colors.map((c, i) => (
            <input key={i} type="color" value={c} aria-label={`Farbe ${i + 1}`} onChange={(e) => useMine({ ...mine, colors: mine.colors.map((x, j) => (j === i ? e.target.value : x)) })} className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent" />
          ))}
          <button onClick={() => useMine({ ...mine, colors: mine.colors.length === 3 ? mine.colors.slice(0, 2) : [...mine.colors, '#5bc0be'] })} className="rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-text">
            {mine.colors.length === 3 ? 'Nur zwei Farben' : '+ dritte Farbe'}
          </button>
          <span className="flex gap-0.5" role="radiogroup" aria-label="Richtung">
            {ANGLES.map(([a, arrow]) => (
              <button key={a} role="radio" aria-checked={mine.angle === a} title={`Richtung ${arrow}`} onClick={() => useMine({ ...mine, angle: a })} className={`grid size-7 place-items-center rounded-md ${mine.angle === a ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover'}`}>
                {arrow}
              </button>
            ))}
          </span>
          {look.theme !== 'custom' && <button onClick={() => useMine(mine)} className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white dark:text-bg">Verwenden</button>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">Eigene Akzentfarbe</span>
          <input type="color" value={look.accent ?? current.accent.slice(0, 7)} aria-label="Akzentfarbe" onChange={(e) => setLook({ accent: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-line bg-transparent" />
          <span className="rounded px-2 py-0.5 text-sm font-medium text-white dark:text-bg" style={{ background: current.accent }}>So sieht ein Knopf aus</span>
          {look.accent && <button onClick={() => setLook({ accent: null })} className="rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-text">Vom Schema nehmen</button>}
        </div>
        <p className="mt-2 text-xs text-faint">Nexora passt die Helligkeit eigener Farben an, damit Text darauf lesbar bleibt.</p>
      </div>

      <Choice label="Schriftgröße" value={look.size} onChange={(size) => setLook({ size })} options={[['klein', 'Klein'], ['normal', 'Normal'], ['gross', 'Groß'], ['sehrgross', 'Sehr groß']]} />
      <Choice label="Schriftart" value={look.font} onChange={(font) => setLook({ font })} options={[['geist', 'Geist'], ['segoe', 'Segoe UI'], ['arial', 'Arial'], ['georgia', 'Georgia']]} styleOf={(id) => ({ fontFamily: FONTS[id] })} />
      <Choice label="Dichte" value={look.density} onChange={(density) => setLook({ density })} options={[['kompakt', 'Kompakt'], ['normal', 'Normal'], ['luftig', 'Luftig']]} />
      <Choice label="Seitenbreite" value={look.width} onChange={(width) => setLook({ width })} options={[['schmal', 'Schmal'], ['breit', 'Breit'], ['voll', 'Volle Breite']]} />
      <Choice label="Ecken" value={look.radius} onChange={(radius) => setLook({ radius })} options={[['eckig', 'Eckig'], ['normal', 'Normal'], ['rund', 'Rund']]} />

      <div className="mb-5">
        <div className="mb-1.5 text-sm text-muted">Seitenleiste</div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setLook({ sidebarHidden: !look.sidebarHidden })} className="rounded-md border border-line bg-raised px-3 py-1.5 hover:border-faint">
            {look.sidebarHidden ? 'Seitenleiste zeigen' : 'Seitenleiste einklappen'}
          </button>
          <button onClick={() => setLook({ sidebar: DEFAULT_LOOK.sidebar })} disabled={look.sidebar === DEFAULT_LOOK.sidebar} className="rounded-md border border-line bg-raised px-3 py-1.5 hover:border-faint disabled:opacity-50">
            Breite zurücksetzen
          </button>
          <span className="text-sm text-faint">Breite am rechten Rand ziehen; Strg+Umschalt+L klappt ein und aus.</span>
        </div>
      </div>

      <button onClick={() => (setMine({ colors: ['#ff9f6b', '#e0569a', '#6d5bd6'], angle: 135 }), setLook({ ...DEFAULT_LOOK, mode: look.mode }))} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover hover:text-text">
        Aussehen auf Standard zurücksetzen
      </button>
    </section>
  )
}

// Alles als Markdown-Ordner: lesbar ohne Nexora, z. B. in VS Code oder Obsidian
function ExportAll() {
  const app = useApp()
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button onClick={app.exportAll} className="rounded-md border border-line bg-raised px-3 py-1.5 hover:border-faint">Alles als Markdown exportieren …</button>
      <span className="text-muted">Ordner mit .md-Dateien, Bildern und Anhängen; Links zwischen Seiten bleiben erhalten.</span>
    </div>
  )
}
