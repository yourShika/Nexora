import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syncVault } from './obsidian.js'
import { lopConfig } from './fields.js'

// Ordner und Datenbank im Speicher; Uhr und Änderungszeiten zählen hoch
function world() {
  let clock = 0
  let mt = 1000
  let sort = 0
  const disk = new Map()
  const nodes = []
  const bodies = new Map()
  const put = (rel, text) => disk.set(rel, { text, size: text.length, mtime: ++mt })
  const stat = (rel) => ({ size: disk.get(rel).size, mtime: disk.get(rel).mtime })
  const writes = []
  const api = {
    list: async () => [...disk].map(([rel, f]) => ({ rel, size: f.size, mtime: f.mtime })),
    read: async (_, rel) => disk.get(rel).text,
    write: async (_, rel, text) => (writes.push(rel), put(rel, text), stat(rel)),
    rename: async (_, from, to) => {
      assert.ok(!disk.has(to), `Ziel ${to} gibt es schon`)
      disk.set(to, disk.get(from))
      disk.delete(from)
    },
    copyIn: async (_, src, rel) => (put(rel, `Kopie von ${src}`), stat(rel)),
    importImage: async (_, rel) => `bilder/${rel.replace(/\W/g, '')}.png`,
    importFile: async (_, rel) => [`00000000-0000-0000-0000-000000000001/${rel.split('/').pop()}`, 12],
    all: async () => nodes.map((n) => ({ ...n })),
    create: async (kind, parent_id, title, extra = {}) => {
      const n = { id: crypto.randomUUID(), parent_id, kind, title, sort: ++sort, props: null, config: null, deleted_at: null, ...extra, updated_at: `t${++clock}` }
      nodes.push(n)
      bodies.set(n.id, '')
      return { ...n }
    },
    update: async (id, f) => {
      const n = nodes.find((x) => x.id === id)
      if ('body' in f) bodies.set(id, f.body)
      Object.assign(n, Object.fromEntries(Object.entries(f).filter(([k]) => k !== 'body')), { updated_at: `t${++clock}` })
    },
    loadBody: async (id) => bodies.get(id) ?? '',
    changed: () => {},
    day: () => '04.11.2026',
  }
  const find = (title) => nodes.find((n) => n.title === title && !n.deleted_at)
  return { api, disk, put, nodes, bodies, writes, find }
}

test('Obsidian-Ordner als neues Notizbuch, dann in beide Richtungen', async () => {
  const w = world()
  w.put('Start.md', '# Start\n\nSiehe [[Projekte/Server]] und ![[bild.png|300]].\n')
  w.put('Projekte/Server.md', '---\ntags: [it]\n---\n\nServer-Text\n')
  w.put('Projekte/Server/Details.md', 'Details')
  w.put('bild.png', 'PNG')
  const nb = await w.api.create('notebook', null, 'Tresor', { config: { obsidian: { root: 'R', files: {}, assets: {} } } })
  const sync = () => syncVault(nb.id, w.api)

  let r = await sync()
  assert.deepEqual([r.neu, r.geschrieben], [3, 0])
  const start = w.find('Start')
  const server = w.find('Server')
  assert.equal(w.find('Projekte').kind, 'section')
  assert.equal(server.parent_id, w.find('Projekte').id)
  assert.equal(w.find('Details').parent_id, server.id, 'Ordnernotiz wird Elternseite')
  assert.equal(w.bodies.get(start.id), `Siehe [[Server|${server.id}]] und ![|300](bilder/bildpng.png).`)
  assert.equal(w.bodies.get(server.id), 'Server-Text')

  r = await sync()
  assert.deepEqual(r, { neu: 0, geaendert: 0, geschrieben: 0, konflikte: 0, fehlt: 0 }, 'zweiter Lauf ändert nichts')

  // in Nexora geändert → Datei, YAML-Kopf bleibt, Link als Wikilink mit Pfad
  await w.api.update(server.id, { body: `Neuer Text mit [[Start|${start.id}]]` })
  r = await sync()
  assert.equal(r.geschrieben, 1)
  assert.equal(w.disk.get('Projekte/Server.md').text, '---\ntags: [it]\n---\n\nNeuer Text mit [[Start|Start]]\n')

  // in Obsidian geändert → Seite, Datei bleibt unangetastet
  w.put('Start.md', 'Geändert in Obsidian')
  w.writes.length = 0
  r = await sync()
  assert.equal(r.geaendert, 1)
  assert.equal(w.bodies.get(start.id), 'Geändert in Obsidian')
  assert.deepEqual(w.writes, [])

  // in beiden geändert → Nexora in die Datei, Obsidian-Fassung als eigene Seite (und eigene Datei)
  await w.api.update(start.id, { body: 'Nexora-Fassung' })
  w.put('Start.md', 'Obsidian-Fassung')
  r = await sync()
  assert.equal(r.konflikte, 1)
  assert.equal(w.disk.get('Start.md').text, 'Nexora-Fassung\n')
  const copy = w.find('Start (Obsidian-Fassung vom 04.11.2026)')
  assert.equal(w.bodies.get(copy.id), 'Obsidian-Fassung')
  assert.equal(w.disk.get('Start (Obsidian-Fassung vom 04.11.2026).md').text, 'Obsidian-Fassung\n')

  // in Nexora umbenannt → Datei und Ordner der Unterseiten wandern mit
  await w.api.update(server.id, { title: 'Server neu' })
  await sync()
  assert.ok(w.disk.has('Projekte/Server neu.md') && w.disk.has('Projekte/Server neu/Details.md'))
  assert.ok(!w.disk.has('Projekte/Server.md') && !w.disk.has('Projekte/Server/Details.md'))
  r = await sync()
  assert.equal(r.geschrieben, 0, 'nach dem Umbenennen ruhig')

  // in Obsidian umbenannt → Titel folgt, keine neue Seite
  w.disk.set('Startseite.md', w.disk.get('Start.md'))
  w.disk.delete('Start.md')
  r = await sync()
  assert.equal(r.neu, 0)
  assert.equal(w.nodes.find((n) => n.id === start.id).title, 'Startseite')

  // in Obsidian gelöscht → Seite bleibt, wird nicht wieder geschrieben
  w.disk.delete('Projekte/Server neu/Details.md')
  r = await sync()
  assert.equal(r.fehlt, 1)
  assert.ok(w.find('Details'))
  await sync()
  assert.ok(!w.disk.has('Projekte/Server neu/Details.md'))

  // in Nexora im Papierkorb → Datei bleibt; ändert sie sich, kommt sie als neue Seite zurück
  await w.api.update(start.id, { deleted_at: 'jetzt' })
  await sync()
  assert.ok(w.disk.has('Startseite.md'))
  w.put('Startseite.md', 'zurück')
  r = await sync()
  assert.equal(r.neu, 1)
  assert.equal(w.bodies.get(w.find('Startseite').id), 'zurück')
})

