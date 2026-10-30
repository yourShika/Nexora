import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareEvents, defaultSchedule, describeChanges, describeSchedule, dueJobs, nextRun, nextRuns, overviewMarkdown, scheduleError, snapshot } from './jobs.js'

// Freitag, 30.10.2026
const at = (d, h = 0, m = 0) => new Date(2026, 9, d, h, m)
const times = (over) => ({ ...defaultSchedule(), mode: 'times', ...over })
const every = (over) => ({ ...defaultSchedule(), mode: 'every', ...over })
const monthly = (over) => ({ ...defaultSchedule(), mode: 'monthly', ...over })

test('Zeitplan: feste Uhrzeiten und Wochentage', () => {
  // Mo bis Fr um 08:00; Freitag 09:00 → Montag
  assert.deepEqual(nextRun(times({ days: [1, 2, 3, 4, 5] }), at(30, 9)), new Date(2026, 10, 2, 8, 0))
  // genau zur Uhrzeit zählt die nächste
  assert.deepEqual(nextRun(times({ days: [5], times: ['08:00', '12:00'] }), at(30, 8)), at(30, 12))
  // unsortierte Uhrzeiten
  assert.deepEqual(nextRun(times({ days: [5], times: ['12:00', '08:00'] }), at(30, 7)), at(30, 8))
  assert.deepEqual(nextRuns(times({ days: [1, 5] }), at(30, 9)), [new Date(2026, 10, 2, 8), new Date(2026, 10, 6, 8), new Date(2026, 10, 9, 8)])
})

test('Zeitplan: Intervall mit und ohne Zeitfenster', () => {
  const s = every({ minutes: 30, days: [5], window: true, from: '08:00', to: '10:00' })
  assert.deepEqual(nextRun(s, at(30, 7)), at(30, 8))
  assert.deepEqual(nextRun(s, at(30, 9, 10)), at(30, 9, 30))
  // das Ende des Fensters zählt noch mit, danach nächste Woche
  assert.deepEqual(nextRun(s, at(30, 9, 59)), at(30, 10))
  assert.deepEqual(nextRun(s, at(30, 10)), new Date(2026, 10, 6, 8))
  assert.deepEqual(nextRun(every({ minutes: 15, days: [1, 2, 3, 4, 5, 6, 7], window: false }), at(30, 23, 50)), at(31, 0, 0))
})

test('Zeitplan: monatlich, auch am Monatsende', () => {
  assert.deepEqual(nextRun(monthly({ day: 1 }), at(30, 9)), new Date(2026, 10, 1, 8))
  assert.deepEqual(nextRun(monthly({ day: 'last' }), at(30, 9)), at(31, 8))
  // der 31. greift im November am 30.
  assert.deepEqual(nextRun(monthly({ day: 31 }), new Date(2026, 10, 1)), new Date(2026, 10, 30, 8))
  assert.deepEqual(nextRun(monthly({ day: 'last' }), new Date(2027, 1, 1)), new Date(2027, 1, 28, 8))
})

test('Zeitplan: ohne Wochentag nie, Prüfung nennt den Fehler', () => {
  assert.equal(nextRun(times({ days: [] }), at(30)), null)
  assert.match(scheduleError(times({ days: [] })), /Wochentag/)
  assert.match(scheduleError(times({ times: [] })), /Uhrzeit/)
  assert.match(scheduleError(every({ window: true, from: '18:00', to: '08:00' })), /Zeitfenster/)
  assert.equal(scheduleError(every({ window: false, from: '18:00', to: '08:00' })), '')
  assert.equal(scheduleError(defaultSchedule()), '')
})

