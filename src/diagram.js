// Diagramm-Block: Codeblock der Sprache "diagramm". Oben Einstellungen ("typ: balken"), darunter bei eigener Tabelle
// die Daten mit ; oder Tab getrennt (erste Zeile Überschriften, erste Spalte Beschriftungen). Reine Rechnungen, die Ansicht ist Chart.jsx.

export const CHART_TYPES = [
  ['balken', 'Balken'], ['quer', 'Balken quer'], ['gestapelt', 'Gestapelt'], ['linie', 'Linie'], ['flaeche', 'Fläche'],
  ['torte', 'Torte'], ['ring', 'Ring'], ['punkte', 'Punkte'], ['netz', 'Netz'], ['polar', 'Polar'],
]
export const SOURCES = [['tabelle', 'Eigene Tabelle'], ['liste', 'LOP-Liste (live)'], ['seite', 'Tabelle dieser Seite']]
export const GROUPS = [['status', 'Status'], ['prio', 'Priorität'], ['person', 'Zuständig'], ['tags', 'Tags'], ['faellig', 'Fällig (Monat)']]
const KEYS = ['typ', 'titel', 'quelle', 'liste', 'gruppe', 'nur', 'seite']

export function parseSpec(text) {
  const spec = { typ: 'balken', titel: '', quelle: 'tabelle', liste: '', gruppe: 'status', nur: 'offen', seite: 1, rows: [] }
  const lines = (text ?? '').replace(/\r/g, '').split('\n')
  let i = 0
  for (; i < lines.length; i++) {
    const m = /^([a-zäöü]+):\s*(.*)$/i.exec(lines[i].trim())
    if (!m || !KEYS.includes(m[1].toLowerCase())) break
    spec[m[1].toLowerCase()] = m[2].trim()
  }
  spec.seite = Math.max(1, Number(spec.seite) || 1)
  spec.rows = lines.slice(i).filter((l) => l.trim() && l.trim() !== '---').map((l) => l.split(/;|\t/).map((c) => c.trim()))
  return spec
}

export function serializeSpec(spec) {
  const head = [`typ: ${spec.typ}`, ...(spec.titel ? [`titel: ${spec.titel}`] : []), `quelle: ${spec.quelle}`]
  if (spec.quelle === 'liste') head.push(`liste: ${spec.liste}`, `gruppe: ${spec.gruppe}`, `nur: ${spec.nur}`)
  if (spec.quelle === 'seite') head.push(`seite: ${spec.seite}`)
  const rows = spec.quelle === 'tabelle' ? spec.rows.filter((r) => r.some((c) => c !== '')).map((r) => r.join(';')) : []
  return [...head, ...(rows.length ? ['---', ...rows] : [])].join('\n')
}

// Deutsche Schreibweise: "1.234,5" -> 1234.5, "4,5" -> 4.5; leer oder Text -> null
export function num(s) {
  const t = String(s ?? '').trim().replace(/\s|%|€/g, '')
  if (!t) return null
  const n = Number(/,\d+$/.test(t) || /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}

// Erste Zeile Überschriften, erste Spalte Beschriftungen; Spalten ohne eine einzige Zahl fallen weg
export function fromRows(rows) {
  if (rows.length < 2) return { labels: [], series: [] }
  const [head, ...body] = rows
  const series = head.slice(1).map((name, j) => ({ name: name || `Reihe ${j + 1}`, values: body.map((r) => num(r[j + 1])) })).filter((s) => s.values.some((v) => v != null))
  return { labels: body.map((r) => r[0] ?? ''), series }
}

// Markdown-Tabellen einer Seite als Zeilen (ohne Trennzeile |---|)
export function pageTables(md) {
  const tables = []
  let cur = null
  for (const line of (md ?? '').split('\n')) {
    const t = line.trim()
    if (t.startsWith('|') && t.endsWith('|')) {
      const cells = t.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|').replace(/\*\*|__/g, ''))
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
      ;(cur ??= []).push(cells)
    } else if (cur) {
      tables.push(cur)
      cur = null
    }
  }
  if (cur) tables.push(cur)
  return tables
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

// LOP-Punkte zählen; fields: Felder der Liste, done(row): ist erledigt
export function fromList(rows, fields, gruppe, nur, done) {
  const shown = nur === 'alle' ? rows : rows.filter((r) => !done(r))
  const field = (id) => fields.find((f) => f.id === id)
  const name = (f, id) => f?.options?.find((o) => o.id === id)?.name ?? id
  const counts = new Map()
  const add = (k) => counts.set(k, (counts.get(k) ?? 0) + 1)
  let order = null
  if (gruppe === 'status' || gruppe === 'prio') {
    const f = gruppe === 'status' ? fields.find((x) => x.type === 'status') : field('prio')
    order = [...(f?.options ?? []).map((o) => o.name), 'Ohne']
    for (const r of shown) add(r.props?.[f?.id] ? name(f, r.props[f.id]) : 'Ohne')
  } else if (gruppe === 'tags') {
    for (const r of shown) for (const t of r.props?.tags?.length ? r.props.tags : ['Ohne']) add(name(field('tags'), t))
  } else if (gruppe === 'faellig') {
    const keyOf = (d) => (d ? d.slice(0, 7) : '~')
    for (const r of shown) add(keyOf(r.props?.due))
    const keys = [...counts.keys()].sort()
    return {
      labels: keys.map((k) => (k === '~' ? 'Ohne Datum' : `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`)),
      series: [{ name: 'Punkte', values: keys.map((k) => counts.get(k)) }],
    }
  } else {
    for (const r of shown) add(r.props?.person || 'Niemand')
  }
  const labels = order ? order.filter((k) => counts.has(k)) : [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b, 'de'))
  return { labels, series: [{ name: 'Punkte', values: labels.map((k) => counts.get(k)) }] }
}

// Torte, Ring, Polar: höchstens 8 Stücke, der Rest wird "Weitere" (Farben wiederholen sich nie)
export function foldSlices({ labels, series }, max = 8) {
  if (labels.length <= max || !series.length) return { labels, series }
  const values = series[0].values
  const rest = values.slice(max - 1).reduce((s, v) => s + (v ?? 0), 0)
  return { labels: [...labels.slice(0, max - 1), `Weitere (${labels.length - max + 1})`], series: [{ ...series[0], values: [...values.slice(0, max - 1), rest] }] }
}
