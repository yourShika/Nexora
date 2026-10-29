import { CHIP_COLORS } from './fields.js'

// Eine Personenliste für alle LOP-Listen ("Zuständig"). Gespeichert sind nur Name und Farbe (Einstellung "personen");
// dazu kommt jeder Name, der schon in einem Punkt steht, damit nichts verloren geht. Im Punkt steht weiter der Name.
const KEYS = Object.keys(CHIP_COLORS).filter((k) => k !== 'grau')

// Zuständig ist ein Name (bis 0.29) oder eine Liste von Namen
export const personsOf = (v) => (Array.isArray(v) ? v : v ? [v] : [])

export function peopleList(saved, rows) {
  const list = [...saved]
  const known = new Set(saved.map((p) => p.name.toLowerCase()))
  for (const r of rows) {
    for (const raw of personsOf(r.props?.person)) {
      const name = raw.trim()
      if (name && !known.has(name.toLowerCase())) {
        known.add(name.toLowerCase())
        list.push({ name })
      }
    }
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

// ohne gewählte Farbe immer dieselbe zum Namen
export const colorOf = (p) => p?.color ?? KEYS[[...(p?.name ?? '')].reduce((h, c) => (h * 31 + c.codePointAt(0)) >>> 0, 7) % KEYS.length]

// "Kim Bura" → KB, "k.bura" → KB, "Kim" → KI
export function initials(name) {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length > 1 ? parts[0][0] + parts.at(-1)[0] : parts[0].slice(0, 2)).toUpperCase()
}
