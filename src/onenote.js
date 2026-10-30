import { invoke } from '@tauri-apps/api/core'
import { serializeBoxes } from './free.js'

// OneNote-Brücke, nur lesend: Hierarchie und Seiten kommen als XML (Schema 2013) über onenote.rs.
// Eine Seite wird eine freie Seite: jeder OneNote-Container ein Kasten an derselben Stelle.
const NS = 'http://schemas.microsoft.com/office/onenote/2013/onenote'
const parseXml = (s) => new DOMParser().parseFromString(s, 'application/xml')
const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : [])
const kid = (el, name) => kids(el, name)[0]
const px = (pt) => Math.round(((Number(pt) || 0) * 4) / 3) // OneNote rechnet in Punkt
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const plain = (html) => new DOMParser().parseFromString(html, 'text/html').body.textContent
export const link = (node) => node?.config?.onenote ?? null

// Bildformat an den ersten Bytes (OneNote gibt keins an); andere Formate (EMF, BMP …) bleiben draußen
const IMAGE_TYPES = [['iVBOR', 'png'], ['/9j/', 'jpg'], ['R0lGOD', 'gif'], ['UklGR', 'webp']]
// Stand der Umwandlung: steigt er, übernimmt der nächste Abgleich alle Seiten neu (2: Format, Dateien, Freihand)
export const CONVERT = 2

