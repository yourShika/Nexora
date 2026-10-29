import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Circle, CursorText, Eraser, Highlighter, LineSegment, MagnifyingGlassMinus, MagnifyingGlassPlus, PenNib, Rectangle, Trash } from '@phosphor-icons/react'
import Editor from './Editor.jsx'
import { parseBoxes, parseInk, serializeBoxes } from './free.js'
import { hits, inkExtent, inkPath } from './ink.js'

const TOP = 20 // Platz für die Ziehleiste über dem obersten Kasten
const NEW_WIDTH = 440 // Codeblock-Leiste passt ohne Umbruch
const TOOLS = [
  { id: 'write', label: 'Schreiben (Esc)', icon: CursorText },
  { id: 'pen', label: 'Stift', icon: PenNib },
  { id: 'marker', label: 'Textmarker', icon: Highlighter },
  { id: 'line', label: 'Linie', icon: LineSegment },
  { id: 'arrow', label: 'Pfeil', icon: ArrowUpRight },
  { id: 'rect', label: 'Rechteck', icon: Rectangle },
  { id: 'ellipse', label: 'Ellipse', icon: Circle },
  { id: 'eraser', label: 'Radierer (ganze Striche)', icon: Eraser },
]
const FREEHAND = new Set(['pen', 'marker'])
const COLORS = [['text', 'Textfarbe'], ['#e5484d', 'Rot'], ['#f5c518', 'Gelb'], ['#30a46c', 'Grün'], ['#3e8bd6', 'Blau'], ['#8e4ec6', 'Lila']]
const SIZES = { pen: [2, 4, 8], marker: [12, 20, 28] } // Formen nehmen die Stiftstärken
const SIZE_NAMES = ['Dünn', 'Mittel', 'Dick']
const clampZoom = (z) => Math.min(2, Math.max(0.5, z))
const paint = (c) => (c === 'text' ? 'var(--text)' : c)

function Stroke({ s }) {
  return <path d={inkPath(s)} fill="none" stroke={paint(s.c)} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" opacity={s.t === 'marker' ? 0.4 : 1} />
}

