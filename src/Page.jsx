import { useCallback, useEffect, useRef, useState } from 'react'
import { AppWindow, Article, Printer, ArrowBendDownRight, ArrowSquareIn, ClockCounterClockwise, DotsThree, FrameCorners, ListChecks, LockSimple, LockSimpleOpen, PushPin, Stamp, EnvelopeSimple, Star, Trash, WarningCircle } from '@phosphor-icons/react'
import Menu, { MenuItem } from './Menu.jsx'
import { NodeIcon } from './Sidebar.jsx'
import { useApp } from './ctx.js'
import { taskCount, today } from './fields.js'
import { Cover, IconRow } from './PageHead.jsx'
import History from './History.jsx'
import * as db from './db.js'
import Editor from './Editor.jsx'
import FreeCanvas from './FreeCanvas.jsx'
import { hasInk, isFree, toFlow, toFree } from './free.js'
import { IconButton } from './Sidebar.jsx'
import { PropsPanel } from './Props.jsx'

export default function Page({ node, path, autoFocus, onPatch, onSave, onRemove, fields, db: parentDb, onAddOption, flushRef, onWindow, windowed, onFollowUp, onPrint }) {
  const [body, setBody] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [title, setTitle] = useState(node.title)
  const [status, setStatus] = useState('saved')
  const [history, setHistory] = useState(false)
  const [latest, setLatest] = useState(null)
  const [reload, setReload] = useState(0)
  const [menu, setMenu] = useState(null)
  const app = useApp()
  const [checklist, setChecklist] = useState(false)
  const pending = useRef({})
  const timer = useRef()
  const editor = useRef(null)

  // Schreibt gesammelte Änderungen; bei Fehler bleiben sie für den nächsten Versuch liegen
  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const fields = pending.current
    if (!Object.keys(fields).length) return
    pending.current = {}
    try {
      await db.update(node.id, fields)
      if (!Object.keys(pending.current).length) setStatus('saved')
      if ('body' in fields || 'title' in fields) db.journal('bearbeitet', node.id, fields.title ?? node.title).catch(() => {})
    } catch {
      pending.current = { ...fields, ...pending.current }
      setStatus('error')
    }
  }, [node.id])

  const queue = useCallback((fields) => {
    Object.assign(pending.current, fields)
    setStatus('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, 400)
  }, [flush])

  useEffect(() => {
    let alive = true
    db.loadBody(node.id).then((b) => alive && setBody(b), () => alive && setLoadError(true))
    db.touch(node.id).catch(() => {})
    addEventListener('blur', flush)
    return () => {
      alive = false
      removeEventListener('blur', flush)
      flush()
    }
  }, [node.id, flush])

  const onReady = useCallback((e) => (editor.current = e), [])
  // Seitenfenster speichert vor dem Schließen
  if (flushRef) flushRef.current = flush

  // Inhalt ersetzen (alte Fassung, Umwandeln): jetzigen Stand vorher sichern, dann Editor neu aufbauen
  async function replace(next) {
    try {
      await flush()
      await db.snapshot(node.id)
      await db.update(node.id, { body: next })
      setBody(next)
      setLatest(next)
      setReload((k) => k + 1)
      return true
    } catch {
      setStatus('error')
    }
  }
  const free = isFree(body)

  // Fortschritt der Checkliste gleich in Listen und Kanban zeigen (nur bei Änderung)
  function patchTasks(md) {
    const t = taskCount(md)
    if (JSON.stringify(t) !== JSON.stringify(node.tasks ?? null)) onPatch(node.id, { tasks: t })
  }

  return (
    <div className="flex h-full">
    <div className={`h-full min-w-0 flex-1 ${free ? 'overflow-auto' : 'overflow-y-auto'}`}>
      <header className="page-head sticky left-0 top-0 z-10 flex h-12 items-center gap-3 bg-bg/90 px-5 backdrop-blur">
        <nav aria-label="Pfad" className="flex min-w-0 flex-1 items-center gap-1.5 text-muted">
          {path.map((p, i) => (
            <span key={p.id} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <span className="text-faint">/</span>}
              <span className="truncate">{p.title || 'Ohne Titel'}</span>
            </span>
          ))}
        </nav>
        {status === 'error' ? (
          <button onClick={flush} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-danger hover:bg-hover">
            <WarningCircle size={16} /> Nicht gespeichert, erneut versuchen
          </button>
        ) : (
          <span className="text-xs text-faint" aria-live="polite">{status === 'saving' ? 'Speichert …' : 'Gespeichert'}</span>
        )}
        <IconButton label={node.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten'} onClick={() => onSave(node.id, { favorite: node.favorite ? 0 : 1 })}>
          <Star size={16} weight={node.favorite ? 'fill' : 'regular'} className={node.favorite ? 'text-accent' : ''} />
        </IconButton>
        {node.locked ? <LockSimple size={16} weight="fill" className="text-accent" aria-label="Gesperrt" /> : null}
        {node.template ? <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">Vorlage</span> : null}
        {windowed && (
          <IconButton label={windowed.pinned ? 'Nicht mehr im Vordergrund' : 'Immer im Vordergrund'} onClick={windowed.onPin}>
            <PushPin size={16} weight={windowed.pinned ? 'fill' : 'regular'} className={windowed.pinned ? 'text-accent' : ''} />
          </IconButton>
        )}
        <IconButton label="Verlauf" onClick={() => (flush(), setHistory(!history))}>
          <ClockCounterClockwise size={16} className={history ? 'text-accent' : ''} />
        </IconButton>
        <IconButton label="Mehr" onClick={(e) => setMenu({ x: e.clientX - 200, y: e.clientY + 12 })}>
          <DotsThree size={18} weight="bold" />
        </IconButton>
        {menu && (
          <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
            {node.kind === 'row' && node.props?.status === 'wartet' && onFollowUp && (
              <MenuItem icon={EnvelopeSimple} onClick={() => (setMenu(null), onFollowUp(node))}>Nachhaken (Mail-Entwurf)</MenuItem>
            )}
            {onPrint && (
              <MenuItem icon={Printer} onClick={async () => (setMenu(null), await flush(), onPrint(node))}>Drucken / Als PDF …</MenuItem>
            )}
            {onWindow && <MenuItem icon={AppWindow} onClick={() => (flush(), setMenu(null), onWindow())}>In eigenem Fenster öffnen</MenuItem>}
            {windowed && <MenuItem icon={ArrowSquareIn} onClick={() => (setMenu(null), windowed.onMain())}>Im Hauptfenster öffnen</MenuItem>}
            {app.tabs && (
              <MenuItem icon={PushPin} onClick={() => (setMenu(null), app.toggleTab(node.id))}>{app.tabs.includes(node.id) ? 'Reiter lösen' : 'Als Reiter oben anpinnen'}</MenuItem>
            )}
            <MenuItem icon={node.locked ? LockSimpleOpen : LockSimple} onClick={() => (flush(), setMenu(null), onSave(node.id, { locked: node.locked ? 0 : 1 }))}>
              {node.locked ? 'Seite entsperren' : 'Seite sperren'}
            </MenuItem>
            {node.kind === 'page' && !node.locked && body !== null && (
              <MenuItem icon={free ? Article : FrameCorners} onClick={() => (setMenu(null), replace(free ? toFlow(latest ?? body) : toFree(latest ?? body)))}>
                {free ? `In normale Seite umwandeln${hasInk(latest ?? body) ? ' (Zeichnung entfällt)' : ''}` : 'In freie Seite umwandeln'}
              </MenuItem>
            )}
            {node.kind === 'page' && (
              <MenuItem icon={Stamp} onClick={() => (setMenu(null), onSave(node.id, { template: node.template ? 0 : 1 }))}>
                {node.template ? 'Keine Vorlage mehr' : 'Als Vorlage verwenden'}
              </MenuItem>
            )}
            {/^\s*- \[ \] /m.test(latest ?? body ?? '') && (
              <MenuItem icon={ListChecks} onClick={() => (flush(), setMenu(null), setChecklist(true))}>Checkliste als LOP-Punkte anlegen</MenuItem>
            )}
            <div className="my-1 border-t border-line" />
            <MenuItem icon={Trash} danger onClick={() => (flush(), setMenu(null), onRemove(node.id))}>In den Papierkorb</MenuItem>
          </Menu>
        )}
      </header>

      <Cover node={node} onSave={onSave} />
      <article data-page-id={node.id} className={`${free ? '' : 'mx-auto max-w-[var(--page)]'} px-6 md:px-12 ${node.cover ? 'pt-4' : 'pt-8'}`}>
        <IconRow node={node} onSave={onSave} />
        <input
          autoFocus={autoFocus}
          readOnly={!!node.locked}
          value={title}
          placeholder="Ohne Titel"
          aria-label="Titel"
          onChange={(e) => {
            setTitle(e.target.value)
            onPatch(node.id, { title: e.target.value })
            queue({ title: e.target.value })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
              e.preventDefault()
              editor.current?.commands.focus('start')
            }
          }}
          className="mb-2 w-full bg-transparent text-[32px] font-semibold leading-tight tracking-tight outline-none placeholder:text-faint"
        />
        <Backlinks id={node.id} />
        <div className="mb-4" />
        {checklist && <ChecklistDialog pageId={node.id} onClose={() => setChecklist(false)} />}
        {node.kind === 'row' && (
          <>
            <PropsPanel fields={fields} row={node} db={parentDb} onProps={(props) => onSave(node.id, { props })} onAddOption={onAddOption} />
            <RowActivity row={node} />
          </>
        )}
        {loadError ? (
          <p className="text-danger">Die Seite konnte nicht geladen werden.</p>
        ) : body === null ? (
          <div aria-hidden className="space-y-3">
            <div className="h-4 w-3/4 rounded bg-hover" />
            <div className="h-4 w-1/2 rounded bg-hover" />
            <div className="h-4 w-2/3 rounded bg-hover" />
          </div>
        ) : free ? (
          <FreeCanvas key={reload} body={body} editable={!node.locked} onChange={(md) => (setLatest(md), queue({ body: md }))} />
        ) : (
          <Editor key={reload} markdown={body} editable={!node.locked} onChange={(md) => (setLatest(md), queue({ body: md }), node.kind === 'row' && patchTasks(md))} onReady={onReady} />
        )}
      </article>
    </div>
    {history && <History nodeId={node.id} current={latest ?? body ?? ''} onRestore={(v) => replace(v.body).then((ok) => ok && setHistory(false))} onClose={() => setHistory(false)} />}
    </div>
  )
}

