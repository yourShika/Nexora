import { addDays, daysBetween, dayOf, iso, isDone, isLate, option, statusField, today } from './fields.js'
import { monday, weekNumber } from './journal.js'

// Statistik über LOP-Punkte: reine Rechnungen, die Ansicht ist Stats.jsx

const localDay = (stamp) => iso(new Date(stamp))

// Wann ein abgeschlossener Punkt abgeschlossen wurde: letzter Status-Wechsel auf eine Erledigt-Option
// im Verlauf ("Status: In Arbeit → Erledigt"), sonst Tagebuch, sonst die letzte Änderung
export function doneMoments(rows, fieldsFor, changes, journal) {
  const changesOf = Map.groupBy(changes, (c) => c.node_id)
  const journalOf = Map.groupBy(journal, (j) => j.node_id)
  const last = (stamps) => stamps.sort().at(-1)
  const out = new Map()
  for (const row of rows) {
    const fields = fieldsFor(row)
    if (!isDone(row, fields)) continue
    const sf = statusField(fields)
    const ends = sf.options.filter((o) => o.done).map((o) => ` → ${o.name}`)
    const toDone = (changesOf.get(row.id) ?? []).filter((c) => c.text.startsWith(`${sf.name}: `) && ends.some((e) => c.text.endsWith(e)))
    out.set(row.id, last(toDone.map((c) => c.created_at)) ?? last((journalOf.get(row.id) ?? []).map((j) => j.at)) ?? row.updated_at)
  }
  return out
}

// Nach Anzahl absteigend; ab `max` Einträgen wird der Rest zu "Weitere"
function tally(items, keyOf, max = 8) {
  const m = new Map()
  for (const it of items) {
    const k = keyOf(it)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  const list = [...m].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de'))
  if (list.length <= max) return list
  const rest = list.slice(max - 1)
  return [...list.slice(0, max - 1), { label: `Weitere (${rest.length})`, count: rest.reduce((s, x) => s + x.count, 0) }]
}

const SPANS = [
  { label: 'Am selben Tag', max: 0 },
  { label: '1 bis 7 Tage', max: 7 },
  { label: '8 bis 30 Tage', max: 30 },
  { label: 'Über 30 Tage', max: Infinity },
]

// rows: lebende Punkte; fieldsFor(row): Felder seiner Liste; listOf(row): Name der Liste; done: doneMoments()
export function stats({ rows, fieldsFor, listOf, done, now = new Date(), weeks = 12 }) {
  const t = today(now)
  const first = addDays(monday(t), -7 * (weeks - 1))
  const doneDay = (r) => (done.has(r.id) ? localDay(done.get(r.id)) : null)
  const created = (r) => localDay(r.created_at)

  const series = Array.from({ length: weeks }, (_, i) => {
    const start = addDays(first, 7 * i)
    const end = addDays(start, 6)
    // Stand am Ende der Woche; die laufende Woche zählt bis heute
    const ref = end < t ? addDays(end, 1) : t
    const open = rows.filter((r) => created(r) <= end && !(doneDay(r) && doneDay(r) <= end))
    return {
      start,
      end,
      label: `KW ${weekNumber(start)}`,
      created: rows.filter((r) => created(r) >= start && created(r) <= end).length,
      done: rows.filter((r) => doneDay(r) >= start && doneDay(r) <= end).length,
      open: open.length,
      // shortcut: nimmt das heutige Fälligkeitsdatum, verschobene Termine zählen rückwirkend nicht
      late: open.filter((r) => r.props?.due && dayOf(r.props.due) < ref).length,
    }
  })

  const open = rows.filter((r) => !isDone(r, fieldsFor(r)))
  const recent = rows.filter((r) => doneDay(r) >= first)
  const leads = recent.map((r) => Math.max(0, daysBetween(created(r), doneDay(r)))).sort((a, b) => a - b)
  const select = (r, id, empty) => {
    const f = fieldsFor(r).find((x) => x.id === id)
    return (f && r.props?.[id] && option(f, r.props[id]).name) || empty
  }
  return {
    weeks: series,
    open: open.length,
    late: open.filter((r) => isLate(r.props?.due, now)).length,
    done: recent.length,
    median: leads.length ? (leads.length % 2 ? leads[(leads.length - 1) / 2] : (leads[leads.length / 2 - 1] + leads[leads.length / 2]) / 2) : null,
    spans: SPANS.map((s, i) => ({ label: s.label, count: leads.filter((d) => d <= s.max && d > (SPANS[i - 1]?.max ?? -1)).length })),
    byStatus: tally(open, (r) => {
      const sf = statusField(fieldsFor(r))
      return (sf && r.props?.[sf.id] && option(sf, r.props[sf.id]).name) || 'Ohne Status'
    }),
    byList: tally(open, listOf),
    byPerson: tally(open, (r) => r.props?.person || 'Niemand'),
    byPrio: tally(open, (r) => select(r, 'prio', 'Ohne Priorität')),
  }
}
