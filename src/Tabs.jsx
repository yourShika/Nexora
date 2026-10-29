import { useState } from 'react'
import { X } from '@phosphor-icons/react'
import { NodeIcon } from './Sidebar.jsx'

// Angepinnte Seiten als Reiter über dem Inhalt; ziehen ordnet um, Mittelklick oder X löst den Reiter
export default function Tabs({ nodes, current, onOpen, onClose, onMove }) {
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState(null) // { id, side: 'before' | 'after' }
  const sideOf = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientX - r.left < r.width / 2 ? 'before' : 'after'
  }
  return (
    <nav aria-label="Angepinnte Seiten" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-bg px-2 py-1">
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
            className={`group flex max-w-52 shrink-0 items-center rounded-md ${active ? 'bg-accent-soft text-text' : 'text-muted hover:bg-hover hover:text-text'} ${mark}`}
          >
            <button onClick={() => onOpen(n.id)} aria-current={active ? 'page' : undefined} className="flex min-w-0 items-center gap-1.5 py-1 pl-2.5 pr-1 text-sm">
              <NodeIcon node={n} size={14} />
              <span className="truncate">{n.title || 'Ohne Titel'}</span>
            </button>
            <button
              aria-label={`Reiter „${n.title || 'Ohne Titel'}“ lösen`}
              onClick={() => onClose(n.id)}
              className={`mr-1 rounded p-0.5 text-faint hover:bg-hover hover:text-text ${active ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </nav>
  )
}
