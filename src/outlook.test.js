import { test } from 'node:test'
import assert from 'node:assert/strict'
import { desiredEvents, eventDays, pushPlan } from './outlook.js'
import { hash } from './onenote.js'
import { lopConfig } from './fields.js'

const list = { id: 'l', title: 'Offene Punkte', config: lopConfig() }
const row = (id, props, extra = {}) => ({ id, title: `Punkt ${id}`, parent_id: 'l', props: { status: 'offen', ...props }, ...extra })

test('Outlook: welche Punkte als Termin', () => {
  const rows = [
    row('a', { nr: 1, due: '2026-10-30' }),
    row('b', { due: '2026-10-30T14:00' }),
    row('c', { due: '2026-10-30', status: 'erledigt' }),
    row('d', {}),
    row('e', { due: '2026-10-31' }, { deleted_at: '2026-10-28' }),
  ]
  const d = desiredEvents(rows, () => list)
  assert.deepEqual([...d.keys()], ['a', 'b'])
  assert.deepEqual({ ...d.get('a'), body: undefined }, { key: 'a', subject: 'LOP-001 Punkt a', start: '2026-10-30T00:00:00', end: '2026-10-31T00:00:00', allDay: true, body: undefined })
  assert.equal(d.get('b').end, '2026-10-30T14:30:00')
  assert.equal(d.get('b').allDay, false)
})

test('Outlook: anlegen, ändern, entfernen', () => {
  const desired = desiredEvents([row('a', { due: '2026-10-30' }), row('b', { due: '2026-11-02' })], () => list)
  assert.equal(pushPlan(desired, {}).create.length, 2)
  // a unverändert, b verschoben, c nicht mehr offen
  const map = Object.fromEntries([...desired].map(([k, e]) => [k, { id: `id-${k}`, hash: hash(`v2${JSON.stringify(e)}`) }]))
  map.c = { id: 'id-c', hash: 'x' }
  const plan = pushPlan(desiredEvents([row('a', { due: '2026-10-30' }), row('b', { due: '2026-11-03' })], () => list), map)
  assert.deepEqual(plan.create, [])
  assert.deepEqual(plan.update.map((e) => [e.id, e.start]), [['id-b', '2026-11-03T00:00:00']])
  assert.deepEqual(plan.delete, ['id-c'])
})

test('Outlook: Termin über mehrere Tage', () => {
  assert.deepEqual(eventDays({ allDay: true, start: '2026-10-30T00:00:00', end: '2026-11-02T00:00:00' }), ['2026-10-30', '2026-10-31', '2026-11-01'])
  assert.deepEqual(eventDays({ allDay: false, start: '2026-10-30T09:00:00', end: '2026-10-30T10:00:00' }), ['2026-10-30'])
})
