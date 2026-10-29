import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChartBar, Check, DotsSixVertical, Eye, EyeSlash, Funnel, Plus, SlidersHorizontal, Trash } from '@phosphor-icons/react'
import * as db from './db.js'
import { LOP_FIELDS, fieldsOf, isDone } from './fields.js'
import { CHART_TYPES, GROUPS, fromList } from './diagram.js'
import { ChartView } from './Chart.jsx'
import Menu from './Menu.jsx'
import Select from './Select.jsx'
import { doneMoments, stats } from './stats.js'
import { View } from './Rows.jsx'

const W = 760
const H = 200
const PAD = { l: 32, r: 8, t: 12, b: 26 }
const SERIES_1 = 'var(--series-1)'
const SERIES_2 = 'var(--series-2)'
const shortDay = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })
const number = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 })

// Achse in Schritten 1, 2, 5, 10 …, höchstens vier Linien über null
function axis(max) {
  const v = Math.max(max, 1)
  for (let e = 1; ; e *= 10) for (const s of [1, 2, 5]) if (v / (s * e) <= 4) return { step: s * e, top: Math.ceil(v / (s * e)) * s * e }
}

// Balken mit runder Oberkante, unten gerade auf der Grundlinie
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

function WeekChart({ title, weeks, series, kind }) {
  const [hover, setHover] = useState(null)
  const { step, top } = axis(Math.max(...weeks.flatMap((w) => series.map((s) => w[s.key]))))
  const pw = W - PAD.l - PAD.r
  const ph = H - PAD.t - PAD.b
  const col = pw / weeks.length
  const y = (v) => PAD.t + ph - (v / top) * ph
  const cx = (i) => PAD.l + (i + 0.5) * col
  const bw = Math.min(16, (col - 12) / series.length - 2)
  const hovered = hover != null && weeks[hover]
  // Tooltip neben die Spalte, in der linken Hälfte rechts davon, sonst links
  const right = hover != null && cx(hover) < W / 2
  const at = hover != null && ((cx(hover) + (right ? col / 2 : -col / 2)) / W) * 100
  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-medium">{title}</span>
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" aria-hidden onMouseLeave={() => setHover(null)}>
          {kind === 'bar' && hovered && <rect x={PAD.l + hover * col} y={PAD.t} width={col} height={ph} rx="4" fill="var(--hover)" />}
          {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" />
              <text x={PAD.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--faint)">{v}</text>
            </g>
          ))}
          {weeks.map((w, i) => (
            <text key={w.start} x={cx(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={hover === i ? 'var(--text)' : 'var(--faint)'}>{w.label}</text>
          ))}
          {kind === 'bar' &&
            weeks.map((w, i) =>
              series.map((s, j) => {
                const h = (w[s.key] / top) * ph
                const x = cx(i) - (series.length * (bw + 2) - 2) / 2 + j * (bw + 2)
                return h > 0 && <path key={`${i}-${s.key}`} d={barPath(x, PAD.t + ph - h, bw, h)} fill={s.color} />
              }),
            )}
          {kind === 'line' && (
            <>
              {hovered && <line x1={cx(hover)} x2={cx(hover)} y1={PAD.t} y2={PAD.t + ph} stroke="var(--faint)" strokeDasharray="3 3" />}
              {series.map((s) => (
                <g key={s.key}>
                  <polyline points={weeks.map((w, i) => `${cx(i)},${y(w[s.key])}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
                  {weeks.map((w, i) => (
                    <circle key={w.start} cx={cx(i)} cy={y(w[s.key])} r={hover === i ? 5 : 4} fill={s.color} stroke="var(--bg)" strokeWidth="2" />
                  ))}
                </g>
              ))}
            </>
          )}
          {weeks.map((w, i) => (
            <rect key={w.start} x={PAD.l + i * col} y="0" width={col} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {hovered && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs shadow-[var(--shadow)]"
            style={{ left: `${at}%`, transform: right ? 'translateX(8px)' : 'translateX(calc(-100% - 8px))' }}
          >
            <div className="mb-1 whitespace-nowrap font-medium">{hovered.label}, {shortDay(hovered.start)} bis {shortDay(hovered.end)}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 whitespace-nowrap text-muted">
                <span className="size-2 rounded-sm" style={{ background: s.color }} /> {s.label}
                <span className="ml-auto pl-3 tabular-nums text-text">{hovered[s.key]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* sr-only am <table> wirkt nicht (Tabellen ignorieren Höhe und Überlauf) und ergab leeren Platz unter der Seite */}
      <div className="sr-only">
      <table>
        <caption>{title}</caption>
        <thead>
          <tr><th>Woche</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.start}><td>{w.label}</td>{series.map((s) => <td key={s.key}>{w[s.key]}</td>)}</tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  )
}

function BarList({ title, items, empty = 'Keine offenen Punkte.' }) {
  const max = Math.max(1, ...items.map((i) => i.count))
  return (
    <section>
      <h2 className="mb-2 font-medium">{title}</h2>
      {items.some((i) => i.count) ? (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.label} className="grid grid-cols-[minmax(0,9rem)_1fr_2rem] items-center gap-3">
              <span className="truncate" title={it.label}>{it.label}</span>
              <span className="h-2.5">
                {it.count > 0 && <span className="block h-full min-w-0.5 rounded-r-[4px]" style={{ width: `${(it.count / max) * 100}%`, background: SERIES_1 }} />}
              </span>
              <span className="text-right tabular-nums text-muted">{it.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-faint">{empty}</p>
      )}
    </section>
  )
}

function Tile({ label, value, sub, alert }) {
  return (
    <div className="rounded-lg border border-line bg-raised px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${alert ? 'text-danger' : ''}`}>{value}</div>
      <div className="text-xs text-faint">{sub}</div>
    </div>
  )
}

const RANGES = [4, 12, 26, 52]
// Bausteine: [id, Name, Breite im Raster aus 4 Spalten]
const BLOCKS = [
  ['offen', 'Offen', 1], ['ueberfaellig', 'Überfällig', 1], ['abgeschlossen', 'Abgeschlossen', 1], ['durchlauf', 'Durchlaufzeit (Median)', 1],
  ['woche', 'Neu und abgeschlossen je Woche', 4], ['verlauf', 'Offen am Ende der Woche', 4],
  ['status', 'Offen nach Status', 2], ['liste', 'Offen nach Liste', 2], ['person', 'Offen nach Person', 2], ['prio', 'Offen nach Priorität', 2], ['dauer', 'Durchlaufzeit', 2],
]
const SPAN = { 1: 'col-span-2 md:col-span-1', 2: 'col-span-4 md:col-span-2', 4: 'col-span-4' }
// lists: [] = alle, sonst Listen-IDs und 'eingang'; order/hidden: Bausteine; charts: eigene Diagramme
const DEFAULT = { lists: [], weeks: 12, order: BLOCKS.map(([id]) => id), hidden: [], charts: [] }
const chartName = (c) => c.titel || `${CHART_TYPES.find(([id]) => id === c.typ)?.[1] ?? 'Diagramm'} nach ${GROUPS.find(([id]) => id === c.gruppe)?.[1] ?? '…'}`

// Statistik über die LOP-Punkte: Verlauf je Woche, was offen ist und wie lange Punkte brauchen.
// Einstellbar (Einstellung "statistik"): welche Listen, Zeitraum, Bausteine ein/aus und Reihenfolge, eigene Diagramme
export default function Stats({ rows, dbOf, lists }) {
  const [events, setEvents] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [editing, setEditing] = useState(false)
  const [picker, setPicker] = useState(null)
  const closePicker = useCallback(() => setPicker(null), [])
  const [drag, setDrag] = useState(null)
  const [over, setOver] = useState(null) // { id, side }
  useEffect(() => {
    db.doneEvents().then(setEvents, () => setEvents({ changes: [], journal: [] }))
    db.getSetting('statistik').then((v) => setCfg({ ...DEFAULT, ...(v ? JSON.parse(v) : {}) }), () => setCfg(DEFAULT))
  }, [])
  const save = (patch) => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    db.setSetting('statistik', JSON.stringify(next)).catch(() => {})
  }

  const chosen = (cfg?.lists ?? []).filter((id) => id === 'eingang' || lists.some((l) => l.id === id))
  const shown = useMemo(() => (chosen.length ? rows.filter((r) => chosen.includes(r.parent_id ?? 'eingang')) : rows), [rows, chosen.join()])
  const fieldsFor = useCallback((r) => fieldsOf(dbOf(r)), [dbOf])
  const s = useMemo(() => {
    if (!events || !cfg) return null
    return stats({
      rows: shown,
      fieldsFor,
      listOf: (r) => (dbOf(r) ? dbOf(r).title || 'Ohne Titel' : 'Eingang'),
      done: doneMoments(shown, fieldsFor, events.changes, events.journal),
      weeks: cfg.weeks,
    })
  }, [shown, dbOf, events, cfg?.weeks])

  if (!s) return <View title="Statistik" icon={ChartBar} sub="LOP-Punkte"><p className="text-muted">Lädt …</p></View>

  const n = cfg.weeks
  const builtIn = new Map(BLOCKS.map(([id, name, size]) => [id, { name, size }]))
  const custom = new Map(cfg.charts.map((c) => [`diagramm:${c.id}`, c]))
  // gespeicherte Reihenfolge; Neues (spätere Versionen, eben angelegte Diagramme) hinten an
  const order = [...cfg.order.filter((id) => builtIn.has(id) || custom.has(id)), ...[...builtIn.keys(), ...custom.keys()].filter((id) => !cfg.order.includes(id))]
  const blocks = order.filter((id) => editing || !cfg.hidden.includes(id))
  const toggle = (id) => save({ hidden: cfg.hidden.includes(id) ? cfg.hidden.filter((x) => x !== id) : [...cfg.hidden, id] })
  const changeChart = (id, patch) => save({ charts: cfg.charts.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const addChart = () => {
    const id = Math.random().toString(36).slice(2, 8)
    save({ charts: [...cfg.charts, { id, typ: 'ring', gruppe: 'status', nur: 'offen', titel: '' }], order: [...order, `diagramm:${id}`] })
  }
  const removeChart = (key) => save({ charts: cfg.charts.filter((c) => `diagramm:${c.id}` !== key), order: order.filter((x) => x !== key) })
  function drop(id, e) {
    const r = e.currentTarget.getBoundingClientRect()
    // breite Bausteine: obere/untere Hälfte, schmale: linke/rechte
    const before = r.width > e.currentTarget.parentElement.clientWidth * 0.6 ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2
    return before ? 'before' : 'after'
  }
  function move(id, target, side) {
    const rest = order.filter((x) => x !== id)
    rest.splice(rest.indexOf(target) + (side === 'after' ? 1 : 0), 0, id)
    save({ order: rest })
  }

  const content = (id) => {
    switch (id) {
      case 'offen': return <Tile label="Offen" value={s.open} sub="Punkte jetzt" />
      case 'ueberfaellig': return <Tile label="Überfällig" value={s.late} sub="Fälligkeit vorbei" alert={s.late > 0} />
      case 'abgeschlossen': return <Tile label="Abgeschlossen" value={s.done} sub={`in ${n} Wochen`} />
      case 'durchlauf': return <Tile label="Durchlaufzeit" value={s.median == null ? '–' : `${number(s.median)} ${s.median === 1 ? 'Tag' : 'Tage'}`} sub="Median bis abgeschlossen" />
      case 'woche': return <WeekChart title="Neu und abgeschlossen je Woche" kind="bar" weeks={s.weeks} series={[{ key: 'created', label: 'Neu', color: SERIES_1 }, { key: 'done', label: 'Abgeschlossen', color: SERIES_2 }]} />
      case 'verlauf': return <WeekChart title="Offen am Ende der Woche" kind="line" weeks={s.weeks} series={[{ key: 'open', label: 'Offen', color: SERIES_1 }, { key: 'late', label: 'Davon überfällig', color: SERIES_2 }]} />
      case 'status': return <BarList title="Offen nach Status" items={s.byStatus} />
      case 'liste': return <BarList title="Offen nach Liste" items={s.byList} />
      case 'person': return <BarList title="Offen nach Person" items={s.byPerson} />
      case 'prio': return <BarList title="Offen nach Priorität" items={s.byPrio} />
      case 'dauer': return <BarList title="Durchlaufzeit" items={s.spans} empty={`In ${n} Wochen nichts abgeschlossen.`} />
      default: {
        const c = custom.get(id)
        return <CustomChart chart={c} rows={shown} fieldsFor={fieldsFor} editing={editing} onChange={(patch) => changeChart(c.id, patch)} />
      }
    }
  }

  const listLabel = !chosen.length ? 'Alle Listen' : chosen.length === 1 ? (chosen[0] === 'eingang' ? 'Eingang' : lists.find((l) => l.id === chosen[0])?.title) : `${chosen.length} Listen`
  const pick = (id) => save({ lists: id === null ? [] : chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] })
  const bar = 'flex items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 py-1 text-sm'
  return (
    <View title="Statistik" icon={ChartBar} sub={`${chosen.length ? listLabel : 'Alle LOP-Punkte'}, die letzten ${n} Wochen`}>
      <div className="mb-8 flex flex-wrap items-center gap-2">
        <button
          aria-haspopup="dialog"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setPicker({ x: r.left, y: r.bottom + 4 })
          }}
          className={`${bar} hover:border-faint`}
        >
          <Funnel size={14} className="text-muted" /> {listLabel}
        </button>
        <Select aria-label="Zeitraum" value={n} onChange={(e) => save({ weeks: Number(e.target.value) })} className={bar}>
          {RANGES.map((w) => <option key={w} value={w}>{w} Wochen</option>)}
        </Select>
        <span className="flex-1" />
        {editing && (
          <>
            <button onClick={addChart} className={`${bar} hover:border-faint`}><Plus size={14} /> Diagramm</button>
            <button onClick={() => save({ order: DEFAULT.order, hidden: [], charts: [] })} className="rounded-md px-2.5 py-1 text-sm text-muted hover:bg-hover hover:text-text">Zurücksetzen</button>
          </>
        )}
        <button onClick={() => setEditing(!editing)} aria-pressed={editing} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm ${editing ? 'bg-accent font-medium text-white dark:text-bg' : 'text-muted hover:bg-hover hover:text-text'}`}>
          {editing ? <Check size={14} /> : <SlidersHorizontal size={14} />} {editing ? 'Fertig' : 'Anpassen'}
        </button>
      </div>
      {picker && (
        <Menu x={picker.x} y={picker.y} onClose={closePicker} role="dialog" label="Listen wählen">
          <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover">
            <input type="checkbox" checked={!chosen.length} onChange={() => pick(null)} className="accent-[var(--accent)]" /> Alle Listen
          </label>
          <div className="my-1 border-t border-line" />
          {[{ id: 'eingang', title: 'Eingang' }, ...lists].map((l) => (
            <label key={l.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover">
              <input type="checkbox" checked={chosen.includes(l.id)} onChange={() => pick(l.id)} className="accent-[var(--accent)]" /> <span className="max-w-72 truncate">{l.title}</span>
            </label>
          ))}
        </Menu>
      )}
      {editing && <p className="mb-4 text-sm text-muted">Bausteine ziehen zum Umordnen, das Auge blendet aus und ein. Ausgeblendete sind hier blass zu sehen.</p>}
      <div className="mb-10 grid grid-cols-4 gap-x-6 gap-y-8">
        {blocks.map((id) => {
          const meta = builtIn.get(id) ?? { name: chartName(custom.get(id)), size: 2 }
          const off = cfg.hidden.includes(id)
          const mark = over?.id !== id ? '' : over.side === 'before' ? 'shadow-[-3px_0_0_var(--accent)]' : 'shadow-[3px_0_0_var(--accent)]'
          return (
            <div
              key={id}
              draggable={editing}
              onDragStart={(e) => (setDrag(id), (e.dataTransfer.effectAllowed = 'move'), e.dataTransfer.setData('application/x-nexora-stat', id))}
              onDragEnd={() => (setDrag(null), setOver(null))}
              onDragOver={(e) => {
                if (!drag || drag === id) return
                e.preventDefault()
                const side = drop(id, e)
                if (over?.id !== id || over.side !== side) setOver({ id, side })
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (drag && drag !== id) move(drag, id, drop(id, e))
                setDrag(null)
                setOver(null)
              }}
              className={`${SPAN[meta.size]} min-w-0 ${editing ? 'rounded-lg p-2 outline-1 outline-line outline-dashed' : ''} ${mark}`}
            >
              {editing && (
                <div className="mb-2 flex items-center gap-1 text-xs text-muted">
                  <DotsSixVertical size={14} className="shrink-0 cursor-grab text-faint" />
                  <span className="min-w-0 flex-1 truncate">{meta.name}</span>
                  <button aria-label={`${meta.name} ${off ? 'einblenden' : 'ausblenden'}`} title={off ? 'Einblenden' : 'Ausblenden'} onClick={() => toggle(id)} className="rounded p-1 hover:bg-hover hover:text-text">
                    {off ? <EyeSlash size={14} /> : <Eye size={14} />}
                  </button>
                  {custom.has(id) && (
                    <button aria-label={`${meta.name} entfernen`} title="Entfernen" onClick={() => removeChart(id)} className="rounded p-1 hover:bg-hover hover:text-danger">
                      <Trash size={14} />
                    </button>
                  )}
                </div>
              )}
              <div className={off ? 'opacity-40' : ''}>{content(id)}</div>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-faint">
        Abgeschlossen heißt erledigt oder verworfen. Überfällig im Verlauf rechnet mit dem heutigen Fälligkeitsdatum; verschobene Termine zählen rückwirkend nicht.
      </p>
    </View>
  )
}

// Eigenes Diagramm über die gewählten Listen (wie /Diagramm mit einer LOP-Liste als Quelle)
function CustomChart({ chart, rows, fieldsFor, editing, onChange }) {
  const data = useMemo(() => fromList(rows, rows[0] ? fieldsFor(rows[0]) : LOP_FIELDS, chart.gruppe, chart.nur, (r) => isDone(r, fieldsFor(r))), [rows, fieldsFor, chart.gruppe, chart.nur])
  const field = 'rounded-md border border-line bg-raised px-2 py-1 text-xs'
  return (
    <section>
      {editing ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <input value={chart.titel} placeholder={chartName({ ...chart, titel: '' })} aria-label="Titel des Diagramms" onChange={(e) => onChange({ titel: e.target.value })} className={`min-w-0 flex-1 ${field}`} />
          <Select aria-label="Art" value={chart.typ} onChange={(e) => onChange({ typ: e.target.value })} className={field}>
            {CHART_TYPES.filter(([id]) => id !== 'punkte').map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
          <Select aria-label="Gruppieren nach" value={chart.gruppe} onChange={(e) => onChange({ gruppe: e.target.value })} className={field}>
            {GROUPS.map(([id, name]) => <option key={id} value={id}>nach {name}</option>)}
          </Select>
          <Select aria-label="Welche Punkte" value={chart.nur} onChange={(e) => onChange({ nur: e.target.value })} className={field}>
            <option value="offen">nur offene</option>
            <option value="alle">alle</option>
          </Select>
        </div>
      ) : (
        <h2 className="mb-2 font-medium">{chartName(chart)}</h2>
      )}
      {data.series[0]?.values.length ? <ChartView spec={{ typ: chart.typ, titel: '' }} data={data} className="h-60" /> : <p className="text-faint">Keine Punkte.</p>}
    </section>
  )
}
