import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, between, taskCount, daysBetween, nextDate, sortRows, sortsOf, isoWeek, parseTime } from './fields.js'
import { parseQuick } from './quick.js'

test('nächster Termin einer Wiederholung', () => {
  assert.equal(nextDate('2026-10-28', 'd1'), '2026-10-29')
  assert.equal(nextDate('2026-10-28', 'w2'), '2026-11-11')
  assert.equal(nextDate('2026-01-31', 'm1'), '2026-02-28')
  assert.equal(nextDate('2028-01-31', 'm1'), '2028-02-29')
  assert.equal(nextDate('2026-11-30', 'm3'), '2027-02-28')
  assert.equal(nextDate('2028-02-29', 'y1'), '2029-02-28')
})

test('Tage rechnen über Monats- und Jahresgrenzen', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02')
  assert.equal(daysBetween('2026-10-25', '2026-11-01'), 7) // über die Zeitumstellung hinweg
})

test('Kurzsyntax für Wiederholungen', () => {
  const now = new Date(2026, 9, 27)
  assert.deepEqual(parseQuick('Zertifikate prüfen *monatlich 1.11.', now), { title: 'Zertifikate prüfen', props: { repeat: 'm1', due: '2026-11-01' } })
  assert.equal(parseQuick('Backup testen *quartal', now).props.repeat, 'm3')
  assert.deepEqual(parseQuick('3 * 4 rechnen', now), { title: '3 * 4 rechnen', props: {} })
})

test('Unterpunkte: Checkliste im Text des Punkts', () => {
  assert.equal(taskCount('Nur Text'), null)
  assert.deepEqual(taskCount('- [x] a\n- [ ] b\n  - [X] b1\n* [ ]\nText - [ ] mitten im Satz\n- \\[x\\] maskiert'), { done: 2, total: 4 })
})

test('Sortierwert zwischen Nachbarn', () => {
  assert.equal(between(10, 20), 15)
  assert.equal(between(10, undefined), 1010)
  assert.equal(between(undefined, 10), -990)
  assert.equal(between(undefined, undefined), 0)
})

test('Sortieren nach mehreren Ebenen', () => {
  const fields = [
    { id: 'status', type: 'status', options: [{ id: 'offen' }, { id: 'arbeit' }, { id: 'erledigt' }] },
    { id: 'due', type: 'date' },
    { id: 'tags', type: 'multi' },
  ]
  const rows = [
    { id: 'a', title: 'LOP-10', props: { status: 'arbeit', due: '2026-11-02' } },
    { id: 'b', title: 'LOP-2', props: { status: 'offen', due: '2026-11-05' } },
    { id: 'c', title: 'LOP-3', props: { status: 'arbeit' } },
    { id: 'd', title: '', props: { status: 'offen', due: '2026-11-01', tags: ['x'] } },
  ]
  const ids = (levels) => sortRows(rows, fields, levels).map((r) => r.id).join('')
  assert.equal(ids([{ field: 'status', dir: 'asc' }, { field: 'due', dir: 'asc' }]), 'dbac')
  assert.equal(ids([{ field: 'status', dir: 'desc' }, { field: 'due', dir: 'desc' }]), 'acbd') // Leere bleiben unten
  assert.equal(ids([{ field: 'title', dir: 'asc' }]), 'bcad') // LOP-2 vor LOP-10, ohne Titel ans Ende
  assert.equal(ids([{ field: 'tags', dir: 'asc' }]), 'dabc') // sonst stabile eigene Reihenfolge
  assert.equal(ids([{ field: 'weg', dir: 'asc' }]), 'abcd')
  assert.deepEqual(sortsOf({ sort: { field: 'due', dir: 'asc' } }, 'list'), [{ field: 'due', dir: 'asc' }])
  assert.deepEqual(sortsOf({ sort: { field: 'due', dir: 'asc' }, sorts: { list: [] } }, 'list'), [])
})

test('Kalenderwoche und getippte Uhrzeit', () => {
  assert.equal(isoWeek('2026-10-29'), 44)
  assert.equal(isoWeek('2026-01-01'), 1) // Donnerstag
  assert.equal(isoWeek('2027-01-01'), 53) // Freitag, gehört noch zu 2026
  assert.equal(isoWeek('2024-12-30'), 1)
  assert.deepEqual(['9', '930', '0930', '14.30', '14:5', '', '25', '1260', 'ab'].map(parseTime), ['09:00', '09:30', '09:30', '14:30', null, '', null, null, null])
})
