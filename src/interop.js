// Import aus Obsidian (Ordner) und Notion (Export „Markdown & CSV“, entpackt): reine Logik ohne Tauri (testbar).
// Eingabe ist die Dateiliste [{ rel, size }] mit "/"-Pfaden und der Text der .md-Dateien (bei Notion auch .csv).
import { LOP_FIELDS } from './fields.js'

export const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i
const NOTION_ID = /\s?[0-9a-f]{32}$/i

const dirOf = (rel) => rel.split('/').slice(0, -1).join('/')
const baseOf = (rel) => rel.split('/').pop()
const stemOf = (rel) => rel.replace(/\.[^./]+$/, '')
const key = (p) => p.normalize('NFC').toLowerCase()
const decode = (s) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
// Titel ohne Zeichen, die einen Seitenlink [[Titel|id]] stören
const clean = (t) => t.replace(/[[\]|]/g, '').trim()

// Notion hängt jedem Namen eine ID an: "Server 1a2b…" → "Server"
export const stripId = (name) => name.replace(NOTION_ID, '').trim() || name

// "a/b" + "../c.md" → "a/c.md"; null, wenn der Pfad aus dem Ordner hinausführt
export function joinPath(dir, rel) {
  const out = dir ? dir.split('/') : []
  for (const part of rel.split('/')) {
    if (part === '..') {
      if (!out.length) return null
      out.pop()
    } else if (part && part !== '.') out.push(part)
  }
  return out.join('/')
}

// YAML-Kopf von Obsidian ("---" … "---") als [Schlüssel, Wert]; einfache Werte, Listen ("- a") und [a, b]
export function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text)
  if (!m) return { props: [], body: text }
  const props = []
  const unquote = (v) => v.trim().replace(/^(["'])(.*)\1$/, '$2')
  for (const line of m[1].split('\n')) {
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && props.length) {
      const last = props.at(-1)
      last[1] = [last[1], unquote(item[1])].filter(Boolean).join(', ')
      continue
    }
    const kv = /^([^\s:#-][^:]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    const v = kv[2].trim()
    props.push([kv[1].trim(), /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map(unquote).filter(Boolean).join(', ') : unquote(v)])
  }
  return { props: props.filter(([, v]) => v !== ''), body: text.slice(m[0].length) }
}

// CSV nach RFC 4180: Anführungszeichen, "" und Zeilenumbrüche im Feld; leere Zeilen fallen weg
export function parseCsv(text) {
  const rows = [[]]
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',' || c === '\n') {
      rows.at(-1).push(field)
      field = ''
      if (c === '\n') rows.push([])
    } else if (c !== '\r') field += c
  }
  rows.at(-1).push(field)
  return rows.filter((r) => r.some((v) => v.trim()))
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONATE = ['jan', 'feb', 'mär', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dez']
const pad = (n) => String(n).padStart(2, '0')

// Notion schreibt Daten je nach Sprache ("October 30, 2026 3:00 PM", "30. Oktober 2026 15:00") oder ISO;
// bei Zeiträumen ("… → …") zählt der Beginn. Ergebnis "JJJJ-MM-TT" oder "JJJJ-MM-TTTHH:MM", sonst null
export function parseDate(text) {
  const s = String(text).split('→')[0].trim()
  let y, m, d, t, r
  if ((r = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}:\d{2}))?/.exec(s))) [, y, m, d, t] = r
  else if ((r = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?: (\d{1,2}:\d{2}))?$/.exec(s))) [, d, m, y, t] = r
  else if ((r = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4})(?: (\d{1,2}):(\d{2}) ?([AP]M)?)?$/i.exec(s))) {
    y = r[3]
    m = MONTHS.indexOf(r[1].toLowerCase()) + 1
    d = r[2]
    if (r[4]) t = `${r[6] ? (Number(r[4]) % 12) + (/pm/i.test(r[6]) ? 12 : 0) : r[4]}:${r[5]}`
  } else if ((r = /^(\d{1,2})\. ?([A-Za-zÄä]{3})[a-zä]*\.? (\d{4})(?: (\d{1,2}:\d{2}))?$/.exec(s))) {
    y = r[3]
    m = MONATE.indexOf(r[2].toLowerCase()) + 1
    d = r[1]
    t = r[4]
  } else return null
  m = Number(m)
  d = Number(d)
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null
  const day = `${y}-${pad(m)}-${pad(d)}`
  return t ? `${day}T${t.padStart(5, '0')}` : day
}

