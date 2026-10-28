import { useEffect, useMemo, useRef, useState } from 'react'
import { CHIP_COLORS, DEPS_FIELD, START_FIELD, addDays, dayOf, daysBetween, formatNr, isDone, option, statusField, timeOf, today } from './fields.js'

// span: so viele Tage zeigt die Zeitleiste mindestens, damit sie die Breite füllt
const ZOOMS = { woche: { px: 36, label: 'Tage', span: 35 }, monat: { px: 14, label: 'Wochen', span: 90 }, quartal: { px: 5, label: 'Monate', span: 270 } }
const ROW = 34

const shiftValue = (v, days) => (v ? addDays(dayOf(v), days) + (timeOf(v) ? `T${timeOf(v)}` : '') : v)
const minDay = (list) => list.reduce((a, b) => (b < a ? b : a))
const maxDay = (list) => list.reduce((a, b) => (b > a ? b : a))

// Gantt: Balken von "Beginn" bis "Fällig"; ohne Beginn ein Meilenstein am Fälligkeitstag
export default function TimelineView({ db, rows, fields, config, onConfig, onRow, onOpen }) {
  const zoomKey = ZOOMS[config.zoom] ? config.zoom : 'monat'
  const px = ZOOMS[zoomKey].px
  const startF = fields.find((f) => f.id === START_FIELD.id && f.type === 'date')
  const depsF = fields.find((f) => f.type === 'deps')
  const sf = statusField(fields)
  const t = today()
  const [drag, setDrag] = useState(null)
  // Ref neben dem State: Ereignisse kommen schneller, als React neu zeichnet
  const dragRef = useRef(null)
  const scroller = useRef(null)

  const items = useMemo(() => {
    const list = []
    for (const r of rows) {
      const e = dayOf(r.props?.due)
      const s = (startF && dayOf(r.props?.[startF.id])) || e
      if (!s) continue
      list.push({ r, s: s <= (e ?? s) ? s : e, e: e ?? s })
    }
    return list.sort((a, b) => a.s.localeCompare(b.s) || a.e.localeCompare(b.e))
  }, [rows, startF])
  const unplanned = rows.length - items.length

  const from = addDays(minDay([t, ...items.map((i) => i.s)]), -3)
  const to = maxDay([addDays(maxDay([t, ...items.map((i) => i.e)]), 21), addDays(from, ZOOMS[zoomKey].span)])
  const total = daysBetween(from, to) + 1
  const x = (day) => daysBetween(from, day) * px
  const days = useMemo(() => Array.from({ length: total }, (_, i) => addDays(from, i)), [from, total])

  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(t) - 240)
    // nur beim Öffnen und Zoomwechsel zu heute springen
  }, [zoomKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Vorschau während des Ziehens
  const view = (it) => {
    if (drag?.id !== it.r.id) return it
    const d = Math.round(drag.dx / px)
    if (drag.mode === 'move') return { ...it, s: addDays(it.s, d), e: addDays(it.e, d) }
    if (drag.mode === 'start') return { ...it, s: minDay([addDays(it.s, d), it.e]) }
    return { ...it, e: maxDay([addDays(it.e, d), it.s]) }
  }

  function finish(it) {
    const cur = dragRef.current
    if (!cur || cur.id !== it.r.id) return
    dragRef.current = null
    const d = Math.round(cur.dx / px)
    const { mode, dx } = cur
    setDrag(null)
    if (!d) return mode === 'move' && Math.abs(dx) < 3 && onOpen(it.r.id)
    const p = { ...it.r.props }
    const hasStart = startF && p[startF.id]
    if (mode === 'move') {
      if (p.due) p.due = shiftValue(p.due, d)
      if (hasStart) p[startF.id] = shiftValue(p[startF.id], d)
    } else if (mode === 'start' && startF) {
      p[startF.id] = shiftValue(p[startF.id] || p.due, Math.min(d, daysBetween(it.s, it.e)))
    } else if (mode === 'end') {
      p.due = shiftValue(p.due || p[startF?.id], Math.max(d, -daysBetween(it.s, it.e)))
    }
    onRow(it.r.id, { props: p })
  }

  const grab = (e, it, mode) => {
    e.stopPropagation()
    // Zeiger festhalten, damit das Ziehen auch außerhalb des Balkens weiterläuft (Stift/Touch können das verweigern)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
    dragRef.current = { id: it.r.id, mode, x0: e.clientX, dx: 0 }
    setDrag(dragRef.current)
  }
  const move = (e) => {
    if (!dragRef.current) return
    dragRef.current = { ...dragRef.current, dx: e.clientX - dragRef.current.x0 }
    setDrag(dragRef.current)
  }

  const addField = (f) => onConfig({ ...config, fields: [...fields, f] })
  const index = new Map(items.map((it, i) => [it.r.id, i]))
  const shown = items.map(view)

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Zoom" className="flex gap-1">
          {Object.entries(ZOOMS).map(([k, z]) => (
            <button key={k} role="radio" aria-checked={zoomKey === k} onClick={() => onConfig({ ...config, zoom: k })} className={`rounded-md px-2.5 py-1 ${zoomKey === k ? 'bg-accent-soft' : 'text-muted hover:bg-hover hover:text-text'}`}>
              {z.label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {!startF && <button onClick={() => addField(START_FIELD)} className="rounded-md border border-line px-2.5 py-1 text-muted hover:border-faint hover:text-text">Feld „Beginn“ anlegen</button>}
        {!depsF && <button onClick={() => addField(DEPS_FIELD)} className="rounded-md border border-line px-2.5 py-1 text-muted hover:border-faint hover:text-text">Abhängigkeiten anlegen</button>}
      </div>
      {!items.length ? (
        <p className="text-muted">Noch keine Punkte mit Termin. Trage „Fällig“{startF ? ' und „Beginn“' : ''} ein, dann erscheinen hier die Balken.</p>
      ) : (
        <div className="flex overflow-hidden rounded-lg border border-line">
          <div className="w-60 shrink-0 border-r border-line bg-side">
            <div className="h-12 border-b border-line" />
            {shown.map((it) => (
              <button key={it.r.id} onClick={() => onOpen(it.r.id)} style={{ height: ROW }} className="flex w-full items-center gap-2 truncate px-3 text-left hover:bg-hover">
                {it.r.props?.nr && <span className="shrink-0 font-mono text-xs text-faint">{formatNr(db, it.r.props.nr)}</span>}
                <span className={`truncate ${isDone(it.r, fields) ? 'text-faint line-through' : ''}`}>{it.r.title || 'Ohne Titel'}</span>
              </button>
            ))}
          </div>
          <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto" onPointerMove={move}>
            <div style={{ width: total * px }} className="relative">
              <Scale days={days} px={px} zoom={zoomKey} t={t} />
              <div className="relative" style={{ height: items.length * ROW }}>
                {zoomKey !== 'quartal' && days.map((d, i) => ([0, 6].includes(new Date(`${d}T00:00`).getDay()) ? <div key={d} className="absolute top-0 h-full bg-side/70" style={{ left: i * px, width: px }} /> : null))}
                <div className="absolute top-0 z-10 h-full w-0.5 bg-accent/70" style={{ left: x(t) + px / 2 }} title="Heute" />
                {depsF && <Arrows items={shown} index={index} field={depsF.id} x={x} px={px} />}
                {shown.map((it, i) => {
                  const o = option(sf, it.r.props?.status)
                  // grau (z. B. "Offen") wirkt als Balken matt: dann die Akzentfarbe
                  const color = !o || o.color === 'grau' ? CHIP_COLORS.petrol : CHIP_COLORS[o.color]
                  const milestone = !startF || !it.r.props?.[startF.id]
                  const top = i * ROW + 7
                  const done = isDone(it.r, fields)
                  if (milestone && it.s === it.e) {
                    return (
                      <div
                        key={it.r.id}
                        onPointerDown={(e) => grab(e, items[i], 'move')}
                        onPointerUp={() => finish(items[i])}
                        title={`${it.r.title} (${it.e})`}
                        className={`absolute z-20 size-4 rotate-45 cursor-grab rounded-[3px] ${done ? 'opacity-50' : ''}`}
                        style={{ left: x(it.e) + px / 2 - 8, top: top + 2, background: color }}
                      />
                    )
                  }
                  return (
                    <div
                      key={it.r.id}
                      onPointerDown={(e) => grab(e, items[i], 'move')}
                      onPointerUp={() => finish(items[i])}
                      title={`${it.r.title}: ${it.s} bis ${it.e}`}
                      className={`group/bar absolute z-20 flex h-5 cursor-grab items-center overflow-hidden rounded-md text-xs text-white shadow-sm ${done ? 'opacity-50' : ''} ${drag?.id === it.r.id ? 'ring-2 ring-accent' : ''}`}
                      style={{ left: x(it.s), width: (daysBetween(it.s, it.e) + 1) * px, top, background: color }}
                    >
                      <span onPointerDown={(e) => grab(e, items[i], 'start')} onPointerUp={(e) => (e.stopPropagation(), finish(items[i]))} className="h-full w-2 shrink-0 cursor-ew-resize bg-black/0 hover:bg-black/20" />
                      <span className="min-w-0 flex-1 truncate px-1">{(daysBetween(it.s, it.e) + 1) * px > 60 ? it.r.title : ''}</span>
                      <span onPointerDown={(e) => grab(e, items[i], 'end')} onPointerUp={(e) => (e.stopPropagation(), finish(items[i]))} className="h-full w-2 shrink-0 cursor-ew-resize hover:bg-black/20" />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
      {unplanned > 0 && <p className="mt-2 text-xs text-faint">{unplanned} {unplanned === 1 ? 'Punkt' : 'Punkte'} ohne Termin nicht gezeigt.</p>}
    </div>
  )
}

function Scale({ days, px, zoom, t }) {
  return (
    <div className="relative h-12 border-b border-line text-xs">
      {days.map((d, i) =>
        d.endsWith('-01') || i === 0 ? (
          <span key={`m${d}`} className="absolute top-1 whitespace-nowrap px-1 font-medium" style={{ left: i * px }}>
            {new Date(`${d}T00:00`).toLocaleDateString('de-DE', { month: 'short', year: 'numeric' })}
          </span>
        ) : null,
      )}
      {days.map((d, i) => {
        const show = zoom === 'woche' || (zoom === 'monat' && new Date(`${d}T00:00`).getDay() === 1)
        return show ? (
          <span key={d} className={`absolute bottom-1 text-center ${d === t ? 'font-semibold text-accent' : 'text-faint'}`} style={{ left: i * px, width: zoom === 'woche' ? px : undefined }}>
            {Number(d.slice(8))}
          </span>
        ) : null
      })}
    </div>
  )
}

// Abhängigkeiten: Linie vom Ende des Vorgängers zum Anfang; rot, wenn der Punkt zu früh beginnt
function Arrows({ items, index, field, x, px }) {
  const lines = []
  items.forEach((it, i) => {
    for (const pred of it.r.props?.[field] ?? []) {
      const j = index.get(pred)
      if (j == null) continue
      const p = items[j]
      const [x1, y1, x2, y2] = [x(p.e) + px, j * ROW + ROW / 2, x(it.s), i * ROW + ROW / 2]
      const bad = it.s <= p.e
      lines.push(
        <path key={`${pred}-${it.r.id}`} d={`M ${x1} ${y1} H ${x1 + 6} V ${y2} H ${x2}`} fill="none" stroke={bad ? 'var(--danger)' : 'var(--faint)'} strokeWidth="1.5" markerEnd={`url(#${bad ? 'pfeil-rot' : 'pfeil'})`}>
          <title>{bad ? 'Beginnt, bevor der Vorgänger fertig ist' : 'Abhängigkeit'}</title>
        </path>,
      )
    }
  })
  return (
    <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
      <defs>
        <marker id="pfeil" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="var(--faint)" /></marker>
        <marker id="pfeil-rot" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="var(--danger)" /></marker>
      </defs>
      {lines}
    </svg>
  )
}
