// Import von Textdateien und Markdown-Export: reine Logik, ohne Tauri (testbar)
import { describe as show, formatNr, option } from './fields.js'
import { personsOf } from './people.js'

// UTF-8, sonst Windows-1252 (alte Notepad-Dateien); BOM entfernen
export function decodeText(bytes) {
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes)
  }
  return text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
}

// Dateiname -> Seitentitel und Inhalt; Logs bleiben als Textblock unverändert lesbar
export function importedPage(fileName, text) {
  const ext = fileName.split('.').pop().toLowerCase()
  const title = fileName.replace(/\.[^.]+$/, '')
  const body = ext === 'log' ? `\`\`\`plaintext\n${text.replace(/\n+$/, '')}\n\`\`\`` : text
  return { title, body }
}

// Dateiname für Windows und andere Systeme
export function safeName(title) {
  const name = (title || 'Ohne Titel').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 100)
  return name || 'Ohne Titel'
}

const KIND_ORDER = { notebook: 0, section: 1, database: 2, page: 3 }

// Pfad von einer Datei zu einer anderen (beide relativ zur Export-Wurzel, "/" getrennt)
export function relPath(fromFile, to) {
  const a = fromFile.split('/').slice(0, -1)
  const b = to.split('/')
  let i = 0
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/')
}

// CSV wie Notion sie liest: Felder mit Komma, Anführungszeichen oder Umbruch in "…"
export const toCsv = (rows) => rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n'

// Feldwert als schlichter Text (Datum als JJJJ-MM-TT, Nummer mit Kürzel); leer bleibt leer
function plain(f, n, db) {
  const v = f.type === 'nr' ? n.props?.nr : n.props?.[f.id]
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return ''
  if (f.type === 'nr') return formatNr(db, v)
  if (f.type === 'date') return v.replace('T', ' ')
  if (f.type === 'person') return personsOf(v).join(', ')
  return show(f, v)
}

// Obsidian-Eigenschaften (YAML): Listen als Liste, Datum und Häkchen ohne Anführungszeichen, sonst als JSON-String (gültiges YAML)
function yaml(f, n, db) {
  const text = plain(f, n, db)
  if (!text) return []
  const k = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(f.name) ? f.name : JSON.stringify(f.name)
  const v = n.props?.[f.id]
  if (f.type === 'multi' || f.type === 'person') return [`${k}:`, ...(f.type === 'multi' ? v.map((x) => option(f, x).name) : personsOf(v)).map((x) => `  - ${JSON.stringify(x)}`)]
  if (f.type === 'date') return [`${k}: ${v}`]
  if (f.type === 'checkbox') return [`${k}: ${!!v}`]
  return [`${k}: ${JSON.stringify(text)}`]
}

/*
 * Baut den Export für die Knoten `rootIds`.
 * src: { get(id), children(id) (Baum ohne Punkte), rows(id) (Punkte einer Liste), body(id) }
 * style: 'markdown' (normale Links), 'obsidian' (Wikilinks, Felder als YAML-Kopf, ohne Titelzeile),
 * 'notion' (wie Notions eigener Export: Listen als CSV, Felder als "Name: Wert" unter dem Titel)
 * Ergebnis: files [{ path, content }], copies [{ from, to }] (Bilder/Anhänge aus dem Datenordner)
 */