const DONE = /^(done|erledigt|fertig|completed?|abgeschlossen|closed)$/i
const STATUS_COLOR = [[DONE, 'gruen'], [/^(in progress|in arbeit|in bearbeitung|doing)$/i, 'blau'], [/^(wartet|waiting|blocked|blockiert)$/i, 'gelb']]
const PRIO_COLOR = [[/^(hoch|high|dringend|urgent)$/i, 'rot'], [/^(mittel|medium)$/i, 'orange']]
const colorFor = (list, v) => list.find(([re]) => re.test(v))?.[1] ?? 'grau'

// Spalte einer Notion-Tabelle → Feld der Liste: Status, Priorität, Zuständig, Tags und Daten werden erkannt, der Rest ist Text
function fieldFor(name, values, taken, short) {
  const id = (want) => {
    const v = want && !taken.has(want) ? want : short()
    taken.add(v)
    return v
  }
  const list = (split) => [...new Set(values.flatMap((v) => (split ? v.split(/,\s*/) : [v])).map((v) => v.trim()).filter(Boolean))]
  if (/^status$/i.test(name)) return { id: id('status'), name, type: 'status', options: list().map((v) => ({ id: short(), name: v, color: colorFor(STATUS_COLOR, v), ...(DONE.test(v) ? { done: true } : {}) })) }
  if (/^(priorit(ä|ae)t|priority|prio)$/i.test(name)) return { id: id('prio'), name, type: 'select', options: list().map((v) => ({ id: short(), name: v, color: colorFor(PRIO_COLOR, v) })) }
  if (/^(person|personen|assignee|assigned to|zuständig|owner|verantwortlich|bearbeiter)$/i.test(name)) return { id: id('person'), name, type: 'person' }
  if (/^(tags?|labels?|schlagw(ö|oe)rter|schlagworte|kategorien?)$/i.test(name)) return { id: id('tags'), name, type: 'multi', options: list(true).map((v) => ({ id: v, name: v, color: 'grau' })) }
  const filled = values.filter((v) => v.trim())
  if (filled.length && filled.every(parseDate)) return { id: id(/^(fällig|due|due date|deadline|frist)$/i.test(name) && 'due'), name, type: 'date' }
  return { id: id(), name, type: 'text' }
}

function cellValue(f, raw) {
  const v = (raw ?? '').trim()
  if (!v) return null
  if (f.type === 'status' || f.type === 'select') return f.options.find((o) => o.name === v)?.id ?? null
  if (f.type === 'multi' || f.type === 'person') return v.split(/,\s*/).filter(Boolean)
  if (f.type === 'date') return parseDate(v)
  return v
}

const LINK = /(!?)\[\[([^\]\n]+?)\]\]|(!?)\[([^\]\n]*)\]\((<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"\n]*")?\)/g
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/

/*
 * Plant den Import als neues Notizbuch: Knoten für db.insertNode, Eltern vor Kindern.
 * style 'obsidian' | 'notion'; texts Map rel → Text; assets Map rel → { src: 'bilder/…' } | { file: '<uuid>/<Name>', size }.
 * Verlinkte Bilder und Dateien ohne Eintrag in assets stehen in `used`: erst diese übernehmen, dann noch einmal planen.
 */
