import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frontmatter, joinPath, parseCsv, parseDate, planImport, stripId } from './interop.js'
import { buildExport, toCsv } from './io.js'
import { lopConfig } from './fields.js'

// Zähler-IDs statt UUIDs, damit die Ergebnisse lesbar bleiben
const counter = () => {
  let i = 0
  return () => `id${String(++i).padStart(6, '0')}`
}
const files = (texts, extra = []) => [...Object.keys(texts), ...extra].map((rel) => ({ rel, size: 10 }))
const byTitle = (nodes) => Object.fromEntries(nodes.map((n) => [n.title, n]))

test('Helfer: Pfade, Notion-IDs, YAML-Kopf, CSV, Daten', () => {
  assert.equal(joinPath('a/b', '../c.md'), 'a/c.md')
  assert.equal(joinPath('', '../x'), null)
  assert.equal(stripId('Server 0123456789abcdef0123456789abcdef'), 'Server')
  assert.deepEqual(frontmatter('---\ntags:\n  - a\n- b\nstatus: "offen"\nliste: [x, y]\nleer:\n---\nText'), { props: [['tags', 'a, b'], ['status', 'offen'], ['liste', 'x, y']], body: 'Text' })
  assert.deepEqual(frontmatter('Kein Kopf'), { props: [], body: 'Kein Kopf' })
  assert.deepEqual(parseCsv('Name,Notiz\r\nA,"mit, Komma"\n"B ""x""","zwei\nZeilen"\n\n'), [['Name', 'Notiz'], ['A', 'mit, Komma'], ['B "x"', 'zwei\nZeilen']])
  assert.deepEqual(parseCsv(toCsv([['a,b', 'c"d', 'e\nf']])), [['a,b', 'c"d', 'e\nf']])
  assert.equal(parseDate('October 30, 2026'), '2026-10-30')
  assert.equal(parseDate('March 3, 2026 3:05 PM'), '2026-03-03T15:05')
  assert.equal(parseDate('March 3, 2026 12:30 AM'), '2026-03-03T00:30')
  assert.equal(parseDate('March 3, 2026 15:00'), '2026-03-03T15:00')
  assert.equal(parseDate('30. Oktober 2026 9:15'), '2026-10-30T09:15')
  assert.equal(parseDate('1. März 2026 → 5. März 2026'), '2026-03-01')
  assert.equal(parseDate('30.10.2026'), '2026-10-30')
  assert.equal(parseDate('2026-10-30T08:00:00.000Z'), '2026-10-30T08:00')
  assert.equal(parseDate('nächste Woche'), null)
})

test('Obsidian: Ordner, Eigenschaften, Links, Bilder und Anhänge', () => {
  const texts = {
    'Start.md': '---\ntags: [it, server]\n---\nSiehe [[Exchange]], [[Exchange|den Mailserver]], [[Exchange#Backup]] und [[Fehlt]].\n![[Exchange]]\n![[plan.png|300]]\n![[Handbuch.pdf]]\n[relativ](IT/Exchange.md) ==wichtig== `[[Exchange]]`\n- [ ] (offen)',
    'IT/Exchange.md': '# Exchange\n```\n[[Start]]\n```\n![Bild](../plan.png)',
    'IT/Netz/Switch.md': 'Switch',
  }
  const input = { files: files(texts, ['anhang/plan.png', 'Handbuch.pdf', '.obsidian/app.json']), texts: new Map(Object.entries(texts)), title: 'Vault' }
  const scan = planImport('obsidian', { ...input, makeId: counter() })
  assert.deepEqual(scan.used.sort(), ['Handbuch.pdf', 'anhang/plan.png'])

  const assets = new Map([['anhang/plan.png', { src: 'bilder/neu.png' }], ['Handbuch.pdf', { file: 'u-1/Handbuch.pdf', size: 99 }]])
  const { nodes, used } = planImport('obsidian', { ...input, assets, makeId: counter() })
  assert.deepEqual(used, [])
  const n = byTitle(nodes)
  assert.equal(nodes[0].kind, 'notebook')
  assert.equal(n.IT.kind, 'section')
  assert.equal(n.Netz.parent_id, n.IT.id)
  assert.equal(n.Switch.parent_id, n.Netz.id)
  assert.equal(n.Start.parent_id, n.Vault.id)
  const ex = `[[Exchange|${n.Exchange.id}]]`
  assert.equal(
    n.Start.body,
    `- **tags:** it, server\n\nSiehe ${ex}, ${ex}, ${ex} und Fehlt.\n${ex}\n![|300](bilder/neu.png)\n[[datei:u-1/Handbuch.pdf|99]]\n${ex} <span style="background-color: yellow">wichtig</span> \`[[Exchange]]\`\n- [ ] (offen)`,
  )
  assert.equal(n.Exchange.body, '```\n[[Start]]\n```\n![Bild](bilder/neu.png)')
  // Eltern stehen vor ihren Kindern
  const seen = new Set()
  for (const x of nodes) {
    assert.ok(!x.parent_id || seen.has(x.parent_id), x.title)
    seen.add(x.id)
  }
})

