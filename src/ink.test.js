import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bounds, hasPressure, hits, inkExtent, inkPath, inside, lassoPick, moveStroke, pressurePath, scaleStroke } from './ink.js'

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

test('Druckstärke: nur Stift mit Druckwerten, Umriss geschlossen', () => {
  assert.equal(hasPressure({ t: 'pen', w: 4, p: [[0, 0], [10, 0]] }), false)
  assert.equal(hasPressure({ t: 'marker', w: 4, p: [[0, 0, 50], [10, 0, 50]] }), false)
  const s = { t: 'pen', w: 4, p: [[0, 0, 50], [10, 0, 100]] }
  assert.ok(hasPressure(s))
  // Druck 50 ergibt die normale Breite (Radius 2), Druck 100 fast das Doppelte
  assert.equal(pressurePath(s), 'M0.0 2.0L10.0 3.5A3.5 3.5 0 0 1 10.0 -3.5L0.0 -2.0A2.0 2.0 0 0 1 0.0 2.0Z')
})

test('Lasso: Auswahl, Rahmen, Verschieben, Größe', () => {
  const square = [[0, 0], [100, 0], [100, 100], [0, 100]]
  assert.ok(inside([50, 50], square))
  assert.equal(inside([150, 50], square), false)
  const ink = [
    { t: 'pen', w: 2, p: [[10, 10], [20, 20], [30, 30]] },
    { t: 'pen', w: 2, p: [[90, 50], [120, 50], [150, 50]] },
    { t: 'rect', w: 2, p: [[20, 20], [60, 60]] },
  ]
  assert.deepEqual(lassoPick(ink, square), [0, 2])
  assert.deepEqual(bounds([ink[0]], [{ x: 50, y: 0, w: 40, h: 20 }]), [9, 0, 90, 31])
  assert.equal(bounds([], []), null)
  assert.deepEqual(moveStroke({ t: 'pen', w: 2, p: [[1, 2, 40]] }, 10, 5).p, [[11, 7, 40]])
  assert.deepEqual(scaleStroke({ t: 'pen', w: 2, p: [[10, 10], [20, 30]] }, 10, 10, 2).p, [[10, 10], [30, 50]])
})
