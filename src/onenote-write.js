import { invoke } from '@tauri-apps/api/core'
import { isFree, parseBoxes, parseInk, serializeBoxes } from './free.js'
import { relativeSrc } from './images.js'
import { CONVERT, NS, boxState, esc, fetchPages, hash, kids, link, parseNotebook, parseXml } from './onenote.js'

// Nexora → OneNote, nur für Notizbücher mit config.onenote.write. Läuft beim Abgleich vor dem Einlesen.
// Geänderter Text ersetzt den Text im passenden OneNote-Container; Bilder, Freihand und Dateien aus OneNote bleiben
// (unverändert mitgeschickt, sonst löscht OneNote sie). Neue Seiten werden am Ende ihres Abschnitts angelegt.
// Nur, was OneNote ohne Absturz annimmt (Proben 2026-11-04): Fließtext, Listen, Tabellen als HTMLBlock, Überschriften
// und Code als Absätze mit Absatzformat, Aufgaben als Absätze mit Kästchen. Seiten verschieben (UpdateHierarchy) und
// Seitenebenen (pageLevel, Unterseiten) lassen OneNote abstürzen, darum nie: ein Absturz träfe das offene OneNote.

// Kästen von Seiten, die Nexora anlegt, liegen wie bei OneNote selbst ab (36 pt, 86 pt)
const ORIGIN = { x: 48, y: 95 }
const pt = (v) => Math.round(v * 75) / 100
const cdata = (s) => s.replaceAll(']]>', ']]&gt;')
const textOf = (n) => (n.content ?? []).map((c) => c.text ?? '').join('')

// Absatzformate, wie OneNote sie selbst anlegt
const STYLES = {
  p: ['Calibri', '11.0', 'automatic'],
  h1: ['Calibri Light', '20.0', '#1e4e79'],
  h2: ['Calibri Light', '16.0', '#2e75b5'],
  h3: ['Calibri Light', '14.0', '#1f3763'],
  h4: ['Calibri Light', '12.0', '#2f5496'],
  h5: ['Calibri', '11.0', '#2e75b5'],
  h6: ['Calibri', '11.0', '#2e75b5'],
  code: ['Consolas', '11.0', 'automatic'],
}

// Formate und Aufgaben-Kästchen der Seite: vorhandene nehmen, fehlende ans Ende der Liste. Jedes benutzte muss im
// geschickten XML stehen, auch ein vorhandenes, sonst lehnt OneNote die Seite ab (0x80042001)
function pageStyles(page) {
  const xml = (el) => new XMLSerializer().serializeToString(el)
  const quickDefs = kids(page, 'QuickStyleDef')
  const tags = kids(page, 'TagDef')
  const quick = new Map(quickDefs.map((d) => [d.getAttribute('name'), { index: d.getAttribute('index'), xml: xml(d) }]))
  const found = tags.find((t) => t.getAttribute('symbol') === '3' || /aufgabe|to ?do|erledig/i.test(t.getAttribute('name') ?? ''))
  let todo = found ? { index: found.getAttribute('index'), xml: xml(found) } : null
  let nextQuick = Math.max(-1, ...quickDefs.map((d) => Number(d.getAttribute('index')))) + 1
  const used = new Map()
  const s = {}
  s.style = (name) => {
    if (!quick.has(name)) {
      const [font, size, color] = STYLES[name]
      const index = String(nextQuick++)
      quick.set(name, { index, xml: `<one:QuickStyleDef index="${index}" name="${name}" fontColor="${color}" highlightColor="automatic" font="${font}" fontSize="${size}" spaceBefore="0.0" spaceAfter="0.0"/>` })
    }
    used.set(name, quick.get(name))
    return quick.get(name).index
  }
  s.todo = () => {
    if (!todo) {
      const index = String(Math.max(-1, ...tags.map((t) => Number(t.getAttribute('index')))) + 1)
      todo = { index, xml: `<one:TagDef index="${index}" type="0" symbol="3" name="Aufgabe"/>` }
    }
    s.tagUsed = true
    return todo.index
  }
  // TagDef vor QuickStyleDef, sonst lehnt OneNote die Seite ab
  s.defs = () => (s.tagUsed ? todo.xml : '') + [...used.values()].sort((a, b) => a.index - b.index).map((d) => d.xml).join('')
  return s
}