test('Notion: Seiten, Unterseiten, Liste aus CSV mit Feldern und Punkten', () => {
  const id = (n) => String(n).repeat(32).slice(0, 32)
  const w = 'Private & Shared'
  const texts = {
    [`${w}/Projekt ${id(1)}.md`]: `# Projekt: Umzug\n\nAufgaben: [Aufgaben](Aufgaben%20${id(2)}.csv), Notiz [Unter](Projekt%20${id(1)}/Unter%20${id(3)}.md)\n![Bild](Projekt%20${id(1)}/Bild.png)\n[extern](https://www.notion.so/x)`,
    [`${w}/Projekt ${id(1)}/Unter ${id(3)}.md`]: `# Unter\n\nZurück zu [Projekt](../Projekt%20${id(1)}.md)`,
    [`${w}/Aufgaben ${id(2)}.csv`]: 'Name,Status\nNur gefiltert,Done\n',
    [`${w}/Aufgaben ${id(2)}_all.csv`]: '﻿Name,Status,Priorität,Zuständig,Tags,Fällig,Notiz\nServer tauschen,In progress,Hoch,"Kim, Lou","hw, eilig","October 30, 2026",x\nAlt,Done,,,,,\nOhne Seite,Not started,,,,,',
    [`${w}/Aufgaben ${id(2)}/Server tauschen ${id(4)}.md`]: '# Server tauschen\n\nStatus: In progress\nPriorität: Hoch\n\nAblauf steht.',
    [`${w}/Aufgaben ${id(2)}/Alt ${id(5)}.md`]: '# Alt\n\nStatus: Done',
  }
  const input = { files: files(texts, [`${w}/Projekt ${id(1)}/Bild.png`]), texts: new Map(Object.entries(texts).map(([k, v]) => [k, v.replace(/^﻿/, '')])), title: 'Export-0a1b2c3d-1111' }
  const assets = new Map([[`${w}/Projekt ${id(1)}/Bild.png`, { src: 'bilder/b.png' }]])
  const { nodes, used } = planImport('notion', { ...input, assets, makeId: counter() })
  assert.deepEqual(used, [])
  const n = byTitle(nodes)
  assert.equal(nodes[0].title, 'Notion-Import')
  assert.ok(!n['Private & Shared'], 'Hüllordner übersprungen')
  assert.equal(n['Projekt: Umzug'].parent_id, nodes[0].id)
  assert.equal(n.Unter.parent_id, n['Projekt: Umzug'].id)
  assert.equal(n.Aufgaben.kind, 'database')
  assert.equal(n.Aufgaben.parent_id, nodes[0].id)
  assert.equal(n['Projekt: Umzug'].body, `Aufgaben: [[Aufgaben|${n.Aufgaben.id}]], Notiz [[Unter|${n.Unter.id}]]\n![Bild](bilder/b.png)\n[extern](https://www.notion.so/x)`)
  assert.equal(n.Unter.body, `Zurück zu [[Projekt: Umzug|${n['Projekt: Umzug'].id}]]`)

  const fields = n.Aufgaben.config.fields
  assert.deepEqual(fields.map((f) => [f.name, f.type, f.id.length === 8 ? 'neu' : f.id]), [['Status', 'status', 'status'], ['Priorität', 'select', 'prio'], ['Zuständig', 'person', 'person'], ['Tags', 'multi', 'tags'], ['Fällig', 'date', 'due'], ['Notiz', 'text', 'neu']])
  const status = fields[0].options
  assert.deepEqual(status.map((o) => [o.name, o.color, !!o.done]), [['In progress', 'blau', false], ['Done', 'gruen', true], ['Not started', 'grau', false]])
  const rows = nodes.filter((x) => x.parent_id === n.Aufgaben.id).sort((a, b) => a.sort - b.sort)
  assert.deepEqual(rows.map((r) => r.title), ['Server tauschen', 'Alt', 'Ohne Seite'])
  assert.ok(rows.every((r) => r.kind === 'row'))
  const st = n['Server tauschen']
  assert.equal(st.body, 'Ablauf steht.')
  assert.deepEqual(st.props, { status: status[0].id, prio: fields[1].options[0].id, person: ['Kim', 'Lou'], tags: ['hw', 'eilig'], due: '2026-10-30', [fields[5].id]: 'x' })
  assert.equal(fields[1].options[0].color, 'rot')
  assert.equal(n.Alt.body, '')
  assert.equal(n['Ohne Seite'].props.status, status[2].id)
})

