import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { openUrl } from '@tauri-apps/plugin-opener'
import { enable as enableAutostart } from '@tauri-apps/plugin-autostart'
import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { AppWindow, X } from '@phosphor-icons/react'
import { closeWindow, label, openWindow as openPageWindow, restoreWindows, windowKey, windowPage } from './windows.js'
import * as db from './db.js'
import { CANVAS } from './free.js'
import Sidebar, { Rail } from './Sidebar.jsx'
import Page from './Page.jsx'
import DatabaseView from './Database.jsx'
import { Overview, TrashView } from './Overview.jsx'
import { Inbox, Today } from './Rows.jsx'
import Snippets from './Snippets.jsx'
import Settings from './Settings.jsx'
import Search from './Search.jsx'
import { HOTKEYS, bindHotkeys, hotkeyLabel } from './hotkey.js'
import { maskSecrets, secretSpans } from './secrets.js'
import SecretDialog from './SecretDialog.jsx'
import { isPermissionGranted, sendNotification } from '@tauri-apps/plugin-notification'
import { checkReminders } from './notify.js'
import { bmpToPng, initImages, saveImageBytes } from './images.js'
import { describeReport, hash, link as oneNoteLink, syncNotebook } from './onenote.js'
import { desiredEvents, followUpMail, pushDue, readEvents } from './outlook.js'
import Journal from './Journal.jsx'
import Stats from './Stats.jsx'
import Print, { PrintAsk } from './Print.jsx'
import OneNoteConnect from './OneNote.jsx'
import { VaultPicker, VaultUnlock, setVaultPicker, vault } from './Vault.jsx'
import { htmlToMarkdown } from './Editor.jsx'
import { indexText } from './ocr.js'
import { loadBackupSettings, maybeBackup, runBackup } from './backup.js'
import { findUpdate, installUpdate } from './updates.js'
import Tabs, { VIEWS } from './Tabs.jsx'
import * as T from './tabs.js'
import TitleBar from './TitleBar.jsx'
import News from './News.jsx'
import { getVersion } from '@tauri-apps/api/app'
import { homeDir } from '@tauri-apps/api/path'
import { peopleList, personsOf } from './people.js'
import { getLook, loadLook, motionOn, setLook, useLook } from './theme.js'
import { dayOf, daysBetween, describe, emptyConfig, fieldsOf, formatDate, isDone, lopConfig, nextDate, shiftDate, statusField, today, toggleDone } from './fields.js'
import CalendarView from './Calendar.jsx'
import { CalendarBlank } from '@phosphor-icons/react'
import { parseQuick } from './quick.js'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { buildExport, decodeText, importedPage, packNotebook, safeName, unpackNotebook } from './io.js'
import { setLinkData } from './Links.jsx'
import { AppContext } from './ctx.js'

const DEFAULT_TITLE = { notebook: 'Neues Notizbuch', section: 'Neuer Abschnitt', page: '', database: 'Neue Liste', row: '' }
// Wohin etwas im Baum darf (null = oberste Ebene)
// Abschnitte dürfen in Abschnitten liegen (wie Abschnittsgruppen in OneNote)
// Seiten und Listen dürfen auch direkt im Notizbuch liegen (ohne Abschnitt)
const PARENTS = { notebook: [null], section: ['notebook', 'section'], page: ['notebook', 'section', 'page'], database: ['notebook', 'section', 'page'] }
const SEED_SECTION = '7d1f3c2a-0b6e-4c55-9a1e-3f0d2b8c4e02'

function loadExpanded() {
  try {
    return new Set(JSON.parse(localStorage.getItem('expanded') || '[]'))
  } catch {
    return new Set()
  }
}

// Baum aus nicht gelöschten Knoten; Kinder eines gelöschten Knotens verschwinden mit.
// Punkte (rows) stehen nicht im Baum, sondern in ihrer Liste bzw. im Eingang (parent null).
function buildTree(nodes) {
  const byParent = new Map()
  for (const n of nodes) {
    if (n.deleted_at) continue
    const key = n.parent_id ?? null
    byParent.set(key, [...(byParent.get(key) ?? []), n])
  }
  for (const list of byParent.values()) list.sort((a, b) => a.sort - b.sort)
  const alive = new Map()
  // Bereich (Arbeit/Privat) steht am obersten Knoten, alles darunter erbt ihn
  const areas = new Map()
  const walk = (parent, area) =>
    (byParent.get(parent) ?? []).forEach((n) => {
      alive.set(n.id, n)
      areas.set(n.id, area ?? (n.area || 'arbeit'))
      walk(n.id, areas.get(n.id))
    })
  walk(null)
  const kids = (id) => (byParent.get(id) ?? []).filter((n) => n.kind !== 'row')
  return { alive, roots: kids(null), children: kids, rows: (id) => (byParent.get(id) ?? []).filter((n) => n.kind === 'row'), areaOf: (id) => areas.get(id) }
}

