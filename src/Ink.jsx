import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Circle, CopySimple, CursorText, Eraser, Highlighter, Lasso, LineSegment, PenNib, Rectangle, Trash } from '@phosphor-icons/react'
import { bounds, hasPressure, hits, inkPath, inside, lassoPick, moveStroke, pressurePath, scaleStroke } from './ink.js'

// Zeichnen auf freien Seiten und im Zeichnungs-Block: Werkzeuge, Stiftdruck, Lasso, Tasten.
// Die Fläche (FreeCanvas, Drawing) hält die Striche und speichert; hier liegt nur das Bedienen.

export const TOOLS = [
  { id: 'write', label: 'Schreiben (Esc)', icon: CursorText },
  { id: 'pen', label: 'Stift', icon: PenNib },
  { id: 'marker', label: 'Textmarker', icon: Highlighter },
  { id: 'line', label: 'Linie', icon: LineSegment },
  { id: 'arrow', label: 'Pfeil', icon: ArrowUpRight },
  { id: 'rect', label: 'Rechteck', icon: Rectangle },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'lasso', label: 'Lasso: umfahren wählt aus (Entf, Strg+C/V/D)', icon: Lasso },
  { id: 'eraser', label: 'Radierer (ganze Striche)', icon: Eraser },
]
const FREEHAND = new Set(['pen', 'marker'])
const COLORS = [['text', 'Textfarbe'], ['#e5484d', 'Rot'], ['#f5c518', 'Gelb'], ['#30a46c', 'Grün'], ['#3e8bd6', 'Blau'], ['#8e4ec6', 'Lila']]
const SIZES = { pen: [2, 4, 8], marker: [12, 20, 28] } // Formen nehmen die Stiftstärken
const SIZE_NAMES = ['Dünn', 'Mittel', 'Dick']
const paint = (c) => (c === 'text' ? 'var(--text)' : c)
const sizeKind = (s) => (s.t === 'marker' ? 'marker' : 'pen')
const CLIP = 'nexora-ink' // Ablage für Strg+C/V, gilt für alle Seiten und Fenster
const OFFSET = 24 // Eingefügtes und Dupliziertes rückt etwas ab

export function Stroke({ s }) {
  if (hasPressure(s)) return <path d={pressurePath(s)} fill={paint(s.c)} />
  return <path d={inkPath(s)} fill="none" stroke={paint(s.c)} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" opacity={s.t === 'marker' ? 0.4 : 1} />
}

// Nur die zuletzt benutzte Fläche reagiert auf Tasten (mehrere Zeichnungen auf einer Seite)
let active = null

// Gemeinsames Ziehen: Listener am Fenster, damit schnelle Bewegungen nicht abreißen
function follow(onMove, onUp) {
  const up = () => {
    removeEventListener('pointermove', onMove)
    removeEventListener('pointerup', up)
    onUp()
  }
  addEventListener('pointermove', onMove)
  addEventListener('pointerup', up)
}

/**
 * ink, setInk(next): Striche der Fläche. local(e): Punkt in Flächen-Koordinaten, scale(): Zoom.
 * boxes (nur freie Seite): { get(), set(next, store), rects() } für Lasso über Textkästen.
 * ownUndo: eigenes Strg+Z (freie Seite); der Block nutzt den Verlauf des Editors.
 */
