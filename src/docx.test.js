import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitSize, hexColor } from './docx.js'

test('Word-Export: Farben und Bildgrößen', () => {
  assert.equal(hexColor('rgb(220, 38, 38)'), 'DC2626')
  assert.equal(hexColor('rgba(0, 0, 0, 0)'), null) // durchsichtig: keine Hinterlegung
  assert.equal(hexColor('rgba(255, 255, 0, 0.5)'), 'FFFF00')
  assert.equal(hexColor('oklch(0.5 0.1 20)'), null)
  assert.deepEqual(fitSize(1200, 600), { width: 600, height: 300 }) // breiter als die Textspalte: verkleinert
  assert.deepEqual(fitSize(300, 200), { width: 300, height: 200 }) // kleiner: bleibt
})