export function planImport(style, { files, texts, title, makeId, assets = new Map() }) {
  const notion = style === 'notion'
  const isPage = notion ? /\.(md|csv)$/i : /\.md$/i
  const short = () => makeId().replace(/-/g, '').slice(0, 8)
  const nodes = []
  const byId = new Map()
  const byRel = new Map() // key(rel) einer .md/.csv → Knoten
  const used = new Set()
  const sorts = new Map()
  const make = (kind, t, extra) => {
    const n = { id: makeId(), parent_id: null, kind, title: t, body: '', props: null, config: null, sort: 0, ...extra }
    nodes.push(n)
    byId.set(n.id, n)
    return n
  }
  const place = (n, parent) => {
    const sort = (sorts.get(parent.id) ?? 0) + 1000
    sorts.set(parent.id, sort)
    Object.assign(n, { parent_id: parent.id, sort })
  }
  const book = make('notebook', notion && /^Export-[0-9a-f-]{8,}/i.test(title) ? 'Notion-Import' : title)
  const sorted = [...files].sort((a, b) => a.rel.localeCompare(b.rel, 'de', { numeric: true }))
  const exact = new Map(sorted.map((f) => [key(f.rel), f.rel]))

  // Notion: Hüllordner ohne eigene Seite überspringen (z. B. "Private & Shared")
  let skip = ''
  while (notion && sorted.length) {
    const first = new Set(sorted.map((f) => f.rel.slice(skip.length).split('/')[0]))
    if (first.size !== 1 || sorted.some((f) => !f.rel.slice(skip.length).includes('/'))) break
    skip += `${[...first][0]}/`
  }
  const top = skip.replace(/\/$/, '')

  // 1. Seiten und Listen anlegen (noch ohne Platz im Baum)
  const pages = [] // { rel, node, text, keys }
  const tables = [] // { rel, folder, node }
  for (const f of sorted) {
    if (!isPage.test(f.rel)) continue
    const stem = stemOf(f.rel)
    if (/\.csv$/i.test(f.rel)) {
      const folder = stem.replace(/_all$/, '')
      if (folder === stem && exact.has(key(`${stem}_all.csv`))) continue // "_all" enthält auch gefilterte Punkte
      const node = make('database', stripId(baseOf(folder)))
      byRel.set(key(f.rel), node)
      byRel.set(key(`${folder}.csv`), node)
      tables.push({ rel: f.rel, folder, node })
      continue
    }
    if (notion && (exact.has(key(`${stem}.csv`)) || exact.has(key(`${stem}_all.csv`)))) continue
    let text = texts.get(f.rel) ?? ''
    let t = notion ? stripId(baseOf(stem)) : baseOf(stem)
    if (notion) {
      const h1 = /^# (.+)\n*/.exec(text)
      if (h1) {
        t = h1[1].trim()
        text = text.slice(h1[0].length)
      }
    }
    const node = make('page', clean(t) || 'Ohne Titel')
    byRel.set(key(f.rel), node)
    pages.push({ rel: f.rel, node, text })
  }

  // Ordner → Elternknoten: Seite oder Liste gleichen Namens (Notion, Obsidian-Ordnernotiz), sonst Abschnitt
  const folders = new Map()
  const holder = (n) => {
    while (n.kind === 'row' || n.kind === 'database') n = byId.get(n.parent_id) ?? book
    return n
  }
  const ownerOf = (dir) => {
    if (dir === top || !dir) return book
    if (!folders.has(dir)) {
      let n = byRel.get(key(`${dir}.md`)) ?? byRel.get(key(`${dir}.csv`))
      if (!n) {
        const parent = holder(ownerOf(dirOf(dir)))
        n = make(['notebook', 'section'].includes(parent.kind) ? 'section' : 'page', clean(notion ? stripId(baseOf(dir)) : baseOf(dir)))
        place(n, parent)
      }
      folders.set(dir, n)
    }
    return folders.get(dir)
  }

  // 2. Listen mit ihren Punkten (flache zuerst, damit Listen in Punkten ihren Platz finden)
  const norm = (s) => key(s).replace(/[^\p{L}\p{N}]/gu, '')
  const pageOf = new Map(pages.map((p) => [p.node, p]))
  for (const tb of tables.sort((a, b) => a.folder.split('/').length - b.folder.split('/').length)) {
    place(tb.node, holder(ownerOf(dirOf(tb.rel))))
    const [head = [], ...data] = parseCsv(texts.get(tb.rel) ?? '')
    const taken = new Set()
    const fields = head.slice(1).map((name, i) => fieldFor(name.trim(), data.map((r) => r[i + 1] ?? ''), taken, short))
    if (!fields.some((f) => f.type === 'status')) fields.unshift({ ...structuredClone(LOP_FIELDS[1]), id: taken.has('status') ? short() : 'status' })
    tb.node.config = { fields, prefix: '', nextNr: 1, view: 'table', hideDone: false }
    const pending = pages.filter((p) => !p.node.parent_id && dirOf(p.rel) === tb.folder)
    const keys = head.map((h) => h.trim())
    for (const r of data) {
      const t = (r[0] ?? '').trim()
      const i = pending.findIndex((p) => norm(p.node.title) === norm(t))
      const row = i >= 0 ? pending.splice(i, 1)[0].node : make('row', clean(t) || 'Ohne Titel')
      row.kind = 'row'
      if (t) row.title = clean(t)
      const props = Object.fromEntries(fields.map((f, j) => [f.id, cellValue(f, r[j + 1])]).filter(([, v]) => v != null))
      row.props = Object.keys(props).length ? props : null
      if (pageOf.has(row)) pageOf.get(row).keys = keys
      place(row, tb.node)
    }
    for (const p of pending) {
      p.node.kind = 'row'
      place(p.node, tb.node)
    }
  }

  // 3. Übrige Seiten einhängen
  for (const p of pages) if (!p.node.parent_id) place(p.node, holder(ownerOf(dirOf(p.rel))))

  // Verweis auflösen: relativ zur Datei, ab Wurzel, bei Obsidian zuletzt über den Dateinamen (kürzester Pfad zuerst)
  const byName = new Map()
  for (const f of [...sorted].sort((a, b) => a.rel.split('/').length - b.rel.split('/').length)) if (!byName.has(key(baseOf(f.rel)))) byName.set(key(baseOf(f.rel)), f.rel)
  const find = (path, from, wiki) => {
    const wants = wiki ? [`${path}.md`, path] : [path]
    for (const w of wants) {
      for (const c of [joinPath(dirOf(from), w), joinPath('', w)]) if (c != null && exact.has(key(c))) return exact.get(key(c))
    }
    if (!notion) for (const w of wants) if (byName.has(key(baseOf(w)))) return byName.get(key(baseOf(w)))
    return null
  }
  const render = (rel, label, alt, width) => {
    const node = byRel.get(key(rel))
    if (node) return `[[${node.title}|${node.id}]]`
    if (isPage.test(rel)) return label
    const a = assets.get(rel)
    if (!a) {
      used.add(rel)
      return label || baseOf(rel)
    }
    if (a.src) return `![${alt}${width ? `|${width}` : ''}](${a.src})`
    return `[[datei:${a.file}|${a.size}]]`
  }
  const convert = (md, from) =>
    md
      .split(CODE)
      .map((part, i) => {
        if (i % 2) return part
        const out = part.replace(LINK, (all, wbang, wiki, mbang, label, target) => {
          if (wiki != null) {
            const bar = wiki.indexOf('|')
            const [raw, alias] = bar < 0 ? [wiki, ''] : [wiki.slice(0, bar), wiki.slice(bar + 1)]
            const [path, anchor = ''] = raw.split('#')
            if (!path.trim()) return alias || anchor.replace(/^\^/, '')
            const rel = find(path.trim(), from, true)
            const width = /^(\d+)(?:x\d+)?$/.exec(alias)?.[1]
            return rel ? render(rel, alias || path, '', width) : alias || path
          }
          const t = target.replace(/^<|>$/g, '')
          if (/^[a-z][\w+.-]*:/i.test(t) || t.startsWith('#')) return all // http:, mailto:, Anker
          const rel = find(decode(t.split('#')[0]), from, false)
          // fehlende Seite → nur der Text; alles andere (z. B. "- [ ] (offen)") bleibt, wie es war
          if (!rel) return mbang || !isPage.test(t.split('#')[0]) ? all : label
          return render(rel, label, label.replace(/\|/g, ''))
        })
        return notion ? out : out.replace(/==([^=\n]+)==/g, '<span style="background-color: yellow">$1</span>')
      })
      .join('')

  // 4. Inhalte: Obsidian-Eigenschaften als Liste oben, bei Notion-Punkten die Feldzeilen weg (stehen in den Feldern)
  for (const p of pages) {
    let text = p.text
    let lead = []
    if (!notion) {
      const fm = frontmatter(text)
      // eine Überschrift, die nur den Dateinamen wiederholt, ist in Nexora schon der Seitentitel
      const h1 = /^# (.+)\n*/.exec(fm.body)
      text = h1 && key(h1[1].trim()) === key(p.node.title) ? fm.body.slice(h1[0].length) : fm.body
      lead = fm.props.map(([k, v]) => `- **${k}:** ${v}`)
    } else if (p.keys) {
      const lines = text.split('\n')
      let i = 0
      while (i < lines.length && p.keys.some((k) => lines[i].startsWith(`${k}: `) || lines[i] === `${k}:`)) i++
      text = lines.slice(i).join('\n').replace(/^\n+/, '')
    }
    p.node.body = [...lead, ...(lead.length ? [''] : []), convert(text, p.rel)].join('\n').replace(/\s+$/, '')
  }

  const depth = (n) => {
    let d = 0
    for (let x = n; x.parent_id; x = byId.get(x.parent_id)) d++
    return d
  }
  return { nodes: nodes.sort((a, b) => depth(a) - depth(b)), used: [...used] }
}