export default function App() {
  const [nodes, setNodes] = useState(null)
  // Reiter wie im Browser (tabs.js); die offene Seite ist die des aktiven Reiters
  const [tabState, setTabState] = useState({ tabs: [], active: null })
  const tabsRef = useRef(tabState)
  const tabKeys = useRef(null)
  // Strg+Z außerhalb des Textes (siehe remember): Schritte zum Rückgängigmachen und Wiederholen
  const history = useRef({ done: [], undone: [] })
  const tick = useRef({ n: 0, armed: false })
  const undoKeys = useRef(null)
  const current = windowPage ?? T.activeTab(tabState)?.view ?? null
  // Reiter ändern; wechselt dabei die sichtbare Seite, blendet sie weich über (View Transition, nur der Inhalt, index.css).
  // tabsRef gleich setzen, damit mehrere Änderungen hintereinander aufeinander aufbauen
  const changeTabs = useCallback((fn) => {
    const before = tabsRef.current
    const next = fn(before)
    if (next === before) return
    tabsRef.current = next
    const go = () => setTabState(tabsRef.current)
    if (T.activeTab(next)?.view === T.activeTab(before)?.view || !document.startViewTransition || !motionOn()) return go()
    document.startViewTransition(() => flushSync(go))
  }, [])
  // Navigieren im aktiven Reiter (wie ein Link im Browser)
  const setCurrent = useCallback((id) => changeTabs((s) => T.navigate(s, id)), [changeTabs])
  const [fresh, setFresh] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [expanded, setExpanded] = useState(loadExpanded)
  const [error, setError] = useState('')
  const [focusMode, setFocusMode] = useState(false)
  const [printing, setPrinting] = useState(null) // { ask: Seite, count } oder { pages }
  const look = useLook()
  const [settingsTab, setSettingsTab] = useState('allgemein')
  const [area, setArea] = useState('arbeit') // aktiver Bereich: 'arbeit' | 'privat'
  const [peopleSaved, setPeopleSaved] = useState([]) // Personenliste mit Farben (Einstellung "personen")
  const [profile, setProfile] = useState({ name: '', color: 'petrol' }) // Benutzer-Anzeige unten links (Einstellung "profil")
  const [news, setNews] = useState(null) // Version, deren Neuigkeiten gerade offen sind
  const [appVersion, setAppVersion] = useState('')
  const areaValue = area === 'privat' ? 'privat' : null // so steht er am obersten Knoten
  const [notice, setNotice] = useState('')
  const [oneNote, setOneNote] = useState(null) // offen: { busy: Fortschrittstext }
  const syncing = useRef(false)
  const [vaultAsk, setVaultAsk] = useState(null) // Entsperren offen: { status, resolve }
  const [vaultPick, setVaultPick] = useState(null) // Auswahl offen: { resolve }
  const [vaultOpen, setVaultOpen] = useState(false)
  // Outlook: was eingeschaltet ist, letzter Abgleich; Termine nur im Speicher
  const [outlook, setOutlook] = useState({ push: false, read: false, busy: false, last: '', error: '' })
  const [events, setEvents] = useState([])
  const outlookOpts = useRef(outlook)
  outlookOpts.current = outlook
  const outlookRunning = useRef(false)

  // Entsperrt? Sonst nach dem Master-Passwort fragen. false bei Abbruch oder wenn bw fehlt bzw. nicht angemeldet ist
  async function unlockVault() {
    let status
    try {
      status = await vault.status()
    } catch (e) {
      setError(`Tresor: ${e}`)
      return false
    }
    if (status.status === 'unlocked') return setVaultOpen(true), true
    if (status.status === 'missing') return setError('Die Bitwarden-CLI (bw) ist nicht installiert, siehe Einstellungen → Tresor.'), false
    if (status.status === 'unauthenticated') return setError('bw ist noch nicht angemeldet, siehe Einstellungen → Tresor.'), false
    return new Promise((resolve) => setVaultAsk({ status, resolve }))
  }
  async function vaultCopy(id, what) {
    if (!(await unlockVault())) return
    try {
      await vault.copy(id, what)
      setNotice(what === 'passwort' ? 'Passwort kopiert. Die Zwischenablage wird in 30 Sekunden geleert.' : 'Benutzername kopiert.')
    } catch (e) {
      setError(`Tresor: ${e}`)
    }
  }
  const lockVault = () => vault.lock().catch(() => {}).then(() => setVaultOpen(false))
  setVaultPicker(async () => ((await unlockVault()) ? new Promise((resolve) => setVaultPick({ resolve })) : null))

  // Anzeige "Tresor offen" folgt dem Stand in vault.rs (sperrt sich dort nach Ablauf selbst)
  useEffect(() => {
    if (!vaultOpen) return
    const t = setInterval(() => vault.status().then((s) => s.status !== 'unlocked' && setVaultOpen(false), () => {}), 30_000)
    return () => clearInterval(t)
  }, [vaultOpen])
  // Hinweise verschwinden nach ein paar Sekunden von selbst
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(t)
  }, [notice])
  const [hotkeys, setHotkeys] = useState(() => Object.fromEntries(HOTKEYS.map((h) => [h.id, h.fallback])))
  const [hotkeyBusy, setHotkeyBusy] = useState([])
  const hotkeyError = hotkeyBusy.length ? `${hotkeyLabel(hotkeys[hotkeyBusy[0]])} ist belegt. Andere Tasten wählen` : ''
  const hotkeyRun = useRef(null)
  const [secretAsk, setSecretAsk] = useState(null) // Passwort-Warnung bei "Zwischenablage in den Eingang"
  const [searching, setSearching] = useState(false)
  const [backup, setBackup] = useState({ busy: false, error: '', dest: '' })
  const [update, setUpdate] = useState({ found: null, busy: false, error: '' })
  const live = useRef(null)
  // Seiten, die gerade in eigenen Fenstern offen sind (nur im Hauptfenster gepflegt)
  const [windows, setWindows] = useState(() => new Set())
  const [windowMode, setWindowMode] = useState('ctrl')
  const [pinned, setPinned] = useState(false)
  const pinnedRef = useRef(false)
  const storeWindow = useRef(() => {})
  const flushRef = useRef(null)
  const modifier = useRef(false)
  const openHereRef = useRef(null)

  // Strg beim letzten Klick oder Tastendruck: entscheidet bei "Strg+Klick", ob eine Seite ein eigenes Fenster bekommt
  useEffect(() => {
    const note = (e) => (modifier.current = e.ctrlKey || e.metaKey)
    for (const t of ['pointerdown', 'keydown', 'keyup']) document.addEventListener(t, note, true)
    return () => {
      for (const t of ['pointerdown', 'keydown', 'keyup']) document.removeEventListener(t, note, true)
    }
  }, [])

  // Hauptfenster: Seitenfenster melden sich beim Schließen ab und schicken Links hierher
  useEffect(() => {
    if (windowPage) return
    db.getSetting('window-mode').then((m) => m && setWindowMode(m)).catch(() => {})
    // Nach einem Update: war das Fenster vorher offen, wieder zeigen (auch wenn der Neustart mit --hidden kam)
    const after = JSON.parse(localStorage.getItem('nach-update') || 'null')
    localStorage.removeItem('nach-update')
    if (after?.show) {
      const w = getCurrentWindow()
      w.unminimize().then(() => w.show()).then(() => w.setFocus()).catch(() => {})
    }
    // Neuigkeiten einmal nach jedem Update (auch nach einem stillen im Tray: dann beim nächsten Öffnen sichtbar)
    getVersion().then(async (v) => {
      setAppVersion(v)
      const seen = await db.getSetting('neuigkeiten-gesehen').catch(() => null)
      if (after || (seen && seen !== v)) setNews(v)
      if (seen !== v) db.setSetting('neuigkeiten-gesehen', v).catch(() => {})
    }).catch(() => {})
    // Name unten links: gespeichert, sonst der Windows-Anmeldename
    Promise.all([db.getSetting('profil').catch(() => null), homeDir().catch(() => '')]).then(([saved, home]) =>
      setProfile(saved ? JSON.parse(saved) : { name: home.split(/[\\/]/).filter(Boolean).at(-1) ?? '', color: 'petrol' }),
    )
    const offs = [
      listen('window-closed', (e) => setWindows((s) => new Set([...s].filter((id) => id !== e.payload)))),
      listen('open-page', (e) => {
        openHereRef.current?.(e.payload)
        const w = getCurrentWindow()
        w.unminimize().then(() => w.show()).then(() => w.setFocus()).catch(() => {})
      }),
    ]
    return () => offs.forEach((p) => p.then((off) => off()))
  }, [])

  // Seitenfenster: Position, Größe und Pin merken; beim Schließen erst speichern, dann abmelden
  useEffect(() => {
    if (!windowPage) return
    const win = getCurrentWindow()
    const key = windowKey(windowPage)
    let timer
    let closing = false
    const store = async () => {
      if (closing || (await win.isMinimized()) || (await win.isMaximized())) return
      const f = await win.scaleFactor()
      const pos = (await win.outerPosition()).toLogical(f)
      const size = (await win.innerSize()).toLogical(f)
      const geo = { x: Math.round(pos.x), y: Math.round(pos.y), w: Math.round(size.width), h: Math.round(size.height), pin: pinnedRef.current }
      if (!closing) await db.setSetting(key, JSON.stringify(geo))
    }
    storeWindow.current = () => store().catch(() => {})
    db.getSetting(key)
      .then((saved) => {
        pinnedRef.current = !!JSON.parse(saved ?? '{}').pin
        setPinned(pinnedRef.current)
      })
      .catch(() => {})
      .then(storeWindow.current)
    const later = () => (clearTimeout(timer), (timer = setTimeout(storeWindow.current, 400)))
    const offs = [
      win.onMoved(later),
      win.onResized(later),
      win.onCloseRequested(async () => {
        closing = true
        clearTimeout(timer)
        await flushRef.current?.()
        await db.deleteSetting(key).catch(() => {})
        await emitTo('main', 'window-closed', windowPage).catch(() => {})
      }),
    ]
    return () => (clearTimeout(timer), offs.forEach((p) => p.then((off) => off())))
  }, [])

  async function togglePin() {
    const next = !pinnedRef.current
    await getCurrentWindow().setAlwaysOnTop(next)
    pinnedRef.current = next
    setPinned(next)
    storeWindow.current()
  }

  // Im fertigen Programm: gleich nach dem Start nachsehen und eine neue Version ohne Klick installieren (immer die neueste,
  // keine Zwischenstände); unterwegs alle 6 Stunden nur vormerken, dann kommt sie beim nächsten Start. Fehler (offline) still
  useEffect(() => {
    if (!import.meta.env.PROD || windowPage) return
    const look = (now) =>
      findUpdate()
        .then((found) => {
          if (!found) return
          setUpdate((u) => ({ ...u, found, busy: now }))
          if (now) return installUpdate(found)
        })
        .catch((e) => now && setUpdate((u) => ({ ...u, busy: false, error: `Update fehlgeschlagen: ${e}` })))
    const first = setTimeout(() => look(true), 3_000)
    const timer = setInterval(() => look(false), 6 * 3600e3)
    return () => (clearTimeout(first), clearInterval(timer))
  }, [])

  const updates = {
    ...update,
    async check() {
      setUpdate((u) => ({ ...u, busy: true, error: '' }))
      try {
        const found = await findUpdate()
        setUpdate({ found, busy: false, error: '', checked: true })
        return found
      } catch (e) {
        setUpdate({ found: null, busy: false, error: String(e) })
      }
    },
    async install() {
      setUpdate((u) => ({ ...u, busy: true, error: '' }))
      try {
        await installUpdate(update.found)
      } catch (e) {
        setUpdate((u) => ({ ...u, busy: false, error: `Update fehlgeschlagen: ${e}` }))
      }
    },
  }

  // force: "Jetzt sichern"; sonst nur, wenn das Intervall abgelaufen ist
  const doBackup = useCallback(async (force) => {
    try {
      if (force) setBackup((b) => ({ ...b, busy: true }))
      const dest = force ? await runBackup(await loadBackupSettings()) : await maybeBackup()
      if (dest || force) setBackup({ busy: false, error: '', dest: dest ?? '' })
    } catch (e) {
      setBackup({ busy: false, error: String(e), dest: '' })
    }
  }, [])

  const tree = useMemo(() => buildTree(nodes ?? []), [nodes])
  // Aussehen aus der Datenbank (gilt vor dem Zwischenspeicher dieses PCs)
  useEffect(() => {
    if (!windowPage) loadLook().catch(() => {})
  }, [])
  // Baum nur mit dem aktiven Bereich (Seitenleiste, Suche, Snippets); stabil, solange sich nichts ändert
  const areaTree = useMemo(() => {
    const inArea = (n) => tree.areaOf(n.id) === area
    return { ...tree, alive: new Map([...tree.alive].filter(([, n]) => inArea(n))), roots: tree.roots.filter(inArea) }
  }, [tree, area])

  // Reiter gelöschter Seiten schließen
  useEffect(() => {
    if (!nodes || windowPage) return
    const dead = tabsRef.current.tabs.filter((t) => !VIEWS[t.view] && !tree.alive.has(t.view))
    if (dead.length) changeTabs((s) => dead.reduce((x, t) => T.close(x, t.key), s))
  }, [tree])
  // offene Reiter merken, sie kommen beim nächsten Start wieder
  useEffect(() => {
    if (windowPage || !tabState.tabs.length) return
    const t = setTimeout(() => db.setSetting('reiter', JSON.stringify(T.serialize(tabState))).catch(() => {}), 300)
    return () => clearTimeout(t)
  }, [tabState])
  useEffect(() => {
    db.getSetting('area').then((a) => a && setArea(a)).catch(() => {})
  }, [])

  // Strg+K öffnet die Suche, auch mitten im Editor; Strg+Umschalt+F schaltet den Fokus-Modus
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFocusMode((f) => !f)
      }
      // Seitenleiste: Strg+Umschalt+L (auf deutscher Tastatur bequemer als Strg+\, das auch geht)
      if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key.toLowerCase() === 'l') || e.key === '\\')) {
        e.preventDefault()
        setLook({ sidebarHidden: !getLook().sidebarHidden })
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearching((s) => !s)
      }
      // Strg+Z / Strg+Y (oder Strg+Umschalt+Z) außerhalb von Text: Änderungen an Seiten, Listen und Punkten
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || key === 'y') && !e.defaultPrevented && !e.target.closest?.('input, textarea, [contenteditable="true"], .tiptap')) {
        e.preventDefault()
        if (key === 'y' || e.shiftKey) undoKeys.current?.redo()
        else undoKeys.current?.undo()
      }
      // Reiter wie im Browser: Strg+W schließt, Strg+T neu, Strg+Tab / Strg+Umschalt+Tab wechselt
      if (!windowPage && e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'w' && !e.shiftKey) (e.preventDefault(), tabKeys.current?.close())
        else if (k === 't' && !e.shiftKey) (e.preventDefault(), tabKeys.current?.add())
        else if (e.key === 'Tab') (e.preventDefault(), tabKeys.current?.cycle(e.shiftKey ? -1 : 1))
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  // Esc beendet den Fokus-Modus, außer jemand anderes hat Esc schon verbraucht (Slash-Menü, Zeichenwerkzeug)
  useEffect(() => {
    if (!focusMode) return
    const onKey = (e) => e.key === 'Escape' && setTimeout(() => !e.defaultPrevented && setFocusMode(false))
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [focusMode])

  // Erinnerungen prüfen: gleich nach dem Laden, dann alle 30 s (live hält den aktuellen Stand)
  const loaded = nodes !== null
  useEffect(() => {
    if (!loaded || windowPage) return
    const run = () => {
      if (live.current) checkReminders(live.current.rows, live.current.dbOf).catch(() => {})
      doBackup(false)
    }
    run()
    const timer = setInterval(run, 30_000)
    return () => clearInterval(timer)
  }, [loaded, doBackup])

  // Im fertigen Programm beim ersten Start Autostart einschalten (so gewünscht); im Testmodus nie
  useEffect(() => {
    if (!import.meta.env.PROD || windowPage) return
    db.getSetting('autostart-init')
      .then((done) => !done && enableAutostart().then(() => db.setSetting('autostart-init', '1')))
      .catch(() => {})
  }, [])

  // Gespeicherte Tastenkürzel binden; belegt ein anderes Programm eins, Hinweis statt Absturz
  async function applyHotkeys(keys) {
    setHotkeys(keys)
    const busy = await bindHotkeys(keys, (id) => hotkeyRun.current?.(id))
    setHotkeyBusy(busy)
    return busy
  }
  useEffect(() => {
    if (windowPage) return
    Promise.all(HOTKEYS.map((h) => db.getSetting(h.setting).catch(() => null))).then((saved) =>
      applyHotkeys(Object.fromEntries(HOTKEYS.map((h, i) => [h.id, saved[i] || h.fallback]))),
    )
    // Tray-Menü: "Zwischenablage in den Eingang"
    const off = listen('clipboard-to-inbox', () => hotkeyRun.current?.('clipboard'))
    return () => off.then((f) => f())
  }, [])
  // Neues Kürzel: bei Belegung bleibt das alte
  async function changeHotkey(id, accel) {
    const before = hotkeys
    if ((await applyHotkeys({ ...before, [id]: accel })).includes(id)) {
      await applyHotkeys(before)
      return false
    }
    await db.setSetting(HOTKEYS.find((h) => h.id === id).setting, accel).catch(fail)
    return true
  }
  const fail = (e) => setError(`Speichern fehlgeschlagen: ${e}`)
  const reload = useCallback(() => db.allNodes().then(setNodes).catch((e) => setError(`Datenbank nicht erreichbar: ${e}`)), [])

  useEffect(() => {
    db.getSetting('personen').then((p) => p && setPeopleSaved(JSON.parse(p))).catch(() => {})
    // Seitenfenster: nur Daten laden; Aufräumen, Beispieldaten und Wiederherstellen macht das Hauptfenster
    const off = listen('nodes-changed', (e) => e.payload?.from !== label && reload())
    if (windowPage) {
      initImages()
        .catch(() => {})
        .then(db.allNodes)
        .then((all) => (setNodes(all), setCurrent(windowPage)))
        .catch((e) => setError(`Datenbank nicht erreichbar: ${e}`))
      return () => off.then((f) => f())
    }
    initImages()
      .then(db.purgeOld)
      .catch(() => {})
      .then(seedLop)
      .then(db.allNodes)
      .then(async (all) => {
        const saved = await db.getSetting('reiter').catch(() => null)
        setNodes(all)
        const pages = all.filter((n) => n.kind === 'page' && !n.deleted_at)
        const last = all.filter((n) => n.opened_at && !n.deleted_at).sort((a, b) => b.opened_at.localeCompare(a.opened_at))[0]
        const start = last ?? pages[0]
        // offene Reiter vom letzten Mal; ohne die (oder bis 0.28 nur Angepinnte) dazu die zuletzt geöffnete Seite
        tabsRef.current = T.restore(saved && JSON.parse(saved), start?.id ?? 'today')
        setTabState(tabsRef.current)
        // Eltern der Startseite aufklappen, damit sie im Baum sichtbar ist
        const byId = new Map(all.map((n) => [n.id, n]))
        const up = []
        for (let n = byId.get(start?.parent_id); n; n = byId.get(n.parent_id)) up.push(n.id)
        setExpanded((s) => new Set([...s, ...up]))
        // Text in Bildern und Anhängen erst, wenn die App steht; läuft still im Hintergrund
        setTimeout(indexText, 5000)
        return restoreWindows((id) => all.some((n) => n.id === id && !n.deleted_at)).then((ids) => setWindows(new Set(ids)))
      })
      .catch((e) => setError(`Datenbank nicht erreichbar: ${e}`))
    return () => {
      off.then((f) => f())
    }
  }, [reload])

  // Zurück im Fenster: Änderungen von außen (Skripte, zweites Nexora) übernehmen, bevor Altes zurückgeschrieben wird.
  // Eigenes ist da schon gespeichert (Page.jsx sichert bei "blur")
  useEffect(() => {
    addEventListener('focus', reload)
    return () => removeEventListener('focus', reload)
  }, [reload])

  // Fenstertitel folgt dem Seitentitel
  const windowTitle = windowPage && nodes ? (nodes.find((n) => n.id === windowPage)?.title ?? null) : null
  useEffect(() => {
    if (windowTitle !== null) getCurrentWindow().setTitle(`${windowTitle || 'Ohne Titel'} – Nexora`).catch(() => {})
  }, [windowTitle])

  // Links nie im App-Fenster öffnen, sondern im Standardbrowser; im Editor nur mit Strg+Klick
  useEffect(() => {
    const onClick = (e) => {
      const a = e.target.closest?.('a[href]')
      if (!a) return
      e.preventDefault()
      const inEditor = a.closest('.tiptap')
      if (inEditor && !(e.ctrlKey || e.metaKey)) return
      if (/^(https?:|mailto:)/i.test(a.getAttribute('href'))) openUrl(a.href).catch((err) => setError(String(err)))
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('expanded', JSON.stringify([...expanded]))
    } catch {}
  }, [expanded])

  const patch = useCallback((id, fields) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...fields } : n))), [])

  const pathOf = useCallback((id) => {
    const out = []
    for (let n = tree.alive.get(id); n; n = tree.alive.get(n.parent_id)) out.unshift(n)
    return out
  }, [tree])

  const dbOf = (row) => tree.alive.get(row.parent_id) ?? null

  // Outlook abgleichen: Fälligkeiten in den eigenen Kalender, Termine lesen. Nur das Hauptfenster
  const outlookSync = useCallback(async () => {
    const { push, read } = outlookOpts.current
    if (windowPage || outlookRunning.current || !(push || read) || !live.current) return
    outlookRunning.current = true
    setOutlook((o) => ({ ...o, busy: true, error: '' }))
    try {
      const parts = []
      if (push) {
        const r = await pushDue(live.current.work, live.current.dbOf)
        parts.push(`${r.neu} neu, ${r.geaendert} geändert, ${r.entfernt} entfernt`)
        if (r.fehler?.length) throw new Error(r.fehler.join('; '))
      }
      if (read) {
        const list = await readEvents()
        setEvents(list)
        parts.push(`${list.length} Termine gelesen`)
      }
      const at = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      setOutlook((o) => ({ ...o, busy: false, last: `${at} Uhr: ${parts.join(', ')}` }))
    } catch (e) {
      setOutlook((o) => ({ ...o, busy: false, error: String(e.message ?? e) }))
    } finally {
      outlookRunning.current = false
    }
  }, [])

  useEffect(() => {
    if (windowPage) return
    Promise.all([db.getSetting('outlook-push'), db.getSetting('outlook-read')])
      .then(([push, read]) => setOutlook((o) => ({ ...o, push: push === '1', read: read === '1' })))
      .catch(() => {})
  }, [])
  // Alle 15 Minuten, und 10 s nachdem sich eine Fälligkeit geändert hat (oder nach dem Einschalten)
  const dueSignature = useMemo(
    () => (outlook.push ? hash(JSON.stringify([...desiredEvents([...tree.alive.values()].filter((n) => n.kind === 'row' && tree.areaOf(n.id) !== 'privat'), (r) => tree.alive.get(r.parent_id) ?? null)])) : ''),
    [tree, outlook.push],
  )
  useEffect(() => {
    if (!outlook.push && !outlook.read) return setEvents([])
    const soon = setTimeout(outlookSync, 10_000)
    return () => clearTimeout(soon)
  }, [dueSignature, outlook.push, outlook.read, outlookSync])
  useEffect(() => {
    if (!outlook.push && !outlook.read) return
    const every = setInterval(outlookSync, 15 * 60e3)
    return () => clearInterval(every)
  }, [outlook.push, outlook.read, outlookSync])
  function setOutlookOption(key, on) {
    setOutlook((o) => ({ ...o, [key]: on }))
    db.setSetting(`outlook-${key}`, on ? '1' : '0').catch(fail)
  }

  // replay: Rückgängig/Wiederholen; dann kein neuer Schritt und keine Folgen (nächster Termin, Tagebuch)
  function save(id, fields, { replay = false } = {}) {
    const node = tree.alive.get(id) ?? nodes.find((n) => n.id === id) // auch Gelöschte (Wiederherstellen)
    if (node) logNode(node, fields)
    if (node && !replay) remember(node, fields)
    if (node?.kind === 'row' && fields.props) {
      logChanges(node, fields.props)
      if (!replay) {
        repeatIfDone(node, fields.props)
        const fs = fieldsOf(dbOf(node))
        if (!isDone(node, fs) && isDone({ props: fields.props }, fs)) db.journal('erledigt', id, node.title).catch(() => {})
      }
    }
    patch(id, { ...fields, updated_at: new Date().toISOString() })
    db.update(id, fields).catch(fail)
  }

  // Wiederkehrender Punkt wird erledigt: nächsten Termin als neuen Punkt anlegen.
  // Fällig, Beginn und Wiedervorlage rücken um denselben Abstand weiter, der Inhalt wird übernommen.
  async function repeatIfDone(row, props) {
    const fs = fieldsOf(dbOf(row))
    if (!props.repeat || isDone(row, fs) || !isDone({ props }, fs)) return
    const base = dayOf(props.due) ?? today()
    const next = nextDate(base, props.repeat)
    const delta = daysBetween(base, next)
    const copy = { ...props, due: props.due ? shiftDate(props.due, delta) : next }
    for (const k of ['start', 'followup']) if (copy[k]) copy[k] = shiftDate(copy[k], delta)
    const sf = statusField(fs)
    if (sf) copy[sf.id] = sf.options.find((o) => !o.done)?.id ?? null
    delete copy.nr
    const created = await addRow(row.parent_id, row.title, copy)
    if (!created) return
    await db.update(created.id, { body: await db.loadBody(row.id) }).catch(() => {})
    db.addActivity(row.id, 'change', `Wiederholung: nächster Termin ${formatDate(copy.due)} angelegt`).catch(() => {})
    setNotice(`Nächster Termin angelegt: ${formatDate(copy.due)}`)
  }

  // Verlauf je Punkt: jede geänderte Eigenschaft als "Status: Offen → Wartet"
  // Rückgängig: jede Änderung über save() merkt sich den Stand davor. Was im selben Augenblick passiert (erledigt
  // und nächster Termin, Wiederherstellen samt Eltern), ist ein Schritt; dasselbe Feld kurz hintereinander auch.
  // Text gehört nicht dazu, der hat das Rückgängig des Editors
  const UNDOABLE = ['title', 'icon', 'color', 'cover', 'locked', 'template', 'props', 'config', 'favorite', 'parent_id', 'sort', 'deleted_at', 'area']
  function stepLabel(node, fields) {
    const name = `„${node.title || 'Ohne Titel'}“`
    if ('deleted_at' in fields) return fields.deleted_at ? `${name} gelöscht` : `${name} wiederhergestellt`
    if ('title' in fields) return `Umbenannt in „${fields.title || 'Ohne Titel'}“`
    if ('parent_id' in fields || 'sort' in fields) return `${name} verschoben`
    if ('props' in fields) return `Felder von ${name}`
    if ('config' in fields) return `Einstellungen von ${name}`
    return `${name} geändert`
  }
  function remember(node, fields, { before, label } = {}) {
    const keys = Object.keys(fields).filter((k) => UNDOABLE.includes(k))
    if (!keys.length) return
    const entry = { id: node.id, before: before ?? Object.fromEntries(keys.map((k) => [k, node[k] ?? null])), after: Object.fromEntries(keys.map((k) => [k, fields[k] ?? null])) }
    const h = history.current
    const t = tick.current
    const last = h.done.at(-1)
    const same = last?.entries.length === 1 && last.entries[0].id === entry.id && Object.keys(last.entries[0].after).join() === keys.join() && Date.now() - last.at < 2000
    if (last && last.tick === t.n) last.entries.push(entry)
    else if (same) (last.entries[0].after = entry.after), (last.at = Date.now())
    else {
      h.done.push({ entries: [entry], label: label ?? stepLabel(node, fields), at: Date.now(), tick: t.n })
      if (h.done.length > 100) h.done.shift()
    }
    h.undone = []
    if (!t.armed) (t.armed = true), setTimeout(() => ((t.n += 1), (t.armed = false)))
  }
  // neu angelegt: rückgängig = in den Papierkorb
  const rememberNew = (node) => remember(node, { deleted_at: null }, { before: { deleted_at: new Date().toISOString() }, label: `„${node.title || 'Ohne Titel'}“ angelegt` })
  function undo() {
    const step = history.current.done.pop()
    if (!step) return setNotice('Nichts mehr rückgängig zu machen.')
    for (const e of [...step.entries].reverse()) save(e.id, e.before, { replay: true })
    history.current.undone.push(step)
    setNotice({ text: `Rückgängig: ${step.label}`, label: 'Wiederholen', run: () => undoKeys.current.redo() })
  }
  function redo() {
    const step = history.current.undone.pop()
    if (!step) return setNotice('Nichts zum Wiederholen.')
    for (const e of step.entries) save(e.id, e.after, { replay: true })
    history.current.done.push(step)
    setNotice({ text: `Wiederholt: ${step.label}`, label: 'Rückgängig', run: () => undoKeys.current.undo() })
  }
  undoKeys.current = { undo, redo }

  // Verlauf der Seite (Uhr-Knopf): was sich außer Text und Feldern ändert
  const where = (id) => (id ? pathOf(id).map((p) => p.title || 'Ohne Titel').join(' / ') : 'Eingang')
  function logNode(node, fields) {
    const say = (text, merge) => db.addChange(node.id, text, merge).catch(() => {})
    const changed = (k) => k in fields && (fields[k] ?? null) !== (node[k] ?? null)
    if (changed('title')) db.renamed(node.id, node.title, fields.title).catch(() => {})
    if (changed('parent_id')) say(`Verschoben: ${where(node.parent_id)} → ${where(fields.parent_id)}`)
    if (changed('locked') && !!fields.locked !== !!node.locked) say(fields.locked ? 'Gesperrt' : 'Entsperrt')
    if (changed('template') && !!fields.template !== !!node.template) say(fields.template ? 'Als Vorlage markiert' : 'Keine Vorlage mehr')
    if (changed('icon')) say(fields.icon ? `Symbol: ${fields.icon}` : 'Symbol entfernt')
    if (changed('cover')) say(fields.cover ? 'Titelbild gesetzt' : 'Titelbild entfernt')
    if (changed('area')) say(`Bereich: ${node.area === 'privat' ? 'Privat' : 'Arbeit'} → ${fields.area === 'privat' ? 'Privat' : 'Arbeit'}`)
    if (changed('deleted_at') && !!fields.deleted_at !== !!node.deleted_at) say(fields.deleted_at ? 'In den Papierkorb gelegt' : 'Wiederhergestellt')
    if ('config' in fields && node.kind === 'database' && JSON.stringify(fields.config) !== JSON.stringify(node.config)) say('Listen-Einstellungen geändert', { key: 'Listen-Einstellungen', join: (last) => last })
  }
  function logChanges(row, props) {
    for (const f of fieldsOf(dbOf(row))) {
      const [before, after] = [row.props?.[f.id] ?? null, props[f.id] ?? null]
      if (f.type === 'nr' || JSON.stringify(before) === JSON.stringify(after)) continue
      db.addActivity(row.id, 'change', `${f.name}: ${describe(f, before)} → ${describe(f, after)}`).catch(() => {})
    }
  }

  // Fehlende Tag-Optionen in der Liste ergänzen, damit sie Farbe und Auswahl bekommen
  function withTags(list, tags = []) {
    const tf = list.config.fields.find((f) => f.type === 'multi' && f.id === 'tags')
    const missing = tf ? tags.filter((t) => !tf.options.some((o) => o.id === t)) : []
    if (!missing.length) return list.config
    return { ...list.config, fields: list.config.fields.map((f) => (f === tf ? { ...f, options: [...f.options, ...missing.map((t) => ({ id: t, name: t, color: 'grau' }))] } : f)) }
  }

  // Nummer vergeben und Zähler der Liste hochsetzen
  function numbered(list, props) {
    let config = withTags(list, props.tags)
    const sf = statusField(config.fields)
    const next = { ...(sf && !props[sf.id] ? { [sf.id]: sf.options[0]?.id } : {}), ...props }
    if (config.fields.some((f) => f.type === 'nr') && !next.nr) {
      next.nr = config.nextNr
      config = { ...config, nextNr: config.nextNr + 1 }
    }
    if (config !== list.config) save(list.id, { config })
    return next
  }

  async function addRow(parentId, title, props = {}, open = false) {
    try {
      const list = parentId ? tree.alive.get(parentId) : null
      const full = list ? numbered(list, props) : { status: 'offen', ...props }
      const node = await db.create('row', parentId, title, { props: full, area: parentId ? null : areaValue })
      setNodes((ns) => [...ns, node])
      rememberNew(node)
      db.journal('angelegt', node.id, title).catch(() => {})
      if (open) actions.open(node.id), setFresh(node.id)
      return node
    } catch (e) {
      fail(e)
    }
  }

  // Nachhaken: Mail-Entwurf im installierten Outlook; Nexora sendet nie selbst
  async function followUp(row) {
    try {
      await invoke('outlook_draft', followUpMail(row, dbOf(row)))
      db.addActivity(row.id, 'change', 'Nachgehakt per Mail-Entwurf').catch(() => {})
      db.journal('nachgehakt', row.id, row.title).catch(() => {})
      setNotice('Mail-Entwurf in Outlook geöffnet.')
    } catch (e) {
      setError(`Outlook: ${e}`)
    }
  }

  // Meldung im Fenster, oder als Windows-Meldung, wenn Nexora gerade im Hintergrund ist
  async function tell(text) {
    setNotice(text)
    if (document.hasFocus()) return
    if (await isPermissionGranted().catch(() => false)) sendNotification({ title: 'Nexora', body: text })
  }

  // Zwischenablage in den Eingang: Text wird ein Punkt (erste Zeile Titel), ein Bild ein Punkt mit Bild
  async function clipboardToInbox() {
    try {
      const clip = await invoke('clipboard_read')
      let text = clip.text?.trim()
      if (text) {
        const spans = secretSpans(text)
        if (spans.length) {
          const w = getCurrentWindow()
          await w.unminimize().then(() => w.show()).then(() => w.setFocus()).catch(() => {})
          const choice = await new Promise((resolve) => setSecretAsk({ text, spans, resolve }))
          if (!choice) return
          if (choice === 'masked') text = maskSecrets(text, spans)
        }
        const [first, ...rest] = text.split(/\r?\n/)
        const title = first.trim().slice(0, 120) || 'Aus der Zwischenablage'
        const more = (first.trim().length > 120 ? text : rest.join('\n')).trim()
        const row = await addRow(null, title, {})
        if (row && more) await db.update(row.id, { body: more })
        return tell(`Im Eingang: ${title}`)
      }
      if (clip.bmp) {
        const src = await saveImageBytes(await bmpToPng(clip.bmp), 'png')
        const title = `Bild aus der Zwischenablage, ${new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
        const row = await addRow(null, title, {})
        if (row) await db.update(row.id, { body: `![](${src})` })
        return tell(`Im Eingang: ${title}`)
      }
      tell('Die Zwischenablage ist leer.')
    } catch (e) {
      setError(`Zwischenablage: ${e}`)
    }
  }
  hotkeyRun.current = (id) => (id === 'capture' ? invoke('toggle_capture') : id === 'clipboard' ? clipboardToInbox() : invoke('toggle_picker'))

  // Wochenrückblick als Seite ablegen
  async function savePage(parentId, title, body) {
    try {
      const node = await db.create('page', parentId, title)
      await db.update(node.id, { body })
      setNodes((ns) => [...ns, node])
      db.journal('angelegt', node.id, title).catch(() => {})
      actions.openHere(node.id)
    } catch (e) {
      fail(e)
    }
  }

  // Offene Checkpunkte einer Seite als LOP-Punkte anlegen; Kurzsyntax gilt relativ zum Stichtag
  async function rowsFromChecklist(pageId, listId, day) {
    const list = tree.alive.get(listId)
    const items = [...(await db.loadBody(pageId)).matchAll(/^\s*- \[ \] (.+)$/gm)].map((m) => m[1].trim())
    const [y, m, d] = day.split('-').map(Number)
    const parsed = items.map((text) => parseQuick(text, new Date(y, m - 1, d)))
    // Nummern und Tags einmal für alle vergeben, nicht je Punkt (der Zustand wäre zwischendurch veraltet)
    let config = withTags(list, parsed.flatMap((p) => p.props.tags ?? []))
    const sf = statusField(config.fields)
    const numbering = config.fields.some((f) => f.type === 'nr')
    const created = []
    for (const [i, { title, props }] of parsed.entries()) {
      const full = { ...(sf ? { [sf.id]: sf.options[0]?.id } : {}), ...props, ...(numbering ? { nr: config.nextNr + i } : {}) }
      created.push(await db.create('row', listId, title || items[i], { props: full }))
    }
    if (numbering) config = { ...config, nextNr: config.nextNr + parsed.length }
    save(listId, { config })
    setNodes((ns) => [...ns, ...created])
    return created.length
  }

  // Neue Seite aus einer Vorlage; {{Datum}} in Titel und Inhalt wird durch das heutige Datum ersetzt
  async function fromTemplate(templateId, parentId) {
    try {
      const t = tree.alive.get(templateId)
      const date = new Date().toLocaleDateString('de-DE')
      const sub = (s) => (s ?? '').replaceAll('{{Datum}}', date)
      const node = await db.create('page', parentId, sub(t.title))
      const extra = { body: sub(await db.loadBody(templateId)), icon: t.icon ?? null, cover: t.cover ?? null }
      await db.update(node.id, extra)
      setNodes((ns) => [...ns, { ...node, icon: extra.icon, cover: extra.cover }])
      db.journal('angelegt', node.id, node.title).catch(() => {})
      setExpanded((s) => new Set([...s, parentId]))
      setCurrent(node.id)
    } catch (e) {
      fail(e)
    }
  }

  // Textdateien als Seiten übernehmen: aus dem Explorer gezogen (File) oder per Dateidialog
  async function importFiles(parentId, dropped) {
    try {
      let items
      if (dropped) {
        const texts = dropped.filter((f) => /\.(txt|md|markdown|log)$/i.test(f.name))
        if (!texts.length) return setError('Importieren lassen sich .txt, .md und .log')
        items = await Promise.all(texts.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })))
      } else {
        const picked = await openDialog({ multiple: true, title: 'Textdateien importieren', filters: [{ name: 'Text', extensions: ['txt', 'md', 'markdown', 'log'] }] })
        if (!picked) return
        items = await Promise.all([picked].flat().map(async (p) => ({ name: p.split(/[\\/]/).pop(), bytes: new Uint8Array(await invoke('read_text_file', { path: p })) })))
      }
      const created = []
      for (const it of items) {
        const { title, body } = importedPage(it.name, decodeText(it.bytes))
        const node = await db.create('page', parentId, title)
        await db.update(node.id, { body })
        created.push(node)
      }
      setNodes((ns) => [...ns, ...created])
      setExpanded((s) => new Set([...s, parentId]))
      if (created.length === 1) setCurrent(created[0].id)
      setNotice(`${created.length} ${created.length === 1 ? 'Seite' : 'Seiten'} importiert`)
    } catch (e) {
      fail(e)
    }
  }

  // Markdown-Export: Baum ab `ids` (oder alles) in einen gewählten Ordner, mit Bildern und Anhängen
  async function exportTree(ids, all) {
    try {
      const target = await openDialog({ directory: true, title: 'Ordner für den Export wählen' })
      if (!target) return
      const bodies = new Map()
      const walk = async (id) => {
        const n = tree.alive.get(id)
        if (['page', 'row'].includes(n.kind)) bodies.set(id, await db.loadBody(id))
        for (const k of [...tree.children(id), ...tree.rows(id)]) await walk(k.id)
      }
      for (const id of ids) await walk(id)
      const out = buildExport(ids, { get: (x) => tree.alive.get(x), children: tree.children, rows: tree.rows, body: (x) => bodies.get(x) ?? '' })
      // "Alles" landet in einem eigenen Unterordner mit Datum
      const prefix = all ? `Nexora-Export ${today()}/` : ''
      const files = out.files.map((f) => ({ ...f, path: prefix + f.path }))
      const copies = out.copies.map((c) => ({ ...c, to: prefix + c.to }))
      const n = await invoke('export_files', { target, files, copies })
      setNotice(`${n} Seiten exportiert nach ${target}${all ? `\\${prefix.slice(0, -1)}` : ''}`)
    } catch (e) {
      fail(e)
    }
  }

  // Notizbuch als Nexora-Datei (verlustfrei, mit Bildern und Anhängen)
  async function exportNexora(id) {
    try {
      const root = tree.alive.get(id)
      const target = await saveDialog({ title: 'Notizbuch als Nexora-Datei speichern', defaultPath: `${safeName(root.title)}.nexora`, filters: [{ name: 'Nexora-Notizbuch', extensions: ['nexora'] }] })
      if (!target) return
      const kids = (x) => [...tree.children(x), ...tree.rows(x)]
      const bodies = new Map()
      const activity = new Map()
      const walk = async (x) => {
        bodies.set(x, await db.loadBody(x))
        if (tree.alive.get(x).kind === 'row') activity.set(x, await db.activity(x))
        for (const k of kids(x)) await walk(k.id)
      }
      await walk(id)
      const { json, files } = packNotebook(id, { get: (x) => tree.alive.get(x), kids, body: (x) => bodies.get(x), activity: (x) => activity.get(x) ?? [] })
      const copied = await invoke('export_nexora', { target, json: JSON.stringify(json), files })
      setNotice(`„${root.title || 'Ohne Titel'}“ gespeichert: ${json.nodes.length} Einträge, ${copied} Bilder und Anhänge.`)
    } catch (e) {
      setError(`Export: ${e.message ?? e}`)
    }
  }

  async function importNexora() {
    try {
      const source = await openDialog({ title: 'Nexora-Datei importieren', filters: [{ name: 'Nexora-Notizbuch', extensions: ['nexora'] }] })
      if (!source) return
      const { nodes: list, activity } = unpackNotebook(JSON.parse(await invoke('import_nexora', { source })), () => crypto.randomUUID())
      const [book] = list
      // Gleichnamiges Notizbuch bleibt unberührt, die Kopie bekommt einen Zusatz; sie landet im aktiven Bereich
      const taken = new Set([...tree.alive.values()].filter((n) => n.kind === 'notebook').map((n) => n.title))
      const base = book.title
      for (let i = 1; taken.has(book.title); i++) book.title = `${base} (Import${i > 1 ? ` ${i}` : ''})`
      book.area = areaValue
      book.sort = (tree.roots.at(-1)?.sort ?? 0) + 1000
      for (const n of list) await db.insertNode(n)
      for (const a of activity) await db.insertActivity(a)
      db.nodesChanged()
      setNodes(await db.allNodes())
      actions.openHere(book.id)
      setNotice(`„${book.title}“ importiert: ${list.length} Einträge.`)
    } catch (e) {
      setError(`Import: ${e.message ?? e}`)
    }
  }

  // Ziel beim Ziehen im Baum: zone 'before' | 'after' | 'inside' relativ zu target; null = nicht erlaubt
  function placement(id, targetId, zone) {
    const node = tree.alive.get(id)
    const target = tree.alive.get(targetId)
    if (!node || !target || id === targetId) return null
    const parent = zone === 'inside' ? target : tree.alive.get(target.parent_id) ?? null
    if (parent && pathOf(parent.id).some((n) => n.id === id)) return null
    if (!PARENTS[node.kind]?.includes(parent?.kind ?? null)) return null
    const sibs = tree.children(parent?.id ?? null).filter((n) => n.id !== id)
    if (zone === 'inside') return { parent_id: parent.id, sort: (sibs.at(-1)?.sort ?? 0) + 1000 }
    const i = sibs.findIndex((n) => n.id === target.id)
    const [prev, next] = zone === 'before' ? [sibs[i - 1], target] : [target, sibs[i + 1]]
    const sort = prev && next ? (prev.sort + next.sort) / 2 : prev ? prev.sort + 1000 : next.sort - 1000
    return { parent_id: parent?.id ?? null, sort }
  }

  const actions = {
    fromTemplate,
    showNews: () => setNews(appVersion),
    // Benutzer-Anzeige → Nach Updates suchen
    async checkUpdates() {
      const found = await updates.check()
      // check() gibt bei einem Fehler nichts zurück (undefined), ohne neue Version null
      setNotice(found ? `Version ${found.version} ist da: unten links „jetzt installieren“, sonst kommt sie beim nächsten Start.` : found === undefined ? 'Keine Verbindung zum Update-Server.' : `Nexora ${appVersion} ist aktuell.`)
    },
    // Seitenleiste, Seite: in neuem Reiter öffnen, als Reiter anpinnen oder lösen
    openTab: (id) => actions.openHere(id, true),
    isPinned: (id) => tabState.tabs.some((t) => t.view === id && t.pinned),
    pinPage(id) {
      changeTabs((s) => {
        const t = s.tabs.find((x) => x.view === id)
        return t ? T.pin(s, t.key, !t.pinned) : T.openTab(s, id, { pinned: true })
      })
    },
    importFiles,
    exportTree,
    exportNexora,
    importNexora,
    canMove: (id, targetId, zone) => !!placement(id, targetId, zone),
    move(id, targetId, zone) {
      const to = placement(id, targetId, zone)
      if (!to) return
      save(id, to)
      if (to.parent_id) setExpanded((s) => new Set([...s, to.parent_id]))
    },
    // Im Seitenfenster geht alles ins Hauptfenster; dort je nach Einstellung in ein eigenes Fenster
    open(id) {
      if (windowPage) {
        if (id !== windowPage) emitTo('main', 'open-page', id).catch(() => {})
        return
      }
      const kind = tree.alive.get(id)?.kind
      if ((kind === 'page' || kind === 'row') && (windowMode === 'always' || (windowMode === 'ctrl' && modifier.current))) return actions.openWindow(id)
      actions.openHere(id)
    },
    openWindow(id, at) {
      setWindows((s) => new Set([...s, id]))
      openPageWindow(id, at ?? {}).catch((e) => {
        setError(`Fenster nicht geöffnet: ${e}`)
        setWindows((s) => new Set([...s].filter((x) => x !== id)))
      })
    },
    openHere(id, newTab = false) {
      changeTabs((s) => T.show(s, id, newTab))
      setFresh(null)
      if (!['trash', 'today', 'inbox', 'settings', 'snippets', 'calendar', 'journal', 'stats'].includes(id)) {
        db.touch(id).catch(() => {})
        const node = tree.alive.get(id)
        setExpanded((s) => new Set([...s, ...pathOf(id).slice(0, -1).map((n) => n.id), ...(['notebook', 'section'].includes(node?.kind) ? [id] : [])]))
      }
    },
    oneNoteDialog: () => setOneNote({ busy: '' }),
    async oneNoteConnect(book) {
      setOneNote({ busy: 'Notizbuch wird angelegt …' })
      try {
        const nb = await db.create('notebook', null, book.name, { config: { onenote: { id: book.id } }, area: areaValue })
        await actions.oneNoteSync(nb.id, (text) => setOneNote({ busy: text }))
        actions.openHere(nb.id)
      } catch (e) {
        setError(`OneNote: ${e}`)
      } finally {
        setOneNote(null)
      }
    },
    async oneNoteSync(id, progress = setNotice) {
      if (syncing.current) return
      syncing.current = true
      progress('OneNote wird gefragt …')
      try {
        const all = await db.allNodes()
        const api = { create: db.create, update: db.update, loadBody: db.loadBody, snapshot: db.snapshot, saveImage: saveImageBytes, toMarkdown: htmlToMarkdown, progress }
        const report = await syncNotebook(all.find((n) => n.id === id), all, api)
        await reload()
        setNotice(describeReport(report))
      } catch (e) {
        await reload()
        setError(`OneNote-Abgleich fehlgeschlagen: ${e}`)
      } finally {
        syncing.current = false
      }
    },
    oneNoteUnlink(id) {
      save(id, { config: null })
      setNotice('Verbindung zu OneNote gelöst. Die Seiten bleiben in Nexora und sind weiter gesperrt.')
    },
    toggle(id) {
      setExpanded((s) => {
        const next = new Set(s)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      })
    },
    async add(kind, parentId, template) {
      if (kind === 'row') return addRow(parentId, '', {}, true)
      try {
        const config = kind === 'database' ? (template === 'lop' ? lopConfig() : emptyConfig()) : null
        const title = template === 'lop' ? 'Offene Punkte' : DEFAULT_TITLE[kind]
        const node = await db.create(kind, parentId, title, { config, area: parentId ? null : areaValue })
        if (template === 'frei') await db.update(node.id, { body: CANVAS })
        setNodes((ns) => [...ns, node])
        rememberNew(node)
        if (kind === 'page') db.journal('angelegt', node.id, title).catch(() => {})
        if (parentId) setExpanded((s) => new Set([...s, parentId]))
        if (kind === 'page') {
          setCurrent(node.id)
          setFresh(node.id)
        } else if (kind === 'database') {
          setCurrent(node.id)
        } else {
          setRenaming(node.id)
        }
      } catch (e) {
        fail(e)
      }
    },
    startRename: setRenaming,
    setArea(next) {
      setArea(next)
      db.setSetting('area', next).catch(fail)
      // offene Seite aus dem anderen Bereich nicht stehen lassen
      if (tree.alive.has(current) && tree.areaOf(current) !== next) {
        // zum letzten Reiter, den der Bereich zeigt; gibt es keinen, ein neuer mit Heute
        const shown = (t) => VIEWS[t.view] || (tree.alive.has(t.view) && tree.areaOf(t.view) === next)
        changeTabs((s) => (s.tabs.some(shown) ? { ...s, active: s.tabs.filter(shown).at(-1).key } : T.openTab(s, 'today', { atEnd: true })))
      }
    },
    moveArea(id) {
      const n = tree.alive.get(id)
      const to = n.area === 'privat' ? null : 'privat'
      save(id, { area: to })
      setNotice(`„${n.title || 'Ohne Titel'}“ liegt jetzt im Bereich ${to ? 'Privat' : 'Arbeit'}.`)
      if (current && pathOf(current).some((p) => p.id === id)) setCurrent('today')
    },
    rename(id, title) {
      setRenaming(null)
      const node = tree.alive.get(id)
      if (node && title !== node.title) save(id, { title: title.trim() || node.title })
    },
    save,
    remove(id) {
      const n = tree.alive.get(id)
      save(id, { deleted_at: new Date().toISOString() })
      setNotice({ text: `„${n?.title || 'Ohne Titel'}“ liegt im Papierkorb.`, label: 'Rückgängig', run: () => undoKeys.current.undo() }) // aktueller Stand, nicht der beim Löschen
      if (windowPage === id) getCurrentWindow().close().catch(() => {})
      else if (current && pathOf(current).some((n) => n.id === id)) setCurrent(tree.alive.get(id)?.parent_id ?? 'today')
    },
  }
  openHereRef.current = actions.openHere

  const toggleRow = (row) => save(row.id, { props: toggleDone(row, fieldsOf(dbOf(row))) })

  function assign(row, list) {
    save(row.id, { parent_id: list.id, props: numbered(list, row.props ?? {}) })
    db.addActivity(row.id, 'change', `Zugeteilt: ${list.title || 'Ohne Titel'}`).catch(() => {})
  }

  if (nodes === null) {
    return <div className="grid h-full place-items-center text-muted">{error || 'Lädt …'}</div>
  }

  const node = tree.alive.get(current)
  const favorites = nodes.filter((n) => n.favorite && tree.alive.has(n.id) && tree.areaOf(n.id) === area)
  // Reiter wie Favoriten nur im aktiven Bereich; feste Ansichten (Heute, Eingang …) in beiden
  const shownTab = (t) => VIEWS[t.view] || (tree.alive.has(t.view) && tree.areaOf(t.view) === area)
  const tabItems = tabState.tabs.filter(shownTab).map((t) => ({ ...t, node: tree.alive.get(t.view) }))
  const tabActions = {
    select: (key) => changeTabs((s) => ({ ...s, active: key })),
    close: (key) => changeTabs((s) => T.close(s, key)),
    pin: (key, on) => changeTabs((s) => T.pin(s, key, on)),
    move: (key, target, side) => changeTabs((s) => T.move(s, key, target, side)),
    closeOthers: (key) => changeTabs((s) => T.closeOthers(s, key)),
    closeRight: (key) => changeTabs((s) => T.closeRight(s, key)),
    add: () => changeTabs((s) => T.openTab(s, 'today', { atEnd: true })),
    // herausgezogen: die Seite wandert in ein eigenes Fenster
    window(key, at) {
      const t = tabState.tabs.find((x) => x.key === key)
      if (!t) return
      actions.openWindow(t.view, at)
      changeTabs((s) => T.close(s, key))
    },
  }
  tabKeys.current = { close: () => tabActions.close(tabsRef.current.active), add: tabActions.add, cycle: (dir) => changeTabs((s) => T.cycle(s, dir, s.tabs.filter(shownTab))) }
  const trashed = nodes.filter((n) => n.deleted_at)
  const allRows = [...tree.alive.values()].filter((n) => n.kind === 'row')
  const people = peopleList(peopleSaved, allRows)
  // gespeichert wird immer die ganze Liste (auch Namen, die bisher nur in Punkten standen)
  const savePeople = (list) => (setPeopleSaved(list), db.setSetting('personen', JSON.stringify(list)).catch(fail))
  // Umbenennen und Entfernen gelten auch für die Punkte, in denen die Person zuständig ist
  function renamePerson(old, name) {
    name = name.trim()
    if (!name || name === old) return
    savePeople(people.filter((p) => p.name !== old && p.name.toLowerCase() !== name.toLowerCase()).concat({ ...people.find((p) => p.name === old), name }))
    for (const r of allRows) if (personsOf(r.props?.person).includes(old)) save(r.id, { props: { ...r.props, person: personsOf(r.props.person).map((p) => (p === old ? name : p)) } })
  }
  function removePerson(name) {
    savePeople(people.filter((p) => p.name !== name))
    for (const r of allRows) {
      const rest = personsOf(r.props?.person).filter((p) => p !== name)
      if (rest.length !== personsOf(r.props?.person).length) save(r.id, { props: { ...r.props, person: rest.length ? rest : null } })
    }
  }
  // Heute, Eingang, Kalender, Suche, Tagebuch, Statistik zeigen nur den aktiven Bereich; Erinnerungen kommen aus beiden
  const inArea = (n) => tree.areaOf(n.id) === area
  const areaAlive = areaTree.alive
  const liveRows = allRows.filter(inArea)
  const inboxRows = tree.rows(null).filter(inArea)
  const shownEvents = area === 'arbeit' ? events : [] // Outlook ist der Arbeitskalender
  const databases = [...areaAlive.values()]
    .filter((n) => n.kind === 'database')
    .map((d) => ({ ...d, title: pathOf(d.id).map((p) => p.title || 'Ohne Titel').join(' / ') }))
  live.current = { rows: allRows, dbOf, work: allRows.filter((r) => tree.areaOf(r.id) !== 'privat') }
  // Seitenlinks brauchen den aktuellen Titel auch beim Speichern als Markdown
  const byId = new Map(nodes.map((n) => [n.id, n]))
  setLinkData({ get: (id) => byId.get(id), list: () => [...tree.alive.values()] })
  const app = {
    alive: tree.alive,
    databases,
    open: actions.open,
    notice: setNotice,
    people,
    savePeople,
    renamePerson,
    removePerson,
    pinPage: windowPage ? null : actions.pinPage,
    profile,
    saveProfile: (p) => (setProfile(p), db.setSetting('profil', JSON.stringify(p)).catch(fail)),
    isPinned: actions.isPinned,
    unlockVault,
    vaultCopy,
    lockVault,
    vaultOpen,
    rowsOf: tree.rows,
    addRow,
    toggleRow,
    rowsFromChecklist,
    exportAll: () => exportTree(tree.roots.map((n) => n.id), true),
    templates: [...tree.alive.values()].filter((n) => n.template),
  }
  const commands = [
    { label: 'Heute', run: () => actions.open('today') },
    { label: 'Eingang', run: () => actions.open('inbox') },
    { label: 'Kalender', run: () => actions.open('calendar') },
    { label: 'Snippets', run: () => actions.open('snippets') },
    { label: 'Tagebuch', run: () => actions.open('journal') },
    { label: 'Statistik', run: () => actions.open('stats') },
    { label: 'Schnellerfassung', run: () => invoke('toggle_capture') },
    { label: 'Fokus-Modus (Strg+Umschalt+F)', run: () => setFocusMode((f) => !f) },
    { label: 'Neues Notizbuch', run: () => actions.add('notebook', null) },
    { label: 'Nexora-Datei importieren …', run: () => actions.importNexora() },
    { label: 'Einstellungen', run: () => actions.open('settings') },
    { label: 'Papierkorb', run: () => actions.open('trash') },
    { label: 'Darstellung: Hell', run: () => setLook({ mode: 'light' }) },
    { label: 'Darstellung: Dunkel', run: () => setLook({ mode: 'dark' }) },
    { label: 'Darstellung: Wie Windows', run: () => setLook({ mode: 'system' }) },
    { label: 'Seitenleiste ein-/ausklappen (Strg+Umschalt+L)', run: () => setLook({ sidebarHidden: !look.sidebarHidden }) },
    { label: 'Aussehen anpassen', run: () => (setSettingsTab('aussehen'), actions.open('settings')) },
  ]
  const t = today()
  const counts = {
    inbox: inboxRows.filter((r) => !isDone(r, fieldsOf(null))).length,
    today: liveRows.filter((r) => !isDone(r, fieldsOf(dbOf(r))) && [r.props?.due, r.props?.followup].some((d) => d && dayOf(d) <= t)).length,
  }

  // Drucken: Seite, auf Wunsch mit allen Unterseiten (Tiefe zuerst, wie in der Seitenleiste)
  const subpages = (id) => tree.children(id).filter((n) => n.kind === 'page').flatMap((n) => [n, ...subpages(n.id)])
  function printPage(page, withKids) {
    const kids = page.kind === 'page' ? subpages(page.id) : []
    if (withKids === undefined && kids.length) return setPrinting({ ask: page, count: kids.length })
    const list = [page, ...(withKids ? kids : [])]
    setPrinting({ pages: list.map((n) => ({ node: n, path: n.kind !== 'row' ? pathOf(n.id).slice(0, -1) : dbOf(n) ? pathOf(dbOf(n).id) : [{ id: 'inbox', title: 'Eingang' }], fields: n.kind === 'row' ? fieldsOf(dbOf(n)) : null, list: dbOf(n) })) })
  }

  let view
  if (current === 'trash') {
    view = (
      <TrashView
        items={trashed}
        onRestore={(id) => {
          // gelöschte Eltern mit zurückholen, sonst bliebe die Seite unsichtbar
          const byId = new Map(nodes.map((n) => [n.id, n]))
          for (let n = byId.get(id); n; n = byId.get(n.parent_id)) {
            if (n.deleted_at) save(n.id, { deleted_at: null })
          }
        }}
        onPurge={(id) => {
          setNodes((ns) => ns.filter((n) => n.id !== id && !isBelow(ns, n, id)))
          db.purge(id).catch(fail)
        }}
      />
    )
  } else if (current === 'settings') {
    view = (
      <Settings
        hotkeys={hotkeys}
        hotkeyBusy={hotkeyBusy}
        onHotkey={changeHotkey}
        backup={backup}
        onBackupNow={() => doBackup(true)}
        updates={updates}
        windowMode={windowMode}
        outlook={outlook}
        onOutlook={setOutlookOption}
        onOutlookSync={outlookSync}
        onWindowMode={(m) => (setWindowMode(m), db.setSetting('window-mode', m).catch(fail))}
        tab={settingsTab}
        onTab={setSettingsTab}
      />
    )
  } else if (current === 'calendar') {
    view = (
      <div className="h-full overflow-y-auto px-6 pb-24 pt-14 md:px-12">
        <h1 className="mb-6 flex items-center gap-3 text-[32px] font-semibold leading-tight tracking-tight">
          <CalendarBlank size={28} className="text-accent" /> Kalender
        </h1>
        <CalendarView rows={liveRows} dbOf={dbOf} events={shownEvents} field="due" hideDone onOpen={actions.open} onRow={save} onAdd={(title, props) => addRow(null, title, props)} />
      </div>
    )
  } else if (current === 'journal') {
    view = (
      <Journal
        alive={areaAlive}
        rows={liveRows}
        dbOf={dbOf}
        area={area}
        areaOf={tree.areaOf}
        sections={[...areaAlive.values()].filter((n) => n.kind === 'section').map((s) => ({ id: s.id, title: pathOf(s.id).map((p) => p.title || 'Ohne Titel').join(' / ') }))}
        onOpen={actions.open}
        onSavePage={savePage}
      />
    )
  } else if (current === 'stats') {
    view = <Stats rows={liveRows} dbOf={dbOf} lists={databases} />
  } else if (current === 'snippets') {
    view = <Snippets alive={areaAlive} pathOf={pathOf} onOpen={actions.open} />
  } else if (current === 'today') {
    view = <Today rows={liveRows} dbOf={dbOf} events={shownEvents} onOpen={actions.open} onToggle={toggleRow} onFollowUp={followUp} />
  } else if (current === 'inbox') {
    view = (
      <Inbox
        rows={inboxRows}
        databases={databases}
        onOpen={actions.open}
        onToggle={toggleRow}
        onAdd={(title, props) => addRow(null, title, props)}
        onAssign={assign}
        hotkey={hotkeyLabel(hotkeys.capture)}
      />
    )
  } else if (windowPage && !node) {
    view = (
      <div className="grid h-full place-items-center text-center text-muted">
        <div>
          <p className="mb-3">Diese Seite liegt im Papierkorb oder wurde gelöscht.</p>
          <button onClick={() => getCurrentWindow().close()} className="rounded-md border border-line px-3 py-1.5 hover:bg-hover hover:text-text">Fenster schließen</button>
        </div>
      </div>
    )
  } else if (!windowPage && windows.has(node?.id)) {
    // Dieselbe Seite nie an zwei Stellen bearbeiten, sonst überschreibt ein Fenster das andere
    view = (
      <div className="grid h-full place-items-center px-6 text-center">
        <div className="anim-pop max-w-sm">
          <AppWindow size={32} className="mx-auto mb-3 text-faint" />
          <p className="mb-4 text-muted">„{node.title || 'Ohne Titel'}“ ist in einem eigenen Fenster geöffnet.</p>
          <div className="flex justify-center gap-2">
            <button onClick={() => openPageWindow(node.id)} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-bg">Fenster zeigen</button>
            <button onClick={() => closeWindow(node.id)} className="rounded-md border border-line px-3 py-1.5 text-muted hover:bg-hover hover:text-text">Hierher holen</button>
          </div>
        </div>
      </div>
    )
  } else if (node?.kind === 'page' || node?.kind === 'row') {
    const list = node.kind === 'row' ? dbOf(node) : null
    const path = node.kind === 'row' && !list ? [{ id: 'inbox', title: 'Eingang' }, node] : pathOf(node.id)
    view = (
      <Page
        key={node.id}
        node={node}
        path={path}
        autoFocus={fresh === node.id}
        onPatch={patch}
        onSave={save}
        onRemove={actions.remove}
        fields={fieldsOf(list)}
        db={list}
        onAddOption={list && ((fieldId, name) => save(list.id, { config: withTags(list, [name]) }))}
        onFollowUp={followUp}
        onPrint={printPage}
        flushRef={windowPage ? flushRef : undefined}
        onWindow={windowPage ? undefined : () => actions.openWindow(node.id)}
        windowed={
          windowPage && {
            pinned,
            onPin: () => togglePin().catch((e) => setError(String(e))),
            onMain: () => emitTo('main', 'open-page', node.id).then(() => getCurrentWindow().close()).catch(() => {}),
          }
        }
      />
    )
  } else if (node?.kind === 'database') {
    view = (
      <DatabaseView
        key={node.id}
        db={node}
        rows={tree.rows(node.id)}
        onOpen={actions.open}
        onAdd={(title, props) => addRow(node.id, title, props)}
        onRow={save}
        onConfig={(config) => save(node.id, { config })}
        onTitle={(title) => save(node.id, { title })}
        onSave={save}
      />
    )
  } else if (node) {
    view = <Overview node={node} kids={tree.children(node.id)} onOpen={actions.open} onAdd={actions.add} onSave={save} />
  } else {
    view = <div className="grid h-full place-items-center text-muted">Wähle links eine Seite oder lege ein Notizbuch an.</div>
  }

  return (
    <AppContext.Provider value={app}>
    <div className="flex h-full flex-col" data-focus={focusMode || undefined}>
      <TitleBar>
        {windowPage ? (
          <span data-tauri-drag-region className="min-w-0 self-center truncate text-sm text-muted">{windowTitle || 'Ohne Titel'}</span>
        ) : (
          !focusMode && (
            <Tabs
              tabs={tabItems}
              active={tabState.active}
              onSelect={tabActions.select}
              onClose={tabActions.close}
              onPin={tabActions.pin}
              onMove={tabActions.move}
              onCloseOthers={tabActions.closeOthers}
              onCloseRight={tabActions.closeRight}
              onNew={tabActions.add}
              onWindow={tabActions.window}
            />
          )
        )}
        {focusMode && (
          <button onClick={() => setFocusMode(false)} className="my-1.5 ml-2 shrink-0 self-center rounded-md px-2 py-1 text-xs text-faint hover:bg-hover hover:text-text">
            Fokus beenden (Esc)
          </button>
        )}
      </TitleBar>
      <div className="flex min-h-0 flex-1">
      {!windowPage && !focusMode && look.sidebarHidden && <Rail current={current} counts={counts} actions={actions} onSearch={() => setSearching(true)} />}
      {!windowPage && !focusMode && !look.sidebarHidden && <Sidebar
        tree={areaTree}
        area={area}
        favorites={favorites}
        counts={counts}
        current={current}
        expanded={expanded}
        renaming={renaming}
        actions={actions}
        warning={backup.error ? 'Sicherung fehlgeschlagen, Einstellungen öffnen' : hotkeyError}
        onSearch={() => setSearching(true)}
        updates={updates}
        vaultOpen={vaultOpen}
        onLockVault={lockVault}
      />}
      {/* key: jede Seite frisch; das Einblenden macht setCurrent */}
      <main key={current} className="page-main min-w-0 flex-1 bg-bg">{view}</main>
      </div>

      {printing?.ask && <PrintAsk node={printing.ask} count={printing.count} onChoose={(kids) => (kids === null ? setPrinting(null) : printPage(printing.ask, kids))} />}
      {printing?.pages && <Print pages={printing.pages} onDone={(err) => (setPrinting(null), err && setError(err))} />}
      {secretAsk && (
        <SecretDialog
          text={secretAsk.text}
          spans={secretAsk.spans}
          onChoose={(choice) => {
            secretAsk.resolve(choice)
            setSecretAsk(null)
          }}
        />
      )}
      {vaultAsk && (
        <VaultUnlock
          status={vaultAsk.status}
          onDone={(ok) => {
            vaultAsk.resolve(ok)
            setVaultAsk(null)
            if (ok) setVaultOpen(true)
          }}
        />
      )}
      {vaultPick && (
        <VaultPicker
          onDone={(item) => {
            vaultPick.resolve(item)
            setVaultPick(null)
          }}
        />
      )}
      {oneNote && (
        <OneNoteConnect
          connected={new Set(nodes.filter((n) => n.kind === 'notebook' && !n.deleted_at && oneNoteLink(n)?.id).map((n) => oneNoteLink(n).id))}
          busy={oneNote.busy}
          onConnect={actions.oneNoteConnect}
          onClose={() => setOneNote(null)}
        />
      )}
      {news && <News version={news} onClose={() => setNews(null)} />}
      {searching && <Search tree={areaTree} pathOf={pathOf} commands={commands} onOpen={actions.open} onClose={() => setSearching(false)} />}

      {notice && !error && (
        <div role="status" className="anim-toast fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-line bg-raised p-3 shadow-[var(--shadow)]">
          <span className="flex-1">{typeof notice === 'string' ? notice : notice.text}</span>
          {notice.run && (
            <button onClick={() => (setNotice(''), notice.run())} className="shrink-0 rounded-md px-2 py-0.5 font-medium text-accent hover:bg-hover">
              {notice.label}
            </button>
          )}
          <button aria-label="Schließen" onClick={() => setNotice('')} className="text-muted hover:text-text">
            <X size={16} />
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="anim-toast fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-line bg-raised p-3 shadow-[var(--shadow)]">
          <span className="flex-1 text-danger">{error}</span>
          <button aria-label="Schließen" onClick={() => setError('')} className="text-muted hover:text-text">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
    </AppContext.Provider>
  )
}

function isBelow(nodes, n, ancestorId) {
  const byId = new Map(nodes.map((x) => [x.id, x]))
  for (let p = byId.get(n.parent_id); p; p = byId.get(p.parent_id)) if (p.id === ancestorId) return true
  return false
}

// Einmalig eine LOP-Liste mit zwei Beispielpunkten in "Erste Schritte" anlegen
async function seedLop() {
  if (await db.getSetting('seed-lop')) return
  const all = await db.allNodes()
  if (all.some((n) => n.id === SEED_SECTION && !n.deleted_at)) {
    const config = lopConfig()
    config.nextNr = 3
    const list = await db.create('database', SEED_SECTION, 'Offene Punkte', { config })
    await db.create('row', list.id, 'Schnellerfassung ausprobieren (Tasten unter Einstellungen)', { props: { nr: 1, status: 'offen', prio: 'hoch', due: today() } })
    await db.create('row', list.id, 'Eigene Felder unter „Felder“ anlegen', { props: { nr: 2, status: 'offen', prio: 'niedrig' } })
  }
  await db.setSetting('seed-lop', '1')
}
