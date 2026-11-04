// Verbundener Obsidian-Ordner: Notizbuch und Ordner laufend in beide Richtungen abgleichen (reine Logik, api von außen).
// Abschnitt ↔ Ordner, Seite ↔ Datei (Unterseiten im gleichnamigen Ordner daneben, wie Obsidians Ordnernotizen),
// Liste ↔ Übersichtsdatei (schreibt nur Nexora) und Ordner mit einer Datei je Punkt (Felder als Eigenschaften).
// Nie löschen: fehlt eine Datei, bleibt die Seite; liegt eine Seite im Papierkorb, bleibt die Datei.
// In beiden geändert: die Nexora-Fassung kommt in die Datei, die Datei-Fassung als eigene Seite daneben.
//
// Stand im Notizbuch (config.obsidian): root, files { rel: { id, file, size, mtime, node, at, front, list } },
// assets { rel: { src, size } }. file = Prüfsumme der Datei, node = Prüfsumme des Texts, den Nexora schreiben würde,
// at = updated_at des Knotens beim letzten Abgleich; size/mtime sparen das Lesen unveränderter Dateien.
import { hash } from './onenote.js'
import { plain, safeName, yaml } from './io.js'
import { CODE, IMAGE, frontmatter, joinPath, linkConverter, parseDate } from './interop.js'
import { REPEATS } from './fields.js'

export const ATTACH = 'Anhänge'
const FILE_KINDS = new Set(['page', 'database', 'row'])
const dirOf = (rel) => rel.split('/').slice(0, -1).join('/')
const baseOf = (rel) => rel.split('/').pop()
const stem = (rel) => baseOf(rel).replace(/\.md$/i, '')
const join = (dir, name) => (dir ? `${dir}/${name}` : name)
const low = (s) => s.normalize('NFC').toLowerCase()
const noMd = (rel) => rel.replace(/\.md$/i, '')
const clean = (t) => (t || 'Ohne Titel').replace(/[[\]|]/g, '').trim() || 'Ohne Titel'
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Knoten unter dem Notizbuch (ohne Papierkorb), die im Ordner vorkommen
export function subtree(all, nbId) {
  const kids = new Map()
  for (const n of all) if (!n.deleted_at) kids.set(n.parent_id, [...(kids.get(n.parent_id) ?? []), n])
  const out = []
  const walk = (id) => {
    for (const n of kids.get(id) ?? []) {
      if (n.kind !== 'section' && !FILE_KINDS.has(n.kind)) continue
      out.push(n)
      walk(n.id)
    }
  }
  walk(nbId)
  return out
}

// Pfade: Datei (rel, außer Abschnitten) und Ordner für die Kinder (dir). Bisherige Namen bleiben, solange sie zum Titel
// passen, damit Umsortieren nichts umbenennt; Namen fremder Dateien im Ordner werden nicht vergeben
export function assignPaths(nbId, nodes, files) {
  const kids = new Map()
  for (const n of nodes) kids.set(n.parent_id, [...(kids.get(n.parent_id) ?? []), n])
  const prev = new Map(Object.entries(files).map(([rel, f]) => [f.id, rel]))
  const out = new Map()
  const walk = (parent, dir) => {
    const list = [...(kids.get(parent) ?? [])].sort((a, b) => a.sort - b.sort)
    const used = new Set()
    const names = new Map()
    const fits = (name, want) => low(name) === low(want) || new RegExp(`^${escRe(low(want))} \\(\\d+\\)$`).test(low(name))
    for (const n of list) {
      const old = prev.get(n.id)
      if (old && dirOf(old) === dir && fits(stem(old), safeName(n.title)) && !used.has(low(stem(old)))) {
        names.set(n.id, stem(old))
        used.add(low(stem(old)))
      }
    }
    for (const n of list) {
      if (names.has(n.id)) continue
      const want = safeName(n.title)
      let name = want
      const foreign = (x) => files[`${join(dir, x)}.md`] && files[`${join(dir, x)}.md`].id !== n.id
      for (let i = 2; used.has(low(name)) || foreign(name); i++) name = `${want} (${i})`
      names.set(n.id, name)
      used.add(low(name))
    }
    for (const n of list) {
      const sub = join(dir, names.get(n.id))
      out.set(n.id, { rel: n.kind === 'section' ? null : `${sub}.md`, dir: sub })
      walk(n.id, sub)
    }
  }
  walk(nbId, '')
  return out
}

