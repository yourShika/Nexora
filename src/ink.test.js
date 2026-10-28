import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hits, inkExtent, inkPath } from './ink.js'

test('Radierer trifft Striche am Rand', () => {
  const pen = { t: 'pen', w: 4, p: [[0, 0], [100, 0], [100, 100]] }
  assert.ok(hits(pen, 50, 5, 4))
  assert.ok(hits(pen, 104, 60, 4))
  assert.equal(hits(pen, 50, 50, 4), false)

  const rect = { t: 'rect', w: 2, p: [[0, 0], [100, 50]] }
  assert.ok(hits(rect, 99, 25, 3))
  assert.equal(hits(rect, 50, 25, 3), false, 'innen ist leer')

  const ellipse = { t: 'ellipse', w: 2, p: [[0, 0], [100, 50]] }
  assert.ok(hits(ellipse, 50, 1, 3))
  assert.equal(hits(ellipse, 50, 25, 3), false)

  assert.ok(hits({ t: 'pen', w: 8, p: [[10, 10]] }, 13, 13, 2), 'Tupfer')
})

test('Pfade und Ausdehnung', () => {
  assert.equal(inkPath({ t: 'line', w: 2, p: [[1, 2], [3, 4]] }), 'M1 2L3 4')
  assert.equal(inkPath({ t: 'pen', w: 2, p: [[0, 0], [10, 0], [20, 10]] }), 'M0 0Q10 0 15 5L20 10')
  assert.match(inkPath({ t: 'arrow', w: 2, p: [[0, 0], [100, 0]] }), /^M0 0L100 0M/)
  assert.deepEqual(inkExtent([{ w: 4, p: [[10, 300]] }, { w: 2, p: [[500, 20]] }]), [502, 304])
  assert.deepEqual(inkExtent([]), [0, 0])
})
