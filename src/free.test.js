import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CANVAS, isFree, parseBoxes, serializeBoxes, toFlow, toFree } from './free.js'

test('Freie Seite: hin und zurück', () => {
  const boxes = [
    { x: 500, y: 20, w: 300, md: 'rechts' },
    { x: 0, y: 20, w: 400, md: '# Links\n\n```powershell\nGet-Date\n```' },
    { x: 0, y: 300, w: 400, md: '  ' },
  ]
  const body = serializeBoxes(boxes)
  assert.ok(isFree(body))
  assert.deepEqual(parseBoxes(body), [
    { x: 0, y: 20, w: 400, md: '# Links\n\n```powershell\nGet-Date\n```' },
    { x: 500, y: 20, w: 300, md: 'rechts' },
  ])
  assert.equal(toFlow(body), '# Links\n\n```powershell\nGet-Date\n```\n\nrechts')
})

test('Freie Seite: umwandeln und Sonderfälle', () => {
  assert.equal(toFree(''), CANVAS)
  assert.deepEqual(parseBoxes(toFree('- [ ] a\n- [ ] b')), [{ x: 0, y: 20, w: 640, md: '- [ ] a\n- [ ] b' }])
  assert.deepEqual(parseBoxes(`${CANVAS}\nlose Zeile\n<!-- box x=10 y=40 w=200 -->\nKasten`), [
    { x: 0, y: 20, w: 480, md: 'lose Zeile' },
    { x: 10, y: 40, w: 200, md: 'Kasten' },
  ])
  assert.equal(isFree('# normale Seite'), false)
})
