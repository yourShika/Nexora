import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowSquareOut, ArrowsDownUp, CalendarBlank, ChartBarHorizontal, DotsSixVertical, Kanban, ListBullets, Plus, SlidersHorizontal, SortAscending, SortDescending, Table, X } from '@phosphor-icons/react'
import { Chip, FieldEditor, FieldValue } from './Props.jsx'
import { Progress, QuickAdd, RowItem } from './Rows.jsx'
import { ConfirmButton } from './Overview.jsx'
import { Cover, IconRow } from './PageHead.jsx'
import CalendarView from './Calendar.jsx'
import TimelineView from './Timeline.jsx'
import { CHIP_COLORS, TYPES, between, isDone, newId, sortRows, sortsOf, statusField } from './fields.js'
import Menu, { MenuItem } from './Menu.jsx'
import Select from './Select.jsx'

const TITLE = { id: 'title', name: 'Titel', type: 'title' }
// Startbreiten in Pixeln; gezogene Breiten stehen je Liste in config.widths
const COL_WIDTH = { title: 320, nr: 80, status: 112, select: 112, date: 132, person: 112, checkbox: 64, multi: 160, text: 160, link: 160 }
const MIN_COL = 48

// Eigene Reihenfolge per Ziehen (nur ohne Spalten-Sortierung): neuer Sortierwert zwischen den Nachbarn
function useRowDrag(rows, onRow, enabled) {
  const [over, setOver] = useState(null) // { id, zone: 'before' | 'after' }
  const dragging = useRef(null)
  const zoneOf = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY - r.top < r.height / 2 ? 'before' : 'after'
  }
  return {
    enabled,
    handle: (row) =>
      enabled
        ? {
            draggable: true,
            onDragStart: (e) => {
              dragging.current = row.id
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('application/x-nexora-row', row.id)
            },
            onDragEnd: () => ((dragging.current = null), setOver(null)),
          }
        : {},
    target: (row) =>
      enabled
        ? {
            onDragOver: (e) => {
              if (!dragging.current || dragging.current === row.id) return
              e.preventDefault()
              const zone = zoneOf(e)
              if (over?.id !== row.id || over.zone !== zone) setOver({ id: row.id, zone })
            },
            onDrop: (e) => {
              e.preventDefault()
              const id = dragging.current
              const zone = zoneOf(e)
              dragging.current = null
              setOver(null)
              if (!id || id === row.id) return
              const list = rows.filter((r) => r.id !== id)
              const i = list.findIndex((r) => r.id === row.id)
              const [prev, next] = zone === 'before' ? [list[i - 1], list[i]] : [list[i], list[i + 1]]
              onRow(id, { sort: between(prev?.sort, next?.sort) })
            },
          }
        : {},
    mark: (row) => (over?.id !== row.id ? '' : over.zone === 'before' ? 'shadow-[inset_0_2px_0_var(--accent)]' : 'shadow-[inset_0_-2px_0_var(--accent)]'),
  }
}
const VIEWS = [
  { id: 'table', label: 'Tabelle', icon: Table },
  { id: 'list', label: 'Liste', icon: ListBullets },
  { id: 'kanban', label: 'Kanban', icon: Kanban },
  { id: 'calendar', label: 'Kalender', icon: CalendarBlank },
  { id: 'timeline', label: 'Zeitleiste', icon: ChartBarHorizontal },
]

const SORTED = ['table', 'list', 'kanban'] // Kalender und Zeitleiste ordnen nach Datum

