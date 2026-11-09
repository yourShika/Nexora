import { useEffect, useMemo, useRef, useState } from 'react'
import { CaretLeft, CaretRight, Plus } from '@phosphor-icons/react'
import { CHIP_COLORS, LOP_FIELDS, chipHex, addDays, dayOf, fieldsOf, isDone, iso, isoWeek, option, timeOf, today } from './fields.js'
import { parseQuick } from './quick.js'
import { BUSY, eventDays, eventLook, eventTime, openEvent } from './outlook.js'
import { clock, eventSpan, layoutDay, rowSpan, snap, weekStart } from './calendar.js'
import { useApp } from './ctx.js'

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const MODES = [['day', 'Tag'], ['week', 'Woche'], ['month', 'Monat']]
const PREV = { day: 'Voriger Tag', week: 'Vorige Woche', month: 'Voriger Monat' }
const NEXT = { day: 'Nächster Tag', week: 'Nächste Woche', month: 'Nächster Monat' }
const MODE_KEY = 'kalender-ansicht' // gilt für alle Kalender, wie in Outlook
const HOUR = 48 // Pixel je Stunde im Raster

const dateOf = (day) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
const weekdayOf = (day) => WEEKDAYS[(dateOf(day).getDay() + 6) % 7]

// Tag, Woche (Stundenraster wie in Outlook) oder Monat: Punkte nach einem Datumsfeld, Ziehen verschiebt den Termin
export default function CalendarView({ rows, dbOf, events = [], field = 'due', onOpen, onRow, onAdd, hideDone, header }) {
  const [mode, setModeState] = useState(() => (MODES.some(([m]) => m === localStorage.getItem(MODE_KEY)) ? localStorage.getItem(MODE_KEY) : 'month'))
  const setMode = (m) => (localStorage.setItem(MODE_KEY, m), setModeState(m))
  const [anchor, setAnchor] = useState(today)
  const month = anchor.slice(0, 7)
  const t = today()

  const days = useMemo(() => {
    if (mode === 'day') return [anchor]
    if (mode === 'week') return Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i))
    const first = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1)
    const start = iso(new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7)))
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [mode, anchor, month])

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

  const shift = (n) =>
    setAnchor(mode === 'month' ? iso(new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + n, 1)) : addDays(anchor, n * (mode === 'week' ? 7 : 1)))
  const label = (() => {
    if (mode === 'day') return dateOf(anchor).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    if (mode === 'month') return dateOf(`${month}-01`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
    const [a, b] = [dateOf(days[0]), dateOf(days[6])]
    const end = b.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
    return `${a.getMonth() === b.getMonth() ? `${a.getDate()}.` : a.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })} – ${end} · KW ${isoWeek(days[0])}`
  })()

  // Gezogener Punkt landet am Tag; im Raster mit der Uhrzeit der Stelle, ganztägig ohne, im Monat behält er seine
  function move(id, day, min) {
    const row = rows.find((r) => r.id === id)
    if (!row) return
    const time = min === undefined ? timeOf(row.props?.[field]) : min === null ? null : clock(min)
    const value = time ? `${day}T${time}` : day
    if (value !== row.props?.[field]) onRow(row.id, { props: { ...row.props, [field]: value } })
  }
  const showDay = (day) => (setAnchor(day), setMode('day'))
  const shared = { byDay, eventsByDay, field, dbOf, onOpen, onAdd, move, t }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="min-w-44 text-lg font-semibold">{label}</h2>
        <button aria-label={PREV[mode]} onClick={() => shift(-1)} className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-text"><CaretLeft size={16} /></button>
        <button onClick={() => setAnchor(t)} className="rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-text">Heute</button>
        <button aria-label={NEXT[mode]} onClick={() => shift(1)} className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-text"><CaretRight size={16} /></button>
        <span className="flex-1" />
        {header}
        <div role="group" aria-label="Kalenderansicht" className="flex rounded-md border border-line p-0.5">
          {MODES.map(([m, name]) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)} className={`rounded px-2.5 py-0.5 ${mode === m ? 'bg-accent-soft text-text' : 'text-muted hover:bg-hover hover:text-text'}`}>
              {name}
            </button>
          ))}
        </div>
      </div>
      {mode === 'month' ? <MonthGrid days={days} month={month} onDay={showDay} {...shared} /> : <TimeGrid days={days} onDay={showDay} {...shared} />}
      <Legend outlook={events.length > 0} />
    </div>
  )
}

