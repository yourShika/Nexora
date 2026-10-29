import { useEffect, useMemo, useState } from 'react'
import { ChartBar } from '@phosphor-icons/react'
import * as db from './db.js'
import { fieldsOf } from './fields.js'
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
    <figure className="mb-10">
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
      <table className="sr-only">
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

// Statistik über alle LOP-Punkte: Verlauf je Woche, was offen ist und wie lange Punkte brauchen
export default function Stats({ rows, dbOf }) {
  const [events, setEvents] = useState(null)
  useEffect(() => {
    db.doneEvents().then(setEvents, () => setEvents({ changes: [], journal: [] }))
  }, [])
  const s = useMemo(() => {
    if (!events) return null
    const fieldsFor = (r) => fieldsOf(dbOf(r))
    return stats({
      rows,
      fieldsFor,
      listOf: (r) => (dbOf(r) ? dbOf(r).title || 'Ohne Titel' : 'Eingang'),
      done: doneMoments(rows, fieldsFor, events.changes, events.journal),
    })
  }, [rows, dbOf, events])

  return (
    <View title="Statistik" icon={ChartBar} sub="LOP-Punkte der letzten 12 Wochen">
      {!s ? (
        <p className="text-muted">Lädt …</p>
      ) : (
        <>
          <div className="mb-10 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Offen" value={s.open} sub="Punkte jetzt" />
            <Tile label="Überfällig" value={s.late} sub="Fälligkeit vorbei" alert={s.late > 0} />
            <Tile label="Abgeschlossen" value={s.done} sub="in 12 Wochen" />
            <Tile label="Durchlaufzeit" value={s.median == null ? '–' : `${number(s.median)} ${s.median === 1 ? 'Tag' : 'Tage'}`} sub="Median bis abgeschlossen" />
          </div>
          <WeekChart
            title="Neu und abgeschlossen je Woche"
            kind="bar"
            weeks={s.weeks}
            series={[{ key: 'created', label: 'Neu', color: SERIES_1 }, { key: 'done', label: 'Abgeschlossen', color: SERIES_2 }]}
          />
          <WeekChart
            title="Offen am Ende der Woche"
            kind="line"
            weeks={s.weeks}
            series={[{ key: 'open', label: 'Offen', color: SERIES_1 }, { key: 'late', label: 'Davon überfällig', color: SERIES_2 }]}
          />
          <div className="mb-10 grid gap-x-10 gap-y-8 md:grid-cols-2">
            <BarList title="Offen nach Status" items={s.byStatus} />
            <BarList title="Offen nach Liste" items={s.byList} />
            <BarList title="Offen nach Person" items={s.byPerson} />
            <BarList title="Offen nach Priorität" items={s.byPrio} />
            <BarList title="Durchlaufzeit" items={s.spans} empty="In 12 Wochen nichts abgeschlossen." />
          </div>
          <p className="text-xs text-faint">
            Abgeschlossen heißt erledigt oder verworfen. Überfällig im Verlauf rechnet mit dem heutigen Fälligkeitsdatum; verschobene Termine zählen rückwirkend nicht.
          </p>
        </>
      )}
    </View>
  )
}
