import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clock, eventSpan, layoutDay, rowSpan, snap, weekStart } from './calendar.js'

test('Kalender: Wochenbeginn ist Montag', () => {
  assert.equal(weekStart('2026-11-09'), '2026-11-09') // Montag
  assert.equal(weekStart('2026-11-15'), '2026-11-09') // Sonntag
  assert.equal(weekStart('2026-11-12'), '2026-11-09')
  assert.equal(weekStart('2027-01-01'), '2026-12-28') // über den Jahreswechsel
})

test('Kalender: Zeitspannen von Punkten und Terminen', () => {
  assert.equal(rowSpan('2026-11-09'), null)
  assert.deepEqual(rowSpan('2026-11-09T14:00'), { from: 840, to: 870 })
  assert.deepEqual(rowSpan('2026-11-09T23:50'), { from: 1430, to: 1440 })
  const e = { start: '2026-11-09T09:30', end: '2026-11-09T11:00' }
  assert.deepEqual(eventSpan(e, '2026-11-09'), { from: 570, to: 660 })
  const night = { start: '2026-11-09T22:00', end: '2026-11-10T02:00' }
  assert.deepEqual(eventSpan(night, '2026-11-09'), { from: 1320, to: 1440 })
  assert.deepEqual(eventSpan(night, '2026-11-10'), { from: 0, to: 120 })
  assert.equal(eventSpan({ start: '2026-11-09T22:00', end: '2026-11-10T00:00' }, '2026-11-10'), null)
  assert.deepEqual(eventSpan({ start: '2026-11-09T10:00', end: '2026-11-09T10:00' }, '2026-11-09'), { from: 600, to: 615 })
  assert.equal(eventSpan({ allDay: true, start: '2026-11-09T00:00', end: '2026-11-10T00:00' }, '2026-11-09'), null)
  assert.equal(clock(570), '09:30')
})

test('Kalender: Überschneidungen nebeneinander', () => {
  const at = (id, from, to) => ({ id, from, to })
  const placed = Object.fromEntries(layoutDay([at('a', 540, 600), at('b', 570, 630), at('c', 600, 660), at('d', 700, 720)]).map((p) => [p.id, `${p.col}/${p.cols}`]))
  // a und b überschneiden sich, c passt in die Spalte von a, d steht allein
  assert.deepEqual(placed, { a: '0/2', b: '1/2', c: '0/2', d: '0/1' })
  assert.deepEqual(layoutDay([]), [])
})

test('Kalender: Ziehen rastet auf Viertelstunden', () => {
  assert.equal(snap(0, 48), 0)
  assert.equal(snap(48 * 9.4, 48), 9 * 60 + 30) // 9:24 → 9:30
  assert.equal(snap(48 * 24, 48), 1425)
  assert.equal(snap(-5, 48), 0)
})
