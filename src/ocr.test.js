import { test } from 'node:test'
import assert from 'node:assert/strict'
import { docPlan, hitLabel, ocrPlan } from './ocr.js'

test('Texterkennung: neue Bilder dran, gelöschte raus', () => {
  assert.deepEqual(ocrPlan(['a.png', 'b.png'], ['bilder/a.png', 'bilder/alt.png']), { todo: ['bilder/b.png'], gone: ['bilder/alt.png'] })
  assert.deepEqual(ocrPlan([], []), { todo: [], gone: [] })
})

test('Texterkennung: Anhang-Einträge zählen nicht als Bilder', () => {
  assert.deepEqual(ocrPlan(['a.png'], ['bilder/a.png', 'datei:x/y.pdf|1']), { todo: [], gone: [] })
})

test('Anhänge: neue dran, verschwundene raus, Seiten zählen als ein Anhang', () => {
  const indexed = ['bilder/a.png', 'datei:u1/Rechnung #12.pdf|1', 'datei:u1/Rechnung #12.pdf|2', 'datei:u2/alt.docx|1', 'datei:u3/leer.pdf|0']
  assert.deepEqual(docPlan(['u1/Rechnung #12.pdf', 'u3/leer.pdf', 'u4/neu.xlsx'], indexed), { todo: ['u4/neu.xlsx'], gone: ['u2/alt.docx'] })
})

test('Treffer zeigt Bild oder Anhang mit Seite bzw. Folie', () => {
  const id = '0b6e7d1f-3c2a-4c55-9a1e-3f0d2b8c4e01'
  assert.equal(hitLabel('bilder/x.png'), 'Im Bild')
  assert.equal(hitLabel(`datei:${id}/Rechnung #12.pdf|3`), 'Im Anhang Rechnung #12.pdf, S. 3')
  assert.equal(hitLabel(`datei:${id}/Schulung.PPTX|2`), 'Im Anhang Schulung.PPTX, Folie 2')
  assert.equal(hitLabel(`datei:${id}/Liste.xlsx|1`), 'Im Anhang Liste.xlsx')
})