// OneNote-Objekte eines Containers, die Nexora nicht als Text ersetzt: Bilder, Freihand, Dateien, Audio/Video
const OBJECTS = ['Image', 'InkDrawing', 'InkWord', 'InkParagraph', 'InkLine', 'InsertedFile', 'MediaFile']
const keptOes = (outline) => kids(outline, 'OEChildren').flatMap((g) => kids(g, 'OE')).filter((oe) => [...oe.children].some((c) => OBJECTS.includes(c.localName)))
// unverändert zurück (mit CallbackID bleibt das Bild), nur Text und Unterpunkte darin ersetzt Nexora
function xmlOf(oe) {
  const copy = oe.cloneNode(true)
  for (const c of [...copy.children]) if (c.localName === 'T' || c.localName === 'OEChildren') c.remove()
  return new XMLSerializer().serializeToString(copy)
}

// HTML für HTMLBlock: nur, was OneNote aus HTML sicher übernimmt; Aufgaben in Listen als ☐/☑ vor dem Text
function sanitize(html, c) {
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
  const rename = (el, tag, style) => {
    const next = body.ownerDocument.createElement(tag)
    if (style) next.setAttribute('style', style)
    next.append(...el.childNodes)
    el.replaceWith(next)
  }
  for (const el of [...body.querySelectorAll('*')]) {
    const tag = el.localName
    if (tag === 'img') {
      const rel = relativeSrc(el.getAttribute('src'))
      // ein OneNote-Bild dieses Kastens bleibt als OneNote-Objekt (am Kastenende), statt doppelt zu kommen
      if (c.isKept(rel) || !(/^bilder\/[\w-]+\.(png|jpe?g|gif|webp|bmp)$/i.test(rel) || /^https?:/i.test(rel))) {
        el.remove()
        continue
      }
      if (rel.startsWith('bilder/')) el.setAttribute('src', c.fileUrl(rel))
      c.emitted.push(rel)
    } else if (tag === 'li' && el.dataset.type === 'taskItem') {
      el.querySelector('label')?.remove()
      const target = el.querySelector('p') ?? el
      target.prepend(el.dataset.checked === 'true' ? '☑ ' : '☐ ')
    } else if (tag === 'div' && el.dataset.attachment) {
      // Anhang in einer Liste: OneNote-Datei bleibt am Kastenende, sonst der Name als Text (eine neue Datei geht nur
      // als eigener Absatz nach OneNote)
      if (c.isKept(el.dataset.attachment)) el.remove()
      else {
        const p = body.ownerDocument.createElement('p')
        p.textContent = `📎 ${el.dataset.attachment.split('/').pop()}`
        el.replaceWith(p)
      }
    } else if ((tag === 'div' && (el.dataset.lop !== undefined || el.dataset.drawing)) || tag === 'input' || tag === 'label') el.remove()
  }
  for (const el of [...body.querySelectorAll('strong')]) rename(el, 'b')
  for (const el of [...body.querySelectorAll('em')]) rename(el, 'i')
  for (const el of [...body.querySelectorAll('code')]) if (el.parentElement?.localName !== 'pre') rename(el, 'span', 'font-family:Consolas')
  for (const el of [...body.querySelectorAll('mark')]) rename(el, 'span', 'background-color:yellow')
  const allowed = { a: ['href'], img: ['src', 'width', 'alt'], span: ['style'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] }
  for (const el of body.querySelectorAll('*'))
    for (const a of [...el.attributes]) if (!(allowed[el.localName] ?? []).includes(a.name)) el.removeAttribute(a.name)
  return cdata(body.innerHTML)
}