test('Zeitplan in Klartext', () => {
  assert.equal(describeSchedule(times({ days: [1, 2, 3, 4, 5], times: ['12:00', '08:00'] })), 'Mo bis Fr um 08:00 und 12:00')
  assert.equal(describeSchedule(times({ days: [1, 2, 3, 4, 5, 6, 7], times: ['07:30'] })), 'Jeden Tag um 07:30')
  assert.equal(describeSchedule(times({ days: [1, 3], times: ['09:00'] })), 'Mo, Mi um 09:00')
  assert.equal(describeSchedule(every({ minutes: 30, days: [1, 2, 3, 4, 5] })), 'Mo bis Fr alle 30 Minuten, von 08:00 bis 18:00')
  assert.equal(describeSchedule(every({ minutes: 60, days: [1, 2, 3, 4, 5, 6, 7], window: false })), 'Jede Stunde')
  assert.equal(describeSchedule(every({ minutes: 120, days: [6, 7], window: false })), 'Sa, So alle 2 Stunden')
  assert.equal(describeSchedule(monthly({ day: 1 })), 'Am 1. jedes Monats um 08:00')
  assert.equal(describeSchedule(monthly({ day: 'last', times: ['17:00'] })), 'Am letzten Tag jedes Monats um 17:00')
})

test('Fällig: verpasste Termine laufen einmal, ausgeschaltete nie', () => {
  const s = times({ days: [1, 2, 3, 4, 5, 6, 7] })
  const job = (over) => ({ id: 'a', enabled: true, schedule: s, since: at(28, 9).toISOString(), ...over })
  // seit dem 28. drei Termine verpasst: fällig, aber nur als ein Lauf
  assert.equal(dueJobs([job()], at(30, 12)).length, 1)
  // nach dem Lauf zählt ab jetzt: nichts mehr offen bis morgen früh
  assert.equal(dueJobs([job({ since: at(30, 12).toISOString() })], at(30, 12, 1)).length, 0)
  assert.equal(dueJobs([job({ since: at(30, 12).toISOString() })], at(31, 8)).length, 1)
  assert.equal(dueJobs([job({ enabled: false })], at(30, 12)).length, 0)
  // Plan ohne Wochentag läuft nie
  assert.equal(dueJobs([job({ schedule: times({ days: [] }) })], at(30, 12)).length, 0)
})

const ev = (id, start, end, subject, location = '', allDay = false) => ({ id: `${id}/${start}`, start, end, subject, location, allDay })