export function useInk({ ink, setInk, local, scale = () => 1, editable, boxes, ownUndo, initialTool = 'write', container }) {
  const me = useRef({}).current
  const [tool, setToolState] = useState(initialTool)
  const [colors, setColors] = useState({ pen: 'text', marker: '#f5c518' })
  const [sizes, setSizes] = useState({ pen: 1, marker: 1 })
  const [draft, setDraft] = useState(null)
  const [lasso, setLasso] = useState(null)
  const [sel, setSel] = useState(null) // { strokes: [Index], boxes: [id] }
  const [preview, setPreview] = useState(null) // Striche während des Verschiebens
  const inkRef = useRef(ink)
  inkRef.current = ink
  const undo = useRef([])
  const drawing = editable && tool !== 'write'
  const kind = tool === 'marker' ? 'marker' : 'pen'
  const shown = preview ?? ink

  const setTool = (t) => {
    setSel(null)
    setToolState(t)
  }
  const snapshot = () => ownUndo && undo.current.push({ ink: inkRef.current, boxes: boxes?.get() })
  function commit(next) {
    snapshot()
    inkRef.current = next
    setInk(next)
  }

  const selRects = () => (sel && boxes ? boxes.rects().filter((r) => sel.boxes.includes(r.id)) : [])
  const frame = sel ? bounds(sel.strokes.map((i) => shown[i]).filter(Boolean), selRects()) : null

  // Auswahl verschieben (mode 'move') oder um die linke obere Ecke vergrößern ('scale')
  function dragSelection(start, mode) {
    const base = inkRef.current
    const baseBoxes = boxes?.get()
    const [x0, y0, x1] = frame
    const width = Math.max(1, x1 - x0)
    let moved = null
    const transform = (pt) => {
      const dx = pt[0] - start[0]
      const dy = pt[1] - start[1]
      const k = Math.max(0.1, (width + dx) / width)
      const strokes = base.map((s, i) => (!sel.strokes.includes(i) ? s : mode === 'move' ? moveStroke(s, dx, dy) : scaleStroke(s, x0, y0, k)))
      const nextBoxes = baseBoxes?.map((b) =>
        !sel.boxes.includes(b.id) ? b : mode === 'move' ? { ...b, x: Math.max(0, b.x + dx), y: Math.max(0, b.y + dy) } : { ...b, x: x0 + (b.x - x0) * k, y: y0 + (b.y - y0) * k, w: Math.max(120, b.w * k) },
      )
      return { strokes, nextBoxes }
    }
    follow(
      (ev) => {
        moved = transform(local(ev))
        setPreview(moved.strokes)
        if (moved.nextBoxes) boxes.set(moved.nextBoxes, false)
      },
      () => {
        setPreview(null)
        if (!moved) return
        if (ownUndo) undo.current.push({ ink: base, boxes: baseBoxes })
        inkRef.current = moved.strokes
        setInk(moved.strokes)
      },
    )
  }

  function down(e) {
    if (!drawing || e.button !== 0) return
    active = me
    e.preventDefault()
    const start = local(e)
    const r = 8 / scale()
    if (tool === 'lasso') {
      if (frame && Math.hypot(start[0] - frame[2], start[1] - frame[3]) <= r) return dragSelection(start, 'scale')
      if (frame && start[0] >= frame[0] && start[0] <= frame[2] && start[1] >= frame[1] && start[1] <= frame[3]) return dragSelection(start, 'move')
      const poly = [start]
      setSel(null)
      setLasso(poly)
      follow(
        (ev) => {
          poly.push(local(ev))
          setLasso([...poly])
        },
        () => {
          setLasso(null)
          if (poly.length < 3) return
          const strokes = lassoPick(inkRef.current, poly)
          const ids = boxes ? boxes.rects().filter((b) => inside([b.x + b.w / 2, b.y + b.h / 2], poly)).map((b) => b.id) : []
          setSel(strokes.length || ids.length ? { strokes, boxes: ids } : null)
        },
      )
      return
    }
    if (tool === 'eraser') {
      const before = inkRef.current
      const er = 6 / scale()
      let last = start
      // Zwischenpunkte, damit schnelle Bewegungen keine Striche überspringen
      const erase = (pt) => {
        const steps = Math.max(1, Math.ceil(Math.hypot(pt[0] - last[0], pt[1] - last[1]) / er))
        let rest = inkRef.current
        for (let i = 1; i <= steps; i++) {
          const x = last[0] + ((pt[0] - last[0]) * i) / steps
          const y = last[1] + ((pt[1] - last[1]) * i) / steps
          rest = rest.filter((s) => !hits(s, x, y, er))
        }
        last = pt
        if (rest.length !== inkRef.current.length) (inkRef.current = rest), setPreview(rest)
      }
      erase(start)
      follow(
        (ev) => erase(local(ev)),
        () => {
          setPreview(null)
          if (inkRef.current === before) return
          const rest = inkRef.current
          inkRef.current = before
          commit(rest)
        },
      )
      return
    }
    // Stiftdruck nur vom echten Stift; die Maus meldet immer 0,5
    const withPressure = tool === 'pen' && e.pointerType === 'pen'
    const point = (ev) => (withPressure ? [...local(ev), Math.max(1, Math.round(ev.pressure * 100))] : local(ev))
    const stroke = { t: tool, c: colors[kind], w: SIZES[kind][sizes[kind]], p: [point(e)] }
    setDraft(stroke)
    follow(
      (ev) => {
        const pt = point(ev)
        if (!FREEHAND.has(tool)) stroke.p = [stroke.p[0], pt]
        else if (Math.hypot(pt[0] - stroke.p.at(-1)[0], pt[1] - stroke.p.at(-1)[1]) >= 2 / scale()) stroke.p = [...stroke.p, pt]
        setDraft({ ...stroke })
      },
      () => {
        setDraft(null)
        // Form ohne Ausdehnung (nur geklickt) nicht speichern
        if (FREEHAND.has(tool) || stroke.p.length > 1) commit([...inkRef.current, stroke])
      },
    )
  }

  // Auswahl ändern: Striche über fn, Kästen über fnBox; null aus fn/fnBox entfernt
  function editSelection(fn, fnBox = (b) => b) {
    const keep = (s, i) => (sel.strokes.includes(i) ? fn(s) : s)
    snapshot()
    if (boxes && sel.boxes.length) boxes.set(boxes.get().map((b) => (sel.boxes.includes(b.id) ? fnBox(b) : b)).filter(Boolean), false)
    const next = inkRef.current.map(keep).filter(Boolean)
    inkRef.current = next
    setInk(next)
  }
  const removeSelection = () => (editSelection(() => null, () => null), setSel(null))
  const recolor = (c) => editSelection((s) => ({ ...s, c }))
  const resize = (i) => editSelection((s) => ({ ...s, w: SIZES[sizeKind(s)][i] }))

  // Neue Striche/Kästen anhängen und gleich auswählen
  function add(strokes, newBoxes = []) {
    snapshot()
    const start = inkRef.current.length
    const next = [...inkRef.current, ...strokes]
    const added = newBoxes.map((b) => ({ ...b, id: crypto.randomUUID() }))
    if (boxes && added.length) boxes.set([...boxes.get(), ...added], false)
    inkRef.current = next
    setInk(next)
    setSel({ strokes: strokes.map((_, i) => start + i), boxes: boxes ? added.map((b) => b.id) : [] })
  }
  const picked = () => ({
    strokes: sel.strokes.map((i) => inkRef.current[i]).filter(Boolean),
    boxes: boxes ? boxes.get().filter((b) => sel.boxes.includes(b.id)).map(({ id, ...b }) => b) : [],
  })
  // Aus derselben Zeichnung etwas versetzt; aus einer anderen oben links, sonst läge es womöglich außerhalb des Blocks
  function shifted({ strokes, boxes: bs, from }) {
    const b = from === me.id ? null : bounds(strokes, bs.map((x) => ({ ...x, h: 0 })))
    const dx = b ? OFFSET - b[0] : OFFSET
    const dy = b ? OFFSET - b[1] : OFFSET
    return [strokes.map((s) => moveStroke(s, dx, dy)), bs.map((x) => ({ ...x, x: x.x + dx, y: x.y + dy }))]
  }
  me.id ??= crypto.randomUUID()
  const duplicate = () => add(...shifted({ ...picked(), from: me.id }))

  // Tasten: nur für die zuletzt benutzte Fläche und nicht, während in einem Textkasten geschrieben wird
  useEffect(() => {
    if (!drawing) return
    const key = (e) => {
      if (active !== me) return
      const typing = document.activeElement?.closest('.free-box')
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const take = () => (e.preventDefault(), e.stopPropagation())
      // Esc hebt die Auswahl auf bzw. geht zum Schreiben zurück; nur dann nicht weiter an den Fokus-Modus
      if (e.key === 'Escape') {
        if (sel) take(), setSel(null)
        else if (initialTool === 'write') take(), setTool('write')
        return
      }
      if (typing) return
      if (sel && (e.key === 'Delete' || e.key === 'Backspace')) return take(), removeSelection()
      if (sel && ctrl && (k === 'c' || k === 'x')) {
        take()
        try {
          localStorage.setItem(CLIP, JSON.stringify({ ...picked(), from: me.id }))
        } catch {}
        if (k === 'x') removeSelection()
        return
      }
      if (sel && ctrl && k === 'd') return take(), duplicate()
      if (ctrl && k === 'v' && tool === 'lasso') {
        let clip = null
        try {
          clip = JSON.parse(localStorage.getItem(CLIP) || 'null')
        } catch {}
        if (!clip?.strokes) return
        take()
        return add(...shifted(clip))
      }
      if (ownUndo && ctrl && k === 'z' && undo.current.length) {
        take()
        const last = undo.current.pop()
        setSel(null)
        if (boxes && last.boxes) boxes.set(last.boxes, false)
        inkRef.current = last.ink
        setInk(last.ink)
      }
    }
    // Klick außerhalb: andere Fläche oder Text, Auswahl fällt weg
    const away = (e) => {
      if (container.current?.contains(e.target)) return
      if (active === me) active = null
      setSel(null)
    }
    addEventListener('keydown', key, true)
    addEventListener('pointerdown', away, true)
    return () => {
      removeEventListener('keydown', key, true)
      removeEventListener('pointerdown', away, true)
    }
  })

  return { tool, setTool, drawing, kind, colors, setColors, sizes, setSizes, draft, lasso, sel, frame, shown, down, recolor, resize, duplicate, removeSelection, scale }
}