// Nexora-Markdown → Obsidian: Seitenlinks als Wikilinks mit Pfad, Bilder und Anhänge als Einbettung/Link auf die Datei
// im Ordner. assetOf(src) → rel im Ordner (legt die Kopie bei Bedarf an); Code bleibt
export function toVault(md, { paths, get, assetOf }) {
  const target = (id) => paths.get(id)?.rel
  return md
    .split(CODE)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/\[\[lop:([0-9a-f-]{36})(?:\|alle)?\]\]/g, (all, id) => (target(id) ? `[[${noMd(target(id))}|Liste: ${clean(get(id)?.title)}]]` : all))
            .replace(/\[\[([^\]|\n]*)\|([0-9a-f-]{36})\]\]/g, (_, title, id) => (target(id) ? `[[${noMd(target(id))}|${clean(get(id)?.title || title)}]]` : title))
            .replace(/\[\[datei:([0-9a-f-]{36}\/[^\]|\n]+)\|\d+(?:\|vorschau)?\]\]/g, (all, file) => {
              const rel = assetOf(`anhaenge/${file}`)
              return rel ? `[[${rel}]]` : all
            })
            .replace(/!\[([^\]]*)\]\((bilder\/[\w-]+\.\w+)\)/g, (all, alt, src) => {
              const rel = assetOf(src)
              const width = /\|(\d+)$/.exec(alt)?.[1]
              return rel ? `![[${rel}${width ? `|${width}` : ''}]]` : all
            }),
    )
    .join('')
}

const yamlBlock = (lines) => (lines.length ? `---\n${lines.join('\n')}\n---\n\n` : '')

// Text der Datei für einen Knoten; entry.front = YAML der Seite (unverändert) bzw. fremde Eigenschaften eines Punkts
export function renderNode(node, ctx, entry) {
  if (node.kind === 'database') return overview(node, ctx)
  const body = toVault(ctx.body(node.id) ?? '', ctx).replace(/\s+$/, '')
  const front = entry?.front ? entry.front.split('\n') : []
  const head = node.kind === 'row' ? [...(ctx.get(node.parent_id)?.config?.fields ?? []).flatMap((f) => yaml(f, node, ctx.get(node.parent_id))), ...front] : front
  return body ? `${yamlBlock(head)}${body}\n` : yamlBlock(head).replace(/\n$/, '')
}

// Übersicht einer Liste: Tabelle mit Links auf die Punkte; Änderungen daran überschreibt der nächste Abgleich
function overview(db, ctx) {
  const fields = (db.config?.fields ?? []).filter((f) => f.type !== 'deps')
  const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  const rows = ctx.rows(db.id)
  const lines = [
    `> Übersicht der Liste „${clean(db.title)}“, geschrieben von Nexora. Die Punkte sind die Dateien im Ordner daneben; Änderungen hier überschreibt Nexora.`,
    '',
    `| Titel | ${fields.map((f) => cell(f.name)).join(' | ')} |`,
    `| --- | ${fields.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${ctx.paths.get(r.id)?.rel ? `[[${noMd(ctx.paths.get(r.id).rel)}\\|${clean(r.title)}]]` : cell(r.title || 'Ohne Titel')} | ${fields.map((f) => cell(plain(f, r, db) || '–')).join(' | ')} |`),
  ]
  return `${lines.join('\n')}\n`
}

