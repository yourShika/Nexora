import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildExport, decodeText, importedPage, packNotebook, relPath, safeName, unpackNotebook } from './io.js'
import { lopConfig } from './fields.js'

test('Text: UTF-8 und altes Windows-1252', () => {
  assert.equal(decodeText(new TextEncoder().encode('﻿Grüße\r\nZeile 2')), 'Grüße\nZeile 2')
  assert.equal(decodeText(new Uint8Array([0x47, 0x72, 0xfc, 0xdf, 0x65])), 'Grüße')
})

test('Import: Titel aus Dateiname, Logs als Textblock', () => {
  assert.deepEqual(importedPage('Notizen.md', '# Hallo'), { title: 'Notizen', body: '# Hallo' })
  assert.deepEqual(importedPage('setup.log', 'a\nb\n\n'), { title: 'setup', body: '```plaintext\na\nb\n```' })
})

test('Dateinamen und relative Pfade', () => {
  assert.equal(safeName('Server: Exchange / DC?'), 'Server_ Exchange _ DC_')
  assert.equal(safeName(''), 'Ohne Titel')
  assert.equal(relPath('IT/Server/Exchange.md', 'IT/Clients/Laptops.md'), '../Clients/Laptops.md')
  assert.equal(relPath('IT/Server.md', 'bilder/a.png'), '../bilder/a.png')
  assert.equal(relPath('A.md', 'A/B.md'), 'A/B.md')
})

test('Export: Baum, Links, Bilder, Anhänge, Listen', () => {
  const id = (n) => `00000000-0000-0000-0000-00000000000${n}`
  const nodes = {
    [id(1)]: { id: id(1), kind: 'notebook', title: 'IT' },
    [id(2)]: { id: id(2), kind: 'section', title: 'Server', parent_id: id(1) },
    [id(3)]: { id: id(3), kind: 'page', title: 'Exchange', parent_id: id(2) },
    [id(4)]: { id: id(4), kind: 'page', title: 'DC', parent_id: id(2), icon: '🖥️' },
    [id(5)]: { id: id(5), kind: 'database', title: 'LOP', parent_id: id(2), config: lopConfig() },
    [id(6)]: { id: id(6), kind: 'row', title: 'Zertifikat', parent_id: id(5), props: { nr: 1, status: 'wartet', due: '2026-11-03' } },
  }
  const bodies = {
    [id(3)]: `Siehe [[DC alt|${id(4)}]] und [[Weg|${id(9)}]].\n\n![|400](bilder/abc.png)\n\n[[datei:${id(8)}/Plan.pdf|1234]]\n\n[[lop:${id(5)}]]`,
    [id(4)]: 'Domain Controller',
    [id(6)]: 'Notiz zum Punkt',
  }
  const all = Object.values(nodes)
  const { files, copies } = buildExport([id(1)], {
    get: (x) => nodes[x],
    children: (x) => all.filter((n) => n.parent_id === x && n.kind !== 'row'),
    rows: (x) => all.filter((n) => n.parent_id === x && n.kind === 'row'),
    body: (x) => bodies[x] ?? '',
  })
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]))
  assert.deepEqual(Object.keys(byPath).sort(), ['IT/Server/DC.md', 'IT/Server/Exchange.md', 'IT/Server/LOP.md', 'IT/Server/LOP/Zertifikat.md'])
  const ex = byPath['IT/Server/Exchange.md']
  assert.match(ex, /Siehe \[DC\]\(<DC\.md>\) und Weg\./)
  assert.match(ex, /!\[\|400\]\(\.\.\/\.\.\/bilder\/abc\.png\)/)
  assert.match(ex, new RegExp(`Anhang: \\[Plan\\.pdf\\]\\(<\\.\\./\\.\\./anhaenge/${id(8)}/Plan\\.pdf>\\)`))
  assert.match(ex, /Liste: \[LOP\]\(<LOP\.md>\)/)
  assert.match(byPath['IT/Server/DC.md'], /^# 🖥️ DC/)
  assert.match(byPath['IT/Server/LOP.md'], /\| \[Zertifikat\]\(<LOP\/Zertifikat\.md>\) \| 1 \| Wartet \|/)
  assert.match(byPath['IT/Server/LOP/Zertifikat.md'], /- \*\*Status:\*\* Wartet/)
  assert.deepEqual(copies.map((c) => c.from).sort(), [`anhaenge/${id(8)}/Plan.pdf`, 'bilder/abc.png'])
})

