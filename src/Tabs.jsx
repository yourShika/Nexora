import { useCallback, useRef, useState } from 'react'
import { AppWindow, BookOpenText, CalendarBlank, ChartBar, Code, GearSix, Lightning, Plus, PushPin, PushPinSlash, Timer, Trash, Tray, X } from '@phosphor-icons/react'
import Menu, { MenuItem } from './Menu.jsx'
import { NodeIcon } from './Sidebar.jsx'

// Feste Ansichten, die ein Reiter zeigen kann; alles andere ist eine Seiten-ID
export const VIEWS = {
  today: ['Heute', Lightning], inbox: ['Eingang', Tray], calendar: ['Kalender', CalendarBlank], journal: ['Tagebuch', BookOpenText],
  stats: ['Statistik', ChartBar], snippets: ['Snippets', Code], jobs: ['Aufgaben', Timer], settings: ['Einstellungen', GearSix], trash: ['Papierkorb', Trash],
}
const titleOf = (t) => (t.node ? t.node.title || 'Ohne Titel' : VIEWS[t.view]?.[0] ?? '…')
function TabIcon({ tab, size = 14 }) {
  if (tab.node) return <NodeIcon node={tab.node} size={size} />
  const Icon = VIEWS[tab.view]?.[1]
  return Icon ? <Icon size={size} className="shrink-0 text-accent" /> : null
}

// Reiter in der Titelleiste wie im Browser (Logik in tabs.js). Angepinnte schmal mit Symbol und ohne X.
// Ziehen ordnet um; aus dem Fenster gezogen und losgelassen öffnet die Seite in einem eigenen Fenster.
// Mittelklick schließt, Rechtsklick zeigt das Menü
export default function Tabs({ tabs, active, onSelect, onClose, onPin, onMove, onCloseOthers, onCloseRight, onNew, onWindow }) {
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState(null) // { key, side: 'before' | 'after' }
  const [menu, setMenu] = useState(null) // { tab, x, y }
  const closeMenu = useCallback(() => setMenu(null), [])
  const outside = useRef(false)
  const sideOf = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientX - r.left < r.width / 2 ? 'before' : 'after'
  }
  const canWindow = (t) => ['page', 'row'].includes(t.node?.kind)

  // Verlässt der Ziehvorgang das Fenster, gibt es keinen dragleave mit Ziel mehr (relatedTarget null)
  const leave = (e) => !e.relatedTarget && (outside.current = true)
  const enter = () => (outside.current = false)
  function start(e, t) {
    setDrag(t.key)
    outside.current = false
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-nexora-tab', t.view)
    document.addEventListener('dragleave', leave)
    document.addEventListener('dragenter', enter)
  }
  function end(e, t) {
    document.removeEventListener('dragleave', leave)
    document.removeEventListener('dragenter', enter)
    setDrag(null)
    setOver(null)
    if (outside.current && e.dataTransfer.dropEffect === 'none' && canWindow(t)) onWindow(t.key, e.screenX || e.screenY ? { x: e.screenX - 60, y: e.screenY - 16 } : null)
  }

  return (
    <nav aria-label="Reiter" data-tour="reiter" data-tauri-drag-region className="flex min-w-0 items-stretch gap-0.5 pt-1.5">
      {tabs.map((t) => {
        const on = t.key === active
        const mark = over?.key !== t.key ? '' : over.side === 'before' ? 'shadow-[inset_2px_0_0_var(--accent)]' : 'shadow-[inset_-2px_0_0_var(--accent)]'
        return (
          <div
            key={t.key}
            draggable
            onDragStart={(e) => start(e, t)}
            onDragEnd={(e) => end(e, t)}
            onDragOver={(e) => {
              if (!drag || drag === t.key) return
              e.preventDefault()
              const side = sideOf(e)
              if (over?.key !== t.key || over.side !== side) setOver({ key: t.key, side })
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (drag && drag !== t.key) onMove(drag, t.key, sideOf(e))
              setDrag(null)
              setOver(null)
            }}
            onAuxClick={(e) => e.button === 1 && !t.pinned && onClose(t.key)}
            onContextMenu={(e) => (e.preventDefault(), setMenu({ tab: t, x: e.clientX, y: e.clientY }))}
            className={`group relative flex shrink items-center self-end rounded-t-lg ${t.pinned ? 'w-10 shrink-0 justify-center' : 'w-52 min-w-14'} ${on ? 'bg-bg text-text' : 'text-muted hover:bg-hover hover:text-text'} ${mark}`}
          >
            <button
              onClick={() => onSelect(t.key)}
              aria-current={on ? 'page' : undefined}
              aria-label={t.pinned ? `${titleOf(t)} (angepinnt)` : undefined}
              title={titleOf(t)}
              className={`flex h-8 min-w-0 items-center gap-1.5 text-sm ${t.pinned ? 'justify-center px-2' : 'flex-1 pl-3 pr-1'}`}
            >
              <TabIcon tab={t} size={t.pinned ? 16 : 14} />
              {!t.pinned && <span className="truncate">{titleOf(t)}</span>}
            </button>
            {!t.pinned && (
              <button
                aria-label={`Reiter „${titleOf(t)}“ schließen`}
                onClick={() => onClose(t.key)}
                className={`mr-1.5 shrink-0 rounded p-0.5 text-faint hover:bg-hover hover:text-text ${on ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
              >
                <X size={12} />
              </button>
            )}
          </div>
        )
      })}
      <button aria-label="Neuer Reiter (Strg+T)" title="Neuer Reiter (Strg+T)" onClick={onNew} className="mb-0.5 ml-0.5 grid size-7 shrink-0 place-items-center self-end rounded-md text-muted hover:bg-hover hover:text-text">
        <Plus size={14} />
      </button>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={closeMenu}>
          <MenuItem icon={menu.tab.pinned ? PushPinSlash : PushPin} onClick={() => (closeMenu(), onPin(menu.tab.key, !menu.tab.pinned))}>{menu.tab.pinned ? 'Lösen' : 'Anpinnen'}</MenuItem>
          {canWindow(menu.tab) && <MenuItem icon={AppWindow} onClick={() => (closeMenu(), onWindow(menu.tab.key, null))}>In eigenem Fenster öffnen</MenuItem>}
          <div className="my-1 border-t border-line" />
          <MenuItem icon={X} onClick={() => (closeMenu(), onClose(menu.tab.key))}>Schließen</MenuItem>
          <MenuItem onClick={() => (closeMenu(), onCloseOthers(menu.tab.key))}>Andere schließen</MenuItem>
          <MenuItem onClick={() => (closeMenu(), onCloseRight(menu.tab.key))}>Rechts davon schließen</MenuItem>
        </Menu>
      )}
    </nav>
  )
}
