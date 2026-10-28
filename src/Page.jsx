import { useCallback, useEffect, useRef, useState } from 'react'
import { Star, Trash, WarningCircle } from '@phosphor-icons/react'
import * as db from './db.js'
import Editor from './Editor.jsx'
import { IconButton } from './Sidebar.jsx'
import { PropsPanel } from './Props.jsx'

export default function Page({ node, path, autoFocus, onPatch, onSave, onRemove, fields, db: parentDb, onAddOption }) {
  const [body, setBody] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [title, setTitle] = useState(node.title)
  const [status, setStatus] = useState('saved')
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

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 flex h-12 items-center gap-3 bg-bg/90 px-5 backdrop-blur">
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
        <IconButton label="In den Papierkorb" onClick={() => (flush(), onRemove(node.id))}>
          <Trash size={16} />
        </IconButton>
      </header>

      <article className="mx-auto max-w-[760px] px-6 pt-10 md:px-12">
        <input
          autoFocus={autoFocus}
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
          className="mb-6 w-full bg-transparent text-[32px] font-semibold leading-tight tracking-tight outline-none placeholder:text-faint"
        />
        {node.kind === 'row' && (
          <PropsPanel fields={fields} row={node} db={parentDb} onProps={(props) => onSave(node.id, { props })} onAddOption={onAddOption} />
        )}
        {loadError ? (
          <p className="text-danger">Die Seite konnte nicht geladen werden.</p>
        ) : body === null ? (
          <div aria-hidden className="space-y-3">
            <div className="h-4 w-3/4 rounded bg-hover" />
            <div className="h-4 w-1/2 rounded bg-hover" />
            <div className="h-4 w-2/3 rounded bg-hover" />
          </div>
        ) : (
          <Editor markdown={body} onChange={(md) => queue({ body: md })} onReady={onReady} />
        )}
      </article>
    </div>
  )
}