function MonthGrid({ days, month, byDay, eventsByDay, field, dbOf, onOpen, onAdd, move, onDay, t }) {
  const [adding, setAdding] = useState(null)
  const [open, setOpen] = useState(null)
  const [over, setOver] = useState(null)
  return (
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
            onDrop={(e) => (e.preventDefault(), setOver(null), move(e.dataTransfer.getData('text/plain'), day))}
            className={`group/day relative min-h-28 border-line p-1 ${i % 7 ? 'border-l' : ''} ${i >= 7 ? 'border-t' : ''} ${over === day ? 'bg-accent-soft' : day.slice(0, 7) !== month ? 'bg-side/60' : ''}`}
          >
            <div className="mb-1 flex items-center justify-between px-1">
              <button
                onClick={() => onDay(day)}
                title="Tag anzeigen"
                className={`grid size-6 place-items-center rounded-full text-xs ${day === t ? 'bg-accent font-semibold text-white dark:text-bg' : `hover:bg-hover ${day.slice(0, 7) === month ? '' : 'text-faint'}`}`}
              >
                {Number(day.slice(8))}
              </button>
              {onAdd && (
                <button aria-label={`Punkt am ${day} anlegen`} onClick={() => setAdding(day)} className="invisible rounded p-0.5 text-faint hover:bg-hover hover:text-text group-hover/day:visible">
                  <Plus size={13} />
                </button>
              )}
            </div>
            <ul className="space-y-0.5">
              {(expanded ? meetings : meetings.slice(0, 3)).map((e) => <li key={e.id}><EventChip e={e} time /></li>)}
              {shown.map((r) => <li key={r.id}><RowChip r={r} dbOf={dbOf} field={field} onOpen={onOpen} time /></li>)}
            </ul>
            {items.length + meetings.length > 3 && (
              <button onClick={() => setOpen(expanded ? null : day)} className="mt-0.5 px-1 text-xs text-muted hover:text-text">
                {expanded ? 'weniger' : `+${items.length + meetings.length - 3} weitere`}
              </button>
            )}
            {adding === day && <AddInput day={day} field={field} onAdd={onAdd} onClose={() => setAdding(null)} />}
          </div>
        )
      })}
    </div>
  )
}