export function buildExport(rootIds, src, style = 'markdown') {
  // Verweis von der Datei `from` auf `to` (beide ab Export-Wurzel); in Tabellen muss "|" bei Obsidian maskiert sein
  const link = (text, to, from, table) => {
    const t = text.replace(/[[\]]/g, '')
    if (style === 'obsidian') return `[[${to.replace(/\.md$/, '')}${table ? '\\|' : '|'}${t.replace(/\|/g, '')}]]`
    const rel = relPath(from, to)
    if (style === 'notion') return `[${t}](${rel.split('/').map((p) => encodeURIComponent(p).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')})`
    return `[${t}](<${rel}>)`
  }
  const paths = new Map() // id -> Pfad der .md-Datei
  const plan = [] // [id, Pfad]

  // 1. Pfade vergeben (eindeutig je Ordner)
  const place = (ids, folder) => {
    const used = new Set()
    const unique = (name) => {
      let n = name
      for (let i = 2; used.has(n.toLowerCase()); i++) n = `${name} (${i})`
      used.add(n.toLowerCase())
      return n
    }
    const sorted = [...ids].sort((x, y) => (KIND_ORDER[src.get(x).kind] ?? 9) - (KIND_ORDER[src.get(y).kind] ?? 9))
    for (const id of sorted) {
      const node = src.get(id)
      const name = unique(safeName(node.title))
      const base = folder ? `${folder}/${name}` : name
      if (node.kind === 'notebook' || node.kind === 'section') {
        place(src.children(id).map((n) => n.id), base)
        continue
      }
      const file = `${base}.${style === 'notion' && node.kind === 'database' ? 'csv' : 'md'}`
      paths.set(id, file)
      plan.push([id, file])
      const kids = [...src.children(id), ...(node.kind === 'database' ? src.rows(id) : [])]
      if (kids.length) place(kids.map((n) => n.id), base)
    }
  }
  place(rootIds, '')

  // 2. Inhalte schreiben, interne Verweise und Dateien umschreiben
  const copies = new Map()
  const files = plan.map(([id, path]) => {
    const node = src.get(id)
    const rewrite = (md) =>
      md
        .replace(/\[\[lop:([0-9a-f-]{36})(?:\|alle)?\]\]/g, (_, ref) => (paths.has(ref) ? `Liste: ${link(src.get(ref).title || 'Ohne Titel', paths.get(ref), path)}` : 'Liste (nicht exportiert)'))
        .replace(/\[\[([^\]|\n]*)\|([0-9a-f-]{36})\]\]/g, (_, title, ref) => (paths.has(ref) ? link(src.get(ref).title || title, paths.get(ref), path) : title))
        .replace(/\[\[datei:([0-9a-f-]{36})\/([^\]|\n]+)\|\d+(?:\|vorschau)?\]\]/g, (_, uuid, name) => {
          const to = `anhaenge/${uuid}/${name}`
          copies.set(to, to)
          return `Anhang: ${link(name, to, path)}`
        })
        .replace(/!\[([^\]]*)\]\((bilder\/[\w-]+\.\w+)\)/g, (_, alt, img) => {
          copies.set(img, img)
          return `![${style === 'notion' ? alt.replace(/\|\d+$/, '') : alt}](${relPath(path, img)})`
        })

    const head = style === 'obsidian' ? [] : [`# ${node.icon ? `${node.icon} ` : ''}${node.title || 'Ohne Titel'}`, '']
    if (node.kind === 'database') {
      const fields = node.config?.fields ?? []
      const rows = src.rows(id)
      const cols = ['Titel', ...fields.map((f) => f.name)]
      if (style === 'notion') return { path, content: toCsv([cols, ...rows.map((r) => [r.title || 'Ohne Titel', ...fields.map((f) => plain(f, r, node))])]) }
      const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
      const table = [
        `| ${cols.map(cell).join(' | ')} |`,
        `| ${cols.map(() => '---').join(' | ')} |`,
        ...rows.map((r) => `| ${[link(r.title || 'Ohne Titel', paths.get(r.id), path, true), ...fields.map((f) => cell(plain(f, r, node) || '–'))].join(' | ')} |`),
      ]
      return { path, content: [...head, ...(rows.length ? table : ['(keine Punkte)']), ''].join('\n') }
    }
    if (node.kind === 'row') {
      const db = src.get(node.parent_id)
      const fields = db?.config?.fields ?? []
      if (style === 'obsidian') return { path, content: ['---', ...fields.flatMap((f) => yaml(f, node, db)), '---', '', rewrite(src.body(id))].join('\n') }
      if (style === 'notion') return { path, content: [...head, ...fields.map((f) => [f.name, plain(f, node, db)]).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), '', rewrite(src.body(id))].join('\n') }
      const props = fields.map((f) => `- **${f.name}:** ${plain(f, node, db) || '–'}`)
      return { path, content: [...head, ...props, '', rewrite(src.body(id))].join('\n') }
    }
    return { path, content: [...head, rewrite(src.body(id))].join('\n') }
  })
  return { files, copies: [...copies.values()].map((p) => ({ from: p, to: p })) }
}