test('Nexora-Datei: packen und mit neuen IDs auspacken', () => {
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const nodes = new Map([
    [id(1), { id: id(1), parent_id: null, kind: 'notebook', title: 'Buch', config: { onenote: { id: 'x' } }, sort: 1 }],
    [id(2), { id: id(2), parent_id: id(1), kind: 'section', title: 'Abschnitt', sort: 1 }],
    [id(3), { id: id(3), parent_id: id(2), kind: 'page', title: 'Seite', cover: 'bilder/c0ffee00-0000-4000-8000-000000000001.png', sort: 1 }],
    [id(4), { id: id(4), parent_id: id(2), kind: 'database', title: 'Liste', config: { fields: [] }, sort: 2 }],
    [id(5), { id: id(5), parent_id: id(4), kind: 'row', title: 'Punkt', props: { nr: 1, after: [id(6)] }, sort: 1 }],
    [id(6), { id: id(6), parent_id: id(4), kind: 'row', title: 'Vorher', props: { nr: 2 }, sort: 2 }],
  ])
  const kids = (p) => [...nodes.values()].filter((n) => n.parent_id === p)
  const bodies = { [id(3)]: `Siehe [[Vorher|${id(6)}]] und [[lop:${id(4)}]]\n\n![](bilder/aaaaaaaa-0000-4000-8000-000000000002.png)\n\n[[datei:bbbbbbbb-0000-4000-8000-000000000003/Plan.pdf|12]]` }
  const { json, files } = packNotebook(id(1), {
    get: (x) => nodes.get(x),
    kids,
    body: (x) => bodies[x] ?? '',
    activity: (x) => (x === id(5) ? [{ kind: 'comment', text: 'Hallo', created_at: '2026-10-01T10:00:00.000Z' }] : []),
  })
  assert.deepEqual(json.nodes.map((n) => n.title), ['Buch', 'Abschnitt', 'Seite', 'Liste', 'Punkt', 'Vorher'])
  assert.deepEqual(files.sort(), ['anhaenge/bbbbbbbb-0000-4000-8000-000000000003/Plan.pdf', 'bilder/aaaaaaaa-0000-4000-8000-000000000002.png', 'bilder/c0ffee00-0000-4000-8000-000000000001.png'])

  let n = 100
  const back = unpackNotebook(JSON.parse(JSON.stringify(json)), () => id(n++))
  const by = Object.fromEntries(back.nodes.map((x) => [x.title, x]))
  assert.equal(by.Buch.parent_id, null)
  assert.equal(by.Buch.config, null, 'OneNote-Verbindung fällt weg')
  assert.equal(by.Abschnitt.parent_id, by.Buch.id)
  assert.equal(by.Punkt.parent_id, by.Liste.id)
  assert.deepEqual(by.Punkt.props.after, [by.Vorher.id])
  assert.equal(by.Seite.body, `Siehe [[Vorher|${by.Vorher.id}]] und [[lop:${by.Liste.id}]]\n\n![](bilder/aaaaaaaa-0000-4000-8000-000000000002.png)\n\n[[datei:bbbbbbbb-0000-4000-8000-000000000003/Plan.pdf|12]]`)
  assert.deepEqual(back.activity, [{ node_id: by.Punkt.id, kind: 'comment', text: 'Hallo', created_at: '2026-10-01T10:00:00.000Z' }])
  assert.throws(() => unpackNotebook({ format: 99, nodes: [] }, () => 'x'))
})
