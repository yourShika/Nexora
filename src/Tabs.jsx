import { useState } from 'react'
import { PushPin, X } from '@phosphor-icons/react'
import { NodeIcon } from './Sidebar.jsx'

// Angepinnte Seiten als Reiter in der Titelleiste; ziehen ordnet um, Mittelklick oder X löst den Reiter.
// Ist die offene Seite nicht angepinnt, steht sie blass dahinter und lässt sich mit der Nadel anpinnen
export default function Tabs({ nodes, current, loose, onOpen, onClose, onMove, onPin }) {
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState(null) // { id, side: 'before' | 'after' }
  const sideOf = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientX - r.left < r.width / 2 ? 'before' : 'after'
  }
  const tab = 'group relative flex w-52 min-w-14 shrink items-center self-end rounded-t-lg'
  return (
    <nav aria-label="Angepinnte Seiten" data-tauri-drag-region className="flex min-w-0 items-stretch gap-0.5 pt-1.5">
      {nodes.map((n) => {
        const active = n.id === current
        const mark = over?.id !== n.id ? '' : over.side === 'before' ? 'shadow-[inset_2px_0_0_var(--accent)]' : 'shadow-[inset_-2px_0_0_var(--accent)]'
        return (
          <div
            key={n.id}
            draggable
            onDragStart={(e) => (setDrag(n.id), (e.dataTransfer.effectAllowed = 'move'), e.dataTransfer.setData('application/x-nexora-tab', n.id))}
            onDragEnd={() => (setDrag(null), setOver(null))}
            onDragOver={(e) => {
              if (!drag || drag === n.id) return
              e.preventDefault()
              const side = sideOf(e)
              if (over?.id !== n.id || over.side !== side) setOver({ id: n.id, side })
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (drag && drag !== n.id) onMove(drag, n.id, sideOf(e))
              setDrag(null)
              setOver(null)
            }}
            onAuxClick={(e) => e.button === 1 && onClose(n.id)}
            className={`${tab} ${active ? 'bg-bg text-text' : 'text-muted hover:bg-hover hover:text-text'} ${mark}`}
          >
            <button onClick={() => onOpen(n.id)} aria-current={active ? 'page' : undefined} className="flex h-8 min-w-0 flex-1 items-center gap-1.5 pl-3 pr-1 text-sm">
              <NodeIcon node={n} size={14} />
              <span className="truncate">{n.title || 'Ohne Titel'}</span>
            </button>
            <button
              aria-label={`Reiter „${n.title || 'Ohne Titel'}“ lösen`}
              onClick={() => onClose(n.id)}
              className={`mr-1.5 shrink-0 rounded p-0.5 text-faint hover:bg-hover hover:text-text ${active ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
      {loose && (
        <div className={`${tab} bg-bg text-muted`}>
          <span className="flex h-8 min-w-0 flex-1 items-center gap-1.5 pl-3 pr-1 text-sm italic">
            <NodeIcon node={loose} size={14} />
            <span className="truncate">{loose.title || 'Ohne Titel'}</span>
          </span>
          <button aria-label="Als Reiter anpinnen" title="Als Reiter anpinnen" onClick={() => onPin(loose.id)} className="mr-1.5 shrink-0 rounded p-0.5 text-faint hover:bg-hover hover:text-text">
            <PushPin size={12} />
          </button>
        </div>
      )}
    </nav>
  )
}