// YAML-Kopf zerlegen: Blöcke je Schlüssel (Folgezeilen gehören zum Schlüssel davor)
function yamlGroups(raw) {
  const groups = []
  for (const line of raw.split('\n')) {
    const key = /^([^\s:#-][^:]*):/.exec(line)?.[1].trim().replace(/^"(.*)"$/, '$1')
    if (key != null || !groups.length) groups.push({ key: key ?? '', lines: [line] })
    else groups.at(-1).lines.push(line)
  }
  return groups
}

// Eigenschaft aus Obsidian → Feldwert; null = leer, undefined = nicht lesbar (Feld bleibt unverändert)
function fieldValue(f, v) {
  if (!v) return null
  const byName = (x) => f.options?.find((o) => low(o.name) === low(x))?.id
  switch (f.type) {
    case 'status':
    case 'select':
      return byName(v)
    case 'multi':
      return v.split(/,\s*/).filter(Boolean).map((x) => byName(x) ?? x)
    case 'person':
      return v.split(/,\s*/).filter(Boolean)
    case 'date':
      return parseDate(v) ?? undefined
    case 'checkbox':
      return /^(true|ja|yes|1|x)$/i.test(v)
    case 'number':
      return Number.isFinite(Number(v)) ? Number(v) : undefined
    case 'repeat':
      return Object.entries(REPEATS).find(([, name]) => low(name) === low(v))?.[0] ?? (REPEATS[v] ? v : undefined)
    case 'nr':
    case 'deps':
      return undefined
    default:
      return v
  }
}

/*
 * Datei → Inhalt für Nexora: { body, front, props }. Seiten behalten ihren YAML-Kopf unverändert (front); bei Punkten
 * werden bekannte Felder zu props, fremde Eigenschaften bleiben als front erhalten. Eine Überschrift, die nur den
 * Dateinamen wiederholt, fällt weg. convert = Linkumwandlung (linkConverter)
 */
export function fromVault(text, rel, { convert, fields }) {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text)
  let body = m ? text.slice(m[0].length) : text
  let front = m?.[1] ?? null
  let props = null
  if (fields) {
    props = {}
    const known = new Map(fields.map((f) => [low(f.name), f]))
    const seen = new Set()
    // frontmatter() liefert leere Werte nicht: ein fehlendes Feld ist in Obsidian geleert worden
    for (const [k, v] of m ? frontmatter(text).props : []) {
      const f = known.get(low(k.replace(/^"(.*)"$/, '$1')))
      if (!f) continue
      seen.add(f.id)
      const value = fieldValue(f, v)
      if (value !== undefined) props[f.id] = value
    }
    if (m) for (const f of fields) if (!seen.has(f.id) && f.type !== 'nr' && f.type !== 'deps') props[f.id] = null
    front = m ? yamlGroups(m[1]).filter((g) => g.key && !known.has(low(g.key))).flatMap((g) => g.lines).join('\n') || null : null
  }
  body = body.replace(/^\n+/, '')
  const h1 = /^# (.+)\n*/.exec(body)
  if (h1 && low(h1[1].trim()) === low(stem(rel))) body = body.slice(h1[0].length)
  return { body: convert(body, rel).replace(/\s+$/, ''), front, props }
}

/*
 * Ein Abgleich. api: list(root) → [{ rel, size, mtime }], read(root, rel) → Text, write(root, rel, text) → { size, mtime },
 * rename(root, from, to), copyIn(root, src, rel) → { size }, importImage(root, rel) → src, importFile(root, rel) → [Datei, Größe],
 * all() → Knoten, create(kind, parent, title, extra) → Knoten, update(id, felder), loadBody(id), changed(id), day() → "TT.MM.JJJJ"
 */
export async function syncVault(nbId, api) {
  let all = await api.all()
  const nb = all.find((n) => n.id === nbId)
  const conf = nb.config.obsidian
  const root = conf.root
  const files = { ...conf.files }
  const assets = { ...conf.assets }
  const report = { neu: 0, geaendert: 0, geschrieben: 0, konflikte: 0, fehlt: 0 }
  let dirty = false
  const listing = await api.list(root)
  const onDisk = new Map(listing.map((e) => [e.rel, e]))
  const texts = new Map()
  const read = async (rel) => {
    if (!texts.has(rel)) texts.set(rel, await api.read(root, rel))
    return texts.get(rel)
  }
  let nodes = subtree(all, nbId)
  let alive = new Map(nodes.map((n) => [n.id, n]))
  const byId = (id) => alive.get(id) ?? (id === nbId ? nb : null)
  // Umfeld für renderNode; Kopien von Bildern/Anhängen in den Ordner plant assetOf, ausgeführt wird vor dem Schreiben
  const makeCtx = (paths) => {
    const bySrc = new Map(Object.entries(assets).map(([rel, a]) => [a.src, rel]))
    const bodies = new Map()
    const copies = []
    return {
      paths,
      bodies,
      copies,
      get: (id) => alive.get(id),
      rows: (id) => nodes.filter((n) => n.parent_id === id && n.kind === 'row').sort((a, b) => a.sort - b.sort),
      body: (id) => bodies.get(id),
      assetOf: (src) => {
        if (bySrc.has(src)) return bySrc.get(src)
        let rel = `${ATTACH}/${baseOf(src)}`
        for (let i = 2; onDisk.has(rel) || assets[rel]; i++) rel = `${ATTACH}/${i}-${baseOf(src)}`
        bySrc.set(src, rel)
        copies.push([src, rel])
        return rel
      },
    }
  }
  const textOf = async (node, ctx, s) => {
    if (node.kind !== 'database') ctx.bodies.set(node.id, await api.loadBody(node.id))
    return renderNode(node, ctx, s)
  }

  // --- A: Ordner → Nexora ---
  const fresh = []
  const edited = []
  for (const e of listing) {
    if (!/\.md$/i.test(e.rel)) continue
    const s = files[e.rel]
    if (s && s.size === e.size && s.mtime === e.mtime) continue
    const h = hash(await read(e.rel))
    if (!s) fresh.push(e.rel)
    else if (h !== s.file) edited.push(e.rel)
    else {
      files[e.rel] = { ...s, size: e.size, mtime: e.mtime }
      dirty = true
    }
  }
  // in Obsidian umbenannt oder verschoben = gleicher Inhalt an neuer Stelle; sonst bleibt die Seite und wird nicht mehr geschrieben
  const moved = new Set()
  for (const rel of Object.keys(files).filter((r) => !onDisk.has(r))) {
    const s = files[rel]
    delete files[rel]
    dirty = true
    const i = s.list ? -1 : fresh.findIndex((r) => hash(texts.get(r)) === s.file)
    if (i >= 0 && alive.has(s.id)) {
      const to = fresh.splice(i, 1)[0]
      files[to] = { ...s, size: onDisk.get(to).size, mtime: onDisk.get(to).mtime }
      moved.add(to)
    } else if (alive.has(s.id) && !s.list) {
      report.fehlt++
      const n = alive.get(s.id)
      await api.update(n.id, { config: { ...n.config, obsidian: { off: true } } })
    }
  }

  // Ordner → Elternknoten: bekannte Pfade, Ordnernotiz (Datei gleichen Namens daneben), sonst neuer Abschnitt bzw. Seite
  const dirs = new Map([['', nbId]])
  for (const [id, p] of assignPaths(nbId, nodes, files)) dirs.set(p.dir, id)
  for (const [rel, s] of Object.entries(files)) if (alive.has(s.id)) dirs.set(noMd(rel), s.id)
  const parentFor = async (dir) => {
    if (dirs.has(dir)) return dirs.get(dir)
    const up = await parentFor(dirOf(dir))
    const holder = byId(up)
    const kind = ['notebook', 'section'].includes(holder?.kind) ? 'section' : 'page'
    const node = await api.create(kind, holder?.kind === 'database' ? holder.parent_id : up, baseOf(dir))
    alive.set(node.id, node)
    dirs.set(dir, node.id)
    return node.id
  }
  // neue Dateien: erst alle Knoten anlegen (flache zuerst, damit Ordnernotizen Eltern werden), dann Inhalte, damit Links passen
  const apply = new Map() // rel → Knoten-ID, deren Inhalt aus der Datei kommt
  const nextNr = new Map()
  const make = async (rel, title) => {
    const parent = await parentFor(dirOf(rel))
    const holder = byId(parent)
    const row = holder?.kind === 'database'
    const extra = {}
    if (row && holder.config?.fields?.some((f) => f.type === 'nr')) {
      const nr = nextNr.get(holder.id) ?? holder.config.nextNr ?? 1
      nextNr.set(holder.id, nr + 1)
      extra.props = { nr }
    }
    const node = await api.create(row ? 'row' : 'page', parent, title, extra)
    alive.set(node.id, node)
    dirs.set(noMd(rel), node.id)
    return node
  }
  for (const rel of fresh.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))) {
    const node = await make(rel, stem(rel))
    files[rel] = { id: node.id, file: hash(texts.get(rel)), size: onDisk.get(rel).size, mtime: onDisk.get(rel).mtime }
    apply.set(rel, node.id)
    report.neu++
    dirty = true
  }
  const force = new Set() // in beiden geändert: Nexora-Fassung schreiben
  for (const rel of edited) {
    const s = files[rel]
    const node = alive.get(s.id)
    files[rel] = { ...s, file: hash(texts.get(rel)), size: onDisk.get(rel).size, mtime: onDisk.get(rel).mtime }
    dirty = true
    if (s.list) continue // Übersicht schreibt Nexora
    if (!node) {
      // Seite im Papierkorb, Datei geändert: als neue Seite zurückholen
      const back = await make(rel, stem(rel))
      files[rel].id = back.id
      apply.set(rel, back.id)
      report.neu++
      continue
    }
    const mine = node.updated_at !== s.at && hash(await textOf(node, makeCtx(assignPaths(nbId, nodes, files)), s)) !== s.node
    if (!mine) {
      apply.set(rel, node.id)
      report.geaendert++
      continue
    }
    const copy = await api.create(node.kind === 'row' ? 'row' : 'page', node.parent_id, `${node.title} (Obsidian-Fassung vom ${api.day()})`, node.kind === 'row' ? { props: { ...node.props } } : {})
    alive.set(copy.id, copy)
    apply.set(`\0${rel}`, copy.id) // Inhalt aus rel, die Kopie bekommt beim Schreiben eine eigene Datei
    force.add(node.id)
    report.konflikte++
  }
  for (const rel of moved) {
    const s = files[rel]
    const parent = await parentFor(dirOf(rel))
    await api.update(s.id, { title: stem(rel), parent_id: parent })
    api.changed(s.id)
    report.geaendert++
  }

  // Inhalte aus den Dateien; verlinkte Bilder und Dateien erst in den Datenordner holen
  if (apply.size) {
    const exact = new Map([...onDisk.keys()].map((r) => [low(r), r]))
    const byName = new Map()
    for (const r of [...onDisk.keys()].sort((a, b) => a.split('/').length - b.split('/').length)) if (!byName.has(low(baseOf(r)))) byName.set(low(baseOf(r)), r)
    const find = (path, from, wiki) => {
      const wants = wiki ? [`${path}.md`, path] : [path]
      for (const w of wants) for (const c of [joinPath(dirOf(from), w), joinPath('', w)]) if (c != null && exact.has(low(c))) return exact.get(low(c))
      for (const w of wants) if (byName.has(low(baseOf(w)))) return byName.get(low(baseOf(w)))
      return null
    }
    const used = new Set()
    const render = (rel, label, alt, width) => {
      const id = files[rel]?.id
      if (id && alive.has(id)) return `[[${clean(alive.get(id).title)}|${id}]]`
      if (/\.md$/i.test(rel)) return label
      const a = assets[rel]
      if (!a) {
        used.add(rel)
        return label || baseOf(rel)
      }
      if (a.src.startsWith('bilder/')) return `![${alt}${width ? `|${width}` : ''}](${a.src})`
      return `[[datei:${a.src.slice('anhaenge/'.length)}|${a.size}]]`
    }
    const convert = linkConverter({ find, render, isPage: (r) => /\.md$/i.test(r) })
    const parse = (rel, id) => fromVault(texts.get(rel), rel, { convert, fields: byId(byId(id)?.parent_id)?.kind === 'database' ? byId(byId(id).parent_id).config?.fields ?? [] : null })
    for (const [key, id] of apply) parse(key.replace(/^\0/, ''), id)
    for (const rel of used) {
      try {
        assets[rel] = IMAGE.test(rel) ? { src: await api.importImage(root, rel) } : await api.importFile(root, rel).then(([file, size]) => ({ src: `anhaenge/${file}`, size }))
        dirty = true
      } catch {
        // fehlt oder nicht lesbar: bleibt als Text
      }
    }
    for (const [key, id] of apply) {
      const rel = key.replace(/^\0/, '')
      const { body, front, props } = parse(rel, id)
      const node = byId(id)
      await api.update(id, { body, ...(props ? { props: { ...node.props, ...props } } : {}) })
      if (!key.startsWith('\0')) files[rel] = { ...files[rel], front }
      api.changed(id)
    }
    for (const [dbId, nr] of nextNr) await api.update(dbId, { config: { ...byId(dbId).config, nextNr: nr } })
  }

  // --- B: Nexora → Ordner ---
  all = await api.all()
  const book = all.find((n) => n.id === nbId)
  nodes = subtree(all, nbId)
  alive = new Map(nodes.map((n) => [n.id, n]))
  const paths = assignPaths(nbId, nodes, files)
  const ctx = makeCtx(paths)
  const relOf = new Map(Object.entries(files).map(([rel, s]) => [s.id, rel]))
  const fromFile = new Set([...apply].filter(([k]) => !k.startsWith('\0')).map(([, id]) => id))
  for (const node of nodes) {
    if (!FILE_KINDS.has(node.kind) || node.config?.obsidian?.off) continue
    const want = paths.get(node.id).rel
    let rel = relOf.get(node.id)
    if (rel && rel !== want && !onDisk.has(want)) {
      await api.rename(root, rel, want)
      files[want] = files[rel]
      delete files[rel]
      onDisk.set(want, onDisk.get(rel))
      onDisk.delete(rel)
      rel = want
      dirty = true
    }
    const s = rel ? files[rel] : null
    if (s && node.kind !== 'database' && node.updated_at === s.at && !force.has(node.id)) continue
    const text = await textOf(node, ctx, s)
    const h = hash(text)
    if (fromFile.has(node.id) || (s && h === s.node && !force.has(node.id))) {
      // gerade aus der Datei gelesen oder nur Einstellungen geändert: Datei bleibt, wie sie ist
      files[rel] = { ...s, node: h, at: node.updated_at }
      dirty = true
      continue
    }
    for (const [src, to] of ctx.copies.splice(0)) {
      const { size } = await api.copyIn(root, src, to)
      assets[to] = { src, size }
    }
    const stat = await api.write(root, rel ?? want, text)
    files[rel ?? want] = { ...(s ?? { id: node.id, ...(node.kind === 'database' ? { list: true } : {}) }), file: h, node: h, size: stat.size, mtime: stat.mtime, at: node.updated_at }
    onDisk.set(rel ?? want, stat)
    report.geschrieben++
    dirty = true
  }
  if (dirty) await api.update(nbId, { config: { ...book.config, obsidian: { ...book.config.obsidian, files, assets } } })
  return report
}
