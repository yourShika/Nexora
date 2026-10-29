import { invoke } from '@tauri-apps/api/core'
import * as db from './db.js'
import { addDays, dayOf, fieldsOf, formatDate, formatNr, isDone, timeOf, today } from './fields.js'
import { hash } from './onenote.js'

// Outlook-Brücke (outlook.rs): offene Fälligkeiten → eigener Kalender "Nexora", Outlook-Termine → Anzeige.
// Die Testversion arbeitet nur mit dem Kalender "Nexora-Test" und liest auch nur von dort.
export const FOLDER = import.meta.env?.DEV ? 'Nexora-Test' : 'Nexora'
const MAP_KEY = `outlook-map:${FOLDER}`

const pad = (n) => String(n).padStart(2, '0')
const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`

// Jeder offene Punkt mit Fälligkeit: ohne Uhrzeit ganztägig, mit Uhrzeit 30 Minuten
export function desiredEvents(rows, dbOf) {
  const out = new Map()
  for (const r of rows) {
    const due = r.props?.due
    const list = dbOf(r)
    if (!due || r.deleted_at || isDone(r, fieldsOf(list))) continue
    const day = dayOf(due)
    const time = timeOf(due)
    const start = `${day}T${time ?? '00:00'}:00`
    const end = time ? local(new Date(new Date(start).getTime() + 30 * 60e3)) : `${addDays(day, 1)}T00:00:00`
    const subject = [formatNr(list, r.props?.nr), r.title || 'Ohne Titel'].filter(Boolean).join(' ')
    out.set(r.id, { key: r.id, subject, start, end, allDay: !time, body: `Aus Nexora${list ? `, Liste „${list.title}“` : ''}. Ändern und erledigen in Nexora.` })
  }
  return out
}

// "v2": bis 0.18 kamen Umlaute falsch in Outlook an; der neue Stand schreibt solche Termine einmal neu
const version = (e) => hash(`v2${JSON.stringify(e)}`)

// map: { Punkt-ID: { id: Outlook-EntryID, hash } } → was anzulegen, zu ändern, zu entfernen ist
export function pushPlan(desired, map) {
  const create = []
  const update = []
  for (const [key, e] of desired) {
    const m = map[key]
    if (!m) create.push(e)
    else if (m.hash !== version(e)) update.push({ ...e, id: m.id })
  }
  const remove = Object.keys(map).filter((k) => !desired.has(k)).map((k) => map[k].id)
  return { create, update, delete: remove }
}

export async function pushDue(rows, dbOf) {
  const map = JSON.parse((await db.getSetting(MAP_KEY)) || '{}')
  const desired = desiredEvents(rows, dbOf)
  const plan = pushPlan(desired, map)
  if (!plan.create.length && !plan.update.length && !plan.delete.length) return { neu: 0, geaendert: 0, entfernt: 0 }
  const res = JSON.parse(await invoke('outlook_push', { folder: FOLDER, job: JSON.stringify(plan) }))
  const next = {}
  for (const [key, e] of desired) {
    // Fehlgeschlagene neue Termine fehlen hier und werden beim nächsten Mal wieder versucht
    const id = res.created?.[key] ?? map[key]?.id
    if (id) next[key] = { id, hash: version(e) }
  }
  await db.setSetting(MAP_KEY, JSON.stringify(next))
  return { neu: plan.create.length - (res.failed?.length ?? 0), geaendert: plan.update.length, entfernt: plan.delete.length, fehler: res.failed ?? [] }
}

// Termine eine Woche zurück bis zwei Monate voraus; nur im Speicher, nie in der Datenbank
export async function readEvents() {
  const from = `${addDays(today(), -7)}T00:00:00`
  const to = `${addDays(today(), 62)}T00:00:00`
  const list = JSON.parse(await invoke('outlook_events', { from, to, folder: import.meta.env?.DEV ? FOLDER : '' }))
  return list.map((e) => ({ ...e, subject: e.subject || '(ohne Betreff)' }))
}

// Tage, an denen ein Termin im Kalender erscheint (ganztägig über mehrere Tage: jeder Tag bis vor dem Ende)
export function eventDays(e) {
  const first = dayOf(e.start)
  const last = e.allDay ? addDays(dayOf(e.end), -1) : dayOf(e.end)
  const days = [first]
  while (days.length < 62 && days.at(-1) < last) days.push(addDays(days.at(-1), 1))
  return days
}

export const eventTime = (e) => (e.allDay ? 'ganztägig' : `${e.start.slice(11, 16)}–${e.end.slice(11, 16)}`)

// Nachhaken zu einem wartenden Punkt: Betreff und Text; den Empfänger trägt man in Outlook ein
export function followUpMail(row, list) {
  const name = [formatNr(list, row.props?.nr), row.title || 'Ohne Titel'].filter(Boolean).join(' ')
  const since = row.created_at ? new Date(row.created_at).toLocaleDateString('de-DE') : null
  const due = row.props?.due ? formatDate(row.props.due) : null
  const lines = [row.props?.person ? `Hallo ${row.props.person},` : 'Hallo,', '', `kurze Nachfrage zu: ${name}`]
  if (since || due) lines.push([since && `offen seit ${since}`, due && `fällig ${due}`].filter(Boolean).join(', '))
  lines.push('', 'Gibt es dazu schon einen Stand?', '', 'Viele Grüße')
  return { subject: `Nachfrage: ${name}`, body: lines.join('\r\n') }
}
