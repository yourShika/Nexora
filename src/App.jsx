import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { enable as enableAutostart } from '@tauri-apps/plugin-autostart'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { X } from '@phosphor-icons/react'
import * as db from './db.js'
import Sidebar from './Sidebar.jsx'
import Page from './Page.jsx'
import DatabaseView from './Database.jsx'
import { Overview, TrashView } from './Overview.jsx'
import { Inbox, Today } from './Rows.jsx'
import Snippets from './Snippets.jsx'
import Settings from './Settings.jsx'
import Search from './Search.jsx'
import { DEFAULT_HOTKEY, bindHotkey, hotkeyLabel } from './hotkey.js'
import { checkReminders } from './notify.js'
import { initImages } from './images.js'
import { loadBackupSettings, maybeBackup, runBackup } from './backup.js'
import { findUpdate, installUpdate } from './updates.js'
import { applyTheme } from './theme.js'
import { dayOf, describe, emptyConfig, fieldsOf, isDone, lopConfig, statusField, today, toggleDone } from './fields.js'
import { parseQuick } from './quick.js'
import { setLinkData } from './Links.jsx'
import { AppContext } from './ctx.js'

const DEFAULT_TITLE = { notebook: 'Neues Notizbuch', section: 'Neuer Abschnitt', page: '', database: 'Neue Liste', row: '' }
// Wohin etwas im Baum darf (null = oberste Ebene)
const PARENTS = { notebook: [null], section: ['notebook'], page: ['section', 'page'], database: ['section', 'page'] }
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
  const walk = (parent) => (byParent.get(parent) ?? []).forEach((n) => (alive.set(n.id, n), walk(n.id)))
  walk(null)
  const kids = (id) => (byParent.get(id) ?? []).filter((n) => n.kind !== 'row')
  return { alive, roots: kids(null), children: kids, rows: (id) => (byParent.get(id) ?? []).filter((n) => n.kind === 'row') }
}

