// Feldtypen, LOP-Vorlage und Helfer für Datenbanken und ihre Punkte.
// Auswahlwerte werden als Options-ID gespeichert; bei Tags ist die ID der Name selbst.

export const TYPES = {
  text: 'Text',
  number: 'Zahl',
  status: 'Status',
  select: 'Auswahl',
  multi: 'Mehrfachauswahl',
  date: 'Datum',
  person: 'Person',
  checkbox: 'Checkbox',
  link: 'Link',
  nr: 'Nummer',
  repeat: 'Wiederholung',
  deps: 'Abhängigkeit',
}

// Wiederholung: Kürzel -> Anzeige; der nächste Termin entsteht beim Abhaken
export const REPEATS = { d1: 'Täglich', w1: 'Wöchentlich', w2: 'Alle 2 Wochen', m1: 'Monatlich', m3: 'Vierteljährlich', y1: 'Jährlich' }

const parseDay = (v) => {
  const [y, m, d] = v.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const addDays = (day, n) => {
  const d = parseDay(day)
  return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))
}
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5)
// Datumswert um Tage verschieben, eine Uhrzeit bleibt erhalten
export const shiftDate = (v, days) => (v ? addDays(v.slice(0, 10), days) + (v.length > 10 ? v.slice(10) : '') : v)

// Nächster Termin; Monate bleiben am Monatsende hängen (31.1. + 1 Monat = 28./29.2.)
export function nextDate(day, code) {
  const n = Number(code.slice(1))
  const unit = code[0]
  if (unit === 'd') return addDays(day, n)
  if (unit === 'w') return addDays(day, 7 * n)
  const d = parseDay(day)
  const months = unit === 'y' ? 12 * n : n
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return iso(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last)))
}

export const CHIP_COLORS = {
  grau: '#7b8487', blau: '#3a6fc4', petrol: '#1b8a94', gruen: '#3f8f4f',
  gelb: '#b88a12', orange: '#d06a2a', rot: '#c8434b', rosa: '#c4508f',
}

// Feste IDs, damit Werte beim Verschieben zwischen LOP-Listen erhalten bleiben
export const LOP_FIELDS = [
  { id: 'nr', name: 'Nr.', type: 'nr' },
  {
    id: 'status', name: 'Status', type: 'status', options: [
      { id: 'offen', name: 'Offen', color: 'grau' },
      { id: 'arbeit', name: 'In Arbeit', color: 'blau' },
      { id: 'wartet', name: 'Wartet', color: 'gelb' },
      { id: 'erledigt', name: 'Erledigt', color: 'gruen', done: true },
      { id: 'verworfen', name: 'Verworfen', color: 'grau', done: true },
    ],
  },
  {
    id: 'prio', name: 'Priorität', type: 'select', options: [
      { id: 'hoch', name: 'Hoch', color: 'rot' },
      { id: 'mittel', name: 'Mittel', color: 'orange' },
      { id: 'niedrig', name: 'Niedrig', color: 'grau' },
    ],
  },
  { id: 'due', name: 'Fällig', type: 'date' },
  { id: 'person', name: 'Zuständig', type: 'person' },
  { id: 'followup', name: 'Wiedervorlage', type: 'date' },
  { id: 'tags', name: 'Tags', type: 'multi', options: [] },
  { id: 'repeat', name: 'Wiederholung', type: 'repeat' },
]
// Zeitleiste: Beginn und Abhängigkeiten werden bei Bedarf ergänzt (Knopf in der Ansicht)
export const START_FIELD = { id: 'start', name: 'Beginn', type: 'date' }
export const DEPS_FIELD = { id: 'after', name: 'Abhängig von', type: 'deps' }

// Punkte im Eingang gehören noch zu keiner Liste und haben die LOP-Felder ohne Nummer
export const INBOX_FIELDS = LOP_FIELDS.filter((f) => f.id !== 'nr')

export const lopConfig = (prefix = 'LOP') => ({ fields: structuredClone(LOP_FIELDS), prefix, nextNr: 1, view: 'table', hideDone: true })
export const emptyConfig = () => ({ fields: [{ id: 'status', ...structuredClone(LOP_FIELDS[1]) }], prefix: '', nextNr: 1, view: 'table', hideDone: true })

export const fieldsOf = (db) => db?.config?.fields ?? INBOX_FIELDS
export const statusField = (fields) => fields.find((f) => f.type === 'status')

export function isDone(row, fields) {
  const sf = statusField(fields)
  return !!sf?.options.find((o) => o.id === row.props?.[sf.id])?.done
}

// Erledigt-Haken: erste Erledigt-Option bzw. zurück auf die erste offene
export function toggleDone(row, fields) {
  const sf = statusField(fields)
  if (!sf) return row.props
  const target = isDone(row, fields) ? sf.options.find((o) => !o.done) : sf.options.find((o) => o.done)
  return { ...row.props, [sf.id]: target?.id ?? null }
}

export const formatNr = (db, nr) => (nr ? `${db?.config?.prefix ? `${db.config.prefix}-` : ''}${String(nr).padStart(3, '0')}` : '')

export function today(now = new Date()) {
  return iso(now)
}

export function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Datumswerte sind "JJJJ-MM-TT" oder mit Uhrzeit "JJJJ-MM-TTTHH:MM" (Ortszeit)
export const dayOf = (v) => v?.slice(0, 10) ?? null
export const timeOf = (v) => (v && v.length > 10 ? v.slice(11, 16) : null)
export const stamp = (d = new Date()) => `${iso(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
export const isLate = (v, now = new Date()) => !!v && (v.length > 10 ? v < stamp(now) : v < iso(now))
export const isToday = (v, now = new Date()) => dayOf(v) === iso(now)

export function formatDate(value, now = new Date()) {
  if (!value) return ''
  const day = dayOf(value)
  const time = timeOf(value) ? ` ${timeOf(value)}` : ''
  if (day === iso(now)) return `Heute${time}`
  if (day === iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))) return `Morgen${time}`
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', ...(y !== now.getFullYear() ? { year: 'numeric' } : {}) }) + time
}

// Feldwert als Text für den Verlauf eines Punkts
export function describe(field, value) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '–'
  if (field.type === 'status' || field.type === 'select') return option(field, value).name
  if (field.type === 'multi') return value.map((v) => option(field, v).name).join(', ')
  if (field.type === 'date') return formatDate(value)
  if (field.type === 'checkbox') return value ? 'ja' : 'nein'
  if (field.type === 'repeat') return REPEATS[value] ?? value
  if (field.type === 'deps') return `${value.length} ${value.length === 1 ? 'Punkt' : 'Punkte'}`
  return String(value)
}

export const option = (field, id) => field?.options?.find((o) => o.id === id) ?? (id ? { id, name: id, color: 'grau' } : null)

export const newId = () => crypto.randomUUID().slice(0, 8)