// Tag und Woche: oben die Tage und eine Zeile für Ganztägiges, darunter 24 Stunden; scrollt beim Öffnen auf 7 Uhr
function TimeGrid({ days, byDay, eventsByDay, field, dbOf, onOpen, onAdd, move, onDay, t }) {
  const scroller = useRef(null)
  const [now, setNow] = useState(() => new Date())
  const [over, setOver] = useState(null) // { day, min } — min null: ganztägig
  const [adding, setAdding] = useState(null) // { day, min }
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR
  }, [days.length])
  const cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`
  const top = (min) => (min / 60) * HOUR
  const minuteAt = (e) => snap(e.clientY - e.currentTarget.getBoundingClientRect().top, HOUR)
  const drop = (e, day, min) => (e.preventDefault(), setOver(null), move(e.dataTransfer.getData('text/plain'), day, min))
  const nowMin = now.getHours() * 60 + now.getMinutes()

  return (
    <div ref={scroller} className="max-h-[calc(100vh-15rem)] min-h-80 overflow-y-auto rounded-lg border border-line">
      {/* deckend: --side ist bei Verlaufs-Farbschemata durchscheinend, beim Scrollen schienen sonst die Stunden durch */}
      <div className="sticky top-0 z-20 grid border-b border-line bg-raised" style={{ gridTemplateColumns: cols }}>
        <div className="bg-side" />
        {days.map((day) => (
          <button key={day} onClick={() => onDay(day)} disabled={days.length === 1} title={days.length > 1 ? 'Tag anzeigen' : undefined} className="flex items-center gap-1.5 border-l border-line bg-side px-2 py-1 text-left text-xs text-muted enabled:hover:text-text">
            {weekdayOf(day)}
            <span className={`grid size-6 place-items-center rounded-full ${day === t ? 'bg-accent font-semibold text-white dark:text-bg' : ''}`}>{Number(day.slice(8))}</span>
          </button>
        ))}
        <div className="border-t border-line px-1.5 py-1 text-right text-[10px] leading-6 text-faint">ganztägig</div>
        {days.map((day) => {
          const untimed = (byDay.get(day) ?? []).filter((r) => !timeOf(r.props[field]))
          const allDay = (eventsByDay.get(day) ?? []).filter((e) => e.allDay)
          return (
            <div
              key={day}
              onDragOver={(e) => (e.preventDefault(), (over?.day !== day || over.min !== null) && setOver({ day, min: null }))}
              onDragLeave={() => over?.day === day && over.min === null && setOver(null)}
              onDrop={(e) => drop(e, day, null)}
              className={`group/day relative min-h-8 border-l border-t border-line py-0.5 pl-0.5 pr-5 ${over?.day === day && over.min === null ? 'bg-accent-soft' : ''}`}
            >
              <ul className="space-y-0.5">
                {allDay.map((e) => <li key={e.id}><EventChip e={e} /></li>)}
                {untimed.map((r) => <li key={r.id}><RowChip r={r} dbOf={dbOf} field={field} onOpen={onOpen} /></li>)}
              </ul>
              {onAdd && (
                <button aria-label={`Punkt am ${day} anlegen`} onClick={() => setAdding({ day, min: null })} className="invisible absolute right-0.5 top-1 rounded p-0.5 text-faint hover:bg-hover hover:text-text group-hover/day:visible">
                  <Plus size={13} />
                </button>
              )}
              {adding?.day === day && adding.min === null && <AddInput day={day} field={field} onAdd={onAdd} onClose={() => setAdding(null)} />}
            </div>
          )
        })}
      </div>
      <div className="grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR }}>
        <div className="relative">
          {Array.from({ length: 23 }, (_, i) => (
            <span key={i} className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-faint" style={{ top: top((i + 1) * 60) }}>{i + 1}:00</span>
          ))}
        </div>
        {days.map((day) => {
          const blocks = layoutDay([
            ...(eventsByDay.get(day) ?? []).map((e) => ({ key: `e${e.id}`, event: e, ...eventSpan(e, day) })).filter((b) => b.from !== undefined),
            ...(byDay.get(day) ?? []).map((r) => ({ key: r.id, row: r, ...rowSpan(r.props[field]) })).filter((b) => b.from !== undefined),
          ])
          return (
            <div
              key={day}
              data-day={day}
              title={onAdd ? 'Doppelklick legt hier einen Punkt an' : undefined}
              onDragOver={(e) => {
                e.preventDefault()
                const min = minuteAt(e)
                if (over?.day !== day || over.min !== min) setOver({ day, min })
              }}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(null)}
              onDrop={(e) => drop(e, day, minuteAt(e))}
              onDoubleClick={(e) => onAdd && e.target === e.currentTarget && setAdding({ day, min: Math.floor(((e.clientY - e.currentTarget.getBoundingClientRect().top) / HOUR) * 2) * 30 })}
              className="relative border-l border-line"
              style={{ backgroundImage: `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${HOUR}px)` }}
            >
              {blocks.map((b) => (
                <div key={b.key} className="absolute p-px" style={{ top: top(b.from), height: Math.max(20, top(b.to - b.from)), left: `${(b.col / b.cols) * 100}%`, width: `${100 / b.cols}%` }}>
                  {b.row ? <RowChip r={b.row} dbOf={dbOf} field={field} onOpen={onOpen} time grid /> : <EventChip e={b.event} time grid />}
                </div>
              ))}
              {over?.day === day && over.min !== null && (
                <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-accent" style={{ top: top(over.min) }}>
                  <span className="ml-0.5 rounded bg-accent px-1 text-[10px] text-white dark:text-bg">{clock(over.min)}</span>
                </div>
              )}
              {day === t && <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-danger" style={{ top: top(nowMin) }} />}
              {adding?.day === day && adding.min !== null && (
                <div className="absolute inset-x-1 z-10" style={{ top: top(adding.min) }}>
                  <AddInput day={day} min={adding.min} field={field} onAdd={onAdd} onClose={() => setAdding(null)} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Punkt: nach Priorität gefärbt (Liste ohne Priorität: grau), ziehbar
function RowChip({ r, dbOf, field, onOpen, time, grid }) {
  const db = dbOf(r)
  const p = option(fieldsOf(db).find((f) => f.id === 'prio'), r.props?.prio)
  const color = chipHex(p?.color)
  const done = isDone(r, fieldsOf(db))
  const at = time && timeOf(r.props?.[field])
  return (
    <button
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/plain', r.id)}
      onClick={() => onOpen(r.id)}
      title={`${at ? `${at} ` : ''}${r.title}${db ? ` (${db.title})` : ''}${p ? ` · Priorität ${p.name}` : ''}`}
      style={{ borderLeftColor: color, background: p ? `color-mix(in oklab, ${color} 12%, var(--raised))` : undefined }}
      className={`flex w-full items-start rounded border-l-[3px] bg-raised px-1.5 py-0.5 text-left text-xs shadow-sm hover:bg-hover ${grid ? 'h-full overflow-hidden' : ''} ${done ? 'text-faint line-through' : ''}`}
    >
      <span className="min-w-0 truncate">
        {at && <span className="mr-1 text-faint">{at}</span>}
        {r.title || 'Ohne Titel'}
      </span>
    </button>
  )
}

// Outlook-Termin: Klick öffnet ihn in Outlook
function EventChip({ e, time, grid }) {
  const app = useApp()
  const look = eventLook(e)
  return (
    <button
      onClick={() => openEvent(e).catch((err) => app?.notice(`Outlook: ${err.message ?? err}`))}
      title={`${eventTime(e)} ${e.subject}${e.location ? ` (${e.location})` : ''} · ${look.label} · in Outlook öffnen`}
      style={{ background: look.tint ?? undefined }}
      className={`relative flex w-full items-start rounded bg-hover py-0.5 pl-2.5 pr-1.5 text-left text-xs hover:brightness-95 ${grid ? 'h-full overflow-hidden' : ''} ${look.tint ? 'text-text' : 'text-muted'} ${e.busy === 0 ? 'opacity-75' : ''}`}
    >
      <span aria-hidden className="absolute inset-y-0.5 left-0.5 w-[3px] rounded-full" style={{ background: look.stripe }} />
      <span className="min-w-0 truncate">
        {time && !e.allDay && <span className="mr-1 opacity-70">{e.start.slice(11, 16)}</span>}
        {e.subject}
      </span>
    </button>
  )
}

// Neuer Punkt am Tag (im Raster zur angeklickten Zeit); eine getippte Uhrzeit ("14:00") gewinnt
function AddInput({ day, min = null, field, onAdd, onClose }) {
  return (
    <input
      autoFocus
      aria-label="Neuer Punkt"
      placeholder="Titel, Enter"
      onBlur={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
        if (e.key === 'Enter' && e.currentTarget.value.trim()) {
          const { title, props } = parseQuick(e.currentTarget.value)
          const time = timeOf(props.due) ?? (min !== null ? clock(min) : null)
          delete props.due
          onAdd(title, { ...props, [field]: time ? `${day}T${time}` : day })
          onClose()
        }
      }}
      className="anim-pop mt-1 w-full rounded border border-accent bg-raised px-1.5 py-0.5 text-xs outline-none"
    />
  )
}

// Farben erklären, damit sie nicht allein die Bedeutung tragen
const PRIO = LOP_FIELDS.find((f) => f.id === 'prio').options
function Legend({ outlook }) {
  const mark = (background) => <span aria-hidden className="inline-block h-3 w-[3px] rounded-full" style={{ background }} />
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span>Punkte nach Priorität:</span>
      {PRIO.map((o) => <span key={o.id} className="flex items-center gap-1.5">{mark(CHIP_COLORS[o.color])}{o.name}</span>)}
      {outlook && (
        <>
          <span className="ml-2">Outlook:</span>
          {BUSY.map((name, busy) => <span key={name} className="flex items-center gap-1.5">{mark(eventLook({ busy }).stripe)}{name}</span>)}
        </>
      )}
    </p>
  )
}
