import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  ArrowClockwise, ArrowUUpLeft, ArrowUUpRight, ArrowUpRight, Circle, Crop, Cursor, EyeSlash, GridFour, Highlighter, LineSegment, NumberCircleOne, PaintBucket, PenNib, Rectangle, TextT, Trash,
} from '@phosphor-icons/react'
import * as db from './db.js'
import { saveImageBytes } from './images.js'
import { inkPath } from './ink.js'
import { NUMBER_RADIUS, TEXT_SIZE, cropFrom, hitOp, moveOp, nextNumber, opBounds, rotateState } from './imageops.js'

// Bild bearbeiten wie in Greenshot. Gespeichert wird ein neues Bild mit eingebrannten Markierungen (Verpixeltes ist wirklich weg);
// Original und Schritte merkt sich die Einstellung bild:<neues Bild>, damit man später weiter ändern kann.
const TOOLS = [
  ['select', 'Auswählen und verschieben (Entf löscht)', Cursor],
  ['rect', 'Rahmen', Rectangle],
  ['ellipse', 'Ellipse', Circle],
  ['arrow', 'Pfeil', ArrowUpRight],
  ['line', 'Linie', LineSegment],
  ['pen', 'Stift', PenNib],
  ['marker', 'Textmarker', Highlighter],
  ['fill', 'Fläche, halbtransparent', PaintBucket],
  ['text', 'Text', TextT],
  ['number', 'Nummer (1, 2, 3 …)', NumberCircleOne],
  ['pixel', 'Verpixeln', GridFour],
  ['black', 'Schwärzen', EyeSlash],
  ['crop', 'Zuschneiden', Crop],
]
const COLORS = [['#e5484d', 'Rot'], ['#f5c518', 'Gelb'], ['#30a46c', 'Grün'], ['#3e8bd6', 'Blau'], ['#8e4ec6', 'Lila'], ['#111111', 'Schwarz'], ['#ffffff', 'Weiß']]
const WIDTHS = [[2, 'Dünn'], [4, 'Mittel'], [8, 'Dick']]
const SHAPES = new Set(['rect', 'ellipse', 'arrow', 'line', 'fill', 'pixel', 'black'])
const onDark = (c) => (c === '#ffffff' || c === '#f5c518' ? '#111111' : '#ffffff')

function rotatedBase(bitmap, rot) {
  const [w, h] = rot % 180 ? [bitmap.height, bitmap.width] : [bitmap.width, bitmap.height]
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')
  g.translate(w / 2, h / 2)
  g.rotate((rot * Math.PI) / 180)
  g.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  return c
}