// Nexora-Datei: ein Notizbuch verlustfrei (Knoten mit Text, Verlauf der Punkte, Bilder und Anhänge)
export const NEXORA_FORMAT = 1
const KINDS = new Set(['notebook', 'section', 'page', 'database', 'row'])
const KEEP = ['id', 'parent_id', 'kind', 'title', 'icon', 'color', 'cover', 'locked', 'template', 'props', 'config', 'sort', 'favorite', 'created_at']
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g

// src: { get(id), kids(id) (auch Punkte), body(id), activity(id) }; Eltern stehen immer vor ihren Kindern
export function packNotebook(rootId, src) {
  const nodes = []
  const walk = (id) => {
    const n = src.get(id)
    nodes.push({ ...Object.fromEntries(KEEP.map((k) => [k, n[k] ?? null])), body: src.body(id) ?? '' })
    for (const k of src.kids(id)) walk(k.id)
  }
  walk(rootId)
  const files = new Set()
  for (const n of nodes) {
    for (const m of `${n.body}\n${n.cover ?? ''}`.matchAll(/bilder\/[\w-]+\.\w+/g)) files.add(m[0])
    for (const m of n.body.matchAll(/\[\[datei:([0-9a-f-]{36}\/[^\]|\n]+)\|/g)) files.add(`anhaenge/${m[1]}`)
  }
  const activity = nodes.filter((n) => n.kind === 'row').flatMap((n) => src.activity(n.id).map((a) => ({ node_id: n.id, kind: a.kind, text: a.text, created_at: a.created_at })))
  return { json: { format: NEXORA_FORMAT, exported: new Date().toISOString(), nodes, activity }, files: [...files] }
}

// Neue IDs für alles (dieselbe Datei lässt sich mehrfach einlesen); Verweise in Text, Feldern und Einstellungen ziehen mit
export function unpackNotebook(data, makeId) {
  if (data?.format !== NEXORA_FORMAT || !Array.isArray(data.nodes) || data.nodes[0]?.kind !== 'notebook') throw new Error('Keine Nexora-Datei in diesem Format')
  const list = data.nodes.filter((n) => KINDS.has(n.kind) && typeof n.id === 'string')
  const map = new Map(list.map((n) => [n.id, makeId()]))
  const swap = (s) => s.replace(UUID, (id) => map.get(id) ?? id)
  const json = (v) => (v == null ? null : JSON.parse(swap(JSON.stringify(v))))
  const root = map.get(list[0].id)
  const nodes = list.map((n, i) => ({
    ...n,
    id: map.get(n.id),
    parent_id: i === 0 ? null : map.get(n.parent_id) ?? root,
    title: String(n.title ?? ''),
    body: swap(String(n.body ?? '')),
    props: json(n.props),
    config: json(n.config),
  }))
  // Die Kopie hängt nicht mehr an OneNote, sonst glichen zwei Notizbücher dasselbe ab
  if (nodes[0].config?.onenote) {
    const { onenote: _, ...rest } = nodes[0].config
    nodes[0].config = Object.keys(rest).length ? rest : null
  }
  const activity = (data.activity ?? []).filter((a) => map.has(a.node_id) && ['change', 'comment'].includes(a.kind)).map((a) => ({ ...a, node_id: map.get(a.node_id) }))
  return { nodes, activity }
}