// Text im Absatz (T): OneNote nimmt dort b, i, u, s, a und span mit style; alles andere wird Text. Zeilenumbrüche
// kommen als \n zurück (ein <br> im T ist ungeprüft, darum macht der Aufrufer daraus Absätze oder Leerzeichen)
function inline(html) {
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
  const walk = (node) =>
    [...node.childNodes]
      .map((n) => {
        if (n.nodeType === 3) return esc(n.textContent)
        if (n.nodeType !== 1) return ''
        const inner = walk(n)
        const tag = n.localName
        if (['b', 'i', 'u', 's'].includes(tag)) return `<${tag}>${inner}</${tag}>`
        if (tag === 'a' && n.getAttribute('href')) return `<a href="${esc(n.getAttribute('href'))}">${inner}</a>`
        if (tag === 'span' && n.getAttribute('style')) return `<span style="${esc(n.getAttribute('style'))}">${inner}</span>`
        return tag === 'br' ? '\n' : inner
      })
      .join('')
  return cdata(walk(body))
}

const textOe = (t, style) => `<one:OE quickStyleIndex="${style}"><one:T><![CDATA[${t}]]></one:T></one:OE>`
const htmlBlock = (html) => `<one:HTMLBlock><one:Data><![CDATA[<html><body>${html}</body></html>]]></one:Data></one:HTMLBlock>`

// Blöcke (TipTap-JSON) → Inhalt eines Containers. Aufeinanderfolgende Listen, Tabellen, Bilder werden ein HTMLBlock
function blocks(nodes, c) {
  const out = []
  let run = []
  const flush = () => {
    const html = run.length ? c.html(run) : ''
    if (html.trim()) out.push(htmlBlock(html))
    run = []
  }
  for (const n of nodes) {
    const kept = n.type === 'image' ? c.keptXml(n.attrs?.src) : n.type === 'attachment' ? c.keptXml(n.attrs?.path) : null
    if (kept) {
      flush()
      out.push(kept)
      continue
    }
    switch (n.type) {
      case 'heading': {
        flush()
        const t = inline(c.html([{ type: 'paragraph', content: n.content }])).replaceAll('\n', ' ')
        if (t.trim()) out.push(textOe(t, c.styles.style(`h${Math.min(6, n.attrs?.level ?? 1)}`)))
        break
      }
      // Absätze als eigene OneNote-Absätze: ein HTMLBlock nach einer Aufgabe mit Unterpunkten landet in OneNote eine
      // Ebene zu tief
      case 'paragraph':
        flush()
        for (const line of inline(c.html([n])).split('\n')) if (line.trim()) out.push(textOe(line, c.styles.style('p')))
        break
      case 'codeBlock':
        flush()
        for (const line of textOf(n).split('\n')) out.push(textOe(cdata(esc(line)), c.styles.style('code')))
        break
      case 'taskList':
        flush()
        for (const item of n.content ?? []) {
          const [first, ...rest] = item.content ?? []
          const own = first?.type === 'paragraph'
          const inner = blocks(own ? rest : (item.content ?? []), c)
          const t = own ? inline(c.html([first])).replaceAll('\n', ' ') : ''
          out.push(`<one:OE><one:Tag index="${c.styles.todo()}" completed="${!!item.attrs?.checked}"/><one:T><![CDATA[${t}]]></one:T>${inner.length ? `<one:OEChildren>${inner.join('')}</one:OEChildren>` : ''}</one:OE>`)
        }
        break
      case 'attachment': {
        flush()
        // Anhänge heißen in Nexora "<uuid>/<Dateiname>" (unter <Daten>/anhaenge)
        const rel = n.attrs?.path ?? ''
        if (/^[\w-]+\/[^/\\]+$/.test(rel) && !rel.includes('..')) {
          out.push(`<one:OE><one:InsertedFile pathSource="${esc(c.path(`anhaenge/${rel}`))}" preferredName="${esc(rel.split('/').pop())}"/></one:OE>`)
          c.emitted.push(rel)
        }
        break
      }
      case 'drawing':
        break // Zeichnungen aus Nexora bleiben in Nexora
      default:
        run.push(n)
    }
  }
  flush()
  return out
}

