import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foldSlices, fromList, fromRows, num, pageTables, parseSpec, serializeSpec } from './diagram.js'
import { LOP_FIELDS, isDone } from './fields.js'

test('Diagramm-Text lesen und schreiben', () => {
  const text = 'typ: ring\ntitel: Tickets\nquelle: tabelle\n---\nMonat;Offen;Erledigt\nJan;4;10\nFeb;6\t12'
  const spec = parseSpec(text)
  assert.equal(spec.typ, 'ring')
  assert.equal(spec.titel, 'Tickets')
  assert.deepEqual(spec.rows, [['Monat', 'Offen', 'Erledigt'], ['Jan', '4', '10'], ['Feb', '6', '12']])
  assert.equal(serializeSpec(spec), 'typ: ring\ntitel: Tickets\nquelle: tabelle\n---\nMonat;Offen;Erledigt\nJan;4;10\nFeb;6;12')
  assert.equal(serializeSpec({ ...spec, quelle: 'liste', liste: 'abc', gruppe: 'person', nur: 'alle' }), 'typ: ring\ntitel: Tickets\nquelle: liste\nliste: abc\ngruppe: person\nnur: alle')
  assert.deepEqual(parseSpec('').rows, [])
  assert.equal(parseSpec('Kategorie;Wert\nA;1').rows.length, 2, 'ohne Kopf gleich Daten')
})

test('Zahlen in deutscher Schreibweise', () => {
  assert.equal(num('4,5'), 4.5)
  assert.equal(num('1.234,5'), 1234.5)
  assert.equal(num('1.234'), 1234)
  assert.equal(num('12'), 12)
  assert.equal(num('12 %'), 12)
  assert.equal(num('abc'), null)
  assert.equal(num(''), null)
})

test('Tabelle wird zu Reihen; Spalten ohne Zahlen fallen weg', () => {
  assert.deepEqual(fromRows([['Server', 'CPU', 'Notiz'], ['A', '40', 'ok'], ['B', '75,5', '']]), {
    labels: ['A', 'B'],
    series: [{ name: 'CPU', values: [40, 75.5] }],
  })
  assert.deepEqual(fromRows([['nur Kopf']]), { labels: [], series: [] })
})

test('Markdown-Tabellen einer Seite', () => {
  const md = 'Text\n\n| Monat | Wert |\n| --- | ---: |\n| Jan | 3 |\n| **Feb** | 4 |\n\nmehr\n\n| A | B |\n|---|---|\n| x | 1 |'
  assert.deepEqual(pageTables(md), [
    [['Monat', 'Wert'], ['Jan', '3'], ['Feb', '4']],
    [['A', 'B'], ['x', '1']],
  ])
})

test('LOP-Punkte zählen', () => {
  const rows = [
    { props: { status: 'offen', prio: 'hoch', person: 'Kim', tags: ['netz'], due: '2026-10-03' } },
    { props: { status: 'arbeit', person: 'Kim', tags: ['netz', 'server'], due: '2026-11-01' } },
    { props: { status: 'erledigt', person: 'Sam' } },
  ]
  const done = (r) => isDone(r, LOP_FIELDS)
  assert.deepEqual(fromList(rows, LOP_FIELDS, 'status', 'offen', done), { labels: ['Offen', 'In Arbeit'], series: [{ name: 'Punkte', values: [1, 1] }] })
  assert.deepEqual(fromList(rows, LOP_FIELDS, 'status', 'alle', done).labels, ['Offen', 'In Arbeit', 'Erledigt'])
  assert.deepEqual(fromList(rows, LOP_FIELDS, 'prio', 'offen', done), { labels: ['Hoch', 'Ohne'], series: [{ name: 'Punkte', values: [1, 1] }] })
  assert.deepEqual(fromList(rows, LOP_FIELDS, 'person', 'alle', done), { labels: ['Kim', 'Sam'], series: [{ name: 'Punkte', values: [2, 1] }] })
  assert.deepEqual(fromList(rows, LOP_FIELDS, 'tags', 'offen', done), { labels: ['netz', 'server'], series: [{ name: 'Punkte', values: [2, 1] }] })
  assert.deepEqual(fromList(rows, LOP_FIELDS, 'faellig', 'alle', done).labels, ['Okt 2026', 'Nov 2026', 'Ohne Datum'])
})

test('Tortenstücke über 8 werden zu "Weitere"', () => {
  const labels = 'abcdefghij'.split('')
  const out = foldSlices({ labels, series: [{ name: 'x', values: labels.map((_, i) => i + 1) }] })
  assert.equal(out.labels.length, 8)
  assert.equal(out.labels.at(-1), 'Weitere (3)')
  assert.equal(out.series[0].values.at(-1), 8 + 9 + 10)
})
