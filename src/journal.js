import { addDays, formatDate } from './fields.js'

// Arbeitstagebuch und Wochenrückblick: reine Rechnungen, die Ansicht ist Journal.jsx
export const KIND_ORDER = ['notiz', 'erledigt', 'angelegt', 'nachgehakt', 'ausgefuehrt', 'bearbeitet']

const noon = (day) => new Date(`${day}T12:00:00`)

export const monday = (day) => addDays(day, -((noon(day).getDay() + 6) % 7))

// Kalenderwoche nach ISO 8601 (Woche mit dem ersten Donnerstag ist KW 1)
export function weekNumber(day) {
  const d = noon(day)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const jan4 = new Date(d.getFullYear(), 0, 4, 12)
  return 1 + Math.round(((d - jan4) / 864e5 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
}

const linkTo = (alive, e) => {
  const node = e.node_id && alive.get(e.node_id)
  const title = (node?.title || e.text || 'Ohne Titel').replace(/[|\]\n]/g, ' ')
  return node ? `[[${title}|${node.id}]]` : title
}

// Rückblick als Markdown für "Als Seite speichern": Seitenlinks, solange die Seiten noch da sind
export function weekMarkdown({ week, entries, overdue, waiting, alive }) {
  const of = (kind) => entries.filter((e) => e.kind === kind)
  const part = (title, list, line) => (list.length ? [`## ${title} (${list.length})`, '', ...list.map(line), ''] : [])
  const runs = of('ausgefuehrt')
  return [
    `Woche vom ${formatDate(week)} bis ${formatDate(addDays(week, 6))}`,
    '',
    ...part('Erledigt', of('erledigt'), (e) => `- ${linkTo(alive, e)}`),
    ...part('Neu angelegt', of('angelegt'), (e) => `- ${linkTo(alive, e)}`),
    ...part('Nachgehakt', of('nachgehakt'), (e) => `- ${linkTo(alive, e)}`),
    ...part('Notizen', of('notiz'), (e) => `- ${e.text}`),
    ...part('Runbooks ausgeführt', runs, (e) => `- ${linkTo(alive, { ...e, text: '' })}: ${e.text}`),
    ...part('Überfällig (Stand bei Erstellung)', overdue, (r) => `- ${linkTo(alive, { node_id: r.id })}, fällig ${formatDate(r.props.due)}`),
    ...part('Wartet', waiting, (r) => `- ${linkTo(alive, { node_id: r.id })}`),
  ]
    .join('\n')
    .trim()
}
