import { useMemo, useState } from 'react'
import { CaretLeft, CaretRight, Plus } from '@phosphor-icons/react'
import { CHIP_COLORS, addDays, dayOf, fieldsOf, isDone, iso, option, statusField, timeOf, today } from './fields.js'
import { parseQuick } from './quick.js'
import { eventDays, eventTime } from './outlook.js'

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

// Monatsansicht: Punkte nach einem Datumsfeld, Ziehen verschiebt den Termin, "+" legt am Tag an
export default function CalendarView({ rows, dbOf, events = [], field = 'due', onOpen, onRow, onAdd, hideDone, header }) {
  const [month, setMonth] = useState(() => today().slice(0, 7))
  const [adding, setAdding] = useState(null)
  const [open, setOpen] = useState(null)
  const [over, setOver] = useState(null)
  const t = today()

  const days = useMemo(() => {
    const first = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1)
    const start = iso(new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7)))
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [month])

  const byDay = useMemo(() => {
    const map = new Map()
    for (const r of rows) {
      const v = r.props?.[field]
      if (!v || (hideDone && isDone(r, fieldsOf(dbOf(r))))) continue
      map.set(dayOf(v), [...(map.get(dayOf(v)) ?? []), r])
    }
    // ohne Uhrzeit ans Ende des Tages
    const at = (r) => timeOf(r.props[field]) ?? '99'
    for (const list of map.values()) list.sort((a, b) => at(a).localeCompare(at(b)))
    return map
  }, [rows, field, hideDone, dbOf])

  // Outlook-Termine je Tag (nur Anzeige)
  const eventsByDay = useMemo(() => {
    const map = new Map()
    for (const e of events) for (const d of eventDays(e)) map.set(d, [...(map.get(d) ?? []), e])
    return map
  }, [events])

  const shift = (n) => {
    const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + n, 1)
    setMonth(iso(d).slice(0, 7))
  }
  const label = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })

  function drop(e, day) {
    e.preventDefault()
    setOver(null)
    const row = rows.find((r) => r.id === e.dataTransfer.getData('text/plain'))
    if (!row) return
    const time = timeOf(row.props?.[field])
    const value = time ? `${day}T${time}` : day
    if (value !== row.props?.[field]) onRow(row.id, { props: { ...row.props, [field]: value } })
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="min-w-44 text-lg font-semibold capitalize">{label}</h2>
        <button aria-label="Voriger Monat" onClick={() => shift(-1)} className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-text"><CaretLeft size={16} /></button>
        <button onClick={() => setMonth(t.slice(0, 7))} className="rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-text">Heute</button>
        <button aria-label="Nächster Monat" onClick={() => shift(1)} className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-text"><CaretRight size={16} /></button>
        <span className="flex-1" />
        {header}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-line">
        {WEEKDAYS.map((d) => <div key={d} className="border-b border-line bg-side px-2 py-1 text-xs font-medium text-muted">{d}</div>)}
        {days.map((day, i) => {
          const meetings = eventsByDay.get(day) ?? []
          const items = byDay.get(day) ?? []
          const expanded = open === day
          // Termine zählen bei "weitere" mit
          const room = Math.max(0, 3 - meetings.length)
          const shown = expanded ? items : items.slice(0, room)
          return (
            <div
              key={day}
              onDragOver={(e) => (e.preventDefault(), over !== day && setOver(day))}
              onDragLeave={() => over === day && setOver(null)}
              onDrop={(e) => drop(e, day)}
              className={`group/day relative min-h-28 border-line p-1 ${i % 7 ? 'border-l' : ''} ${i >= 7 ? 'border-t' : ''} ${over === day ? 'bg-accent-soft' : day.slice(0, 7) !== month ? 'bg-side/60' : ''}`}
            >
              <div className="mb-1 flex items-center justify-between px-1">
                <span className={`grid size-6 place-items-center rounded-full text-xs ${day === t ? 'bg-accent font-semibold text-white dark:text-bg' : day.slice(0, 7) === month ? '' : 'text-faint'}`}>
                  {Number(day.slice(8))}
                </span>
                {onAdd && (
                  <button aria-label={`Punkt am ${day} anlegen`} onClick={() => setAdding(day)} className="invisible rounded p-0.5 text-faint hover:bg-hover hover:text-text group-hover/day:visible">
                    <Plus size={13} />
                  </button>
                )}
              </div>
              <ul className="space-y-0.5">
                {(expanded ? meetings : meetings.slice(0, 3)).map((e) => (
                  <li key={e.id} title={`${eventTime(e)} ${e.subject}${e.location ? ` (${e.location})` : ''} · Outlook`} className="truncate rounded bg-hover px-1.5 py-0.5 text-xs text-muted">
                    {!e.allDay && <span className="mr-1 text-faint">{e.start.slice(11, 16)}</span>}
                    {e.subject}
                  </li>
                ))}
                {shown.map((r) => {
                  const db = dbOf(r)
                  const o = option(statusField(fieldsOf(db)), r.props?.status)
                  const done = isDone(r, fieldsOf(db))
                  return (
                    <li key={r.id}>
                      <button
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', r.id)}
                        onClick={() => onOpen(r.id)}
                        title={`${r.title}${db ? ` (${db.title})` : ''}`}
                        style={{ borderLeftColor: CHIP_COLORS[o?.color] ?? CHIP_COLORS.grau }}
                        className={`block w-full truncate rounded border-l-[3px] bg-raised px-1.5 py-0.5 text-left text-xs shadow-sm hover:bg-hover ${done ? 'text-faint line-through' : ''}`}
                      >
                        {timeOf(r.props?.[field]) && <span className="mr-1 text-faint">{timeOf(r.props[field])}</span>}
                        {r.title || 'Ohne Titel'}
                      </button>
                    </li>
                  )
                })}
              </ul>
              {items.length + meetings.length > 3 && (
                <button onClick={() => setOpen(expanded ? null : day)} className="mt-0.5 px-1 text-xs text-muted hover:text-text">
                  {expanded ? 'weniger' : `+${items.length + meetings.length - 3} weitere`}
                </button>
              )}
              {adding === day && (
                <input
                  autoFocus
                  aria-label="Neuer Punkt"
                  placeholder="Titel, Enter"
                  onBlur={() => setAdding(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setAdding(null)
                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                      // Tag aus dem Kalender, eine getippte Uhrzeit ("14:00") bleibt erhalten
                      const { title, props } = parseQuick(e.currentTarget.value)
                      const time = timeOf(props.due)
                      delete props.due
                      onAdd(title, { ...props, [field]: time ? `${day}T${time}` : day })
                      setAdding(null)
                    }
                  }}
                  className="anim-pop mt-1 w-full rounded border border-accent bg-raised px-1.5 py-0.5 text-xs outline-none"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
