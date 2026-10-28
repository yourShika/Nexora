import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, daysBetween, nextDate } from './fields.js'
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