function drawOp(g, base, op) {
  const [[ax, ay], [bx, by] = op.p[0]] = op.p
  const [l, t, w, h] = [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)]
  if (op.t === 'pixel') {
    if (w < 1 || h < 1) return
    const k = Math.max(6, Math.round(Math.max(w, h) / 20))
    const small = new OffscreenCanvas(Math.max(1, Math.ceil(w / k)), Math.max(1, Math.ceil(h / k)))
    small.getContext('2d').drawImage(base, l, t, w, h, 0, 0, small.width, small.height)
    g.save()
    g.imageSmoothingEnabled = false
    g.drawImage(small, 0, 0, small.width, small.height, l, t, w, h)
    g.restore()
  } else if (op.t === 'black') {
    g.fillStyle = '#000000'
    g.fillRect(l, t, w, h)
  } else if (op.t === 'fill') {
    g.save()
    g.globalAlpha = 0.3
    g.fillStyle = op.c
    g.fillRect(l, t, w, h)
    g.restore()
  } else if (op.t === 'text') {
    const size = TEXT_SIZE[op.w] ?? 24
    g.font = `600 ${size}px "Segoe UI", Arial, sans-serif`
    const pad = size * 0.3
    const tw = g.measureText(op.text).width
    g.fillStyle = op.c === '#ffffff' ? 'rgba(17,17,17,0.85)' : 'rgba(255,255,255,0.92)'
    g.beginPath()
    g.roundRect(ax, ay, tw + 2 * pad, size * 1.4, size * 0.25)
    g.fill()
    g.fillStyle = op.c
    g.textBaseline = 'middle'
    g.fillText(op.text, ax + pad, ay + size * 0.72)
  } else if (op.t === 'number') {
    const r = NUMBER_RADIUS[op.w] ?? 18
    g.beginPath()
    g.arc(ax, ay, r, 0, 2 * Math.PI)
    g.fillStyle = op.c
    g.fill()
    g.lineWidth = 2
    g.strokeStyle = '#ffffff'
    g.stroke()
    g.fillStyle = onDark(op.c)
    g.font = `700 ${Math.round(r * 1.1)}px "Segoe UI", Arial, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(String(op.n), ax, ay + 1)
    g.textAlign = 'start'
  } else {
    g.save()
    g.strokeStyle = op.c
    g.lineWidth = op.t === 'marker' ? op.w * 4 : op.w
    g.lineCap = 'round'
    g.lineJoin = 'round'
    if (op.t === 'marker') g.globalAlpha = 0.4
    g.stroke(new Path2D(inkPath(op)))
    g.restore()
  }
}

const paint = (g, base, ops) => {
  g.drawImage(base, 0, 0)
  for (const op of ops) drawOp(g, base, op)
}

export default function ImageEditor({ file, onSave, onClose }) {
  const name = file.slice('bilder/'.length)
  const [base, setBase] = useState(null) // { bitmap, file }
  const [state, setStateRaw] = useState({ ops: [], crop: null, rot: 0 })
  const stateRef = useRef(state)
  const setState = (s) => ((stateRef.current = s), setStateRaw(s))
  const history = useRef({ undo: [], redo: [] })
  const [tool, setTool] = useState('arrow')
  const [color, setColor] = useState(COLORS[0][0])
  const [width, setWidth] = useState(4)
  const [draft, setDraft] = useState(null)
  const [selected, setSelected] = useState(-1)
  const [typing, setTyping] = useState(null) // { p, text }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [scale, setScale] = useState(1)
  const canvas = useRef(null)
  const area = useRef(null)
  const rotated = useRef(null)

  // Bearbeitetes Bild: Original und Schritte aus der Datenbank, sonst das Bild selbst
  useEffect(() => {
    let alive = true
    ;(async () => {
      const saved = JSON.parse((await db.getSetting(`bild:${name}`)) || 'null')
      const src = saved?.orig ?? file
      const bytes = await invoke('read_image', { name: src.slice('bilder/'.length) })
      const bitmap = await createImageBitmap(new Blob([bytes]))
      if (!alive) return
      if (saved) setState({ ops: saved.ops ?? [], crop: saved.crop ?? null, rot: saved.rot ?? 0 })
      setBase({ bitmap, file: src })
    })().catch((e) => alive && setError(`Bild nicht geladen: ${e}`))
    return () => {
      alive = false
    }
  }, [file])

  const dims = base ? (state.rot % 180 ? [base.bitmap.height, base.bitmap.width] : [base.bitmap.width, base.bitmap.height]) : [1, 1]

  // Einpassen in die Fläche (nie vergrößern)
  useLayoutEffect(() => {
    if (!base || !area.current) return
    const fit = () => setScale(Math.min(1, (area.current.clientWidth - 32) / dims[0], (area.current.clientHeight - 32) / dims[1]))
    fit()
    addEventListener('resize', fit)
    return () => removeEventListener('resize', fit)
  }, [base, dims[0], dims[1]])

  // Zeichnen: Bild, Schritte, Entwurf; außerhalb des Ausschnitts abgedunkelt, Auswahl gestrichelt
  useEffect(() => {
    if (!base || !canvas.current) return
    if (!rotated.current || rotated.current.rot !== state.rot || rotated.current.bitmap !== base.bitmap) rotated.current = { rot: state.rot, bitmap: base.bitmap, canvas: rotatedBase(base.bitmap, state.rot) }
    const c = canvas.current
    c.width = dims[0]
    c.height = dims[1]
    const g = c.getContext('2d')
    paint(g, rotated.current.canvas, draft && draft.t !== 'crop' ? [...state.ops, draft] : state.ops)
    const crop = draft?.t === 'crop' ? cropFrom(draft.p[0], draft.p[1], dims[0], dims[1]) : state.crop
    if (crop) {
      g.save()
      g.fillStyle = 'rgba(0,0,0,0.55)'
      g.beginPath()
      g.rect(0, 0, dims[0], dims[1])
      g.rect(crop[0], crop[1], crop[2], crop[3])
      g.fill('evenodd')
      g.restore()
    }
    if (selected >= 0 && state.ops[selected]) {
      const [l, t, r, b] = opBounds(state.ops[selected])
      g.save()
      g.setLineDash([6 / scale, 4 / scale])
      g.lineWidth = 1.5 / scale
      g.strokeStyle = '#0e6f78'
      g.strokeRect(l - 6, t - 6, r - l + 12, b - t + 12)
      g.restore()
    }
  }, [base, state, draft, selected, scale, dims[0], dims[1]])

  function commit(next) {
    history.current.undo.push(stateRef.current)
    history.current.redo = []
    setState(next)
  }
  function undo() {
    const prev = history.current.undo.pop()
    if (!prev) return
    history.current.redo.push(stateRef.current)
    setSelected(-1)
    setState(prev)
  }
  function redo() {
    const next = history.current.redo.pop()
    if (!next) return
    history.current.undo.push(stateRef.current)
    setState(next)
  }
  const rotate = () => {
    const s = stateRef.current
    commit({ ...rotateState(s, dims[0], dims[1]), rot: (s.rot + 90) % 360 })
  }
  const removeSelected = () => {
    if (selected < 0) return
    commit({ ...stateRef.current, ops: stateRef.current.ops.filter((_, i) => i !== selected) })
    setSelected(-1)
  }

  const toImage = (e) => {
    const r = canvas.current.getBoundingClientRect()
    return [Math.round((e.clientX - r.left) / scale), Math.round((e.clientY - r.top) / scale)]
  }
  function follow(onMove, onUp) {
    const up = () => {
      removeEventListener('pointermove', onMove)
      removeEventListener('pointerup', up)
      onUp()
    }
    addEventListener('pointermove', onMove)
    addEventListener('pointerup', up)
  }

  function down(e) {
    if (e.button !== 0 || !base || busy) return
    e.preventDefault()
    if (typing) return finishText()
    const p = toImage(e)
    const s = stateRef.current
    if (tool === 'select') {
      const i = hitOp(s.ops, p[0], p[1], 6 / scale)
      setSelected(i)
      if (i < 0) return
      let moved = null
      follow(
        (ev) => {
          const q = toImage(ev)
          moved = { ...s, ops: s.ops.map((o, j) => (j === i ? moveOp(o, q[0] - p[0], q[1] - p[1]) : o)) }
          setState(moved)
        },
        () => {
          if (!moved) return
          setState(s)
          commit(moved)
        },
      )
      return
    }
    if (tool === 'text') return setTyping({ p, text: '' })
    if (tool === 'number') return commit({ ...s, ops: [...s.ops, { t: 'number', c: color, w: width, p: [p], n: nextNumber(s.ops) }] })
    const op = { t: tool, c: color, w: width, p: [p] }
    setSelected(-1)
    follow(
      (ev) => {
        const q = toImage(ev)
        if (tool === 'pen' || tool === 'marker') op.p = [...op.p, q]
        else op.p = [p, q]
        setDraft({ ...op })
      },
      () => {
        setDraft(null)
        if (tool === 'crop') return op.p.length > 1 && commit({ ...stateRef.current, crop: cropFrom(op.p[0], op.p[1], dims[0], dims[1]) })
        const [l, t, r, b] = opBounds(op)
        if (SHAPES.has(tool) && Math.max(r - l, b - t) < 4) return // nur geklickt
        commit({ ...stateRef.current, ops: [...stateRef.current.ops, op] })
      },
    )
  }

  function finishText() {
    const t = typing
    setTyping(null)
    if (t?.text.trim()) commit({ ...stateRef.current, ops: [...stateRef.current.ops, { t: 'text', c: color, w: width, p: [t.p], text: t.text.trim() }] })
  }

  const dirty = history.current.undo.length > 0
  function cancel() {
    if (!dirty || confirm('Änderungen am Bild verwerfen?')) onClose()
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      const s = stateRef.current
      const out = s.crop ?? [0, 0, dims[0], dims[1]]
      const c = new OffscreenCanvas(out[2], out[3])
      const g = c.getContext('2d')
      g.translate(-out[0], -out[1])
      paint(g, rotated.current.canvas, s.ops)
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
      const next = await saveImageBytes(bytes, 'png')
      await db.setSetting(`bild:${next.slice('bilder/'.length)}`, JSON.stringify({ orig: base.file, rot: s.rot, crop: s.crop, ops: s.ops }))
      onSave(next)
    } catch (e) {
      setError(`Nicht gespeichert: ${e}`)
      setBusy(false)
    }
  }

  useEffect(() => {
    const key = (e) => {
      if (e.target.tagName === 'INPUT') return
      const ctrl = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') return e.preventDefault(), e.stopPropagation(), cancel()
      if (ctrl && e.key.toLowerCase() === 'z') return e.preventDefault(), e.stopPropagation(), e.shiftKey ? redo() : undo()
      if (ctrl && e.key.toLowerCase() === 'y') return e.preventDefault(), e.stopPropagation(), redo()
      if (e.key === 'Delete' || e.key === 'Backspace') return e.preventDefault(), e.stopPropagation(), removeSelected()
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  })

  const button = (on) => `grid size-8 place-items-center rounded-md ${on ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-text'}`
  return (
    <div role="dialog" aria-modal="true" aria-label="Bild bearbeiten" className="anim-fade fixed inset-0 z-50 flex flex-col bg-[rgb(10_20_22/0.88)]">
      <div role="toolbar" aria-label="Bild bearbeiten" className="m-3 flex flex-wrap items-center gap-0.5 rounded-lg border border-line bg-raised p-1.5">
        {TOOLS.map(([id, label, Icon]) => (
          <button key={id} aria-label={label} title={label} aria-pressed={tool === id} onClick={() => (setTool(id), setSelected(-1))} className={button(tool === id)}>
            <Icon size={18} weight={tool === id ? 'fill' : 'regular'} />
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-line" />
        {COLORS.map(([c, label]) => (
          <button key={c} aria-label={label} title={label} aria-pressed={color === c} onClick={() => setColor(c)} className={button(false)}>
            <span style={{ background: c }} className={`size-4 rounded-full border border-line ${color === c ? 'ring-2 ring-accent ring-offset-2 ring-offset-raised' : ''}`} />
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-line" />
        {WIDTHS.map(([w, label]) => (
          <button key={w} aria-label={label} title={label} aria-pressed={width === w} onClick={() => setWidth(w)} className={button(width === w)}>
            <span className="rounded-full bg-current" style={{ width: 2 + w, height: 2 + w }} />
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-line" />
        <button aria-label="Um 90° drehen" title="Um 90° drehen" onClick={rotate} className={button(false)}><ArrowClockwise size={18} /></button>
        {state.crop && <button onClick={() => commit({ ...state, crop: null })} className="rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-text">Ganzes Bild</button>}
        <button aria-label="Rückgängig (Strg+Z)" title="Rückgängig (Strg+Z)" onClick={undo} className={button(false)}><ArrowUUpLeft size={18} /></button>
        <button aria-label="Wiederholen (Strg+Y)" title="Wiederholen (Strg+Y)" onClick={redo} className={button(false)}><ArrowUUpRight size={18} /></button>
        {selected >= 0 && <button aria-label="Markierung löschen (Entf)" title="Markierung löschen (Entf)" onClick={removeSelected} className={`${button(false)} hover:text-danger`}><Trash size={18} /></button>}
        <span className="flex-1" />
        {error && <span role="alert" className="mr-2 text-sm text-danger">{error}</span>}
        <button onClick={cancel} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover hover:text-text">Abbrechen</button>
        <button onClick={save} disabled={!base || busy} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg">
          {busy ? 'Speichert …' : 'Speichern'}
        </button>
      </div>
      <div ref={area} className="relative grid flex-1 place-items-center overflow-auto p-4">
        {!base && !error && <p className="text-faint">Bild wird geladen …</p>}
        {base && (
          <div className="relative" style={{ width: dims[0] * scale, height: dims[1] * scale }}>
            <canvas
              ref={canvas}
              onPointerDown={down}
              style={{ width: dims[0] * scale, height: dims[1] * scale }}
              className={`block touch-none shadow-[var(--shadow)] ${tool === 'select' ? 'cursor-default' : tool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`}
            />
            {typing && (
              <input
                autoFocus
                value={typing.text}
                onChange={(e) => setTyping({ ...typing, text: e.target.value })}
                onKeyDown={(e) => (e.key === 'Enter' ? finishText() : e.key === 'Escape' && setTyping(null))}
                onBlur={finishText}
                placeholder="Text, Enter übernimmt"
                style={{ left: typing.p[0] * scale, top: typing.p[1] * scale, fontSize: Math.max(12, (TEXT_SIZE[width] ?? 24) * scale), color }}
                className="absolute min-w-40 rounded border border-accent bg-white/95 px-1 font-semibold outline-none"
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