export default function App() {
  const [nodes, setNodes] = useState(null)
  const [current, setCurrent] = useState(null)
  const [fresh, setFresh] = useState(null)
  const [renaming, setRenaming] = useState(null)
  const [expanded, setExpanded] = useState(loadExpanded)
  const [error, setError] = useState('')
  const [hotkey, setHotkey] = useState(DEFAULT_HOTKEY)
  const [hotkeyError, setHotkeyError] = useState('')
  const [searching, setSearching] = useState(false)
  const [backup, setBackup] = useState({ busy: false, error: '', dest: '' })
  const [update, setUpdate] = useState({ found: null, busy: false, error: '' })
  const live = useRef(null)

  // Im fertigen Programm kurz nach dem Start und dann alle 6 Stunden nach Updates sehen; Fehler (offline) still
  useEffect(() => {
    if (!import.meta.env.PROD) return
    const look = () => findUpdate().then((found) => found && setUpdate((u) => ({ ...u, found }))).catch(() => {})
    const first = setTimeout(look, 10_000)
    const timer = setInterval(look, 6 * 3600e3)
    return () => (clearTimeout(first), clearInterval(timer))
  }, [])

  const updates = {
    ...update,
    async check() {
      setUpdate((u) => ({ ...u, busy: true, error: '' }))
      try {
        const found = await findUpdate()
        setUpdate({ found, busy: false, error: '', checked: true })
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

  // Strg+K öffnet die Suche, auch mitten im Editor
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearching((s) => !s)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  // Erinnerungen prüfen: gleich nach dem Laden, dann alle 30 s (live hält den aktuellen Stand)
  const loaded = nodes !== null
  useEffect(() => {
    if (!loaded) return
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
    if (!import.meta.env.PROD) return
    db.getSetting('autostart-init')
      .then((done) => !done && enableAutostart().then(() => db.setSetting('autostart-init', '1')))
      .catch(() => {})
  }, [])

  // Gespeicherte Tastenkombination binden; belegt ein anderes Programm sie, Hinweis statt Absturz
  useEffect(() => {
    db.getSetting('hotkey')
      .catch(() => null)
      .then(async (saved) => {
        const accel = saved || DEFAULT_HOTKEY
        setHotkey(accel)
        try {
          await bindHotkey(accel)
        } catch {
          setHotkeyError(`${hotkeyLabel(accel)} ist belegt. Andere Tasten wählen`)
        }
      })
  }, [])
  const fail = (e) => setError(`Speichern fehlgeschlagen: ${e}`)
  const reload = useCallback(() => db.allNodes().then(setNodes).catch((e) => setError(`Datenbank nicht erreichbar: ${e}`)), [])

  useEffect(() => {
    initImages()
      .then(db.purgeOld)
      .catch(() => {})
      .then(seedLop)
      .then(db.allNodes)
      .then((all) => {
        setNodes(all)
        const pages = all.filter((n) => n.kind === 'page' && !n.deleted_at)
        const last = all.filter((n) => n.opened_at && !n.deleted_at).sort((a, b) => b.opened_at.localeCompare(a.opened_at))[0]
        const start = last ?? pages[0]
        setCurrent(start?.id ?? 'today')
        // Eltern der Startseite aufklappen, damit sie im Baum sichtbar ist
        const byId = new Map(all.map((n) => [n.id, n]))
        const up = []
        for (let n = byId.get(start?.parent_id); n; n = byId.get(n.parent_id)) up.push(n.id)
        setExpanded((s) => new Set([...s, ...up]))
      })
      .catch((e) => setError(`Datenbank nicht erreichbar: ${e}`))
    // Schnellerfassung speichert im anderen Fenster und meldet sich
    const off = listen('nodes-changed', reload)
    return () => {
      off.then((f) => f())
    }
  }, [reload])

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

  function save(id, fields) {
    const node = tree.alive.get(id)
    if (node?.kind === 'row' && fields.props) logChanges(node, fields.props)
    patch(id, { ...fields, updated_at: new Date().toISOString() })
    db.update(id, fields).catch(fail)
  }

  // Verlauf je Punkt: jede geänderte Eigenschaft als "Status: Offen → Wartet"
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
      const node = await db.create('row', parentId, title, { props: full })
      setNodes((ns) => [...ns, node])
      if (open) actions.open(node.id), setFresh(node.id)
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
      setExpanded((s) => new Set([...s, parentId]))
      setCurrent(node.id)
    } catch (e) {
      fail(e)
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
    canMove: (id, targetId, zone) => !!placement(id, targetId, zone),
    move(id, targetId, zone) {
      const to = placement(id, targetId, zone)
      if (!to) return
      save(id, to)
      if (to.parent_id) setExpanded((s) => new Set([...s, to.parent_id]))
    },
    open(id) {
      setCurrent(id)
      setFresh(null)
      if (!['trash', 'today', 'inbox', 'settings', 'snippets'].includes(id)) {
        db.touch(id).catch(() => {})
        const node = tree.alive.get(id)
        setExpanded((s) => new Set([...s, ...pathOf(id).slice(0, -1).map((n) => n.id), ...(['notebook', 'section'].includes(node?.kind) ? [id] : [])]))
      }
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
        const node = await db.create(kind, parentId, title, { config })
        setNodes((ns) => [...ns, node])
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
    rename(id, title) {
      setRenaming(null)
      const node = tree.alive.get(id)
      if (node && title !== node.title) save(id, { title: title.trim() || node.title })
    },
    save,
    remove(id) {
      patch(id, { deleted_at: new Date().toISOString() })
      db.trash(id).catch(fail)
      if (current && pathOf(current).some((n) => n.id === id)) setCurrent(tree.alive.get(id)?.parent_id ?? 'today')
    },
  }

  const toggleRow = (row) => save(row.id, { props: toggleDone(row, fieldsOf(dbOf(row))) })

  function assign(row, list) {
    save(row.id, { parent_id: list.id, props: numbered(list, row.props ?? {}) })
    db.addActivity(row.id, 'change', `Zugeteilt: ${list.title || 'Ohne Titel'}`).catch(() => {})
  }

  if (nodes === null) {
    return <div className="grid h-full place-items-center text-muted">{error || 'Lädt …'}</div>
  }

  const node = tree.alive.get(current)
  const favorites = nodes.filter((n) => n.favorite && tree.alive.has(n.id))
  const trashed = nodes.filter((n) => n.deleted_at)
  const liveRows = [...tree.alive.values()].filter((n) => n.kind === 'row')
  const inboxRows = tree.rows(null)
  const databases = [...tree.alive.values()]
    .filter((n) => n.kind === 'database')
    .map((d) => ({ ...d, title: pathOf(d.id).map((p) => p.title || 'Ohne Titel').join(' / ') }))
  live.current = { rows: liveRows, dbOf }
  // Seitenlinks brauchen den aktuellen Titel auch beim Speichern als Markdown
  const byId = new Map(nodes.map((n) => [n.id, n]))
  setLinkData({ get: (id) => byId.get(id), list: () => [...tree.alive.values()] })
  const app = {
    alive: tree.alive,
    databases,
    open: actions.open,
    rowsOf: tree.rows,
    addRow,
    toggleRow,
    rowsFromChecklist,
    templates: [...tree.alive.values()].filter((n) => n.template),
  }
  const commands = [
    { label: 'Heute', run: () => actions.open('today') },
    { label: 'Eingang', run: () => actions.open('inbox') },
    { label: 'Snippets', run: () => actions.open('snippets') },
    { label: 'Schnellerfassung', run: () => invoke('toggle_capture') },
    { label: 'Neues Notizbuch', run: () => actions.add('notebook', null) },
    { label: 'Einstellungen', run: () => actions.open('settings') },
    { label: 'Papierkorb', run: () => actions.open('trash') },
    { label: 'Darstellung: Hell', run: () => applyTheme('light') },
    { label: 'Darstellung: Dunkel', run: () => applyTheme('dark') },
    { label: 'Darstellung: Wie Windows', run: () => applyTheme('system') },
  ]
  const t = today()
  const counts = {
    inbox: inboxRows.filter((r) => !isDone(r, fieldsOf(null))).length,
    today: liveRows.filter((r) => !isDone(r, fieldsOf(dbOf(r))) && [r.props?.due, r.props?.followup].some((d) => d && dayOf(d) <= t)).length,
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
            if (!n.deleted_at) continue
            patch(n.id, { deleted_at: null })
            db.restore(n.id).catch(fail)
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
        hotkey={hotkey}
        hotkeyError={hotkeyError}
        onHotkey={(accel, err) => (setHotkey(accel), setHotkeyError(err))}
        backup={backup}
        onBackupNow={() => doBackup(true)}
        updates={updates}
      />
    )
  } else if (current === 'snippets') {
    view = <Snippets alive={tree.alive} pathOf={pathOf} onOpen={actions.open} />
  } else if (current === 'today') {
    view = <Today rows={liveRows} dbOf={dbOf} onOpen={actions.open} onToggle={toggleRow} />
  } else if (current === 'inbox') {
    view = (
      <Inbox
        rows={inboxRows}
        databases={databases}
        onOpen={actions.open}
        onToggle={toggleRow}
        onAdd={(title, props) => addRow(null, title, props)}
        onAssign={assign}
        hotkey={hotkeyLabel(hotkey)}
      />
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
    <div className="flex h-full">
      <Sidebar
        tree={tree}
        favorites={favorites}
        counts={counts}
        current={current}
        expanded={expanded}
        renaming={renaming}
        actions={actions}
        warning={backup.error ? 'Sicherung fehlgeschlagen, Einstellungen öffnen' : hotkeyError}
        onSearch={() => setSearching(true)}
        updates={updates}
      />
      {/* key: bei jedem Seitenwechsel neu einblenden */}
      <main key={current} className="anim-page min-w-0 flex-1">{view}</main>

      {searching && <Search tree={tree} pathOf={pathOf} commands={commands} onOpen={actions.open} onClose={() => setSearching(false)} />}

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
