import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cropFrom, hitOp, moveOp, nextNumber, opBounds, rotateState } from './imageops.js'

test('Treffer: Linien am Strich, Flächen innen, oberste zuerst', () => {
  const ops = [
    { t: 'rect', c: '#e5484d', w: 4, p: [[10, 10], [100, 60]] },
    { t: 'arrow', c: '#e5484d', w: 4, p: [[0, 200], [200, 200]] },
    { t: 'number', c: '#e5484d', w: 4, p: [[50, 30]], n: 1 },
    { t: 'text', c: '#e5484d', w: 2, p: [[300, 300]], text: 'Hier klicken' },
  ]
  assert.equal(hitOp(ops, 50, 30), 2, 'Nummer liegt über dem Rechteck')
  assert.equal(hitOp(ops, 90, 50), 0)
  assert.equal(hitOp(ops, 100, 203), 1)
  assert.equal(hitOp(ops, 100, 150), -1)
  assert.equal(hitOp(ops, 320, 310), 3)
  assert.deepEqual(opBounds(ops[2]), [32, 12, 68, 48])
})

test('Verschieben, Nummern, Ausschnitt', () => {
  assert.deepEqual(moveOp({ t: 'pen', p: [[1, 2, 50], [3, 4, 60]] }, 10, -1).p, [[11, 1, 50], [13, 3, 60]])
  assert.equal(nextNumber([{ t: 'number', n: 1 }, { t: 'rect' }, { t: 'number', n: 3 }]), 4)
  assert.equal(nextNumber([]), 1)
  assert.deepEqual(cropFrom([90, 80], [10, 20], 50, 200), [10, 20, 40, 60], 'auf die Bildbreite begrenzt')
  assert.equal(cropFrom([10, 10], [12, 100], 200, 200), null, 'zu schmal')
})

test('Drehen um 90° nimmt Markierungen und Ausschnitt mit', () => {
  // Bild 200×100: oben links (0, 0) landet oben rechts (100, 0) im gedrehten 100×200-Bild
  const { ops, crop } = rotateState({ ops: [{ t: 'line', p: [[0, 0], [200, 100]] }, { t: 'number', p: [[10, 20]], n: 1 }], crop: [0, 0, 50, 20] }, 200, 100)
  assert.deepEqual(ops[0].p, [[100, 0], [0, 200]])
  assert.deepEqual(ops[1].p, [[80, 10]])
  assert.deepEqual(crop, [80, 0, 20, 50])
})
