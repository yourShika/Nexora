import { useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise, Plus, Trash } from '@phosphor-icons/react'
import { NodeIcon } from './Sidebar.jsx'

const KIND = { notebook: 'Notizbuch', section: 'Abschnitt', page: 'Seite', database: 'Liste', row: 'Punkt' }

// Notizbuch oder Abschnitt: zeigt den Inhalt und lädt zum Anlegen ein
export function Overview({ node, kids, onOpen, onAdd }) {
  const childKind = node.kind === 'notebook' ? 'section' : 'page'
  const label = childKind === 'section' ? 'Neuer Abschnitt' : 'Neue Seite'
  return (
    <div className="mx-auto max-w-[760px] px-6 pt-16 md:px-12">
      <div className="mb-8 flex items-center gap-3">
        <NodeIcon node={node} size={26} />
        <h1 className="text-[32px] font-semibold leading-tight tracking-tight">{node.title || 'Ohne Titel'}</h1>
      </div>
      {kids.length ? (
        <ul className="mb-4 divide-y divide-line border-y border-line">
          {kids.map((k) => (
            <li key={k.id}>
              <button onClick={() => onOpen(k.id)} className="flex w-full items-center gap-3 px-2 py-2.5 text-left hover:bg-hover">
                <NodeIcon node={k} />
                <span className="flex-1 truncate">{k.title || 'Ohne Titel'}</span>
                <span className="text-xs text-faint">{new Date(k.updated_at).toLocaleDateString('de-DE')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-muted">
          {node.kind === 'notebook' ? 'Noch keine Abschnitte. Ein Abschnitt fasst Seiten zu einem Thema zusammen.' : 'Noch keine Seiten in diesem Abschnitt.'}
        </p>
      )}
      <button
        onClick={() => onAdd(childKind, node.id)}
        className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 font-medium text-white active:translate-y-px dark:text-bg"
      >
        <Plus size={16} weight="bold" /> {label}
      </button>
    </div>
  )
}

export function TrashView({ items, onRestore, onPurge }) {
  return (
    <div className="mx-auto max-w-[760px] px-6 pt-16 md:px-12">
      <h1 className="mb-2 text-[32px] font-semibold leading-tight tracking-tight">Papierkorb</h1>
      <p className="mb-8 text-muted">Gelöschtes bleibt 30 Tage hier, danach wird es endgültig entfernt.</p>
      {items.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {items.map((n) => (
            <li key={n.id} className="flex items-center gap-3 px-2 py-2.5">
              <NodeIcon node={n} />
              <span className="min-w-0 flex-1 truncate">{n.title || 'Ohne Titel'}</span>
              <span className="text-xs text-faint">{KIND[n.kind]}, gelöscht am {new Date(n.deleted_at).toLocaleDateString('de-DE')}</span>
              <button onClick={() => onRestore(n.id)} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-text">
                <ArrowCounterClockwise size={15} /> Wiederherstellen
              </button>
              <ConfirmButton onConfirm={() => onPurge(n.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">Der Papierkorb ist leer.</p>
      )}
    </div>
  )
}

// Erster Klick fragt nach, zweiter löscht; nach 3 s zurück. compact: nur Symbol, bis scharf
export function ConfirmButton({ onConfirm, compact }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef()
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      aria-label={armed ? 'Wirklich löschen?' : 'Löschen'}
      onClick={() => {
        if (armed) return onConfirm()
        setArmed(true)
        timer.current = setTimeout(() => setArmed(false), 3000)
      }}
      className={`flex shrink-0 items-center gap-1.5 rounded-md ${compact ? 'p-1 text-xs' : 'px-2 py-1'} ${armed ? 'bg-danger text-white' : 'text-muted hover:bg-hover hover:text-danger'}`}
    >
      <Trash size={compact ? 13 : 15} /> {armed ? 'Wirklich löschen?' : compact ? '' : 'Endgültig löschen'}
    </button>
  )
}
