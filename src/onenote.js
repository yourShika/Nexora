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
      return note('Freihand aus OneNote nicht übernommen')
    case 'InsertedFile':
      return note(`Datei „${el.getAttribute('preferredName') ?? ''}“ aus OneNote nicht übernommen`)
    case 'MediaFile':
      return note('Audio oder Video aus OneNote nicht übernommen')
    default:
      return '' // List, Tag, OEChildren, Meta … behandeln die Aufrufer
  }
}

const cellText = (cell) => [...cell.getElementsByTagNameNS(NS, 'T')].map((t) => t.textContent).join(' ')

// Inhalt eines Absatzes (OE): Text mit Absatzformat, Tabellen, Bilder
function content(oe, ctx) {
  const style = ctx.styles.get(oe.getAttribute('quickStyleIndex'))
  return [...oe.children]
    .map((c) => {
      if (c.localName !== 'T') return block(c, ctx)
      if (/^h[1-6]$/.test(style)) return `<${style}>${c.textContent}</${style}>`
      if (style === 'code') return `<pre><code>${esc(plain(c.textContent))}</code></pre>`
      return `<p>${c.textContent}</p>`
    })
    .join('')
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
  const ctx = {
    styles: new Map(kids(page, 'QuickStyleDef').map((s) => [s.getAttribute('index'), s.getAttribute('name')])),
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
  return { title: page.getAttribute('name') || 'Ohne Titel', images: ctx.images, boxes: boxes.map((b) => ({ ...b, x: b.x - minX, y: b.y - minY + 20 })) }
}

// FNV-1a: erkennt, ob eine Seite seit dem letzten Abgleich in Nexora geändert wurde
export function hash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16)
}

async function pageBody(source, api) {
  const { boxes, images } = convertPage(source)
  const srcs = await Promise.all(images.map((img) => api.saveImage(Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0)), img.ext)))
  const md = boxes.map((b) => ({ ...b, md: api.toMarkdown(b.html.replace(/nximg:(\d+)/g, (_, i) => srcs[i])) }))
  return serializeBoxes(md)
}

// Abgleich OneNote → Nexora. Nie löschen: Seiten, die in OneNote fehlen, bleiben und werden nur gezählt.
// Geändert in OneNote und unverändert in Nexora: ersetzen (alte Fassung in den Verlauf).
// Geändert in beiden: OneNote-Fassung als eigene Seite daneben.
// api: create, update, loadBody, snapshot, saveImage(bytes, ext), toMarkdown(html), progress(text)
export async function syncNotebook(nb, all, api) {
  const book = parseNotebook(await invoke('onenote', { op: 'notebook', id: link(nb).id }))
  const known = new Map(all.filter((n) => !n.deleted_at && link(n)?.id).map((n) => [link(n).id, n]))
  const report = { neu: 0, geaendert: 0, konflikte: 0, gesperrt: 0, fehlt: 0 }
  const pages = book.sections.flatMap((s) => (s.locked ? [] : s.pages))

  // Änderungen am Inhalt erkennen: OneNote setzt den Zeitstempel der Seite nicht bei jeder Änderung.
  // Erst alle Seiten ohne Bilddaten (schnell), dann nur neue und geänderte mit Bildern
  const versions = await fetchPages('pageinfo', pages, 40, (i) => api.progress(`OneNote: ${i} von ${pages.length} Seiten geprüft …`))
  for (const p of pages) p.version = versions.get(p.id) ? hash(versions.get(p.id)) : null
  const stale = pages.filter((p) => p.version && link(known.get(p.id))?.version !== p.version)
  const sources = await fetchPages('pages', stale, 10, (i) => api.progress(`OneNote: Seite ${i} von ${stale.length} wird übernommen …`))

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
  for (const s of book.sections) {
    let sec = known.get(s.id)
    const home = parentOf(s.group)
    if (!sec) sec = await api.create('section', home, s.name, { config: { onenote: { id: s.id } } })
    else if (sec.title !== s.name || sec.parent_id !== home) await api.update(sec.id, { title: s.name, parent_id: home })
    if (s.locked) {
      report.gesperrt++
      continue
    }
    const levels = [] // letzte Seite je Ebene, für Unterseiten
    for (const p of s.pages) {
      const parent = (p.level > 1 && levels[p.level - 2]) || sec.id
      let node = known.get(p.id)
      const source = sources.get(p.id)
      if (!node && !source) continue // gerade erst in OneNote gelöscht
      if (source) {
        const body = await pageBody(source, api)
        const fresh = { onenote: { id: p.id, version: p.version, hash: hash(body) } }
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
          await api.update(node.id, { config: { onenote: { ...link(node), version: p.version } } })
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
  await api.update(nb.id, { config: { onenote: { ...link(nb), synced: new Date().toISOString() } } })
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
