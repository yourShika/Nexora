import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ocrPlan } from './ocr.js'

test('Texterkennung: neue Bilder dran, gelöschte raus', () => {
  assert.deepEqual(ocrPlan(['a.png', 'b.png'], ['bilder/a.png', 'bilder/alt.png']), { todo: ['bilder/b.png'], gone: ['bilder/alt.png'] })
  assert.deepEqual(ocrPlan([], []), { todo: [], gone: [] })
})
