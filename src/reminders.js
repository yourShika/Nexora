import { dayOf, fieldsOf, isDone, iso, stamp, timeOf } from './fields.js'

const FIELDS = { due: 'Fällig', followup: 'Wiedervorlage' }

// Was jetzt zu melden ist (ohne Seiteneffekte, testbar).
// notified: Set "id|feld|wert"; lastDigest: Tag der letzten Sammelmeldung; digestTime: "HH:MM"
export function plan(rows, dbOf, { notified, lastDigest, digestTime }, now = new Date()) {
  const t = iso(now)
  const nowStamp = stamp(now)
  const open = rows.filter((r) => !isDone(r, fieldsOf(dbOf(r))))

  // Punkte mit Uhrzeit: melden, sobald sie erreicht ist (nur heute, Verpasstes von gestern deckt die Sammelmeldung)
  const timed = []
  for (const r of open) {
    for (const field of Object.keys(FIELDS)) {
      const v = r.props?.[field]
      if (!timeOf(v) || dayOf(v) !== t || v > nowStamp) continue
      const key = `${r.id}|${field}|${v}`
      if (!notified.has(key)) timed.push({ row: r, field, value: v, key })
    }
  }

  let digest = null
  if (lastDigest !== t && nowStamp.slice(11) >= digestTime) {
    digest = {
      late: open.filter((r) => r.props?.due && dayOf(r.props.due) < t),
      due: open.filter((r) => dayOf(r.props?.due) === t),
      followup: open.filter((r) => r.props?.followup && dayOf(r.props.followup) <= t),
    }
  }
  return { timed, digest }
}

export function timedMessage({ row, field, value }, list) {
  return { title: `${FIELDS[field]} ${timeOf(value)}: ${row.title || 'Ohne Titel'}`, body: list ? list.title : 'Eingang' }
}

export function digestMessage({ late, due, followup }) {
  const parts = [late.length && `${late.length} überfällig`, due.length && `${due.length} heute fällig`, followup.length && `${followup.length} Wiedervorlage`].filter(Boolean)
  if (!parts.length) return null
  const titles = [...new Set([...late, ...due, ...followup].map((r) => r.title || 'Ohne Titel'))]
  return {
    title: `Heute: ${parts.join(', ')}`,
    body: titles.slice(0, 3).join(', ') + (titles.length > 3 ? ` und ${titles.length - 3} weitere` : ''),
  }
}
