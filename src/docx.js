// Word-Export ohne Office: wandelt die fertige Druckansicht (#print-root aus Print.jsx) in eine .docx.
// Übernommen werden Überschriften, Absätze mit Hervorhebungen und Farben, Links, Listen, Aufgaben, Tabellen, Code,
// Zitate, Trennlinien und Bilder; Zeichnungen und Diagramme (SVG) kommen als Bild.
// shortcut: freie Seiten kommen als Text und Bilder in Lesereihenfolge, nicht frei angeordnet; bei Bedarf als Bild der Fläche
import { invoke } from '@tauri-apps/api/core'
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import { relativeSrc } from './images.js'

const MAX_W = 600 // Textbreite A4 bei 2 cm Rand, in Pixeln (96 dpi)
const HEADINGS = { H1: HeadingLevel.HEADING_1, H2: HeadingLevel.HEADING_2, H3: HeadingLevel.HEADING_3, H4: HeadingLevel.HEADING_4, H5: HeadingLevel.HEADING_5, H6: HeadingLevel.HEADING_6 }
const BLOCK = 'p,h1,h2,h3,h4,h5,h6,ul,ol,table,pre,blockquote,hr,div,section,figure,dl'
const DIRECT = { png: 'png', jpg: 'jpg', jpeg: 'jpg', gif: 'gif', bmp: 'bmp' } // alles andere (WebP, SVG) wird PNG
const GREY = { type: ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' }

// Bild höchstens so breit wie die Textspalte, Seitenverhältnis bleibt
export function fitSize(w, h, max = MAX_W) {
  const k = Math.min(1, max / w)
  return { width: Math.round(w * k), height: Math.round(h * k) }
}

// "rgb(220, 38, 38)" → "DC2626"; durchsichtig oder unbekannt → null
export function hexColor(css) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(css ?? '')
  if (!m || Number(m[4] ?? 1) === 0) return null
  return m.slice(1, 4).map((x) => Number(x).toString(16).padStart(2, '0')).join('').toUpperCase()
}

const hidden = (el) => getComputedStyle(el).display === 'none'

async function load(blob) {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function png(img, w, h) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  return new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/png'))).arrayBuffer())
}

// Bild aus dem Datenordner (bilder/…) oder von außen; Größe wie in der Druckansicht
async function imageRun(el) {
  const src = el.getAttribute('src')
  const rel = relativeSrc(src)
  let bytes, ext
  if (rel?.startsWith('bilder/')) {
    bytes = new Uint8Array(await invoke('read_image', { name: rel.slice('bilder/'.length) }))
    ext = rel.split('.').pop().toLowerCase()
  } else {
    const res = await fetch(src)
    bytes = new Uint8Array(await res.arrayBuffer())
    ext = (res.headers.get('content-type') ?? '').split('/')[1]?.replace('svg+xml', 'svg') ?? ''
  }
  const img = await load(new Blob([bytes], { type: ext === 'svg' ? 'image/svg+xml' : `image/${ext}` }))
  const box = el.getBoundingClientRect()
  const size = fitSize(box.width || img.naturalWidth || MAX_W, box.height || img.naturalHeight || MAX_W / 2)
  if (DIRECT[ext]) return new ImageRun({ type: DIRECT[ext], data: bytes, transformation: size })
  return new ImageRun({ type: 'png', data: await png(img, size.width * 2, size.height * 2), transformation: size })
}

// Zeichnung oder Diagramm als Bild, doppelt aufgelöst für den Druck
async function svgRun(svg) {
  const box = svg.getBoundingClientRect()
  if (!box.width || !box.height) return null
  const copy = svg.cloneNode(true)
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  copy.setAttribute('width', box.width)
  copy.setAttribute('height', box.height)
  const img = await load(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }))
  const size = fitSize(box.width, box.height)
  return new ImageRun({ type: 'png', data: await png(img, size.width * 2, size.height * 2), transformation: size })
}

// Text mit Hervorhebungen, Farben, Links und Bildern
async function runsOf(nodes, style, out = []) {
  for (const n of nodes) {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = n.textContent.replace(/\s+/g, ' ')
      if (text) out.push(new TextRun({ text, ...style }))
      continue
    }
    if (n.nodeType !== Node.ELEMENT_NODE || hidden(n)) continue
    const tag = n.tagName
    if (tag === 'BR') out.push(new TextRun({ text: '', break: 1 }))
    else if (tag === 'IMG') out.push((await imageRun(n).catch(() => null)) ?? new TextRun({ text: '[Bild]', ...style }))
    else if (tag.toLowerCase() === 'svg') out.push((await svgRun(n).catch(() => null)) ?? new TextRun({ text: '[Zeichnung]', ...style }))
    else if (tag !== 'INPUT') {
      const s = { ...style }
      if (tag === 'STRONG' || tag === 'B') s.bold = true
      if (tag === 'EM' || tag === 'I') s.italics = true
      if (tag === 'U') s.underline = {}
      if (tag === 'S' || tag === 'DEL') s.strike = true
      if (tag === 'CODE') Object.assign(s, { font: 'Consolas', shading: GREY })
      if (tag === 'MARK') s.highlight = 'yellow'
      if (n.style?.color) s.color = hexColor(getComputedStyle(n).color) ?? s.color
      const fill = n.style?.backgroundColor && hexColor(getComputedStyle(n).backgroundColor)
      if (fill) s.shading = { type: ShadingType.CLEAR, fill, color: 'auto' }
      const href = tag === 'A' ? n.getAttribute('href') ?? '' : ''
      if (/^(https?:|mailto:)/i.test(href)) out.push(new ExternalHyperlink({ link: href, children: await runsOf(n.childNodes, { ...s, style: 'Hyperlink' }) }))
      else await runsOf(n.childNodes, s, out)
    }
  }
  return out
}

