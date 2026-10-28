import { useRef, useState } from 'react'
import { Trash } from '@phosphor-icons/react'
import Editor from './Editor.jsx'
import { parseBoxes, serializeBoxes } from './free.js'

const TOP = 20 // Platz für die Ziehleiste über dem obersten Kasten
const NEW_WIDTH = 440 // Codeblock-Leiste passt ohne Umbruch

// Freie Seite wie OneNote: Klick auf leere Fläche legt einen Kasten an, jeder Kasten ist ein vollwertiger Editor.
// Alle Kästen liegen in derselben Grid-Zelle, so wächst die Fläche von selbst nach rechts und unten mit.
export default function FreeCanvas({ body, editable, onChange }) {
  const [boxes, setBoxes] = useState(() => parseBoxes(body).map((b) => ({ ...b, id: crypto.randomUUID() })))
  const [focus, setFocus] = useState(null)
  const latest = useRef(boxes)

  function commit(next, save = true) {
    latest.current = next
    setBoxes(next)
    if (save) onChange(serializeBoxes(next))
  }
  const patch = (id, fields, save) => commit(latest.current.map((b) => (b.id === id ? { ...b, ...fields } : b)), save)
  const remove = (id) => commit(latest.current.filter((b) => b.id !== id))

  function create(e) {
    if (!editable || e.target !== e.currentTarget) return
    const r = e.currentTarget.getBoundingClientRect()
    const box = { id: crypto.randomUUID(), x: Math.max(0, e.clientX - r.left - 12), y: Math.max(TOP, e.clientY - r.top - 12), w: NEW_WIDTH, md: '' }
    setFocus(box.id)
    commit([...latest.current, box], false)
  }

  // Verschieben oder Breite ändern; Listener am Fenster, damit schnelle Bewegungen nicht abreißen
  function drag(e, box, mode) {
    if (!editable || e.button !== 0) return
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY }
    let moved = false
    const move = (ev) => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      moved = true
      patch(box.id, mode === 'move' ? { x: Math.max(0, box.x + dx), y: Math.max(TOP, box.y + dy) } : { w: Math.max(160, box.w + dx) }, false)
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      if (moved) onChange(serializeBoxes(latest.current))
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  // Leere Kästen verschwinden, sobald man woanders hinklickt (wie in OneNote)
  function leave(e, id) {
    const el = e.currentTarget
    setTimeout(() => {
      if (!document.hasFocus() || el.contains(document.activeElement)) return
      if (!latest.current.find((b) => b.id === id)?.md.trim()) commit(latest.current.filter((b) => b.id !== id), false)
    })
  }

  return (
    <div onClick={create} className={`grid min-h-[60vh] w-max min-w-full pb-[50vh] pr-[40vw] ${editable ? 'cursor-text' : ''}`}>
      {!boxes.length && (
        <p className="pointer-events-none text-faint" style={{ gridArea: '1 / 1', marginTop: TOP }}>
          {editable ? 'Klicke irgendwo, um zu schreiben.' : 'Diese Seite ist leer.'}
        </p>
      )}
      {boxes.map((b) => (
        <div
          key={b.id}
          onBlur={(e) => leave(e, b.id)}
          style={{ gridArea: '1 / 1', marginLeft: b.x, marginTop: b.y, width: b.w }}
          className={`group/box anim-pop relative self-start justify-self-start rounded-md border border-transparent ${editable ? 'hover:border-line focus-within:border-line' : ''}`}
        >
          {editable && (
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
          {editable && (
            <div onPointerDown={(e) => drag(e, b, 'width')} title="Breite ändern" aria-label="Breite ändern" className="absolute -right-1 top-0 h-full w-2 cursor-ew-resize" />
          )}
        </div>
      ))}
    </div>
  )
}