// Freie Seite wie OneNote: Klick auf leere Fläche legt einen Kasten an, jeder Kasten ist ein vollwertiger Editor.
// Alle Kästen liegen in derselben Grid-Zelle, so wächst die Fläche von selbst nach rechts und unten mit.
// Darüber liegt die Zeichenebene; im Modus "Schreiben" klickt man durch sie hindurch.
export default function FreeCanvas({ body, editable, onChange }) {
  const [boxes, setBoxes] = useState(() => parseBoxes(body).map((b) => ({ ...b, id: crypto.randomUUID() })))
  const [ink, setInk] = useState(() => parseInk(body))
  const [draft, setDraft] = useState(null)
  const [focus, setFocus] = useState(null)
  const [tool, setTool] = useState('write')
  const [colors, setColors] = useState({ pen: 'text', marker: '#f5c518' })
  const [sizes, setSizes] = useState({ pen: 1, marker: 1 })
  const [zoom, setZoom] = useState(1)
  const latest = useRef(boxes)
  const inkRef = useRef(ink)
  const undo = useRef([])
  const zoomRef = useRef(1)
  const pendingScroll = useRef(null)
  const canvas = useRef(null)
  const drawing = editable && tool !== 'write'
  const kind = tool === 'marker' ? 'marker' : 'pen'

  const save = () => onChange(serializeBoxes(latest.current, inkRef.current))
  function commit(next, store = true) {
    latest.current = next
    setBoxes(next)
    if (store) save()
  }
  const patch = (id, fields, store) => commit(latest.current.map((b) => (b.id === id ? { ...b, ...fields } : b)), store)
  const remove = (id) => commit(latest.current.filter((b) => b.id !== id))
  function setStrokes(next, before = inkRef.current) {
    undo.current.push(before)
    inkRef.current = next
    setInk(next)
    save()
  }

  // Punkt auf der Fläche in ungezoomten Pixeln
  function local(e) {
    const r = canvas.current.getBoundingClientRect()
    return [Math.round((e.clientX - r.left) / zoomRef.current), Math.round((e.clientY - r.top) / zoomRef.current)]
  }

  function create(e) {
    if (!editable || e.target !== e.currentTarget) return
    const [x, y] = local(e)
    const box = { id: crypto.randomUUID(), x: Math.max(0, x - 12), y: Math.max(TOP, y - 12), w: NEW_WIDTH, md: '' }
    setFocus(box.id)
    commit([...latest.current, box], false)
  }

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

  // Kasten verschieben oder Breite ändern
  function drag(e, box, mode) {
    if (!editable || e.button !== 0) return
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY }
    let moved = false
    follow(
      (ev) => {
        const dx = (ev.clientX - start.x) / zoomRef.current
        const dy = (ev.clientY - start.y) / zoomRef.current
        moved = true
        patch(box.id, mode === 'move' ? { x: Math.max(0, box.x + dx), y: Math.max(TOP, box.y + dy) } : { w: Math.max(160, box.w + dx) }, false)
      },
      () => moved && save(),
    )
  }

  function startInk(e) {
    if (!drawing || e.button !== 0) return
    e.preventDefault()
    const start = local(e)
    if (tool === 'eraser') {
      const before = inkRef.current
      const r = 6 / zoomRef.current
      let last = start
      // Zwischenpunkte, damit schnelle Bewegungen keine Striche überspringen
      const erase = (pt) => {
        const steps = Math.max(1, Math.ceil(Math.hypot(pt[0] - last[0], pt[1] - last[1]) / r))
        let rest = inkRef.current
        for (let i = 1; i <= steps; i++) {
          const x = last[0] + ((pt[0] - last[0]) * i) / steps
          const y = last[1] + ((pt[1] - last[1]) * i) / steps
          rest = rest.filter((s) => !hits(s, x, y, r))
        }
        last = pt
        if (rest.length !== inkRef.current.length) (inkRef.current = rest), setInk(rest)
      }
      erase(start)
      follow((ev) => erase(local(ev)), () => inkRef.current !== before && setStrokes(inkRef.current, before))
      return
    }
    const stroke = { t: tool, c: colors[kind], w: SIZES[kind][sizes[kind]], p: [start] }
    setDraft(stroke)
    follow(
      (ev) => {
        const pt = local(ev)
        if (!FREEHAND.has(tool)) stroke.p = [start, pt]
        else if (Math.hypot(pt[0] - stroke.p.at(-1)[0], pt[1] - stroke.p.at(-1)[1]) >= 2 / zoomRef.current) stroke.p = [...stroke.p, pt]
        setDraft({ ...stroke })
      },
      () => {
        setDraft(null)
        // Form ohne Ausdehnung (nur geklickt) nicht speichern
        if (FREEHAND.has(tool) || stroke.p.length > 1) setStrokes([...inkRef.current, stroke])
      },
    )
  }

  // Strg+Z nimmt den letzten Strich zurück (solange kein Kasten den Fokus hat), Esc zurück zum Schreiben
  useEffect(() => {
    if (!drawing) return
    const key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault() // Esc gilt dem Werkzeug, nicht dem Fokus-Modus
        setTool('write')
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'z' && !document.activeElement?.closest('.tiptap') && undo.current.length) {
        e.preventDefault()
        inkRef.current = undo.current.pop()
        setInk(inkRef.current)
        save()
      }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })

  // Zoomen um einen Punkt (Mauszeiger oder Mitte), der dabei stehen bleibt
  function zoomTo(next, cx, cy) {
    next = clampZoom(next)
    const old = zoomRef.current
    if (Math.abs(next - old) < 0.001) return
    const r = canvas.current.getBoundingClientRect()
    pendingScroll.current = [((cx - r.left) / old) * (next - old), ((cy - r.top) / old) * (next - old)]
    zoomRef.current = next
    setZoom(next)
  }
  function zoomCenter(next) {
    const s = canvas.current.closest('.overflow-auto').getBoundingClientRect()
    zoomTo(next, s.left + s.width / 2, s.top + s.height / 2)
  }
  useLayoutEffect(() => {
    if (!pendingScroll.current) return
    const scroller = canvas.current.closest('.overflow-auto')
    scroller.scrollLeft += pendingScroll.current[0]
    scroller.scrollTop += pendingScroll.current[1]
    pendingScroll.current = null
  }, [zoom])
  useEffect(() => {
    const el = canvas.current
    // nicht passiv, sonst lässt sich das Scrollen bei Strg+Mausrad nicht verhindern
    const wheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  // Leere Kästen verschwinden, sobald man woanders hinklickt (wie in OneNote)
  function leave(e, id) {
    const el = e.currentTarget
    setTimeout(() => {
      if (!document.hasFocus() || el.contains(document.activeElement)) return
      if (!latest.current.find((b) => b.id === id)?.md.trim()) commit(latest.current.filter((b) => b.id !== id), false)
    })
  }

  const strokes = useMemo(() => ink.map((s, i) => <Stroke key={i} s={s} />), [ink])
  const [inkW, inkH] = useMemo(() => inkExtent(ink), [ink])
  const button = (active) => `grid size-7 place-items-center rounded-md ${active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-text'}`

  return (
    <>
      <div role="toolbar" aria-label="Zeichnen" className="sticky left-12 top-14 z-20 mb-3 flex w-fit flex-wrap items-center gap-0.5 rounded-lg border border-line bg-raised/95 p-1 backdrop-blur">
        {editable &&
          TOOLS.map((t) => (
            <button key={t.id} aria-label={t.label} title={t.label} aria-pressed={tool === t.id} onClick={() => (t.id !== 'write' && document.activeElement?.blur(), setTool(t.id))} className={button(tool === t.id)}>
              <t.icon size={17} weight={tool === t.id ? 'fill' : 'regular'} />
            </button>
          ))}
        {editable && <span className="mx-1 h-5 w-px bg-line" />}
        <button aria-label="Verkleinern" title="Verkleinern" onClick={() => zoomCenter(zoom / 1.2)} className={button(false)}>
          <MagnifyingGlassMinus size={17} />
        </button>
        <button aria-label="Zoom auf 100 %" title="Zoom zurücksetzen (Strg+Mausrad zoomt)" onClick={() => zoomCenter(1)} className="h-7 w-12 rounded-md text-xs tabular-nums text-muted hover:bg-hover hover:text-text">
          {Math.round(zoom * 100)} %
        </button>
        <button aria-label="Vergrößern" title="Vergrößern" onClick={() => zoomCenter(zoom * 1.2)} className={button(false)}>
          <MagnifyingGlassPlus size={17} />
        </button>
        {drawing && tool !== 'eraser' && (
          <>
            <span className="mx-1 h-5 w-px bg-line" />
            {COLORS.map(([c, name]) => (
              <button key={c} aria-label={name} title={name} aria-pressed={colors[kind] === c} onClick={() => setColors({ ...colors, [kind]: c })} className={button(false)}>
                <span style={{ background: paint(c) }} className={`size-4 rounded-full ${colors[kind] === c ? 'ring-2 ring-accent ring-offset-2 ring-offset-raised' : ''}`} />
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-line" />
            {SIZE_NAMES.map((name, i) => (
              <button key={name} aria-label={name} title={name} aria-pressed={sizes[kind] === i} onClick={() => setSizes({ ...sizes, [kind]: i })} className={button(sizes[kind] === i)}>
                <span className="rounded-full bg-current" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
              </button>
            ))}
          </>
        )}
      </div>

      <div
        ref={canvas}
        onClick={create}
        style={{ zoom }}
        className={`free-canvas relative grid min-h-[60vh] w-max min-w-full pb-[50vh] pr-[40vw] ${editable && !drawing ? 'cursor-text' : ''}`}
      >
        {!boxes.length && !ink.length && (
          <p className="pointer-events-none text-faint" style={{ gridArea: '1 / 1', marginTop: TOP }}>
            {!editable ? 'Diese Seite ist leer.' : drawing ? 'Zeichne irgendwo.' : 'Klicke irgendwo, um zu schreiben, oder wähle oben den Stift.'}
          </p>
        )}
        {/* Platzhalter bis zum äußersten Strich, damit die Fläche auch mit der Zeichnung wächst */}
        <div aria-hidden style={{ gridArea: '1 / 1', marginLeft: inkW, marginTop: inkH, width: 1, height: 1 }} />
        {boxes.map((b) => (
          <div
            key={b.id}
            onBlur={(e) => leave(e, b.id)}
            style={{ gridArea: '1 / 1', marginLeft: b.x, marginTop: b.y, width: b.w }}
            className={`group/box anim-pop relative self-start justify-self-start rounded-md border border-transparent ${editable && !drawing ? 'hover:border-line focus-within:border-line' : ''}`}
          >
            {editable && !drawing && (
              <div className="absolute inset-x-[-1px] -top-[18px] flex h-[18px] items-center gap-1 rounded-t-md bg-hover opacity-0 transition-opacity group-hover/box:opacity-100 group-focus-within/box:opacity-100">
                <div onPointerDown={(e) => drag(e, b, 'move')} title="Kasten verschieben" aria-label="Kasten verschieben" className="h-full flex-1 cursor-move" />
                <button onClick={() => remove(b.id)} aria-label="Kasten löschen" className="mr-1 rounded p-0.5 text-faint hover:text-danger">
                  <Trash size={12} />
                </button>
              </div>
            )}
            <div className="free-box px-3 py-1">
              <Editor
                markdown={b.md}
                editable={editable}
                onChange={(md) => patch(b.id, { md })}
                onReady={(ed) => b.id === focus && (ed.commands.focus('end'), setFocus(null))}
              />
            </div>
            {editable && !drawing && (
              <div onPointerDown={(e) => drag(e, b, 'width')} title="Breite ändern" aria-label="Breite ändern" className="absolute -right-1 top-0 h-full w-2 cursor-ew-resize" />
            )}
          </div>
        ))}
        <svg
          aria-label={ink.length ? `Zeichnung mit ${ink.length} Strichen` : undefined}
          onPointerDown={startInk}
          className={`absolute inset-0 z-10 size-full overflow-visible ${drawing ? 'cursor-crosshair touch-none' : 'pointer-events-none'}`}
        >
          {strokes}
          {draft && <Stroke s={draft} />}
        </svg>
      </div>
    </>
  )
}