test('Terminübersicht: wann, wo, wie viele je Tag', () => {
  const list = [
    ev('a', '2026-10-30T09:00:00', '2026-10-30T10:30:00', 'Daily | Team', 'Raum 2'),
    ev('b', '2026-10-30T10:00:00', '2026-10-30T11:00:00', 'Überlappt', ''),
    ev('c', '2026-10-30T00:00:00', '2026-10-31T00:00:00', 'Feiertag', '', true),
    ev('d', '2026-10-29T09:00:00', '2026-10-29T10:00:00', 'Gestern'),
    ev('e', '2026-11-05T09:00:00', '2026-11-05T10:00:00', 'Außerhalb'),
    ev('f', '2026-10-31T22:00:00', '2026-11-01T02:00:00', 'Nachtschicht', 'Halle\n1'),
  ]
  const md = overviewMarkdown(list, 3, 'Morgens', at(30, 7, 5))
  assert.match(md, /· 4 Termine in den nächsten 3 Tagen/)
  assert.match(md, /Die Aufgabe „Morgens“ schreibt diese Seite/)
  // überlappende Zeit zählt einmal: 09:00 bis 11:00
  assert.match(md, /## Fr\., 30\. Oktober: 3 Termine, 2:00 Std\./)
  assert.match(md, /\| ganztägig \| Feiertag \|  \|\n\| 09:00–10:30 \| Daily \\\| Team \| Raum 2 \|/)
  // mehrtägig: an jedem Tag beschnitten
  assert.match(md, /## Sa\., 31\. Oktober: 1 Termin, 2:00 Std\.[\s\S]*\| 22:00–24:00 \| Nachtschicht \| Halle 1 \|/)
  assert.match(md, /## So\., 1\. November: 1 Termin, 2:00 Std\.[\s\S]*\| 00:00–02:00 \| Nachtschicht/)
  assert.doesNotMatch(md, /Gestern|Außerhalb/)
  assert.match(overviewMarkdown([], 1, 'X', at(30, 7)), /0 Termine heute[\s\S]*Keine Termine\./)
})

test('Vergleich: neu, verschoben, geändert, abgesagt', () => {
  const now = at(30, 7)
  const old = snapshot(
    [
      ev('gleich', '2026-10-30T09:00:00', '2026-10-30T10:00:00', 'Bleibt', 'A'),
      ev('ort', '2026-10-30T11:00:00', '2026-10-30T12:00:00', 'Ort neu', 'A'),
      ev('weg', '2026-10-31T09:00:00', '2026-10-31T10:00:00', 'Fällt aus'),
      ev('zug', '2026-11-02T09:00:00', '2026-11-02T10:00:00', 'Rückt'),
      ev('serie', '2026-11-03T09:00:00', '2026-11-03T10:00:00', 'Serie'),
      ev('serie', '2026-11-04T09:00:00', '2026-11-04T10:00:00', 'Serie'),
    ],
    14,
    now,
  )
  const fresh = snapshot(
    [
      ev('gleich', '2026-10-30T09:00:00', '2026-10-30T10:00:00', 'Bleibt', 'A'),
      ev('ort', '2026-10-30T11:00:00', '2026-10-30T12:30:00', 'Ort neu', 'B'),
      ev('zug', '2026-11-02T14:00:00', '2026-11-02T15:00:00', 'Rückt'),
      ev('serie', '2026-11-03T09:00:00', '2026-11-03T10:00:00', 'Serie'),
      ev('frisch', '2026-11-05T09:00:00', '2026-11-05T10:00:00', 'Dazu', 'C'),
    ],
    14,
    now,
  )
  const diff = compareEvents(old, fresh, now)
  assert.deepEqual(diff.neu.map((e) => e.subject), ['Dazu'])
  assert.deepEqual(diff.verschoben.map((m) => [m.from.start, m.to.start]), [['2026-11-02T09:00:00', '2026-11-02T14:00:00']])
  assert.deepEqual(diff.geaendert.map((c) => c.parts), [['Ort „A“ → „B“', 'Ende 12:00 → 12:30']])
  assert.deepEqual(diff.abgesagt.map((e) => e.subject), ['Fällt aus', 'Serie'])
  const text = describeChanges(diff)
  assert.equal(text.summary, '1 neu, 1 verschoben, 1 geändert, 2 abgesagt')
  assert.match(text.lines[0], /^Neu: .*09:00 Dazu \(C\)$/)
  assert.match(text.lines[1], /^Verschoben: Rückt, .*09:00 → .*14:00$/)
})

test('Vergleich: wanderndes Zeitfenster täuscht keine Änderung vor', () => {
  // gestern bis 14 Tage voraus gelesen; heute reicht das Fenster einen Tag weiter
  const old = snapshot([ev('a', '2026-10-29T15:00:00', '2026-10-29T16:00:00', 'Vorbei'), ev('b', '2026-10-30T09:00:00', '2026-10-30T10:00:00', 'Bleibt')], 7, at(29, 12))
  const fresh = snapshot([ev('b', '2026-10-30T09:00:00', '2026-10-30T10:00:00', 'Bleibt'), ev('c', '2026-11-05T12:00:00', '2026-11-05T13:00:00', 'Am neuen Ende')], 7, at(30, 8))
  const diff = compareEvents(old, fresh, at(30, 8))
  assert.deepEqual(describeChanges(diff), { lines: [], summary: 'Keine Änderungen' })
  // ein Termin im alten Fenster, der jetzt erst auftaucht, ist neu
  const added = snapshot([ev('b', '2026-10-30T09:00:00', '2026-10-30T10:00:00', 'Bleibt'), ev('d', '2026-11-04T12:00:00', '2026-11-04T13:00:00', 'Wirklich neu')], 7, at(30, 8))
  assert.deepEqual(compareEvents(old, added, at(30, 8)).neu.map((e) => e.subject), ['Wirklich neu'])
  // aus dem Fenster hinaus verschoben ist nicht abgesagt, in ein längeres Fenster hinein schon sichtbar
  const out = snapshot([ev('b', '2026-11-20T09:00:00', '2026-11-20T10:00:00', 'Bleibt')], 30, at(30, 8))
  const moved = compareEvents(old, out, at(30, 8))
  assert.equal(moved.abgesagt.length, 0)
  assert.deepEqual(moved.verschoben.map((m) => m.to.start), ['2026-11-20T09:00:00'])
})