test('Nexora-Notizbuch in leeren Ordner, Listen mit Feldern in beide Richtungen', async () => {
  const w = world()
  const nb = await w.api.create('notebook', null, 'Nexora')
  const db = await w.api.create('database', nb.id, 'Aufgaben', { config: { ...lopConfig('LOP'), nextNr: 3 } })
  const one = await w.api.create('row', db.id, 'Punkt eins', { props: { nr: 1, status: 'offen', prio: 'hoch', tags: ['it'] } })
  await w.api.create('row', db.id, 'Punkt zwei', { props: { nr: 2, status: 'erledigt' } })
  const page = await w.api.create('page', nb.id, 'Notiz')
  await w.api.update(page.id, { body: `Zu [[Punkt eins|${one.id}]]\n\n![|400](bilder/abc.png)\n\n\`[[x|${one.id}]]\` bleibt` })
  await w.api.update(nb.id, { config: { obsidian: { root: 'R2', files: {}, assets: {} } } })
  const sync = () => syncVault(nb.id, w.api)

  let r = await sync()
  assert.equal(r.geschrieben, 4)
  const rowFile = w.disk.get('Aufgaben/Punkt eins.md').text
  assert.match(rowFile, /^---\nNr\.: "LOP-001"\nStatus: "Offen"\nPriorität: "Hoch"\nTags:\n {2}- "it"\n---\n/)
  assert.match(w.disk.get('Aufgaben.md').text, /\| \[\[Aufgaben\/Punkt eins\\\|Punkt eins\]\] \| LOP-001 \| Offen \|/)
  assert.equal(w.disk.get('Notiz.md').text, `Zu [[Aufgaben/Punkt eins|Punkt eins]]\n\n![[Anhänge/abc.png|400]]\n\n\`[[x|${one.id}]]\` bleibt\n`)
  assert.equal(w.disk.get('Anhänge/abc.png').text, 'Kopie von bilder/abc.png')
  r = await sync()
  assert.equal(r.geschrieben, 0)

  // Feld in Obsidian ändern, fremde Eigenschaft ergänzen
  w.put('Aufgaben/Punkt eins.md', rowFile.replace('Status: "Offen"', 'Status: Erledigt\nQuelle: Obsidian').replace(/Priorität: "Hoch"\n/, ''))
  await sync()
  const after = w.nodes.find((n) => n.id === one.id)
  assert.equal(after.props.status, 'erledigt')
  assert.equal(after.props.prio, null, 'entfernte Eigenschaft = leeres Feld')
  assert.equal(after.props.nr, 1)
  assert.match(w.disk.get('Aufgaben.md').text, /Punkt eins\]\] \| LOP-001 \| Erledigt \| – \|/, 'Übersicht folgt')
  // in Nexora weiter bearbeitet: fremde Eigenschaft bleibt in der Datei
  await w.api.update(one.id, { body: 'Notiz dazu' })
  await sync()
  assert.match(w.disk.get('Aufgaben/Punkt eins.md').text, /Status: "Erledigt"\n(.*\n)*Quelle: Obsidian\n---\n\nNotiz dazu\n$/)

  // neuer Punkt aus Obsidian bekommt die nächste Nummer
  w.put('Aufgaben/Neu aus Obsidian.md', '---\nStatus: In Arbeit\nFällig: 2026-11-20\n---\nText')
  r = await sync()
  assert.equal(r.neu, 1)
  const neu = w.find('Neu aus Obsidian')
  assert.deepEqual([neu.kind, neu.props.nr, neu.props.status, neu.props.due], ['row', 3, 'arbeit', '2026-11-20'])
  assert.equal(w.nodes.find((n) => n.id === db.id).config.nextNr, 4)
  assert.match(w.disk.get('Aufgaben.md').text, /Neu aus Obsidian\]\] \| LOP-003 \| In Arbeit/)
})
