import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CANVAS, hasInk, isFree, parseBoxes, parseInk, serializeBoxes, toFlow, toFree } from './free.js'

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

test('Freie Seite: Striche hinter den Kästen', () => {
  const ink = [
    { t: 'pen', c: 'text', w: 4, p: [[10.4, 20], [12, 22.6], [30, 40]] },
    { t: 'arrow', c: '#e5484d', w: 2, p: [[0, 0], [-5, 100]] },
  ]
  const body = serializeBoxes([{ x: 0, y: 20, w: 300, md: 'Text' }], ink)
  assert.ok(hasInk(body))
  assert.equal(body.indexOf('<!-- ink'), body.indexOf('Text') + 6, 'Striche stehen am Ende, die Suche schneidet dort ab')
  assert.deepEqual(parseInk(body), [
    { t: 'pen', c: 'text', w: 4, p: [[10, 20], [12, 23], [30, 40]] },
    { t: 'arrow', c: '#e5484d', w: 2, p: [[0, 0], [-5, 100]] },
  ])
  assert.deepEqual(parseBoxes(body), [{ x: 0, y: 20, w: 300, md: 'Text' }])
  assert.equal(toFlow(body), 'Text')
  assert.equal(hasInk(serializeBoxes([], [])), false)
})
