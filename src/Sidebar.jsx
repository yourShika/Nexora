import { useRef, useState } from 'react'
import {
  AppWindow, ArrowCircleUp, ArrowsLeftRight, FileArrowDown, FileArrowUp, FolderSimplePlus, BookOpenText, Briefcase, ChartBar, House, LockSimpleOpen, ArrowsClockwise, LinkBreak, PlugsConnected, CalendarBlank, CaretRight, CheckSquare, Code, DotsThree, DownloadSimple, Export, FileText, FolderSimple, FrameCorners, GearSix, Lightning, ListChecks, MagnifyingGlass, Notebook, PencilSimple, Plus,
  Browsers, PushPin, SidebarSimple, Stamp, Star, Table, Trash, Tray, Warning,
} from '@phosphor-icons/react'
import Menu, { MenuItem } from './Menu.jsx'
import { useApp } from './ctx.js'
import { DEFAULT_LOOK, setLook, useLook } from './theme.js'
import logo from '../src-tauri/icons/icon.svg'

export const COLORS = {
  petrol: '#1b8a94', blau: '#3a6fc4', gruen: '#3f8f4f', gelb: '#c49a1d',
  orange: '#d06a2a', rot: '#c8434b', rosa: '#c4508f', grau: '#7b8487',
}

const CHILD = { notebook: 'section', section: 'page', page: 'page', database: 'row' }
const NEW_LABEL = { notebook: 'Neuer Abschnitt', section: 'Neue Seite', page: 'Neue Unterseite', database: 'Neuer Punkt' }

export function NodeIcon({ node, size = 16 }) {
  if (node.icon) return <span className="w-4 text-center leading-none">{node.icon}</span>
  if (node.kind === 'notebook') return <Notebook size={size} weight="duotone" color={COLORS[node.color] ?? COLORS.petrol} />
  if (node.kind === 'section') return <FolderSimple size={size} className="text-muted" />
  if (node.kind === 'database') return <ListChecks size={size} className="text-muted" />
  if (node.kind === 'row') return <CheckSquare size={size} className="text-muted" />
  return <FileText size={size} className="text-muted" />
}

