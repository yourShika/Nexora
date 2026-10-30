// Aufgaben (Zeitpläne wie Cron, aber ohne Code): reine Logik, ohne Tauri-Aufrufe (testbar)
import { addDays, formatDate, iso, stamp } from './fields.js'
import { eventDays } from './outlook.js'

export const JOB_KINDS = {
  outlook: { label: 'Outlook-Termine aktualisieren', text: 'Liest die Termine neu und schreibt fällige Punkte nach Outlook, so wie unter Einstellungen → Outlook eingestellt.' },
  onenote: { label: 'OneNote abgleichen', text: 'Gleicht verbundene Notizbücher mit OneNote ab.' },
  backup: { label: 'Sicherung anlegen', text: 'Legt eine Sicherung im Ordner an, der unter Einstellungen → Sicherung steht.' },
  overview: { label: 'Terminübersicht schreiben', name: 'Terminübersicht', text: 'Schreibt eine eigene Seite mit deinen Outlook-Terminen: wann, wo und wie viele je Tag. Die Seite wird bei jedem Lauf neu geschrieben.' },
  compare: { label: 'Termine vergleichen', text: 'Vergleicht deine Outlook-Termine mit dem letzten Lauf und meldet sich, wenn etwas neu, verschoben, geändert oder abgesagt ist.' },
}

export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]
export const WORK_DAYS = [1, 2, 3, 4, 5]
export const INTERVALS = [[5, '5 Minuten'], [10, '10 Minuten'], [15, '15 Minuten'], [30, '30 Minuten'], [60, 'Stunde'], [120, '2 Stunden'], [180, '3 Stunden'], [240, '4 Stunden'], [360, '6 Stunden'], [720, '12 Stunden']]
export const RANGES = [[1, 'Nur heute'], [7, '7 Tage'], [14, '14 Tage'], [30, '30 Tage'], [60, '60 Tage']]

export const defaultSchedule = () => ({ mode: 'times', days: [...WORK_DAYS], times: ['08:00'], minutes: 60, from: '08:00', to: '18:00', window: true, day: 1 })
export const defaultOptions = (kind) => ({ overview: { days: 7 }, compare: { days: 14 }, onenote: { notebook: 'alle' } })[kind] ?? {}

const weekday = (d) => ((d.getDay() + 6) % 7) + 1 // Mo = 1 … So = 7
const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const lastOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()

// Uhrzeiten eines Tages in Minuten, aufsteigend
function slots(s, d) {
  if (s.mode === 'monthly') {
    // der 31. greift im kurzen Monat am letzten Tag, nichts fällt aus
    const day = s.day === 'last' ? lastOfMonth(d) : Math.min(s.day, lastOfMonth(d))
    return d.getDate() === day ? s.times.map(toMinutes).sort((a, b) => a - b) : []
  }
  if (!s.days.includes(weekday(d))) return []
  if (s.mode === 'times') return s.times.map(toMinutes).sort((a, b) => a - b)
  const [from, to] = s.window ? [toMinutes(s.from), toMinutes(s.to)] : [0, 24 * 60 - 1]
  const out = []
  for (let m = from; m <= to; m += s.minutes) out.push(m)
  return out
}

// Nächster Lauf nach `after`; null, wenn der Plan nie greift
export function nextRun(s, after) {
  for (let i = 0; i < 400; i++) {
    const d = new Date(after.getFullYear(), after.getMonth(), after.getDate() + i)
    for (const m of slots(s, d)) {
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60)
      if (at > after) return at
    }
  }
  return null
}

// Die nächsten Läufe für die Vorschau im Formular
export function nextRuns(s, after, count = 3) {
  const out = []
  for (let at = nextRun(s, after); at && out.length < count; at = nextRun(s, at)) out.push(at)
  return out
}

// Fällig: seit `since` (letzter Lauf, Anlegen, Ändern oder Einschalten) ist ein Termin vergangen.
// So läuft eine verpasste Aufgabe beim nächsten Start genau einmal, auch wenn mehrere Termine verpasst wurden
export const dueJobs = (jobs, now) => jobs.filter((j) => {
  if (!j.enabled) return false
  const at = nextRun(j.schedule, new Date(j.since))
  return at && at <= now
})