// Seiten, die hierher verlinken (unter dem Titel)
function Backlinks({ id }) {
  const app = useApp()
  const [ids, setIds] = useState([])
  useEffect(() => {
    db.backlinks(id).then(setIds).catch(() => setIds([]))
  }, [id])
  const pages = ids.map((x) => app.alive.get(x)).filter(Boolean)
  if (!pages.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
      <ArrowBendDownRight size={14} />
      {pages.length === 1 ? '1 Verweis:' : `${pages.length} Verweise:`}
      {pages.map((p) => (
        <button key={p.id} onClick={() => app.open(p.id)} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-hover hover:text-text">
          <NodeIcon node={p} size={13} /> {p.title || 'Ohne Titel'}
        </button>
      ))}
    </div>
  )
}

// Verlauf je Punkt: Feldänderungen (automatisch) und Kommentare
function RowActivity({ row }) {
  const [items, setItems] = useState([])
  const [text, setText] = useState('')
  const [all, setAll] = useState(false)
  const load = useCallback(() => db.activity(row.id).then(setItems).catch(() => {}), [row.id])
  useEffect(() => {
    load()
  }, [load, row.updated_at])

  async function comment() {
    if (!text.trim()) return
    await db.addActivity(row.id, 'comment', text.trim())
    setText('')
    load()
  }

  const shown = all ? items : items.slice(0, 5)
  return (
    <section aria-label="Verlauf des Punkts" className="mb-8 border-b border-line pb-5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && comment()}
        placeholder="Kommentar schreiben, Enter speichert"
        aria-label="Kommentar"
        className="mb-3 w-full rounded-md border border-line bg-raised px-3 py-1.5 outline-none placeholder:text-faint focus:border-accent"
      />
      <ul className="space-y-1.5">
        {shown.map((a) => (
          <li key={a.id} className="flex gap-3 text-sm">
            <time className="w-28 shrink-0 text-xs leading-5 text-faint">{new Date(a.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
            <span className={a.kind === 'comment' ? '' : 'text-muted'}>{a.text}</span>
          </li>
        ))}
        <li className="flex gap-3 text-sm">
          <time className="w-28 shrink-0 text-xs leading-5 text-faint">{new Date(row.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
          <span className="text-muted">Angelegt</span>
        </li>
      </ul>
      {items.length > 5 && (
        <button onClick={() => setAll(!all)} className="mt-2 text-xs text-muted hover:text-text">{all ? 'Weniger zeigen' : `Alle ${items.length} Einträge zeigen`}</button>
      )}
    </section>
  )
}

// Offene Checkpunkte dieser Seite als LOP-Punkte anlegen (Kurzsyntax relativ zum Stichtag)
function ChecklistDialog({ pageId, onClose }) {
  const app = useApp()
  const [list, setList] = useState(app.databases[0]?.id ?? '')
  const [day, setDay] = useState(today())
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      setDone(await app.rowsFromChecklist(pageId, list, day))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div role="dialog" aria-label="Checkliste als LOP-Punkte" className="anim-pop mb-6 rounded-lg border border-accent/40 bg-accent-soft/40 p-4">
      {done != null ? (
        <div className="flex items-center gap-3">
          <span className="flex-1">{done} Punkte angelegt.</span>
          <button onClick={() => app.open(list)} className="rounded-md bg-accent px-3 py-1 font-medium text-white dark:text-bg">Liste öffnen</button>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-muted hover:bg-hover">Schließen</button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            Jeder offene Checkpunkt wird ein LOP-Punkt. Kurzsyntax im Punkt gilt ab dem Stichtag: <code>-3</code> = 3 Tage vorher, <code>+2</code> = 2 Tage danach, dazu <code>@Person</code>, <code>#tag</code>, <code>!hoch</code>.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Liste
              <select value={list} onChange={(e) => setList(e.target.value)} className="rounded-md border border-line bg-raised px-2 py-1 text-sm text-text">
                {app.databases.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Stichtag
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="rounded-md border border-line bg-raised px-2 py-1 text-sm text-text" />
            </label>
            <button onClick={run} disabled={!list || !day || busy} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg">
              {busy ? 'Legt an …' : 'Punkte anlegen'}
            </button>
            <button onClick={onClose} className="rounded-md px-2 py-1.5 text-muted hover:bg-hover">Abbrechen</button>
          </div>
          {!app.databases.length && <p className="mt-2 text-sm text-danger">Es gibt noch keine LOP-Liste.</p>}
        </>
      )}
    </div>
  )
}
