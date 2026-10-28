import { test } from 'node:test'
import assert from 'node:assert/strict'
import { digestMessage, plan } from './reminders.js'

// Dienstag, 27.10.2026, 14:05
const now = new Date(2026, 9, 27, 14, 5)
const row = (id, props) => ({ id, title: id, kind: 'row', parent_id: null, props: { status: 'offen', ...props } })
const rows = [
  row('a', { due: '2026-10-27T14:00' }),
  row('b', { due: '2026-10-27T15:00' }),
  row('c', { due: '2026-10-20' }),
  row('d', { followup: '2026-10-27T09:30', due: '2026-10-27' }),
  row('e', { due: '2026-10-27T13:00', status: 'erledigt' }),
  row('f', { due: '2026-10-26T18:00' }),
]
const state = (o = {}) => ({ notified: new Set(), lastDigest: null, digestTime: '08:00', ...o })

test('Uhrzeit erreicht: einmal melden, Zukunft und Erledigtes nicht', () => {
  const { timed } = plan(rows, () => null, state(), now)
  assert.deepEqual(timed.map((x) => x.key), ['a|due|2026-10-27T14:00', 'd|followup|2026-10-27T09:30'])
  const again = plan(rows, () => null, state({ notified: new Set(timed.map((x) => x.key)) }), now)
  assert.equal(again.timed.length, 0)
})

test('Sammelmeldung einmal am Tag ab der eingestellten Zeit', () => {
  const { digest } = plan(rows, () => null, state(), now)
  assert.deepEqual(digest.late.map((r) => r.id), ['c', 'f'])
  assert.deepEqual(digest.due.map((r) => r.id), ['a', 'b', 'd'])
  assert.deepEqual(digest.followup.map((r) => r.id), ['d'])
  assert.equal(plan(rows, () => null, state({ lastDigest: '2026-10-27' }), now).digest, null)
  assert.equal(plan(rows, () => null, state({ digestTime: '15:00' }), now).digest, null)
})

test('Text der Sammelmeldung', () => {
  const { digest } = plan(rows, () => null, state(), now)
  assert.deepEqual(digestMessage(digest), {
    title: 'Heute: 2 überfällig, 3 heute fällig, 1 Wiedervorlage',
    body: 'c, f, a und 2 weitere',
  })
  assert.equal(digestMessage({ late: [], due: [], followup: [] }), null)
})