// Was im Zeitplan noch fehlt; leer, wenn er gültig ist
export function scheduleError(s) {
  if (s.mode === 'monthly') return s.times.length ? '' : 'Bitte mindestens eine Uhrzeit wählen.'
  if (!s.days.length) return 'Bitte mindestens einen Wochentag wählen.'
  if (s.mode === 'times') return s.times.length ? '' : 'Bitte mindestens eine Uhrzeit wählen.'
  if (s.window && (!s.from || !s.to || toMinutes(s.from) >= toMinutes(s.to))) return 'Das Zeitfenster muss vor seinem Ende beginnen.'
  return ''
}

const joinAnd = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} und ${list.at(-1)}` : list[0] ?? '')

function dayText(days) {
  const sorted = [...days].sort((a, b) => a - b)
  if (sorted.length === 7) return ''
  // zusammenhängend: "Mo bis Fr", sonst einzeln
  if (sorted.length > 2 && sorted.at(-1) - sorted[0] === sorted.length - 1) return `${WEEKDAYS[sorted[0] - 1]} bis ${WEEKDAYS[sorted.at(-1) - 1]}`
  return sorted.map((d) => WEEKDAYS[d - 1]).join(', ')
}

// Zeitplan in Klartext
export function describeSchedule(s) {
  const times = joinAnd([...s.times].sort())
  if (s.mode === 'monthly') return `${s.day === 'last' ? 'Am letzten Tag' : `Am ${s.day}.`} jedes Monats um ${times}`
  const days = dayText(s.days)
  if (s.mode === 'times') return `${days || 'Jeden Tag'} um ${times}`
  const unit = INTERVALS.find(([m]) => m === s.minutes)?.[1] ?? `${s.minutes} Minuten`
  const every = `${unit === 'Stunde' ? 'jede' : 'alle'} ${unit}`
  const text = days ? `${days} ${every}` : every[0].toUpperCase() + every.slice(1)
  return s.window ? `${text}, von ${s.from} bis ${s.to}` : text
}

export const formatRun = (at) => (at ? formatDate(stamp(at)) : 'nie')

const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

// Teil eines Termins an einem Tag in Minuten seit Mitternacht (mehrtägige sind am Tag beschnitten)
function partOfDay(e, day) {
  const start = e.start.slice(0, 10) < day ? 0 : toMinutes(e.start.slice(11, 16))
  const end = e.end.slice(0, 10) > day ? 24 * 60 : toMinutes(e.end.slice(11, 16))
  return [start, end]
}

// Belegte Zeit: überlappende Termine zählen einmal
function busyMinutes(parts) {
  let sum = 0
  let until = 0
  for (const [a, b] of [...parts].sort((x, y) => x[0] - y[0])) {
    if (b > until) sum += b - Math.max(a, until)
    until = Math.max(until, b)
  }
  return sum
}

// Inhalt der Terminübersicht: je Tag mit Terminen wann, wo und wie viel; freie Tage entfallen
export function overviewMarkdown(events, days, jobName, now = new Date()) {
  const first = iso(now)
  const byDay = new Map()
  for (const e of events) {
    for (const day of eventDays(e)) {
      if (day < first || day >= addDays(first, days)) continue
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day).push(e)
    }
  }
  const total = new Set([...byDay.values()].flat()).size
  const span = days === 1 ? 'heute' : `in den nächsten ${days} Tagen`
  const head = [
    `Stand: ${now.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} · ${total} ${total === 1 ? 'Termin' : 'Termine'} ${span}`,
    '',
    `Die Aufgabe „${jobName}“ schreibt diese Seite bei jedem Lauf neu.`,
  ]
  const sections = [...byDay.keys()].sort().map((day) => {
    const list = byDay.get(day).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
    const timed = list.filter((e) => !e.allDay).map((e) => partOfDay(e, day))
    const minutes = busyMinutes(timed)
    const hours = minutes ? `, ${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} Std.` : ''
    const rows = list.map((e) => {
      const [a, b] = partOfDay(e, day)
      return `| ${e.allDay ? 'ganztägig' : `${clock(a)}–${clock(b)}`} | ${cell(e.subject)} | ${cell(e.location)} |`
    })
    return [`## ${dayLabel(day)}: ${list.length} ${list.length === 1 ? 'Termin' : 'Termine'}${hours}`, '', '| Zeit | Termin | Ort |', '| --- | --- | --- |', ...rows].join('\n')
  })
  return [...head, '', ...(sections.length ? sections : ['Keine Termine.'])].join('\n\n').replace(/\n{3,}/g, '\n\n')
}