// Absatz; der erste Absatz eines Listenpunkts bekommt Aufzählungszeichen, Nummer oder Kästchen (ctx.lead)
function para(children, ctx, heading) {
  const opts = { children, heading }
  if (ctx.quote) Object.assign(opts, { indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BFBFBF', space: 8 } } })
  const lead = ctx.lead
  if (lead && !lead.used) {
    lead.used = true
    if (lead.task) Object.assign(opts, { children: [new TextRun(lead.task), ...children], indent: { left: 360 * (lead.level + 1) } })
    else if (lead.number) opts.numbering = lead.number
    else opts.bullet = { level: lead.level }
  } else if (lead) opts.indent = { left: 360 * (lead.level + 2) }
  return new Paragraph(opts)
}

let instance = 0 // jede nummerierte Liste beginnt wieder bei 1

async function list(el, ctx, out, level) {
  const task = el.dataset.type === 'taskList'
  const number = el.tagName === 'OL' && { reference: 'zahlen', level, instance: ++instance }
  for (const li of el.children) {
    if (li.tagName !== 'LI' || hidden(li)) continue
    const lead = { level, number, task: task && (li.dataset.checked === 'true' ? '☑ ' : '☐ '), used: false }
    const nested = (n) => n.nodeType === Node.ELEMENT_NODE && (n.tagName === 'UL' || n.tagName === 'OL' || n.tagName === 'LABEL')
    await blocks(li.childNodes, { ...ctx, lead, skip: nested }, out)
    if (!lead.used) out.push(para([], { ...ctx, lead }))
    for (const sub of li.querySelectorAll('ul, ol')) if (sub.parentElement.closest('li') === li) await list(sub, ctx, out, level + 1)
  }
}

async function table(el) {
  const rows = []
  for (const tr of el.querySelectorAll('tr')) {
    if (tr.closest('table') !== el) continue
    const cells = []
    for (const td of tr.children) {
      const kids = await blocks(td.childNodes, {})
      cells.push(new TableCell({ children: kids.length ? kids : [new Paragraph('')], columnSpan: td.colSpan > 1 ? td.colSpan : undefined, shading: td.tagName === 'TH' ? GREY : undefined }))
    }
    if (cells.length) rows.push(new TableRow({ children: cells }))
  }
  return rows.length ? new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }) : new Paragraph('')
}

// Felder eines LOP-Punkts (dt/dd aus Print.jsx) als zweispaltige Tabelle
function fields(dl) {
  const cell = (el, color) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: el.textContent, color })] })] })
  const rows = [...dl.querySelectorAll('dt')].map((dt) => new TableRow({ children: [cell(dt, '808080'), cell(dt.nextElementSibling)] }))
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })
}

function code(pre) {
  const lines = pre.textContent.replace(/\n$/, '').split('\n')
  return new Paragraph({ shading: GREY, children: lines.map((text, i) => new TextRun({ text, font: 'Consolas', size: 19, ...(i && { break: 1 }) })) })
}

async function blocks(nodes, ctx, out = []) {
  let loose = []
  const flush = async () => {
    if (loose.some((n) => n.nodeType === Node.ELEMENT_NODE || n.textContent.trim())) out.push(para(await runsOf(loose, {}), ctx))
    loose = []
  }
  for (const n of [...nodes]) {
    if (n.nodeType === Node.ELEMENT_NODE && (hidden(n) || ctx.skip?.(n))) continue
    const tag = n.nodeType === Node.ELEMENT_NODE ? n.tagName : ''
    if (!tag || !n.matches(BLOCK)) {
      loose.push(n)
      continue
    }
    await flush()
    if (HEADINGS[tag] || tag === 'P') out.push(para(await runsOf(n.childNodes, {}), ctx, HEADINGS[tag]))
    else if (tag === 'UL' || tag === 'OL') await list(n, ctx, out, ctx.lead ? ctx.lead.level + 1 : 0)
    else if (tag === 'TABLE') out.push(await table(n))
    else if (tag === 'DL') out.push(fields(n))
    else if (tag === 'PRE') out.push(code(n))
    else if (tag === 'BLOCKQUOTE') await blocks(n.childNodes, { ...ctx, quote: true }, out)
    else if (tag === 'HR') out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } } }))
    else if (n.querySelector(BLOCK)) await blocks(n.childNodes, ctx, out)
    else if (n.textContent.trim() || n.querySelector('img, svg')) out.push(para(await runsOf(n.childNodes, {}), ctx))
  }
  await flush()
  return out
}

// root: #print-root mit den fertig aufgebauten Seiten; Ergebnis: Bytes der .docx
export async function toDocx(root) {
  instance = 0
  const children = []
  for (const [i, page] of [...root.querySelectorAll(':scope > .print-page')].entries()) {
    const [path, title, ...rest] = page.children
    children.push(new Paragraph({ pageBreakBefore: i > 0, children: [new TextRun({ text: path.textContent, color: '808080', size: 18 })] }))
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title.textContent)] }))
    await blocks(rest, {}, children)
  }
  const levels = [0, 1, 2, 3, 4, 5].map((level) => ({ level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 360 * (level + 1) + 360, hanging: 360 } } } }))
  const doc = new Document({
    creator: 'Nexora',
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: { config: [{ reference: 'zahlen', levels }] },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  })
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer())
}