// Inhalt eines Kastens; outline = der Container in OneNote (null bei neuen Kästen). refs: Bilder und Anhänge in der
// Reihenfolge, in der sie als OneNote-Objekte ankommen (settle ordnet sie danach den neuen Objekten zu)
function children(md, outline, styles, ctx) {
  const kept = new Map((outline ? keptOes(outline) : []).map((oe) => [oe.getAttribute('objectID'), oe]))
  const refs = new Map(Object.entries(ctx.keep ?? {}).filter(([, id]) => kept.has(id)))
  const used = new Set()
  const c = {
    ...ctx,
    styles,
    emitted: [],
    isKept: (src) => refs.has(src),
    keptXml(src) {
      const id = refs.get(src)
      if (!id || used.has(id)) return null
      used.add(id)
      c.emitted.push(src)
      return xmlOf(kept.get(id))
    },
    html: (nodes) => sanitize(ctx.toHtml(nodes), c),
  }
  const out = blocks(ctx.parse(md).content ?? [], c)
  // was aus OneNote kam und in Nexora fehlt, bleibt trotzdem (Text ersetzen, Rest behalten)
  for (const [id, oe] of kept) if (!used.has(id)) out.push(xmlOf(oe))
  return { parts: out, refs: c.emitted }
}

const outlineXml = (id, b, origin, inner) =>
  `<one:Outline${id ? ` objectID="${id}"` : ''}><one:Position x="${pt(b.x + origin.x)}" y="${pt(b.y + origin.y)}"/><one:OEChildren>${inner.join('')}</one:OEChildren></one:Outline>`

// Kästen einer Seite; eine fließende Seite (von Nexora angelegt) ist ein Kasten
const boxesOf = (body, l) => (isFree(body) ? parseBoxes(body) : body.trim() ? [{ x: 0, y: 20, w: 640, md: body, one: l?.outline }] : [])

// Änderungen an einer verbundenen Seite → XML für UpdatePageContent und zu entfernende Container
function planPage(node, body, source, ctx) {
  const l = link(node)
  const page = parseXml(source).documentElement
  const outlines = new Map(kids(page, 'Outline').map((o) => [o.getAttribute('objectID'), o]))
  const styles = pageStyles(page)
  const origin = l.origin ?? ORIGIN
  const boxes = boxesOf(body, l)
  const seen = new Set()
  const parts = []
  const fresh = []
  const written = new Map()
  let skipped = 0
  for (const b of boxes) {
    const id = b.one && !seen.has(b.one) ? b.one : null // kopierter Kasten mit derselben Kennung: neuer Container
    if (id) seen.add(id)
    const before = id && l.boxes?.[id]
    if (id && outlines.has(id)) {
      if (before && before[0] === hash(b.md) && before[1] === b.x && before[2] === b.y) continue
      const inner = children(b.md, outlines.get(id), styles, { ...ctx, keep: l.keep })
      written.set(id, inner.refs)
      parts.push(outlineXml(id, b, origin, inner.parts))
    } else if (id && before) {
      // Bild, Freihand oder Datei direkt auf der Seite (kein Textcontainer): bleibt in OneNote, wie es ist
      if (before[0] !== hash(b.md)) skipped++
    } else {
      const inner = children(b.md, null, styles, ctx)
      delete b.one
      if (!inner.parts.length) continue // nur Zeichnungen: bleiben in Nexora
      fresh.push(Object.assign(b, { refs: inner.refs }))
      parts.push(outlineXml(null, b, origin, inner.parts))
    }
  }
  // in Nexora gelöschte Kästen: Text weg, Bilder, Freihand und Dateien bleiben; bleibt nichts, geht der Container
  const remove = []
  for (const id of Object.keys(l.boxes ?? {})) {
    if (seen.has(id) || !outlines.has(id)) continue
    const rest = keptOes(outlines.get(id)).map(xmlOf)
    if (rest.length) parts.push(`<one:Outline objectID="${id}"><one:OEChildren>${rest.join('')}</one:OEChildren></one:Outline>`)
    else remove.push(id)
  }
  let title = ''
  if (node.title !== l.title) {
    const oe = kids(kids(page, 'Title')[0], 'OE')[0]
    title = `<one:Title><one:OE${oe ? ` objectID="${oe.getAttribute('objectID')}"` : ''}><one:T><![CDATA[${cdata(esc(node.title || 'Ohne Titel'))}]]></one:T></one:OE></one:Title>`
  }
  const xml = parts.length || title ? `<one:Page xmlns:one="${NS}" ID="${page.getAttribute('ID')}">${styles.defs()}${title}${parts.join('')}</one:Page>` : ''
  return { xml, remove, fresh, boxes, skipped, written, known: new Set(outlines.keys()) }
}

