import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INBOX_FIELDS } from './fields.js'
import { doneMoments, stats } from './stats.js'

const fieldsFor = () => INBOX_FIELDS
const local = (day, h = 12) => new Date(`${day}T${String(h).padStart(2, '0')}:00:00`).toISOString()
const row = (id, created, props) => ({ id, created_at: local(created), updated_at: local('2026-10-29'), props })

test('doneMoments nimmt den letzten Wechsel auf Erledigt, sonst Tagebuch, sonst updated_at', () => {
  const rows = [row('a', '2026-10-01', { status: 'erledigt' }), row('b', '2026-10-01', { status: 'verworfen' }), row('c', '2026-10-01', { status: 'erledigt' }), row('d', '2026-10-01', { status: 'offen' })]
  const changes = [
    { node_id: 'a', text: 'Status: Offen → Erledigt', created_at: local('2026-10-05') },
    { node_id: 'a', text: 'Status: Erledigt → Offen', created_at: local('2026-10-06') },
    { node_id: 'a', text: 'Status: Offen → Erledigt', created_at: local('2026-10-08') },
    { node_id: 'a', text: 'Fällig: – → Heute', created_at: local('2026-10-09') },
  ]
  const journal = [{ node_id: 'b', at: local('2026-10-12') }]
  const m = doneMoments(rows, fieldsFor, changes, journal)
  assert.equal(m.get('a'), local('2026-10-08'))
  assert.equal(m.get('b'), local('2026-10-12'))
  assert.equal(m.get('c'), local('2026-10-29'))
  assert.equal(m.has('d'), false)
})

test('stats zählt Wochen, Offenes, Überfälliges und Durchlaufzeit', () => {
  const now = new Date('2026-10-29T10:00:00') // Donnerstag, KW 44
  const rows = [
    row('a', '2026-10-20', { status: 'erledigt' }), // KW 43 angelegt, KW 44 erledigt nach 7 Tagen
    row('b', '2026-10-27', { status: 'offen', due: '2026-10-28', person: 'Kim', prio: 'hoch' }), // überfällig
    row('c', '2026-10-27', { status: 'wartet', due: '2026-10-29' }), // heute fällig, nicht überfällig
    row('d', '2026-10-01', { status: 'erledigt' }), // am selben Tag erledigt
  ]
  const done = new Map([['a', local('2026-10-27')], ['d', local('2026-10-01', 18)]])
  const s = stats({ rows, fieldsFor, listOf: () => 'Eingang', done, now, weeks: 5 })
  assert.deepEqual(s.weeks.map((w) => w.label), ['KW 40', 'KW 41', 'KW 42', 'KW 43', 'KW 44'])
  assert.deepEqual(s.weeks.map((w) => w.created), [1, 0, 0, 1, 2])
  assert.deepEqual(s.weeks.map((w) => w.done), [1, 0, 0, 0, 1])
  assert.deepEqual(s.weeks.map((w) => w.open), [0, 0, 0, 1, 2])
  assert.deepEqual(s.weeks.map((w) => w.late), [0, 0, 0, 0, 1])
  assert.equal(s.open, 2)
  assert.equal(s.late, 1)
  assert.equal(s.done, 2)
  assert.equal(s.median, 3.5)
  assert.deepEqual(s.spans.map((x) => x.count), [1, 1, 0, 0])
  assert.deepEqual(s.byStatus, [{ label: 'Offen', count: 1 }, { label: 'Wartet', count: 1 }])
  assert.deepEqual(s.byPerson, [{ label: 'Kim', count: 1 }, { label: 'Niemand', count: 1 }])
  assert.deepEqual(s.byPrio, [{ label: 'Hoch', count: 1 }, { label: 'Ohne Priorität', count: 1 }])
  assert.deepEqual(s.byList, [{ label: 'Eingang', count: 2 }])
})

test('stats fasst lange Aufstellungen zu "Weitere" zusammen', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(String(i), '2026-10-27', { status: 'offen', person: `P${i}` }))
  const s = stats({ rows, fieldsFor, listOf: () => 'x', done: new Map(), now: new Date('2026-10-29T10:00:00') })
  assert.equal(s.byPerson.length, 8)
  assert.deepEqual(s.byPerson.at(-1), { label: 'Weitere (3)', count: 3 })
})