// Lasso-Linie, Auswahlrahmen mit Anfasser und Vorschau des aktuellen Strichs; liegt in der Zeichen-SVG
export function InkOverlay({ k }) {
  const r = 5 / k.scale()
  return (
    <>
      {k.draft && <Stroke s={k.draft} />}
      {k.lasso && <polyline points={k.lasso.map((p) => p.join(',')).join(' ')} fill="var(--accent-soft)" fillOpacity="0.4" stroke="var(--accent)" strokeWidth={1.5 / k.scale()} strokeDasharray="4 4" />}
      {k.frame && (
        <>
          <rect x={k.frame[0] - 4} y={k.frame[1] - 4} width={k.frame[2] - k.frame[0] + 8} height={k.frame[3] - k.frame[1] + 8} fill="none" stroke="var(--accent)" strokeWidth={1.5 / k.scale()} strokeDasharray="5 4" className="cursor-move" />
          <rect x={k.frame[2] - r} y={k.frame[3] - r} width={2 * r} height={2 * r} fill="var(--raised)" stroke="var(--accent)" strokeWidth={1.5 / k.scale()} className="cursor-nwse-resize" aria-label="Größe ändern" />
        </>
      )}
    </>
  )
}

const button = (on) => `grid size-7 place-items-center rounded-md ${on ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-text'}`