// neue Seite: Titel und alle Kästen
function planNew(node, body, ctx) {
  const styles = pageStyles(null)
  styles.style('p') // Standard-Absatz zuerst, wie OneNote selbst
  const boxes = boxesOf(body, null)
  const fresh = []
  const parts = []
  for (const b of boxes) {
    const inner = children(b.md, null, styles, ctx)
    if (!inner.parts.length) continue
    fresh.push(Object.assign(b, { refs: inner.refs }))
    parts.push(outlineXml(null, b, ORIGIN, inner.parts))
  }
  const title = `<one:Title><one:OE><one:T><![CDATA[${cdata(esc(node.title || 'Ohne Titel'))}]]></one:T></one:OE></one:Title>`
  const xml = `<one:Page xmlns:one="${NS}" ID="nexora:neu">${styles.defs()}${title}${parts.join('')}</one:Page>`
  return { xml, remove: [], fresh, boxes, skipped: 0, written: new Map(), known: new Set() }
}

// Nach dem Schreiben: neue Container den neuen Kästen zuordnen (nach Lage), Bilder und Anhänge ihren OneNote-Objekten
// (sonst kämen sie beim nächsten Schreiben doppelt), Stand merken
function settle(node, body, plan, after, base) {
  const page = parseXml(after).documentElement
  const origin = base.origin ?? ORIGIN
  const open = kids(page, 'Outline').filter((o) => !plan.known.has(o.getAttribute('objectID')))
  for (const b of plan.fresh) {
    const want = [pt(b.x + origin.x), pt(b.y + origin.y)]
    let best = null
    let dist = Infinity
    for (const o of open) {
      const pos = kids(o, 'Position')[0]
      const d = Math.abs(Number(pos?.getAttribute('x')) - want[0]) + Math.abs(Number(pos?.getAttribute('y')) - want[1])
      if (d < dist) [best, dist] = [o, d]
    }
    if (!best) continue
    b.one = best.getAttribute('objectID')
    plan.written.set(b.one, b.refs)
    open.splice(open.indexOf(best), 1)
  }
  const keep = { ...base.keep }
  for (const o of kids(page, 'Outline')) {
    const refs = plan.written.get(o.getAttribute('objectID'))
    if (!refs) continue
    const objects = [...o.getElementsByTagNameNS(NS, 'OE')].filter((oe) => [...oe.children].some((c) => OBJECTS.includes(c.localName)))
    objects.slice(0, refs.length).forEach((oe, i) => (keep[refs[i]] = oe.getAttribute('objectID')))
  }
  const flow = !isFree(body)
  const outline = flow ? (plan.boxes[0]?.one ?? base.outline) : undefined
  const next = flow ? body : plan.fresh.length ? serializeBoxes(plan.boxes, parseInk(body)) : body
  const onenote = { ...base, version: hash(after), hash: hash(next), boxes: boxState(next, outline), keep, title: node.title, ...(outline ? { outline } : {}) }
  return { body: next, config: { ...node.config, onenote } }
}

