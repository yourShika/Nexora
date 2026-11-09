// Rechenteil für Tag- und Wochenansicht des Kalenders (Stundenraster wie in Outlook)
import { addDays, dayOf, timeOf } from './fields.js'

// Montag der Woche, in der der Tag liegt
export function weekStart(day) {
  const wd = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))).getDay()
  return addDays(day, -((wd + 6) % 7))
}

export const minutesOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
export const clock = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

// Punkte haben nur einen Zeitpunkt: im Raster eine halbe Stunde hoch
export const ROW_MINUTES = 30
export function rowSpan(value) {
  const time = timeOf(value)
  if (!time) return null
  const from = minutesOf(time)
  return { from, to: Math.min(1440, from + ROW_MINUTES) }
}

// Teil eines Outlook-Termins an einem Tag (mehrtägige laufen bis Mitternacht weiter); null, wenn nichts übrig bleibt
export function eventSpan(e, day) {
  if (e.allDay) return null
  const from = day === dayOf(e.start) ? minutesOf(e.start.slice(11, 16)) : 0
  const to = day === dayOf(e.end) ? minutesOf(e.end.slice(11, 16)) : 1440
  if (to > from) return { from, to }
  return day === dayOf(e.start) ? { from, to: Math.min(1440, from + 15) } : null // Termin ohne Dauer
}

// Was sich überschneidet, steht nebeneinander: je Gruppe überlappender Einträge so viele Spalten wie nötig
export function layoutDay(items) {
  const sorted = [...items].sort((a, b) => a.from - b.from || b.to - a.to)
  const out = []
  let group = []
  let cols = [] // Ende des letzten Eintrags je Spalte
  let end = 0
  const close = () => {
    for (const g of group) g.cols = cols.length
    group = []
    cols = []
  }
  for (const it of sorted) {
    if (group.length && it.from >= end) close()
    if (!group.length) end = it.to
    let col = cols.findIndex((last) => last <= it.from)
    if (col < 0) col = cols.push(it.to) - 1
    else cols[col] = it.to
    const placed = { ...it, col }
    group.push(placed)
    out.push(placed)
    end = Math.max(end, it.to)
  }
  close()
  return out
}

// Gezogener Punkt: Minute aus der Höhe im Raster, auf Viertelstunden gerundet
export const snap = (y, hour) => Math.max(0, Math.min(1440 - 15, Math.round((y / hour) * 4) * 15))
