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

// "Anzeigen als" (OlBusyStatus 0–4) und Farben der Outlook-Kategorien (OlCategoryColor 1–25)
export const BUSY = ['Frei', 'Mit Vorbehalt', 'Gebucht', 'Abwesend', 'An anderem Ort']
const CATEGORY = [null, '#e7a1a2', '#f9ba89', '#f7dd8f', '#fcfa90', '#78d168', '#9fdcc9', '#c6d2b0', '#9db7e8', '#b5a1e2', '#daaec2', '#dad9dc', '#6b7994', '#bfbfbf', '#6f6f6f', '#4f4f4f', '#c11a25', '#e2620d', '#c79930', '#b9b300', '#368f2b', '#329b7a', '#778b45', '#2858a5', '#5c3fa3', '#93446b']
const BLUE = '#3a6fc4'
const AWAY = '#8a4fbf'

// Termin wie in Outlook: Fläche in der Farbe der ersten Kategorie, Streifen links nach "Anzeigen als"
// (gebucht voll, mit Vorbehalt schraffiert, an anderem Ort gepunktet, abwesend lila, frei leer)
export function eventLook(e) {
  const tint = CATEGORY[e.color] ?? null
  const c = tint ? `color-mix(in oklab, ${tint} 70%, #000)` : BLUE // Kategoriefarben sind blass, der Streifen soll sichtbar sein
  const stripe = ['var(--line)', `repeating-linear-gradient(135deg, ${c} 0 2px, transparent 2px 4px)`, c, AWAY, `radial-gradient(circle, ${c} 1px, transparent 1.4px) 0 0 / 3px 3px`][e.busy] ?? c
  return { stripe, tint: tint && `color-mix(in oklab, ${tint} 35%, var(--raised))`, label: [BUSY[e.busy], e.categories].filter(Boolean).join(' · ') }
}

export const eventTime = (e) => (e.allDay ? 'ganztägig' : `${e.start.slice(11, 16)}–${e.end.slice(11, 16)}`)

// Nachhaken zu einem wartenden Punkt: Betreff und Text; den Empfänger trägt man in Outlook ein
export function followUpMail(row, list) {
  const name = [formatNr(list, row.props?.nr), row.title || 'Ohne Titel'].filter(Boolean).join(' ')
  const since = row.created_at ? new Date(row.created_at).toLocaleDateString('de-DE') : null
  const due = row.props?.due ? formatDate(row.props.due) : null
  const lines = [row.props?.person ? `Hallo ${[].concat(row.props.person).join(', ')},` : 'Hallo,', '', `kurze Nachfrage zu: ${name}`]
  if (since || due) lines.push([since && `offen seit ${since}`, due && `fällig ${due}`].filter(Boolean).join(', '))
  lines.push('', 'Gibt es dazu schon einen Stand?', '', 'Viele Grüße')
  return { subject: `Nachfrage: ${name}`, body: lines.join('\r\n') }
}