// api: read, write(page, xml, remove) → [id, xml], loadBody, update, parse(md) → TipTap-JSON,
// toHtml(nodes) → HTML, progress, stopped
export async function pushNotebook(nb, all, api) {
  const report = { geschrieben: 0, angelegt: 0, nichtGeschrieben: 0, fehler: [], touched: [], written: [] }
  const step = (text, done, total) => {
    if (api.stopped?.()) throw new Error('Abgleich abgebrochen')
    api.progress?.({ text, done, total })
  }
  step('Änderungen für OneNote werden gesucht …', 0, 0)
  const read = api.read ?? ((op, id) => invoke('onenote', { op, id }))
  const write = api.write ?? ((page, xml, remove) => invoke('onenote_write', { page, xml, delete: remove }))
  // Bilder und Anhänge: onenote_write setzt Kopien in Temp ein (onenote.rs, stage)
  const ctx = { parse: api.parse, toHtml: api.toHtml, fileUrl: (rel) => `nexora-url:${rel}`, path: (rel) => `nexora-path:${rel}` }
  const book = parseNotebook(await read('notebook', link(nb).id))
  const alive = all.filter((n) => !n.deleted_at)
  const byId = new Map(alive.map((n) => [n.id, n]))
  const below = (n) => {
    for (let p = byId.get(n.parent_id); p; p = byId.get(p.parent_id)) if (p.id === nb.id) return true
    return false
  }
  const mine = alive.filter(below)
  // Konflikt: solange die OneNote-Fassung daneben liegt, schreibt Nexora die Seite nicht
  const copies = new Set(mine.map((n) => link(n)?.copyOf).filter(Boolean))
  // `all` gleich mitführen, damit das Einlesen danach den neuen Stand sieht
  const save = async (node, patch) => {
    await api.update(node.id, patch)
    Object.assign(node, patch)
    if ('body' in patch) report.touched.push(node.id)
  }
  const attempt = async (node, fn) => {
    try {
      await fn()
    } catch (e) {
      if (api.stopped?.()) throw e
      report.fehler.push(`„${node.title || 'Ohne Titel'}“: ${e.message ?? e}`)
    }
  }

  // 1. geänderte Seiten
  const changed = []
  for (const n of mine.filter((n) => n.kind === 'page' && link(n)?.id && link(n).boxes && !copies.has(link(n).id))) {
    const body = await api.loadBody(n.id)
    if (hash(body) !== link(n).hash || n.title !== link(n).title) changed.push([n, body])
  }
  const infos = await fetchPages(read, 'pageinfo', changed.map(([n]) => ({ id: link(n).id })), 40, () => {})
  let done = 0
  for (const [n, body] of changed) {
    step('Änderungen werden nach OneNote geschrieben', ++done, changed.length)
    const source = infos.get(link(n).id)
    // in OneNote gelöscht oder dort auch geändert: das Einlesen danach legt die OneNote-Fassung daneben
    if (!source || hash(source) !== link(n).version) continue
    await attempt(n, async () => {
      const plan = planPage(n, body, source, ctx)
      report.nichtGeschrieben += plan.skipped
      const after = plan.xml || plan.remove.length ? (await write(link(n).id, plan.xml, plan.remove.join(';')))[1] : null
      // nichts für OneNote (z. B. nur eigene Striche): nur den Stand merken
      const next = after ? settle(n, body, plan, after, link(n)) : { body, config: { ...n.config, onenote: { ...link(n), hash: hash(body), boxes: boxState(body, link(n).outline), title: n.title } } }
      await save(n, next.body !== body ? next : { config: next.config })
      if (after) {
        report.geschrieben++
        report.written.push(n.id)
      }
    })
  }

  // 2. neue Seiten unter Abschnitten aus OneNote, in OneNote am Abschnittsende. Unterseiten werden dort normale Seiten
  // (loose), in Nexora bleiben sie, wo sie sind
  const open = new Set(book.sections.filter((s) => !s.locked).map((s) => s.id))
  const create = async (n, section, parentOne) => {
    const body = await api.loadBody(n.id)
    const plan = planNew(n, body, ctx)
    const [id, after] = await write(`new:${section}`, plan.xml, '')
    const next = settle(n, body, plan, after, { id, conv: CONVERT, keep: {}, origin: ORIGIN, ...(parentOne ? { loose: true } : {}) })
    await save(n, next.body !== body ? next : { config: next.config })
    report.angelegt++
    report.written.push(n.id)
    return id
  }
  const walk = async (parent, section, parentOne) => {
    for (const n of mine.filter((m) => m.parent_id === parent.id).sort((a, b) => a.sort - b.sort)) {
      if (n.kind !== 'page') {
        if (!link(n)?.id) report.nichtGeschrieben++ // Listen und in Nexora angelegte Abschnitte
        continue
      }
      if (link(n)?.copyOf) continue
      let one = link(n)?.id ?? null
      if (!one) await attempt(n, async () => (one = await create(n, section, parentOne)))
      if (one) await walk(n, section, one)
    }
  }
  for (const sec of mine.filter((n) => n.kind === 'section' && open.has(link(n)?.id))) await walk(sec, link(sec).id, null)
  return report
}