test('Export für Obsidian lässt sich wieder einlesen; Notion bekommt CSV', () => {
  const id = (n) => `00000000-0000-0000-0000-00000000000${n}`
  const nodes = {
    [id(1)]: { id: id(1), kind: 'notebook', title: 'IT' },
    [id(2)]: { id: id(2), kind: 'page', title: 'Server | Netz', parent_id: id(1) },
    [id(3)]: { id: id(3), kind: 'database', title: 'Aufgaben', parent_id: id(1), config: lopConfig('IT') },
    [id(4)]: { id: id(4), kind: 'row', title: 'Tausch (alt)', parent_id: id(3), props: { nr: 7, status: 'arbeit', person: ['Kim'], tags: ['hw'], due: '2026-10-30' } },
  }
  const src = {
    get: (x) => nodes[x],
    children: (x) => Object.values(nodes).filter((n) => n.parent_id === x && n.kind !== 'row'),
    rows: (x) => Object.values(nodes).filter((n) => n.parent_id === x && n.kind === 'row'),
    body: (x) => ({ [id(2)]: `Siehe [[Tausch|${id(4)}]] und [[lop:${id(3)}]]` })[x] ?? '',
  }
  const ob = buildExport([id(1)], src, 'obsidian')
  const get = (out, p) => out.files.find((f) => f.path === p)?.content
  assert.equal(get(ob, 'IT/Server _ Netz.md'), 'Siehe [[IT/Aufgaben/Tausch (alt)|Tausch (alt)]] und Liste: [[IT/Aufgaben|Aufgaben]]')
  assert.match(get(ob, 'IT/Aufgaben.md'), /\| \[\[IT\/Aufgaben\/Tausch \(alt\)\\\|Tausch \(alt\)\]\] \| IT-007 \| In Arbeit \|/)
  assert.equal(get(ob, 'IT/Aufgaben/Tausch (alt).md'), '---\nNr.: "IT-007"\nStatus: "In Arbeit"\nFällig: 2026-10-30\nZuständig:\n  - "Kim"\nTags:\n  - "hw"\n---\n\n')

  const back = planImport('obsidian', { files: ob.files.map((f) => ({ rel: f.path, size: 1 })), texts: new Map(ob.files.map((f) => [f.path, f.content])), title: 'IT', makeId: counter() })
  const b = byTitle(back.nodes)
  assert.equal(b['Server _ Netz'].body, `Siehe [[Tausch (alt)|${b['Tausch (alt)'].id}]] und Liste: [[Aufgaben|${b.Aufgaben.id}]]`)
  assert.match(b['Tausch (alt)'].body, /^- \*\*Nr\.:\*\* IT-007\n- \*\*Status:\*\* In Arbeit\n- \*\*Fällig:\*\* 2026-10-30\n- \*\*Zuständig:\*\* Kim/)

  const no = buildExport([id(1)], src, 'notion')
  assert.equal(get(no, 'IT/Aufgaben.csv'), 'Titel,Nr.,Status,Priorität,Fällig,Zuständig,Wiedervorlage,Tags,Wiederholung\nTausch (alt),IT-007,In Arbeit,,2026-10-30,Kim,,hw,\n')
  assert.equal(get(no, 'IT/Server _ Netz.md'), '# Server | Netz\n\nSiehe [Tausch (alt)](Aufgaben/Tausch%20%28alt%29.md) und Liste: [Aufgaben](Aufgaben.csv)')
  assert.equal(get(no, 'IT/Aufgaben/Tausch (alt).md'), '# Tausch (alt)\n\nNr.: IT-007\nStatus: In Arbeit\nFällig: 2026-10-30\nZuständig: Kim\nTags: hw\n\n')
})