// OneNote-Format (CSS im Text) auf das, was Nexora behält: Farbe, Hintergrund, Schrift und Größe, sofern sie vom
// Absatzformat abweichen; fett, kursiv, unterstrichen erkennt der Editor selbst
const KEEP = { color: 'color', background: 'background-color', 'background-color': 'background-color', 'mso-highlight': 'background-color', 'font-family': 'font-family', 'font-size': 'font-size', 'font-weight': 'font-weight', 'font-style': 'font-style', 'text-decoration': 'text-decoration' }
export function css(style, base) {
  const out = []
  for (const part of (style ?? '').split(';')) {
    const [k, ...rest] = part.split(':')
    const prop = KEEP[k?.trim().toLowerCase()]
    const value = rest.join(':').trim().replace(/^['"]|['"]$/g, '')
    if (!prop || !value || out.some(([p]) => p === prop)) continue
    if (prop === 'color' && /^(automatic|#?0{6}|black|windowtext)$/i.test(value)) continue
    if (prop === 'background-color' && /^(automatic|transparent|none|white|#?f{6})$/i.test(value)) continue
    if (prop === 'font-family' && value.toLowerCase() === base.font?.toLowerCase()) continue
    if (prop === 'font-size' && parseFloat(value) === base.size) continue
    out.push([prop, value])
  }
  return out.map(([p, v]) => `${p}:${v}`).join(';')
}
// Text eines Absatzes: Stile bereinigen, Absatzstil (OE style) als Hülle
function tidy(html, oeStyle, base) {
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
  for (const el of body.querySelectorAll('[style]')) {
    const s = css(el.getAttribute('style'), base)
    if (s) el.setAttribute('style', s)
    else el.removeAttribute('style')
  }
  const outer = css(oeStyle, base)
  return outer ? `<span style="${outer}">${body.innerHTML}</span>` : body.innerHTML
}

// Freihand als Bild: Striche (DIPs, von onenote_ink) → SVG, so groß wie gezeichnet. Im dunklen Modus kehrt index.css
// die Farben um (sonst wäre schwarze Tinte unsichtbar)
export function inkSvg(strokes, pad = 4) {
  const pts = strokes.flatMap((s) => s.points)
  if (!pts.length) return null
  const [x0, y0] = [Math.min(...pts.map((p) => p[0])) - pad, Math.min(...pts.map((p) => p[1])) - pad]
  const w = Math.ceil(Math.max(...pts.map((p) => p[0])) - x0 + pad)
  const h = Math.ceil(Math.max(...pts.map((p) => p[1])) - y0 + pad)
  const n = (v) => Math.round(v * 10) / 10
  const paths = strokes.map((s) => {
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${n(p[0] - x0)} ${n(p[1] - y0)}`).join('') + (s.points.length === 1 ? `l0.1 0` : '')
    return `<path d="${d}" stroke="${s.color}" stroke-width="${n(Math.max(1, s.width))}"${s.marker ? ' stroke-opacity="0.4"' : ''}/>`
  })
  return { width: w, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none" stroke-linecap="round" stroke-linejoin="round">${paths.join('')}</svg>` }
}
const INK = ['InkDrawing', 'InkWord', 'InkParagraph', 'InkLine']
// alle Freihand-Daten eines Elements (InkParagraph enthält InkLine/InkWord mit je eigenen Daten)
const inkData = (el) => [el, ...el.querySelectorAll('*')].filter((x) => x.localName === 'Data' && INK.includes(x.parentElement?.localName)).map((d) => d.textContent.replace(/\s/g, ''))

export async function listNotebooks() {
  const root = parseXml(await invoke('onenote', { op: 'notebooks', id: '' })).documentElement
  return kids(root, 'Notebook').map((n) => ({ id: n.getAttribute('ID'), name: n.getAttribute('nickname') || n.getAttribute('name') }))
}

// Abschnittsgruppen und Abschnitte in Reihenfolge; group = ID der umgebenden Gruppe (null = direkt im Notizbuch).
// Papierkorb fällt weg
export function parseNotebook(source) {
  const root = parseXml(source).documentElement
  const groups = []
  const sections = []
  const walk = (el, group) => {
    for (const c of el.children) {
      if (c.localName === 'SectionGroup' && c.getAttribute('isRecycleBin') !== 'true') {
        groups.push({ id: c.getAttribute('ID'), name: c.getAttribute('name'), group })
        walk(c, c.getAttribute('ID'))
      }
      if (c.localName !== 'Section' || c.getAttribute('isInRecycleBin') === 'true') continue
      sections.push({
        id: c.getAttribute('ID'),
        name: c.getAttribute('name'),
        group,
        color: /^#[0-9a-f]{6}$/i.test(c.getAttribute('color') ?? '') ? c.getAttribute('color').toLowerCase() : null, // Reiterfarbe in OneNote
        locked: c.getAttribute('locked') === 'true' || c.getAttribute('encrypted') === 'true',
        pages: kids(c, 'Page')
          .filter((p) => p.getAttribute('isInRecycleBin') !== 'true')
          .map((p) => ({ id: p.getAttribute('ID'), name: p.getAttribute('name') || 'Ohne Titel', level: Number(p.getAttribute('pageLevel')) || 1 })),
      })
    }
  }
  walk(root, null)
  return { id: root.getAttribute('ID'), name: root.getAttribute('nickname') || root.getAttribute('name'), groups, sections }
}

const note = (text) => `<p><em>(${esc(text)})</em></p>`

function block(el, ctx) {
  switch (el.localName) {
    case 'Table':
      return `<table><tbody>${kids(el, 'Row')
        .map((row, i) => `<tr>${kids(row, 'Cell').map((cell) => (i ? `<td><p>${cellText(cell)}</p></td>` : `<th><p>${cellText(cell)}</p></th>`)).join('')}</tr>`)
        .join('')}</tbody></table>`
    case 'Image': {
      const data = kid(el, 'Data')?.textContent.replace(/\s/g, '')
      const ext = data && IMAGE_TYPES.find(([magic]) => data.startsWith(magic))?.[1]
      if (!ext) return note('Bild in einem Format, das Nexora nicht übernimmt')
      ctx.images.push({ data, ext })
      return `<img src="nximg:${ctx.images.length - 1}" width="${px(kid(el, 'Size')?.getAttribute('width')) || 400}">`
    }
    case 'InkDrawing':
    case 'InkWord':
    case 'InkParagraph':
    case 'InkLine': {
      // Platzhalter nximg-Art: pageBody macht daraus ein SVG-Bild
      const data = inkData(el)
      if (!data.length) return ''
      ctx.ink.push(data)
      return `<img src="nxink:${ctx.ink.length - 1}" alt="Freihand">`
    }
    case 'InsertedFile': {
      // OneNote hält eine Kopie im Zwischenspeicher (pathCache); pageBody übernimmt sie als Anhang
      ctx.files.push({ path: el.getAttribute('pathCache') || el.getAttribute('pathSource'), name: el.getAttribute('preferredName') || 'Datei' })
      return `<div data-attachment="nxfile:${ctx.files.length - 1}" data-size="0" data-preview="0"></div>`
    }
    case 'MediaFile':
      return note('Audio oder Video aus OneNote nicht übernommen')
    default:
      return '' // List, Tag, OEChildren, Meta … behandeln die Aufrufer
  }
}

const cellText = (cell) => [...cell.getElementsByTagNameNS(NS, 'T')].map((t) => t.textContent).join(' ')

// Inhalt eines Absatzes (OE): Text mit Absatzformat, Tabellen, Bilder, Freihand. Mehrere Freihand-Wörter
// hintereinander (eine Zeile Handschrift) werden ein Bild
function content(oe, ctx) {
  const def = ctx.styles.get(oe.getAttribute('quickStyleIndex')) ?? ctx.base
  const style = def.name
  const parts = []
  for (const c of oe.children) {
    if (INK.includes(c.localName) && INK.includes(parts.at(-1)?.el?.localName)) {
      ctx.ink[parts.at(-1).ink].push(...inkData(c))
      continue
    }
    if (c.localName !== 'T') {
      const html = block(c, ctx)
      parts.push({ el: c, html, ink: INK.includes(c.localName) ? ctx.ink.length - 1 : null })
      continue
    }
    const text = tidy(c.textContent, oe.getAttribute('style'), def)
    if (/^h[1-6]$/.test(style)) parts.push({ el: c, html: `<${style}>${text}</${style}>` })
    else if (style === 'code') parts.push({ el: c, html: `<pre><code>${esc(plain(c.textContent))}</code></pre>` })
    else parts.push({ el: c, html: `<p>${text}</p>` })
  }
  return parts.map((p) => p.html).join('')
}

function listKind(oe, ctx) {
  const tag = kid(oe, 'Tag')
  if (tag && ctx.todos.has(tag.getAttribute('index'))) return 'task'
  const list = kid(oe, 'List')
  return list ? (kid(list, 'Number') ? 'ol' : 'ul') : null
}

const OPEN = { ul: '<ul>', ol: '<ol>', task: '<ul data-type="taskList">' }

// Absätze nacheinander; aufeinanderfolgende Listenpunkte werden eine Liste, eingerückte eine Unterliste
function children(el, ctx) {
  let html = ''
  let open = null
  const close = () => open && (html += open === 'ol' ? '</ol>' : '</ul>')
  for (const oe of kids(el, 'OE')) {
    const kind = listKind(oe, ctx)
    if (kind !== open) (close(), (open = kind), kind && (html += OPEN[kind]))
    const inner = children(kid(oe, 'OEChildren'), ctx)
    if (!kind) html += content(oe, ctx) + inner
    else if (kind === 'task') html += `<li data-type="taskItem" data-checked="${kid(oe, 'Tag').getAttribute('completed') === 'true'}">${content(oe, ctx) || '<p></p>'}${inner}</li>`
    else html += `<li>${content(oe, ctx) || '<p></p>'}${inner}</li>`
  }
  close()
  return html
}

// Seite → Titel, Kästen (HTML mit Platzhaltern nximg:N) und Bilddaten
export function convertPage(source) {
  const page = parseXml(source).documentElement
  const defs = kids(page, 'QuickStyleDef').map((s) => ({ index: s.getAttribute('index'), name: s.getAttribute('name'), font: s.getAttribute('font'), size: Number(s.getAttribute('fontSize')) || 11 }))
  const ctx = {
    styles: new Map(defs.map((d) => [d.index, d])),
    base: defs.find((d) => d.name === 'p') ?? { name: 'p', font: 'Calibri', size: 11 }, // Standard-Absatz der Seite
    files: [],
    ink: [],
    // Aufgaben-Kästchen: Symbol 3 oder ein Name wie "Aufgabe"/"To Do"
    todos: new Set(kids(page, 'TagDef').filter((t) => t.getAttribute('symbol') === '3' || /aufgabe|to ?do|erledig/i.test(t.getAttribute('name') ?? '')).map((t) => t.getAttribute('index'))),
    images: [],
  }
  const boxes = [...page.children]
    .filter((el) => ['Outline', 'Image', 'InkDrawing', 'InsertedFile', 'MediaFile'].includes(el.localName))
    .map((el) => ({
      x: px(kid(el, 'Position')?.getAttribute('x')),
      y: px(kid(el, 'Position')?.getAttribute('y')),
      // Kasten etwas breiter als in OneNote (Innenabstand), aber nie winzig
      w: Math.max(240, px(kid(el, 'Size')?.getAttribute('width')) + 24),
      html: el.localName === 'Outline' ? children(kid(el, 'OEChildren'), ctx) : block(el, ctx),
    }))
    .filter((b) => b.html)
  // Titelbereich von OneNote fällt weg: Kästen nach links oben rücken
  const minX = Math.min(...boxes.map((b) => b.x))
  const minY = Math.min(...boxes.map((b) => b.y))
  return { title: page.getAttribute('name') || 'Ohne Titel', images: ctx.images, files: ctx.files, ink: ctx.ink, boxes: boxes.map((b) => ({ ...b, x: b.x - minX, y: b.y - minY + 20 })) }
}

// FNV-1a: erkennt, ob eine Seite seit dem letzten Abgleich in Nexora geändert wurde
export function hash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16)
}

// Platzhalter auflösen: Bilder speichern, Dateien als Anhänge übernehmen, Freihand als SVG-Bild.
// api: saveImage(bytes, ext), importFile(path, name) → [rel, size], ink([base64]) → Striche je Stück
async function pageBody(source, api) {
  const { boxes, images, files, ink } = convertPage(source)
  const srcs = await Promise.all(images.map((img) => api.saveImage(Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0)), img.ext)))
  const kept = await Promise.all(files.map((f) => (f.path ? api.importFile(f.path, f.name).catch(() => null) : null)))
  // ink: je Platzhalter eine Liste von Stücken; die Striche kommen flach in derselben Reihenfolge zurück
  const strokes = ink.length ? await api.ink(ink.flat()).catch(() => ink.flat().map(() => null)) : []
  let at = 0
  const drawn = await Promise.all(
    ink.map((group) => {
      const svg = inkSvg(strokes.slice(at, (at += group.length)).flatMap((x) => x ?? []))
      return svg ? api.saveImage(new TextEncoder().encode(svg.svg), 'svg').then((src) => ({ src, width: svg.width })) : null
    }),
  )
  const html = (b) =>
    b.html
      .replace(/nximg:(\d+)/g, (_, i) => srcs[i])
      .replace(/<img src="nxink:(\d+)"[^>]*>/g, (_, i) => (drawn[i] ? `<img src="${drawn[i].src}" width="${drawn[i].width}" alt="Freihand">` : note('Freihand aus OneNote nicht lesbar')))
      .replace(/<div data-attachment="nxfile:(\d+)"[^>]*><\/div>/g, (_, i) =>
        kept[i] ? `<div data-attachment="${esc(kept[i][0])}" data-size="${kept[i][1]}" data-preview="0"></div>` : note(`Datei „${files[i].name}“ ist in OneNote nicht zwischengespeichert`),
      )
  return serializeBoxes(boxes.map((b) => ({ ...b, md: api.toMarkdown(html(b)) })))
}

// Abgleich OneNote → Nexora. Nie löschen: Seiten, die in OneNote fehlen, bleiben und werden nur gezählt.
// Geändert in OneNote und unverändert in Nexora: ersetzen (alte Fassung in den Verlauf).
// Geändert in beiden: OneNote-Fassung als eigene Seite daneben.
// api: create, update, loadBody, snapshot, saveImage(bytes, ext), importFile, ink, toMarkdown(html),
// progress({ text, done, total }), stopped() → true bricht ab, before() einmal vor dem ersten Umbau (Sicherung)
export async function syncNotebook(nb, all, api) {
  const step = (text, done, total) => {
    if (api.stopped?.()) throw new Error('Abgleich abgebrochen')
    api.progress({ text, done, total })
  }
  step('OneNote wird gelesen …', 0, 0)
  const book = parseNotebook(await invoke('onenote', { op: 'notebook', id: link(nb).id }))
  const known = new Map(all.filter((n) => !n.deleted_at && link(n)?.id).map((n) => [link(n).id, n]))
  const report = { neu: 0, geaendert: 0, konflikte: 0, gesperrt: 0, fehlt: 0 }
  const pages = book.sections.flatMap((s) => (s.locked ? [] : s.pages))

  // Änderungen am Inhalt erkennen: OneNote setzt den Zeitstempel der Seite nicht bei jeder Änderung.
  // Erst alle Seiten ohne Bilddaten (schnell), dann nur neue, geänderte und mit älterer Umwandlung übernommene
  const versions = await fetchPages('pageinfo', pages, 40, (i) => step('Seiten werden geprüft', i, pages.length))
  for (const p of pages) p.version = versions.get(p.id) ? hash(versions.get(p.id)) : null
  const stale = pages.filter((p) => p.version && (link(known.get(p.id))?.version !== p.version || (link(known.get(p.id))?.conv ?? 1) < CONVERT))

  // Umbau (Abschnittsgruppen als Ordner) oder viele Seiten neu: vorher sichern
  // nur wenn schon Abschnitte da sind (beim ersten Verbinden gibt es nichts umzubauen)
  const regroup = book.sections.some((s) => known.has(s.id)) && (book.groups.some((g) => !known.has(g.id)) || book.sections.some((s) => known.has(s.id) && known.get(s.id).title !== s.name))
  if (regroup || stale.some((p) => known.has(p.id) && (link(known.get(p.id)).conv ?? 1) < CONVERT)) await api.before?.()

  const day = new Date().toLocaleDateString('de-DE')
  // Abschnittsgruppen werden Abschnitte, die Abschnitte enthalten; früher übernommene "Gruppe / Abschnitt" rücken so ein
  const holder = new Map()
  const parentOf = (group) => (group ? holder.get(group) : nb.id)
  for (const g of book.groups) {
    let node = known.get(g.id)
    const parent = parentOf(g.group)
    if (!node) node = await api.create('section', parent, g.name, { config: { onenote: { id: g.id } } })
    else if (node.title !== g.name || node.parent_id !== parent) await api.update(node.id, { title: g.name, parent_id: parent })
    holder.set(g.id, node.id)
  }
  // Seiten in Paketen holen und gleich übernehmen, damit der Fortschritt stimmt und Abbrechen greift
  let done = 0
  for (const s of book.sections) {
    let sec = known.get(s.id)
    const home = parentOf(s.group)
    const conf = { onenote: { id: s.id, ...(s.locked ? { locked: true } : {}) } }
    if (!sec) {
      sec = await api.create('section', home, s.name, { config: conf })
      if (s.color) await api.update(sec.id, { color: s.color })
    }    else if (sec.title !== s.name || sec.parent_id !== home || (sec.color ?? null) !== s.color || !!link(sec).locked !== s.locked)
      await api.update(sec.id, { title: s.name, parent_id: home, color: s.color, config: { ...sec.config, ...conf } })
    if (s.locked) {
      report.gesperrt++
      continue
    }
    const sources = await fetchPages('pages', s.pages.filter((p) => stale.includes(p)), 10, () => {})
    const levels = [] // letzte Seite je Ebene, für Unterseiten
    for (const p of s.pages) {
      const parent = (p.level > 1 && levels[p.level - 2]) || sec.id
      let node = known.get(p.id)
      const source = sources.get(p.id)
      if (!node && !source) continue // gerade erst in OneNote gelöscht
      if (source) {
        step('Seiten werden übernommen', ++done, stale.length)
        const body = await pageBody(source, api)
        // weitere Einstellungen der Seite (z. B. Lesemodus) bleiben
        const fresh = { ...node?.config, onenote: { id: p.id, version: p.version, hash: hash(body), conv: CONVERT } }
        if (!node) {
          node = await api.create('page', parent, p.name, { config: fresh })
          await api.update(node.id, { body, locked: 1 })
          report.neu++
        } else if (hash(await api.loadBody(node.id)) === link(node).hash) {
          await api.snapshot(node.id)
          await api.update(node.id, { title: p.name, body, parent_id: parent, config: fresh })
          report.geaendert++
        } else {
          const copy = await api.create('page', parent, `${p.name} (OneNote-Fassung vom ${day})`, { config: { onenote: { copyOf: p.id } } })
          await api.update(copy.id, { body, locked: 1 })
          await api.update(node.id, { config: { ...node.config, onenote: { ...link(node), version: p.version, conv: CONVERT } } })
          report.konflikte++
        }
      } else if (node.parent_id !== parent) {
        await api.update(node.id, { parent_id: parent }) // in OneNote verschoben
      }
      levels[p.level - 1] = node.id
      levels.length = p.level
    }
  }
  const seen = new Set(pages.map((p) => p.id))
  report.fehlt = [...known.values()].filter((n) => n.kind === 'page' && !seen.has(link(n).id) && isBelow(all, n, nb.id)).length
  await api.update(nb.id, { config: { ...nb.config, onenote: { ...link(nb), synced: new Date().toISOString() } } })
  return report
}

// Seiteninhalte in Paketen; eine fehlende Seite kommt leer zurück und fehlt dann in der Map
async function fetchPages(op, pages, size, progress) {
  const out = new Map()
  for (let i = 0; i < pages.length; i += size) {
    progress(i + 1)
    const batch = pages.slice(i, i + size)
    const xmls = (await invoke('onenote', { op, id: batch.map((p) => p.id).join(';') })).split('\0')
    batch.forEach((p, j) => xmls[j] && out.set(p.id, xmls[j]))
  }
  return out
}

function isBelow(all, node, ancestorId) {
  const byId = new Map(all.map((n) => [n.id, n]))
  for (let p = byId.get(node.parent_id); p; p = byId.get(p.parent_id)) if (p.id === ancestorId) return true
  return false
}

export function describeReport(r) {
  const parts = [`${r.neu} neu`, `${r.geaendert} geändert`]
  if (r.konflikte) parts.push(`${r.konflikte} in beiden geändert (OneNote-Fassung daneben gelegt)`)
  if (r.gesperrt) parts.push(`${r.gesperrt} gesperrte Abschnitte übersprungen`)
  if (r.fehlt) parts.push(`${r.fehlt} Seiten gibt es in OneNote nicht mehr (bleiben in Nexora)`)
  return `OneNote abgeglichen: ${parts.join(', ')}.`
}