function Swatches({ value, onPick, sizeValue, onSize }) {
  return (
    <>
      <span className="mx-1 h-5 w-px bg-line" />
      {COLORS.map(([c, name]) => (
        <button key={c} aria-label={name} title={name} aria-pressed={value === c} onClick={() => onPick(c)} className={button(false)}>
          <span style={{ background: paint(c) }} className={`size-4 rounded-full ${value === c ? 'ring-2 ring-accent ring-offset-2 ring-offset-raised' : ''}`} />
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-line" />
      {SIZE_NAMES.map((name, i) => (
        <button key={name} aria-label={name} title={name} aria-pressed={sizeValue === i} onClick={() => onSize(i)} className={button(sizeValue === i)}>
          <span className="rounded-full bg-current" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
        </button>
      ))}
    </>
  )
}

// Werkzeugleiste; bei einer Lasso-Auswahl stattdessen Farbe, Stärke, Duplizieren, Löschen
export function InkToolbar({ k, tools = TOOLS, children, className = '' }) {
  return (
    <div role="toolbar" aria-label="Zeichnen" className={`flex w-fit flex-wrap items-center gap-0.5 rounded-lg border border-line bg-raised/95 p-1 backdrop-blur ${className}`}>
      {tools.map((t) => (
        <button key={t.id} aria-label={t.label} title={t.label} aria-pressed={k.tool === t.id} onClick={() => (t.id !== 'write' && document.activeElement?.blur(), k.setTool(t.id))} className={button(k.tool === t.id)}>
          <t.icon size={17} weight={k.tool === t.id ? 'fill' : 'regular'} />
        </button>
      ))}
      {children}
      {k.sel ? (
        <>
          <Swatches value={null} onPick={k.recolor} sizeValue={null} onSize={k.resize} />
          <span className="mx-1 h-5 w-px bg-line" />
          <button aria-label="Duplizieren (Strg+D)" title="Duplizieren (Strg+D)" onClick={k.duplicate} className={button(false)}><CopySimple size={17} /></button>
          <button aria-label="Auswahl löschen (Entf)" title="Auswahl löschen (Entf)" onClick={k.removeSelection} className={`${button(false)} hover:text-danger`}><Trash size={17} /></button>
        </>
      ) : (
        k.drawing && !['eraser', 'lasso'].includes(k.tool) && (
          <Swatches
            value={k.colors[k.kind]}
            onPick={(c) => k.setColors({ ...k.colors, [k.kind]: c })}
            sizeValue={k.sizes[k.kind]}
            onSize={(i) => k.setSizes({ ...k.sizes, [k.kind]: i })}
          />
        )
      )}
    </div>
  )
}

export function useStrokes(ink) {
  return useMemo(() => ink.map((s, i) => <Stroke key={i} s={s} />), [ink])
}
