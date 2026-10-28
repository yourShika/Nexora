import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, diffLines } from './diff.js'

const short = (d) => d.map((x) => (x.type === 'gap' ? `…${x.count}` : `${{ same: ' ', add: '+', del: '-' }[x.type]}${x.text}`))

test('Änderung, Einfügung, Löschung', () => {
  assert.deepEqual(short(diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne')), [' a', '-b', '+B', ' c', ' d', '+e'])
  assert.deepEqual(short(diffLines('x\ny', 'y')), ['-x', ' y'])
  assert.deepEqual(short(diffLines('', 'neu')), ['-', '+neu'])
})

test('gleiche Texte haben keine Änderungen', () => {
  assert.ok(diffLines('a\nb', 'a\nb').every((d) => d.type === 'same'))
})

test('lange gleiche Strecken werden eingeklappt', () => {
  const old = Array.from({ length: 20 }, (_, i) => `z${i}`).join('\n')
  const neu = old.replace('z10', 'Z10')
  assert.deepEqual(short(collapse(diffLines(old, neu))), ['…8', ' z8', ' z9', '-z10', '+Z10', ' z11', ' z12', '…7'])
})