// Stand für den nächsten Vergleich: nur, was verglichen wird, und bis wohin er reicht
export function snapshot(events, days, now = new Date()) {
  const from = stamp(now)
  const to = `${addDays(iso(now), days)}T00:00`
  const keep = events.filter((e) => e.start >= from && e.start < to).map(({ id, subject, start, end, location }) => ({ id, subject, start, end, location: location ?? '' }))
  return { to, events: keep }
}

const seriesOf = (e) => e.id.split('/')[0]
const when = (start) => `${new Date(start).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })} ${start.slice(11, 16)}`

/*
 * Vergleicht zwei Stände. Zählt nur, was in beiden Zeiträumen liegen kann: Das Zeitfenster wandert mit jedem Tag weiter,
 * ein Termin am neuen Ende ist nicht neu, und was begonnen hat, ist nicht abgesagt.
 * Dieselbe Serien-ID mit anderem Beginn heißt verschoben.
 */
export function compareEvents(old, fresh, now = new Date()) {
  const from = stamp(now)
  const limit = old.to < fresh.to ? old.to : fresh.to
  const inBoth = (e) => e.start >= from && e.start < limit
  const was = old.events.filter(inBoth)
  const is = fresh.events
  const isById = new Map(is.map((e) => [e.id, e]))
  const wasIds = new Set(was.map((e) => e.id))
  const geaendert = []
  const gone = []
  for (const e of was) {
    const cur = isById.get(e.id)
    if (!cur) {
      gone.push(e)
      continue
    }
    const parts = []
    if (cur.subject !== e.subject) parts.push(`Betreff „${e.subject}“ → „${cur.subject}“`)
    if ((cur.location ?? '') !== (e.location ?? '')) parts.push(`Ort „${e.location || '–'}“ → „${cur.location || '–'}“`)
    if (cur.end !== e.end) parts.push(`Ende ${e.end.slice(11, 16)} → ${cur.end.slice(11, 16)}`)
    if (parts.length) geaendert.push({ event: cur, parts })
  }
  const added = is.filter((e) => !wasIds.has(e.id) && !old.events.some((o) => o.id === e.id))
  const verschoben = []
  const abgesagt = []
  for (const e of gone) {
    const i = added.findIndex((n) => seriesOf(n) === seriesOf(e))
    if (i >= 0) verschoben.push({ from: e, to: added.splice(i, 1)[0] })
    else abgesagt.push(e)
  }
  return { neu: added.filter(inBoth), verschoben, geaendert, abgesagt }
}

// Ergebnis für Verlauf und Meldung
export function describeChanges(diff) {
  const lines = [
    ...diff.neu.map((e) => `Neu: ${when(e.start)} ${e.subject}${e.location ? ` (${e.location})` : ''}`),
    ...diff.verschoben.map((m) => `Verschoben: ${m.to.subject}, ${when(m.from.start)} → ${when(m.to.start)}`),
    ...diff.geaendert.map((c) => `Geändert: ${when(c.event.start)} ${c.event.subject}: ${c.parts.join(', ')}`),
    ...diff.abgesagt.map((e) => `Abgesagt: ${when(e.start)} ${e.subject}`),
  ]
  const counts = [[diff.neu.length, 'neu'], [diff.verschoben.length, 'verschoben'], [diff.geaendert.length, 'geändert'], [diff.abgesagt.length, 'abgesagt']].filter(([n]) => n)
  return { lines, summary: counts.length ? counts.map(([n, t]) => `${n} ${t}`).join(', ') : 'Keine Änderungen' }
}
