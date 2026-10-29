// Import von Textdateien und Markdown-Export: reine Logik, ohne Tauri (testbar)
import { describe as show } from './fields.js'

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

const link = (text, target) => `[${text.replace(/[[\]]/g, '')}](<${target}>)`

/*
 * Baut den Export für die Knoten `rootIds`.
 * src: { get(id), children(id) (Baum ohne Punkte), rows(id) (Punkte einer Liste), body(id) }
 * Ergebnis: files [{ path, content }], copies [{ from, to }] (Bilder/Anhänge aus dem Datenordner)
 */
export function buildExport(rootIds, src) {
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
      paths.set(id, `${base}.md`)
      plan.push([id, `${base}.md`])
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
        .replace(/\[\[lop:([0-9a-f-]{36})(?:\|alle)?\]\]/g, (_, ref) => (paths.has(ref) ? `Liste: ${link(src.get(ref).title || 'Ohne Titel', relPath(path, paths.get(ref)))}` : 'Liste (nicht exportiert)'))
        .replace(/\[\[([^\]|\n]*)\|([0-9a-f-]{36})\]\]/g, (_, title, ref) => (paths.has(ref) ? link(src.get(ref).title || title, relPath(path, paths.get(ref))) : title))
        .replace(/\[\[datei:([0-9a-f-]{36})\/([^\]|\n]+)\|\d+(?:\|vorschau)?\]\]/g, (_, uuid, name) => {
          const to = `anhaenge/${uuid}/${name}`
          copies.set(to, to)
          return `Anhang: ${link(name, relPath(path, to))}`
        })
        .replace(/!\[([^\]]*)\]\((bilder\/[\w-]+\.\w+)\)/g, (_, alt, img) => {
          copies.set(img, img)
          return `![${alt}](${relPath(path, img)})`
        })

    const head = [`# ${node.icon ? `${node.icon} ` : ''}${node.title || 'Ohne Titel'}`, '']
    if (node.kind === 'database') {
      const fields = node.config?.fields ?? []
      const rows = src.rows(id)
      const cols = ['Titel', ...fields.map((f) => f.name)]
      const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
      const table = [
        `| ${cols.map(cell).join(' | ')} |`,
        `| ${cols.map(() => '---').join(' | ')} |`,
        ...rows.map((r) => `| ${[link(r.title || 'Ohne Titel', relPath(path, paths.get(r.id))), ...fields.map((f) => cell(f.type === 'nr' ? r.props?.nr ?? '' : show(f, r.props?.[f.id])))].join(' | ')} |`),
      ]
      return { path, content: [...head, ...(rows.length ? table : ['(keine Punkte)']), ''].join('\n') }
    }
    if (node.kind === 'row') {
      const fields = src.get(node.parent_id)?.config?.fields ?? []
      const props = fields.map((f) => `- **${f.name}:** ${f.type === 'nr' ? node.props?.nr ?? '–' : show(f, node.props?.[f.id])}`)
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
