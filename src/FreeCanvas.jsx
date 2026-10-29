import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MagnifyingGlassMinus, MagnifyingGlassPlus, Trash } from '@phosphor-icons/react'
import Editor from './Editor.jsx'
import { parseBoxes, parseInk, serializeBoxes } from './free.js'
import { inkExtent } from './ink.js'
import { InkOverlay, InkToolbar, Stroke, useInk } from './Ink.jsx'

const TOP = 20 // Platz für die Ziehleiste über dem obersten Kasten
const NEW_WIDTH = 440 // Codeblock-Leiste passt ohne Umbruch
const clampZoom = (z) => Math.min(2, Math.max(0.5, z))

// Freie Seite wie OneNote: Klick auf leere Fläche legt einen Kasten an, jeder Kasten ist ein vollwertiger Editor.
// Alle Kästen liegen in derselben Grid-Zelle, so wächst die Fläche von selbst nach rechts und unten mit.
// Darüber liegt die Zeichenebene; im Modus "Schreiben" klickt man durch sie hindurch.
export default function FreeCanvas({ body, editable, onChange }) {
  const [boxes, setBoxes] = useState(() => parseBoxes(body).map((b) => ({ ...b, id: crypto.randomUUID() })))
  const [ink, setInkState] = useState(() => parseInk(body))
  const [focus, setFocus] = useState(null)
  const [zoom, setZoom] = useState(1)
  const latest = useRef(boxes)
  const inkRef = useRef(ink)
  const zoomRef = useRef(1)
  const pendingScroll = useRef(null)
  const canvas = useRef(null)
  const root = useRef(null)

  const save = () => onChange(serializeBoxes(latest.current, inkRef.current))
  function commit(next, store = true) {
    latest.current = next
    setBoxes(next)
    if (store) save()
  }
  const patch = (id, fields, store) => commit(latest.current.map((b) => (b.id === id ? { ...b, ...fields } : b)), store)
  const remove = (id) => commit(latest.current.filter((b) => b.id !== id))

  // Punkt auf der Fläche in ungezoomten Pixeln
  function local(e) {
    const r = canvas.current.getBoundingClientRect()
    return [Math.round((e.clientX - r.left) / zoomRef.current), Math.round((e.clientY - r.top) / zoomRef.current)]
  }

  const k = useInk({
    ink,
    setInk: (next) => {
      inkRef.current = next
      setInkState(next)
      save()
    },
    local,
    scale: () => zoomRef.current,
    editable,
    ownUndo: true,
    container: root,
    // Lasso nimmt Kästen mit; ihre Höhe kennt nur das DOM
    boxes: {
      get: () => latest.current,
      set: commit,
      rects: () =>
        latest.current.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: canvas.current?.querySelector(`[data-box="${b.id}"]`)?.offsetHeight ?? 40 })),
    },
  })
  const drawing = k.drawing

  function create(e) {
    if (!editable || e.target !== e.currentTarget) return
    const [x, y] = local(e)
    const box = { id: crypto.randomUUID(), x: Math.max(0, x - 12), y: Math.max(TOP, y - 12), w: NEW_WIDTH, md: '' }
    setFocus(box.id)
    commit([...latest.current, box], false)
  }

  // Kasten verschieben oder Breite ändern
  function drag(e, box, mode) {
    if (!editable || e.button !== 0) return
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY }
    let moved = false
    const onMove = (ev) => {
      const dx = (ev.clientX - start.x) / zoomRef.current
      const dy = (ev.clientY - start.y) / zoomRef.current
      moved = true
      patch(box.id, mode === 'move' ? { x: Math.max(0, box.x + dx), y: Math.max(TOP, box.y + dy) } : { w: Math.max(160, box.w + dx) }, false)
    }
    const up = () => {
      removeEventListener('pointermove', onMove)
      removeEventListener('pointerup', up)
      if (moved) save()
    }
    addEventListener('pointermove', onMove)
    addEventListener('pointerup', up)
  }

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

  const strokes = useMemo(() => k.shown.map((s, i) => <Stroke key={i} s={s} />), [k.shown])
  const [inkW, inkH] = useMemo(() => inkExtent(k.shown), [k.shown])
  const zoomButton = 'grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-text'

  return (
    <div ref={root}>
      <InkToolbar k={k} tools={editable ? undefined : []} className="sticky left-12 top-14 z-20 mb-3">
        {editable && <span className="mx-1 h-5 w-px bg-line" />}
        <button aria-label="Verkleinern" title="Verkleinern" onClick={() => zoomCenter(zoom / 1.2)} className={zoomButton}>
          <MagnifyingGlassMinus size={17} />
        </button>
        <button aria-label="Zoom auf 100 %" title="Zoom zurücksetzen (Strg+Mausrad zoomt)" onClick={() => zoomCenter(1)} className="h-7 w-12 rounded-md text-xs tabular-nums text-muted hover:bg-hover hover:text-text">
          {Math.round(zoom * 100)} %
        </button>
        <button aria-label="Vergrößern" title="Vergrößern" onClick={() => zoomCenter(zoom * 1.2)} className={zoomButton}>
          <MagnifyingGlassPlus size={17} />
        </button>
      </InkToolbar>

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
            data-box={b.id}
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
          onPointerDown={k.down}
          className={`absolute inset-0 z-10 size-full overflow-visible ${drawing ? (k.tool === 'lasso' ? 'touch-none' : 'cursor-crosshair touch-none') : 'pointer-events-none'}`}
        >
          {strokes}
          <InkOverlay k={k} />
        </svg>
      </div>
    </div>
  )
}
