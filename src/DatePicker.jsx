import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { CalendarBlank, CaretLeft, CaretRight } from '@phosphor-icons/react'
import Menu from './Menu.jsx'
import { addDays, formatDate, isoWeek, parseTime, today } from './fields.js'

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const monday = (day) => addDays(day, -((new Date(`${day}T12:00:00`).getDay() + 6) % 7))
// gleicher Tag im Nachbarmonat, am Monatsende gekürzt (31.1. → 28.2.)
function shiftMonth(day, n) {
  const [y, m, d] = day.split('-').map(Number)
  const last = new Date(y, m - 1 + n + 1, 0).getDate()
  const t = new Date(y, m - 1 + n, Math.min(d, last))
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}
const long = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

// Monatskalender im Nexora-Stil statt des Windows-Kalenders: Schnellknöpfe, Kalenderwochen,
// Pfeiltasten (Tag/Woche), Bild auf/ab (Monat), Pos1/Ende (Wochenanfang/-ende), Enter wählt
export function DatePicker({ value, onPick }) {
  const t = today()
  const [focus, setFocus] = useState(value || t)
  const grid = useRef(null)
  const moved = useRef(false)
  useEffect(() => {
    if (moved.current) grid.current?.querySelector(`[data-day="${focus}"]`)?.focus()
  }, [focus])
  const go = (day) => ((moved.current = true), setFocus(day))

  const start = monday(`${focus.slice(0, 7)}-01`)
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)))
  const label = new Date(`${focus.slice(0, 7)}-01T12:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })
  const nextMonday = addDays(monday(t), 7)

  function key(e) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (step) go(addDays(focus, step))
    else if (e.key === 'PageUp' || e.key === 'PageDown') go(shiftMonth(focus, e.key === 'PageUp' ? -1 : 1))
    else if (e.key === 'Home') go(monday(focus))
    else if (e.key === 'End') go(addDays(monday(focus), 6))
    else return
    e.preventDefault()
  }

  const quick = 'rounded-md px-2 py-1 text-xs text-muted hover:bg-hover hover:text-text'
  return (
    <div className="w-72 p-1.5 text-sm">
      <div className="mb-1.5 flex flex-wrap gap-1">
        <button className={quick} onClick={() => onPick(t)}>Heute</button>
        <button className={quick} onClick={() => onPick(addDays(t, 1))}>Morgen</button>
        <button className={quick} onClick={() => onPick(nextMonday)}>Nächste Woche</button>
        {value && <button className={`${quick} ml-auto`} onClick={() => onPick(null)}>Leeren</button>}
      </div>
      <div className="mb-1 flex items-center gap-1">
        <span className="flex-1 pl-1 font-medium capitalize">{label}</span>
        <button aria-label="Voriger Monat" onClick={() => setFocus(shiftMonth(focus, -1))} className="rounded-md p-1 text-muted hover:bg-hover hover:text-text"><CaretLeft size={14} /></button>
        <button aria-label="Nächster Monat" onClick={() => setFocus(shiftMonth(focus, 1))} className="rounded-md p-1 text-muted hover:bg-hover hover:text-text"><CaretRight size={14} /></button>
      </div>
      <div ref={grid} onKeyDown={key} role="group" aria-label={label} className="grid grid-cols-[1.75rem_repeat(7,1fr)] gap-y-0.5 text-center">
        <span className="text-[10px] leading-6 text-faint">KW</span>
        {WEEKDAYS.map((d) => <span key={d} className="text-xs leading-6 text-faint">{d}</span>)}
        {weeks.map((week) => [
          <span key={`kw${week[0]}`} className="text-[10px] leading-8 text-faint">{isoWeek(week[0])}</span>,
          ...week.map((day, i) => {
            const picked = day === value
            const other = day.slice(0, 7) !== focus.slice(0, 7)
            return (
              <button
                key={day}
                data-day={day}
                data-autofocus={day === focus || undefined}
                tabIndex={day === focus ? 0 : -1}
                aria-label={long(day)}
                aria-pressed={picked}
                aria-current={day === t ? 'date' : undefined}
                onClick={() => onPick(day)}
                className={`mx-auto grid size-8 place-items-center rounded-full text-xs tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  picked ? 'bg-accent font-semibold text-white dark:text-bg' : day === t ? 'font-semibold text-accent ring-1 ring-accent/50 hover:bg-hover' : other ? 'text-faint hover:bg-hover' : i > 4 ? 'text-muted hover:bg-hover' : 'hover:bg-hover'
                }`}
              >
                {Number(day.slice(8))}
              </button>
            )
          }),
        ])}
      </div>
    </div>
  )
}

// Knopf mit dem Datum ("Fr., 30. Okt."), Klick öffnet den Kalender
export function DateField({ value, onChange, className = '', placeholder = 'Datum wählen', ...aria }) {
  const [at, setAt] = useState(null)
  const close = useCallback(() => setAt(null), [])
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ x: r.left, y: r.bottom + 4 })
        }}
        {...aria}
        className={`inline-flex items-center gap-2 text-left ${className}`}
      >
        <CalendarBlank size={14} className="shrink-0 text-faint" />
        {value ? formatDate(value) : <span className="text-faint">{placeholder}</span>}
      </button>
      {at && (
        <Menu x={at.x} y={at.y} onClose={close} role="dialog" label="Datum wählen">
          <DatePicker value={value} onPick={(day) => (close(), onChange(day))} />
        </Menu>
      )}
    </>
  )
}

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)

// Uhrzeit tippen ("930", "14.30") oder aus der Liste wählen (halbe Stunden); onChange bekommt "HH:MM" oder ""
export function TimeInput({ value, onChange, className = '', placeholder = '--:--', ...aria }) {
  const [text, setText] = useState(value ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const list = useRef(null)
  const id = useId()
  useEffect(() => setText(value ?? ''), [value])
  // beim Tippen nur die passende Stunde: "1" → 01:xx und 10–19 Uhr, "14" → 14:xx, "715" → 07:xx (wie parseTime)
  const digits = text.replace(/\D/g, '')
  const hour = digits.length === 3 && !/[:.,]/.test(text) ? `0${digits[0]}` : digits.slice(0, 2)
  const shown = !digits || TIMES.includes(text) ? TIMES : TIMES.filter((x) => (digits.length === 1 ? x.startsWith(digits) || x.startsWith(`0${digits}`) : x.startsWith(hour)))
  const [pos, setPos] = useState(null)
  useEffect(() => {
    if (!open || !list.current) return
    const at = active >= 0 ? active : Math.max(0, shown.findIndex((x) => x >= (value || '08:00')))
    list.current.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: active >= 0 ? 'nearest' : 'start' })
  }, [open, active])

  const commit = (raw) => {
    const t = parseTime(raw)
    setOpen(false)
    setActive(-1)
    if (t === null) return setText(value ?? '') // ungültig: alter Wert bleibt
    setText(t)
    if (t !== (value ?? '')) onChange(t)
  }
  function key(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(shown.length - 1, Math.max(0, a + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(active >= 0 ? shown[active] : text)
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
      setText(value ?? '')
    }
  }

  return (
    <span className="relative inline-flex">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        onFocus={(e) => {
          e.target.select()
          // fest am Fenster, damit kein Überlauf (Tabelle, Eigenschaften) die Liste abschneidet
          const r = e.target.getBoundingClientRect()
          setPos({ left: r.left, top: r.bottom + 4 })
          setOpen(true)
        }}
        onChange={(e) => (setText(e.target.value), setActive(-1), setOpen(true))}
        onBlur={() => commit(text)}
        onKeyDown={key}
        {...aria}
        className={`tabular-nums ${className}`}
      />
      {open && shown.length > 0 && (
        <ul
          ref={list}
          id={id}
          role="listbox"
          onMouseDown={(e) => (e.preventDefault(), e.stopPropagation())}
          style={pos ?? undefined}
          className="anim-pop fixed z-50 max-h-56 w-24 overflow-y-auto rounded-lg border border-line bg-raised p-1 text-sm shadow-[var(--shadow)]"
        >
          {shown.map((x, i) => (
            <li
              key={x}
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={x === value}
              onClick={() => commit(x)}
              onMouseEnter={() => setActive(i)}
              className={`cursor-default rounded-md px-2 py-1 tabular-nums ${i === active ? 'bg-hover' : ''} ${x === value ? 'font-semibold text-accent' : ''}`}
            >
              {x}
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