export default function DatabaseView({ db, rows, onOpen, onAdd, onRow, onConfig, onTitle, onSave }) {
  const config = db.config
  const fields = config.fields
  const [panel, setPanel] = useState(false)
  const [sortMenu, setSortMenu] = useState(null)
  const closeSort = useCallback(() => setSortMenu(null), [])
  const [title, setTitle] = useState(db.title)
  useEffect(() => setTitle(db.title), [db.title])

  const setConfig = (patch) => onConfig({ ...config, ...patch })
  const addOption = (fieldId, name) =>
    setConfig({ fields: fields.map((f) => (f.id === fieldId && !f.options.some((o) => o.id === name) ? { ...f, options: [...f.options, { id: name, name, color: 'grau' }] } : f)) })
  const toggle = (row) => {
    const sf = statusField(fields)
    if (!sf) return
    const target = isDone(row, fields) ? sf.options.find((o) => !o.done) : sf.options.find((o) => o.done)
    onRow(row.id, { props: { ...row.props, [sf.id]: target?.id ?? null } })
  }

  const sorts = sortsOf(config, config.view)
  const setSorts = (list) => setConfig({ sorts: { ...config.sorts, [config.view]: list } })
  const visible = sortRows(config.hideDone && config.view !== 'kanban' ? rows.filter((r) => !isDone(r, fields)) : rows, fields, sorts)
  const hasStatus = !!statusField(fields)
  const dateFields = fields.filter((f) => f.type === 'date')

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Cover node={db} onSave={onSave} />
        <div className={`px-6 pb-24 md:px-12 ${db.cover ? 'pt-4' : 'pt-10'}`}>
          <IconRow node={db} onSave={onSave} />
          <input
            value={title}
            aria-label="Name der Liste"
            placeholder="Ohne Titel"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== db.title && onTitle(title)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="mb-5 w-full bg-transparent text-[32px] font-semibold leading-tight tracking-tight outline-none placeholder:text-faint"
          />

          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line pb-3">
            <div role="tablist" aria-label="Ansicht" className="flex gap-1">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  role="tab"
                  aria-selected={config.view === v.id}
                  onClick={() => setConfig({ view: v.id })}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 ${config.view === v.id ? 'bg-accent-soft text-text' : 'text-muted hover:bg-hover hover:text-text'}`}
                >
                  <v.icon size={16} /> {v.label}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            {hasStatus && config.view !== 'kanban' && (
              <label className="flex cursor-pointer items-center gap-2 text-muted">
                <input type="checkbox" checked={config.hideDone} onChange={(e) => setConfig({ hideDone: e.target.checked })} className="accent-[var(--accent)]" />
                Erledigte ausblenden
              </label>
            )}
            {SORTED.includes(config.view) && (
              <button
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setSortMenu(sortMenu ? null : { x: r.right - 336, y: r.bottom + 4 })
                }}
                onMouseDown={(e) => sortMenu && e.stopPropagation()} // sonst schließt das Menü beim Drücken und öffnet beim Klick wieder
                aria-expanded={!!sortMenu}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 ${sorts.length || sortMenu ? 'bg-accent-soft text-text' : 'text-muted hover:bg-hover hover:text-text'}`}
              >
                <ArrowsDownUp size={16} /> Sortieren{sorts.length ? ` (${sorts.length})` : ''}
              </button>
            )}
            {sortMenu && <SortMenu x={sortMenu.x} y={sortMenu.y} fields={fields} sorts={sorts} onSorts={setSorts} onClose={closeSort} />}
            <button onClick={() => setPanel(!panel)} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 ${panel ? 'bg-accent-soft' : 'text-muted hover:bg-hover hover:text-text'}`}>
              <SlidersHorizontal size={16} /> Felder
            </button>
          </div>

          <QuickAdd onAdd={onAdd} />

          {config.view === 'table' && (
            <TableView
              db={db}
              rows={visible}
              fields={fields}
              sorts={sorts}
              onSorts={setSorts}
              widths={config.widths ?? {}}
              onWidths={(widths) => setConfig({ widths })}
              onOpen={onOpen}
              onRow={onRow}
              addOption={addOption}
            />
          )}
          {config.view === 'list' && <ListView db={db} rows={visible} fields={fields} onOpen={onOpen} onToggle={toggle} drag={!sorts.length} onRow={onRow} />}
          {config.view === 'kanban' && (
            hasStatus
              ? <KanbanView db={db} rows={visible} fields={fields} onOpen={onOpen} onRow={onRow} />
              : <p className="text-muted">Kanban braucht ein Feld vom Typ Status. Lege es unter „Felder“ an.</p>
          )}
          {config.view === 'calendar' && (
            <CalendarView
              rows={rows}
              dbOf={() => db}
              field={dateFields.some((f) => f.id === config.calendarField) ? config.calendarField : dateFields[0]?.id ?? 'due'}
              hideDone={config.hideDone}
              onOpen={onOpen}
              onRow={onRow}
              onAdd={onAdd}
              header={dateFields.length > 1 && (
                <Select value={config.calendarField ?? dateFields[0].id} onChange={(e) => setConfig({ calendarField: e.target.value })} aria-label="Datumsfeld" className="rounded-md border border-line bg-raised px-2 py-1">
                  {dateFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
              )}
            />
          )}
          {config.view === 'timeline' && <TimelineView db={db} rows={visible} fields={fields} config={config} onConfig={onConfig} onRow={onRow} onOpen={onOpen} />}
          {!rows.length && <p className="mt-2 text-muted">Noch keine Punkte. Tippe oben einen ein und drücke Enter.</p>}
        </div>
      </div>
      {panel && <FieldsPanel config={config} onConfig={onConfig} onClose={() => setPanel(false)} />}
    </div>
  )
}

// Sortieren nach mehreren Ebenen für die aktuelle Ansicht
function SortMenu({ x, y, fields, sorts, onSorts, onClose }) {
  const cols = [...fields.filter((f) => f.type === 'nr'), TITLE, ...fields.filter((f) => f.type !== 'nr')]
  const free = cols.filter((c) => !sorts.some((s) => s.field === c.id))
  const change = (i, patch) => onSorts(sorts.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const select = 'rounded-md border border-line bg-raised px-2 py-1'
  return (
    <Menu x={x} y={y} onClose={onClose} role="dialog" label="Sortieren">
      <div className="w-80 p-1.5">
        {sorts.map((s, i) => (
          <div key={i} className="mb-1.5 flex items-center gap-1.5">
            <span className="w-10 shrink-0 text-xs text-faint">{i ? 'dann' : 'Nach'}</span>
            <Select value={s.field} onChange={(e) => change(i, { field: e.target.value })} aria-label={`Feld der ${i + 1}. Ebene`} className={`min-w-0 flex-1 ${select}`}>
              {cols.filter((c) => c.id === s.field || free.includes(c)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select value={s.dir} onChange={(e) => change(i, { dir: e.target.value })} aria-label={`Richtung der ${i + 1}. Ebene`} className={select}>
              <option value="asc">Aufsteigend</option>
              <option value="desc">Absteigend</option>
            </Select>
            <button aria-label={`${i + 1}. Ebene entfernen`} onClick={() => onSorts(sorts.filter((_, j) => j !== i))} className="rounded p-1 text-faint hover:bg-hover hover:text-text">
              <X size={14} />
            </button>
          </div>
        ))}
        {!sorts.length && <p className="px-1 pb-1.5 text-xs text-muted">Ohne Sortierung gilt die eigene Reihenfolge (Zeilen ziehen).</p>}
        {free.length > 0 && <MenuItem icon={Plus} onClick={() => onSorts([...sorts, { field: free[0].id, dir: 'asc' }])}>{sorts.length ? 'Weitere Ebene' : 'Sortierung hinzufügen'}</MenuItem>}
        {sorts.length > 0 && <MenuItem icon={X} onClick={() => onSorts([])}>Sortierung entfernen</MenuItem>}
      </div>
    </Menu>
  )
}

function TableView({ db, rows, fields, sorts, onSorts, widths, onWidths, onOpen, onRow, addOption }) {
  const cols = [...fields.filter((f) => f.type === 'nr'), TITLE, ...fields.filter((f) => f.type !== 'nr')]
  // Klick auf den Kopf: nur nach dieser Spalte, auf, ab, aus; mehrere Ebenen über "Sortieren"
  const clickSort = (id) =>
    onSorts(sorts[0]?.field !== id ? [{ field: id, dir: 'asc' }] : sorts[0].dir === 'asc' ? [{ field: id, dir: 'desc' }] : [])
  const drag = useRowDrag(rows, onRow, !sorts.length)
  const [live, setLive] = useState(null) // Breiten während des Ziehens
  const width = (c) => (live ?? widths)[c.id] ?? COL_WIDTH[c.type] ?? 128
  const total = 24 + cols.reduce((s, c) => s + width(c), 0)

  // Spaltenbreite am rechten Rand ziehen; Doppelklick setzt sie zurück
  function resize(e, c) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const start = width(c)
    let next = widths
    const move = (ev) => setLive((next = { ...widths, [c.id]: Math.max(MIN_COL, Math.round(start + ev.clientX - startX)) }))
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      setLive(null)
      if (next !== widths) onWidths(next)
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }
  const reset = (c) => {
    const { [c.id]: _, ...rest } = widths
    onWidths(rest)
  }

  return (
    <div className="overflow-x-auto">
      <table className="table-fixed border-collapse" style={{ width: total, minWidth: '100%' }}>
        <colgroup>
          <col style={{ width: 24 }} />
          {cols.map((c) => <col key={c.id} style={{ width: width(c) }} />)}
        </colgroup>
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th aria-label="Reihenfolge" />
            {cols.map((c) => { const level = sorts.findIndex((s) => s.field === c.id); return (
              <th key={c.id} className="relative whitespace-nowrap px-1.5 py-1.5 font-medium">
                <button onClick={() => clickSort(c.id)} className="flex max-w-full items-center gap-1 overflow-hidden hover:text-text">
                  <span className="truncate">{c.name}</span>
                  {level >= 0 && (sorts[level].dir === 'asc' ? <SortAscending size={13} /> : <SortDescending size={13} />)}
                  {level >= 0 && sorts.length > 1 && <span className="text-[10px] text-faint">{level + 1}</span>}
                </button>
                <span
                  role="separator"
                  aria-label={`Breite von ${c.name} ändern`}
                  title="Breite ziehen, Doppelklick setzt zurück"
                  onPointerDown={(e) => resize(e, c)}
                  onDoubleClick={() => reset(c)}
                  className="absolute -right-1 top-1 bottom-1 z-10 w-2 cursor-col-resize rounded hover:bg-accent/40"
                />
              </th>
            )})}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} {...drag.target(r)} className={`group border-b border-line ${isDone(r, fields) ? 'opacity-60' : ''} ${drag.mark(r)}`}>
              <td className="px-0 py-0.5 align-middle">
                {drag.enabled && (
                  <span {...drag.handle(r)} title="Ziehen, um die Reihenfolge zu ändern" aria-label="Zeile verschieben" className="invisible flex cursor-grab justify-center text-faint group-hover:visible">
                    <DotsSixVertical size={16} weight="bold" />
                  </span>
                )}
              </td>
              {cols.map((c) => (
                <td key={c.id} className="px-0 py-0.5 align-middle">
                  {c.type === 'title' ? (
                    <TitleCell row={r} onOpen={onOpen} onTitle={(title) => onRow(r.id, { title })} />
                  ) : (
                    <FieldEditor
                      field={c}
                      value={r.props?.[c.id]}
                      db={db}
                      onChange={(v) => onRow(r.id, { props: { ...r.props, [c.id]: v } })}
                      onAddOption={(name) => addOption(c.id, name)}
                      rowId={r.id}
                    />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TitleCell({ row, onOpen, onTitle }) {
  const [text, setText] = useState(row.title)
  useEffect(() => setText(row.title), [row.title])
  return (
    <span className="flex items-center">
      <input
        value={text}
        aria-label="Titel"
        placeholder="Ohne Titel"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== row.title && onTitle(text)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="w-full min-w-0 rounded bg-transparent px-1.5 py-1 font-medium outline-none placeholder:text-faint hover:bg-hover focus:bg-raised focus:ring-1 focus:ring-accent"
      />
      <Progress tasks={row.tasks} />
      <button
        aria-label="Als Seite öffnen"
        title="Als Seite öffnen"
        onClick={() => onOpen(row.id)}
        className="invisible ml-1 shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-text group-hover:visible focus:visible"
      >
        <ArrowSquareOut size={15} />
      </button>
    </span>
  )
}

function ListView({ db, rows, fields, onOpen, onToggle, drag: canDrag, onRow }) {
  const drag = useRowDrag(rows, onRow, canDrag)
  const sf = statusField(fields)
  const groups = sf
    ? [...sf.options.map((o) => ({ key: o.id, label: o, items: rows.filter((r) => r.props?.[sf.id] === o.id) })),
       { key: 'none', label: null, items: rows.filter((r) => !sf.options.some((o) => o.id === r.props?.[sf.id])) }]
    : [{ key: 'all', label: null, items: rows }]
  return groups.filter((g) => g.items.length).map((g) => (
    <section key={g.key} className="mb-6">
      {sf && (
        <h2 className="mb-1.5 flex items-center gap-2 px-2">
          {g.label ? <Chip color={g.label.color}>{g.label.name}</Chip> : <span className="text-muted">Ohne Status</span>}
          <span className="text-xs text-faint">{g.items.length}</span>
        </h2>
      )}
      <ul className="divide-y divide-line border-y border-line">
        {g.items.map((r) => <RowItem key={r.id} row={r} db={db} onOpen={onOpen} onToggle={onToggle} drag={{ ...drag.handle(r), ...drag.target(r) }} mark={drag.mark(r)} />)}
      </ul>
    </section>
  ))
}

function KanbanView({ db, rows, fields, onOpen, onRow }) {
  const sf = statusField(fields)
  const [over, setOver] = useState(null)
  const cards = fields.filter((f) => ['date', 'select', 'person', 'multi'].includes(f.type) && f.id !== 'followup')
  const columns = sf.options.map((o, i) => ({ o, items: rows.filter((r) => (r.props?.[sf.id] ?? (i === 0 ? o.id : null)) === o.id) }))

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {columns.map(({ o, items }) => (
        <section
          key={o.id}
          aria-label={o.name}
          onDragOver={(e) => (e.preventDefault(), setOver(o.id))}
          onDragLeave={() => setOver(null)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(null)
            const row = rows.find((r) => r.id === e.dataTransfer.getData('text/plain'))
            if (row && row.props?.[sf.id] !== o.id) onRow(row.id, { props: { ...row.props, [sf.id]: o.id } })
          }}
          className={`flex w-64 shrink-0 flex-col gap-2 rounded-lg p-2 ${over === o.id ? 'bg-accent-soft' : 'bg-side'}`}
        >
          <h2 className="flex items-center gap-2 px-1 py-0.5">
            <Chip color={o.color}>{o.name}</Chip>
            <span className="text-xs text-faint">{items.length}</span>
          </h2>
          {items.map((r) => (
            <article
              key={r.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', r.id)}
              onClick={() => onOpen(r.id)}
              className="anim-row cursor-grab rounded-md border border-line bg-raised p-2.5 shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-md active:cursor-grabbing"
            >
              <p className={`mb-1.5 font-medium ${o.done ? 'text-muted line-through' : ''}`}>{r.title || 'Ohne Titel'}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {r.props?.nr && <FieldValue field={{ type: 'nr' }} value={r.props.nr} db={db} />}
                <Progress tasks={r.tasks} />
                {cards.map((f) => <FieldValue key={f.id} field={f} value={r.props?.[f.id]} db={db} done={o.done} />)}
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  )
}

// Felder anlegen, umbenennen, löschen; Auswahl-Optionen pflegen
function FieldsPanel({ config, onConfig, onClose }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('text')
  const fields = config.fields
  const setFields = (next) => onConfig({ ...config, fields: next })
  const setField = (id, patch) => setFields(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const hasType = (t) => fields.some((f) => f.type === t)

  function add() {
    if (!name.trim()) return
    // feste IDs, weil Wiederholung und Zeitleiste genau diese Felder lesen
    const f = { id: { repeat: 'repeat', deps: 'after' }[type] ?? newId(), name: name.trim(), type }
    if (['select', 'multi', 'status'].includes(type)) {
      f.options = type === 'status'
        ? [{ id: newId(), name: 'Offen', color: 'grau' }, { id: newId(), name: 'Erledigt', color: 'gruen', done: true }]
        : []
    }
    setFields([...fields, f])
    setName('')
  }

  return (
    <aside aria-label="Felder" className="anim-panel flex w-80 shrink-0 flex-col border-l border-line bg-side">
      <div className="flex h-12 items-center justify-between px-4">
        <h2 className="font-semibold">Felder</h2>
        <button aria-label="Schließen" onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-text"><X size={16} /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6">
        {fields.map((f) => (
          <div key={f.id} className="rounded-lg border border-line bg-raised p-3">
            <div className="flex items-center gap-2">
              <BlurInput value={f.name} label="Feldname" onCommit={(v) => v && setField(f.id, { name: v })} className="font-medium" />
              <span className="shrink-0 text-xs text-faint">{TYPES[f.type]}</span>
              <ConfirmButton compact onConfirm={() => setFields(fields.filter((x) => x.id !== f.id))} />
            </div>
            {f.type === 'nr' && (
              <label className="mt-2 flex items-center gap-2 text-muted">
                Präfix
                <BlurInput value={config.prefix} label="Präfix" onCommit={(v) => onConfig({ ...config, prefix: v })} className="w-24" />
                <span className="text-xs text-faint">nächste: {config.nextNr}</span>
              </label>
            )}
            {f.options && <OptionsEditor field={f} onChange={(options) => setField(f.id, { options })} />}
          </div>
        ))}

        <div className="rounded-lg border border-dashed border-line p-3">
          <p className="mb-2 font-medium">Neues Feld</p>
          <input
            value={name}
            placeholder="Name"
            aria-label="Name des neuen Felds"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            className="mb-2 w-full rounded-md border border-line bg-bg px-2 py-1 outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Typ" className="flex-1 rounded-md border border-line bg-bg px-2 py-1">
              {Object.entries(TYPES)
                .filter(([t]) => !(['nr', 'status', 'repeat', 'deps'].includes(t) && hasType(t)))
                .map(([t, label]) => <option key={t} value={t}>{label}</option>)}
            </Select>
            <button onClick={add} className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 font-medium text-white dark:text-bg">
              <Plus size={14} weight="bold" /> Hinzufügen
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

function OptionsEditor({ field, onChange }) {
  const colors = Object.keys(CHIP_COLORS)
  const set = (id, patch) => onChange(field.options.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  return (
    <ul className="mt-2 space-y-1">
      {field.options.map((o) => (
        <li key={o.id} className="flex items-center gap-2">
          <button
            aria-label={`Farbe von ${o.name} wechseln`}
            title="Farbe wechseln"
            onClick={() => set(o.id, { color: colors[(colors.indexOf(o.color) + 1) % colors.length] })}
            style={{ background: CHIP_COLORS[o.color] ?? CHIP_COLORS.grau }}
            className="size-3.5 shrink-0 rounded-full"
          />
          <BlurInput value={o.name} label="Option" onCommit={(v) => v && set(o.id, { name: v })} />
          {field.type === 'status' && (
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted" title="Zählt als erledigt">
              <input type="checkbox" checked={!!o.done} onChange={(e) => set(o.id, { done: e.target.checked })} className="accent-[var(--accent)]" />
              erledigt
            </label>
          )}
          <button aria-label={`${o.name} entfernen`} onClick={() => onChange(field.options.filter((x) => x.id !== o.id))} className="shrink-0 rounded p-0.5 text-faint hover:text-danger">
            <X size={13} />
          </button>
        </li>
      ))}
      <li>
        <button
          onClick={() => onChange([...field.options, { id: newId(), name: 'Neu', color: 'grau' }])}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted hover:bg-hover hover:text-text"
        >
          <Plus size={12} /> Option
        </button>
      </li>
    </ul>
  )
}

function BlurInput({ value, label, onCommit, className = '' }) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => setText(value ?? ''), [value])
  return (
    <input
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== (value ?? '') && onCommit(text.trim())}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={`min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 outline-none hover:bg-hover focus:bg-bg focus:ring-1 focus:ring-accent ${className}`}
    />
  )
}