export default function Sidebar({ tree, area, favorites, counts, current, expanded, renaming, actions, warning, onSearch, updates, vaultOpen, onLockVault }) {
  const [menu, setMenu] = useState(null)
  const templates = useApp()?.templates ?? []

  const openMenu = (e, node) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, node })
  }
  const run = (fn) => () => (setMenu(null), fn())
  const drag = useRef(null)
  const [over, setOver] = useState(null)
  const ctx = { tree, expanded, current, renaming, actions, openMenu, drag, over, setOver }

  const m = menu?.node
  const look = useLook()
  const [width, setWidth] = useState(null) // während des Ziehens

  // Breite am rechten Rand ziehen; Doppelklick stellt die Standardbreite her
  function resize(e) {
    e.preventDefault()
    const startX = e.clientX
    const start = look.sidebar
    let next = start
    const move = (ev) => setWidth((next = Math.min(440, Math.max(200, Math.round(start + ev.clientX - startX)))))
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      setWidth(null)
      if (next !== start) setLook({ sidebar: next })
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  return (
    <aside style={{ width: width ?? look.sidebar }} className="relative flex h-full shrink-0 flex-col border-r border-line bg-side">
      <div
        role="separator"
        aria-label="Breite der Seitenleiste ändern"
        title="Breite ziehen, Doppelklick setzt zurück"
        onPointerDown={resize}
        onDoubleClick={() => setLook({ sidebar: DEFAULT_LOOK.sidebar })}
        className="absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-accent/30"
      />
      <div className="flex h-12 items-center gap-2 px-4">
        <img src={logo} alt="" className="size-5" />
        <span className="font-semibold tracking-tight">Nexora</span>
        <span className="flex-1" />
        <IconButton label="Einstellungen" onClick={() => actions.open('settings')}>
          <GearSix size={16} />
        </IconButton>
        <IconButton label="Seitenleiste einklappen (Strg+Umschalt+L)" onClick={() => setLook({ sidebarHidden: true })}>
          <SidebarSimple size={16} />
        </IconButton>
      </div>

      <div role="radiogroup" aria-label="Bereich" className="mx-2 mb-2 grid grid-cols-2 gap-0.5 rounded-md bg-hover p-0.5 text-xs">
        {[['arbeit', 'Arbeit', Briefcase], ['privat', 'Privat', House]].map(([id, label, Icon]) => (
          <button
            key={id}
            role="radio"
            aria-checked={area === id}
            onClick={() => actions.setArea(id)}
            className={`flex items-center justify-center gap-1.5 rounded px-2 py-1 ${area === id ? 'bg-raised text-text shadow-sm' : 'text-muted hover:text-text'}`}
          >
            <Icon size={14} weight={area === id ? 'fill' : 'regular'} className={area === id ? 'text-accent' : ''} /> {label}
          </button>
        ))}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <button onClick={onSearch} className="mb-1 flex h-[var(--row)] w-full items-center gap-2 rounded-md px-2 text-left text-muted hover:bg-hover hover:text-text">
          <MagnifyingGlass size={16} />
          <span className="flex-1">Suchen</span>
          <kbd className="rounded border border-line px-1 font-sans text-[11px] text-faint">Strg K</kbd>
        </button>
        <ul className="mb-3">
          {[
            { id: 'today', label: 'Heute', icon: Lightning, count: counts.today },
            { id: 'inbox', label: 'Eingang', icon: Tray, count: counts.inbox },
            { id: 'calendar', label: 'Kalender', icon: CalendarBlank },
            { id: 'journal', label: 'Tagebuch', icon: BookOpenText },
            { id: 'stats', label: 'Statistik', icon: ChartBar },
            { id: 'snippets', label: 'Snippets', icon: Code },
          ].map((v) => (
            <li key={v.id}>
              <button
                onClick={() => actions.open(v.id)}
                onAuxClick={(e) => e.button === 1 && actions.openTab(v.id)}
                className={`flex h-[var(--row)] w-full items-center gap-2 rounded-md px-2 text-left ${current === v.id ? 'bg-accent-soft' : 'hover:bg-hover'}`}
              >
                <v.icon size={16} className="text-accent" />
                <span className="flex-1">{v.label}</span>
                {v.count > 0 && <span className="text-xs tabular-nums text-muted">{v.count}</span>}
              </button>
            </li>
          ))}
        </ul>

        {favorites.length > 0 && (
          <>
            <Heading>Favoriten</Heading>
            <ul className="mb-3">
              {favorites.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => actions.open(n.id)}
                    onAuxClick={(e) => e.button === 1 && actions.openTab(n.id)}
                    className={`flex h-[var(--row)] w-full items-center gap-2 rounded-md px-2 text-left ${current === n.id ? 'bg-accent-soft' : 'hover:bg-hover'}`}
                  >
                    <NodeIcon node={n} />
                    <span className="truncate">{n.title || 'Ohne Titel'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <Heading
          action={
            <span className="flex gap-0.5">
              <IconButton label="Nexora-Datei importieren" onClick={actions.importNexora}><FileArrowDown size={14} /></IconButton>
              <IconButton label="OneNote-Notizbuch verbinden" onClick={actions.oneNoteDialog}><PlugsConnected size={14} /></IconButton>
              <IconButton label="Neues Notizbuch" onClick={() => actions.add('notebook', null)}><Plus size={14} /></IconButton>
            </span>
          }
        >
          Notizbücher
        </Heading>
        {tree.roots.length ? (
          <ul role="tree" aria-label="Notizbücher">
            {tree.roots.map((n) => <Row key={n.id} node={n} depth={0} ctx={ctx} />)}
          </ul>
        ) : (
          <button onClick={() => actions.add('notebook', null)} className="w-full rounded-md px-2 py-2 text-left text-muted hover:bg-hover">
            Erstes Notizbuch anlegen
          </button>
        )}
      </nav>

      <div className="border-t border-line p-2">
        {updates.found && (
          <button
            onClick={updates.install}
            disabled={updates.busy}
            className="mb-1 flex w-full items-center gap-2 rounded-md bg-accent-soft px-2 py-1.5 text-left text-xs hover:bg-hover disabled:opacity-60"
          >
            <ArrowCircleUp size={16} className="shrink-0 text-accent" />
            {updates.busy ? `Version ${updates.found.version} wird installiert …` : `Version ${updates.found.version} jetzt installieren (sonst beim nächsten Start)`}
          </button>
        )}
        {warning && (
          <button onClick={() => actions.open('settings')} className="mb-1 flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs text-danger hover:bg-hover">
            <Warning size={16} className="mt-px shrink-0" /> {warning}
          </button>
        )}
        {vaultOpen && (
          <button onClick={onLockVault} title="Tresor jetzt sperren" className="mb-1 flex h-[var(--row)] w-full items-center gap-2 rounded-md px-2 text-accent hover:bg-hover">
            <LockSimpleOpen size={16} /> Tresor offen, sperren
          </button>
        )}
        <button
          onClick={() => actions.open('trash')}
          className={`flex h-[var(--row)] w-full items-center gap-2 rounded-md px-2 text-muted ${current === 'trash' ? 'bg-accent-soft text-text' : 'hover:bg-hover hover:text-text'}`}
        >
          <Trash size={16} />
          Papierkorb
        </button>
      </div>

      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {m.kind === 'page' && <MenuItem icon={AppWindow} onClick={run(() => actions.openWindow(m.id))}>In eigenem Fenster öffnen</MenuItem>}
          <MenuItem icon={Plus} onClick={run(() => actions.add(CHILD[m.kind], m.id))}>{NEW_LABEL[m.kind]}</MenuItem>
          {m.kind === 'section' && <MenuItem icon={FolderSimplePlus} onClick={run(() => actions.add('section', m.id))}>Neuer Abschnitt darin</MenuItem>}
          {['section', 'page'].includes(m.kind) && (
            <>
              <MenuItem icon={FrameCorners} onClick={run(() => actions.add('page', m.id, 'frei'))}>Neue freie Seite</MenuItem>
              <MenuItem icon={ListChecks} onClick={run(() => actions.add('database', m.id, 'lop'))}>Neue LOP-Liste</MenuItem>
              <MenuItem icon={Table} onClick={run(() => actions.add('database', m.id))}>Neue leere Liste</MenuItem>
              {templates.length > 0 && (
                <>
                  <div className="px-2 pb-0.5 pt-2 text-xs text-faint">Neue Seite aus Vorlage</div>
                  {templates.slice(0, 10).map((t) => (
                    <MenuItem key={t.id} icon={Stamp} onClick={run(() => actions.fromTemplate(t.id, m.id))}>
                      {t.icon ? `${t.icon} ` : ''}{t.title || 'Ohne Titel'}
                    </MenuItem>
                  ))}
                </>
              )}
            </>
          )}
          {['section', 'page'].includes(m.kind) && (
            <MenuItem icon={DownloadSimple} onClick={run(() => actions.importFiles(m.id))}>Textdateien importieren …</MenuItem>
          )}
          {m.kind === 'notebook' && <MenuItem icon={FileArrowUp} onClick={run(() => actions.exportNexora(m.id))}>Als Nexora-Datei speichern …</MenuItem>}
          <MenuItem icon={Export} onClick={run(() => actions.exportTree([m.id]))}>Als Markdown exportieren …</MenuItem>
          <MenuItem icon={PencilSimple} onClick={run(() => actions.startRename(m.id))}>Umbenennen</MenuItem>
          <MenuItem icon={Star} onClick={run(() => actions.save(m.id, { favorite: m.favorite ? 0 : 1 }))}>
            {m.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten'}
          </MenuItem>
          <MenuItem icon={Browsers} onClick={run(() => actions.openTab(m.id))}>In neuem Reiter öffnen</MenuItem>
          <MenuItem icon={PushPin} onClick={run(() => actions.pinPage(m.id))}>{actions.isPinned(m.id) ? 'Reiter lösen' : 'Als Reiter anpinnen'}</MenuItem>
          {m.kind === 'notebook' && (
            <MenuItem icon={ArrowsLeftRight} onClick={run(() => actions.moveArea(m.id))}>{m.area === 'privat' ? 'In den Bereich Arbeit' : 'In den Bereich Privat'}</MenuItem>
          )}
          {m.kind === 'notebook' && m.config?.onenote && (
            <>
              <MenuItem icon={ArrowsClockwise} onClick={run(() => actions.oneNoteSync(m.id))}>Mit OneNote abgleichen</MenuItem>
              <MenuItem icon={LinkBreak} onClick={run(() => actions.oneNoteUnlink(m.id))}>OneNote-Verbindung lösen</MenuItem>
            </>
          )}
          {m.kind === 'notebook' && (
            <div className="flex gap-1.5 px-2 py-2" role="group" aria-label="Farbe">
              {Object.entries(COLORS).map(([name, hex]) => (
                <button
                  key={name}
                  aria-label={`Farbe ${name}`}
                  onClick={run(() => actions.save(m.id, { color: name }))}
                  style={{ background: hex }}
                  className={`size-4 rounded-full ${(m.color ?? 'petrol') === name ? 'ring-2 ring-text ring-offset-1 ring-offset-raised' : ''}`}
                />
              ))}
            </div>
          )}
          <div className="my-1 border-t border-line" />
          <MenuItem icon={Trash} danger onClick={run(() => actions.remove(m.id))}>In den Papierkorb</MenuItem>
        </Menu>
      )}
    </aside>
  )
}

function Row({ node, depth, ctx }) {
  const { tree, expanded, current, renaming, actions, openMenu, drag, over, setOver } = ctx
  const kids = tree.children(node.id)
  const open = expanded.has(node.id)
  const foldable = kids.length > 0 || node.kind === 'notebook' || node.kind === 'section'
  const active = current === node.id
  const mark = over?.id === node.id ? over.zone : null

  // Oberes/unteres Drittel: davor/danach einsortieren, Mitte: hinein
  const zoneAt = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - r.top) / r.height
    return y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'inside'
  }

  return (
    <li role="treeitem" aria-expanded={foldable ? open : undefined} aria-selected={active}>
      <div
        draggable={renaming !== node.id}
        onDragStart={(e) => {
          drag.current = node.id
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', node.title)
        }}
        onDragEnd={() => ((drag.current = null), setOver(null))}
        onDragOver={(e) => {
          // Dateien aus dem Explorer: nur in Abschnitte und Seiten importieren
          if (!drag.current && e.dataTransfer.types.includes('Files')) {
            const ok = node.kind === 'section' || node.kind === 'page'
            if (ok) e.preventDefault()
            if (mark !== (ok ? 'inside' : null)) setOver(ok ? { id: node.id, zone: 'inside' } : null)
            return
          }
          if (!drag.current) return
          const zone = zoneAt(e)
          const ok = actions.canMove(drag.current, node.id, zone)
          if (ok) e.preventDefault()
          if (mark !== (ok ? zone : null)) setOver(ok ? { id: node.id, zone } : null)
        }}
        onDragLeave={() => mark && setOver(null)}
        onDrop={(e) => {
          e.preventDefault()
          if (drag.current) actions.move(drag.current, node.id, zoneAt(e))
          else if (e.dataTransfer.files.length) actions.importFiles(node.id, [...e.dataTransfer.files])
          drag.current = null
          setOver(null)
        }}
        onContextMenu={(e) => openMenu(e, node)}
        style={{ paddingLeft: 6 + depth * 14 }}
        className={`group flex h-[var(--row)] items-center gap-1 rounded-md pr-1 ${active || mark === 'inside' ? 'bg-accent-soft text-text' : 'hover:bg-hover'} ${mark === 'before' ? 'shadow-[inset_0_2px_0_var(--accent)]' : mark === 'after' ? 'shadow-[inset_0_-2px_0_var(--accent)]' : ''}`}
      >
        <button
          tabIndex={-1}
          aria-label={open ? 'Zuklappen' : 'Aufklappen'}
          onClick={() => actions.toggle(node.id)}
          className={`grid size-4 shrink-0 place-items-center rounded text-faint hover:text-text ${foldable ? '' : 'invisible'}`}
        >
          <CaretRight size={11} weight="bold" className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        {renaming === node.id ? (
          <RenameInput node={node} onDone={(title) => actions.rename(node.id, title)} />
        ) : (
          <button
            onClick={() => actions.open(node.id)}
            onAuxClick={(e) => e.button === 1 && actions.openTab(node.id)} // Mittelklick: neuer Reiter
            onDoubleClick={() => actions.startRename(node.id)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <NodeIcon node={node} />
            <span className={`truncate ${node.kind === 'notebook' ? 'font-medium' : ''} ${node.title ? '' : 'text-faint'}`}>
              {node.title || 'Ohne Titel'}
            </span>
          </button>
        )}
        <span className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
          <IconButton label={NEW_LABEL[node.kind]} onClick={() => actions.add(CHILD[node.kind], node.id)}>
            <Plus size={14} />
          </IconButton>
          <IconButton label="Mehr" onClick={(e) => openMenu(e, node)}>
            <DotsThree size={16} weight="bold" />
          </IconButton>
        </span>
      </div>
      {open && kids.length > 0 && (
        <ul role="group" className="anim-tree">
          {kids.map((k) => <Row key={k.id} node={k} depth={depth + 1} ctx={ctx} />)}
        </ul>
      )}
    </li>
  )
}

function Heading({ children, action }) {
  return (
    <div className="flex h-8 items-center justify-between px-2 pt-2 text-xs font-medium text-faint">
      {children}
      {action}
    </div>
  )
}

// Eingeklappte Seitenleiste: schmale Leiste mit dem Nötigsten
export function Rail({ current, counts, actions, onSearch }) {
  const item = (label, Icon, run, active, count) => (
    <button key={label} aria-label={label} title={label} onClick={run} className={`relative grid size-8 place-items-center rounded-md ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-text'}`}>
      <Icon size={17} />
      {count > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent px-1 text-[10px] leading-4 text-white dark:text-bg">{count}</span>}
    </button>
  )
  return (
    <aside className="flex h-full w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-side py-2">
      {item('Seitenleiste zeigen (Strg+Umschalt+L)', SidebarSimple, () => setLook({ sidebarHidden: false }))}
      <span className="my-1 h-px w-6 bg-line" />
      {item('Suchen (Strg+K)', MagnifyingGlass, onSearch)}
      {item('Heute', Lightning, () => actions.open('today'), current === 'today', counts.today)}
      {item('Eingang', Tray, () => actions.open('inbox'), current === 'inbox', counts.inbox)}
      {item('Kalender', CalendarBlank, () => actions.open('calendar'), current === 'calendar')}
      <span className="flex-1" />
      {item('Einstellungen', GearSix, () => actions.open('settings'), current === 'settings')}
    </aside>
  )
}

export function IconButton({ label, onClick, children }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={(e) => (e.stopPropagation(), onClick(e))}
      className="grid size-6 place-items-center rounded-md text-muted hover:bg-hover hover:text-text"
    >
      {children}
    </button>
  )
}

function RenameInput({ node, onDone }) {
  const [value, setValue] = useState(node.title)
  const done = useRef(false)
  // Enter/Escape lösen beim Entfernen noch ein blur aus; nur das erste zählt
  const finish = (title) => !done.current && ((done.current = true), onDone(title))
  return (
    <input
      autoFocus
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(node.title)
      }}
      aria-label="Name"
      className="min-w-0 flex-1 rounded border border-accent bg-raised px-1.5 py-0.5 outline-none"
    />
  )
}
