import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colorOf, initials, peopleList } from './people.js'

test('Personenliste aus gespeicherten und benutzten Namen', () => {
  const saved = [{ name: 'Sam', color: 'rot' }]
  const rows = [{ props: { person: 'kim' } }, { props: { person: 'sam' } }, { props: { person: ' Kim ' } }, { props: {} }]
  assert.deepEqual(peopleList(saved, rows), [{ name: 'kim' }, { name: 'Sam', color: 'rot' }])
  assert.equal(colorOf({ name: 'Sam', color: 'rot' }), 'rot')
  assert.equal(colorOf({ name: 'Kim' }), colorOf({ name: 'Kim' }))
  assert.notEqual(colorOf({ name: 'Kim' }), 'grau')
  assert.deepEqual(['Kim Bura', 'k.bura', 'Kim', ' '].map(initials), ['KB', 'KB', 'KI', '?'])
})
