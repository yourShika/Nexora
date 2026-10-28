// Kurzschreibweise der Schnellerfassung:
// "Switch 2.OG tauschen #netzwerk @Müller !hoch fr" -> Titel + Tags, Zuständig, Priorität, Fällig
import { iso, stamp } from './fields.js'

const WEEKDAYS = {
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6,
  // "so" fehlt absichtlich: zu häufig als normales Wort
  mo: 1, di: 2, mi: 3, do: 4, fr: 5, sa: 6,
}
const PRIO = { hoch: 'hoch', h: 'hoch', 1: 'hoch', mittel: 'mittel', m: 'mittel', 2: 'mittel', niedrig: 'niedrig', n: 'niedrig', 3: 'niedrig' }

const addDays = (now, n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)

// Einzelnes Wort als Datum lesen, sonst null
export function parseDate(word, now = new Date()) {
  const low = word.toLowerCase()
  if (low === 'heute') return iso(now)
  // nur kleingeschrieben: "Morgen" ist sonst die Tageszeit
  if (word === 'morgen') return iso(addDays(now, 1))
  if (low === 'übermorgen') return iso(addDays(now, 2))
  if (low in WEEKDAYS) return iso(addDays(now, (WEEKDAYS[low] - now.getDay() + 7) % 7))
  // +7 / -3: Tage ab heute bzw. ab dem Stichtag einer Checklisten-Vorlage
  let m = /^([+-])(\d{1,3})$/.exec(low)
  if (m) return iso(addDays(now, Number(m[2]) * (m[1] === '-' ? -1 : 1)))
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/.exec(low)
  if (m) {
    const [day, month] = [Number(m[1]), Number(m[2])]
    let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getFullYear()
    let date = new Date(year, month - 1, day)
    if (date.getMonth() !== month - 1) return null
    // ohne Jahr und schon vorbei: nächstes Jahr gemeint
    if (!m[3] && iso(date) < iso(now)) date = new Date(++year, month - 1, day)
    return iso(date)
  }
  return null
}

const HOUR = '([01]?\\d|2[0-3])'
const pad = (h) => h.padStart(2, '0')

export function parseQuick(text, now = new Date()) {
  const props = {}
  const tags = []
  const words = []
  let time = null
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    // Uhrzeit: 14:30, 9:00, 14uhr, "14 Uhr"
    let m = new RegExp(`^${HOUR}:([0-5]\\d)$`).exec(t) ?? new RegExp(`^${HOUR}uhr$`, 'i').exec(t)
    if (!m && new RegExp(`^${HOUR}$`).test(t) && /^uhr$/i.test(tokens[i + 1] ?? '')) m = [t, t], i++
    if (m) { time = `${pad(m[1])}:${m[2] ?? '00'}`; continue }
    if (/^#[\p{L}\p{N}_-]+$/u.test(t)) { tags.push(t.slice(1)); continue }
    if (/^@[\p{L}\p{N}._-]+$/u.test(t)) { props.person = t.slice(1); continue }
    if (/^!/.test(t) && PRIO[t.slice(1).toLowerCase()]) { props.prio = PRIO[t.slice(1).toLowerCase()]; continue }
    if (/^nächste$/i.test(t) && /^woche$/i.test(tokens[i + 1] ?? '')) {
      props.due = iso(addDays(now, ((1 - now.getDay() + 7) % 7) || 7))
      i++
      continue
    }
    const date = parseDate(t, now)
    if (date) { props.due = date; continue }
    words.push(t)
  }
  if (tags.length) props.tags = [...new Set(tags)]
  // Nur Uhrzeit: heute, falls noch nicht vorbei, sonst morgen
  if (time) props.due = `${props.due ?? (`${iso(now)}T${time}` > stamp(now) ? iso(now) : iso(addDays(now, 1)))}T${time}`
  return { title: words.join(' '), props }
}
