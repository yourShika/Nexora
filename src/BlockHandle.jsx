import { useEffect, useState } from 'react'
import { NodeSelection } from '@tiptap/pm/state'
import { DotsSixVertical } from '@phosphor-icons/react'

// Griff links neben dem Block unter der Maus. Ziehen verschiebt den ganzen Block (oberste Ebene),
// Klick wählt ihn aus. Das Verschieben selbst erledigt ProseMirror über view.dragging.
export default function BlockHandle({ editor, wrapper }) {
  const [at, setAt] = useState(null)

  useEffect(() => {
    const el = wrapper.current
    if (!editor || !el) return
    const view = editor.view
    const onMove = (e) => {
      const box = view.dom.getBoundingClientRect()
      const hit = view.posAtCoords({ left: Math.min(Math.max(e.clientX, box.left + 4), box.right - 4), top: e.clientY })
      if (!hit) return
      const $pos = view.state.doc.resolve(hit.pos)
      const index = $pos.index(0)
      if (index >= view.state.doc.childCount) return setAt(null)
      const pos = $pos.posAtIndex(index, 0)
      const dom = view.nodeDOM(pos)
      if (!(dom instanceof HTMLElement)) return setAt(null)
      const top = dom.getBoundingClientRect().top - el.getBoundingClientRect().top
      setAt((a) => (a?.pos === pos && a.top === top ? a : { pos, top }))
    }
    const onLeave = () => setAt(null)
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('mouseleave', onLeave)
    }
  }, [editor, wrapper])

  if (!at || !editor) return null

  const select = () => {
    const view = editor.view
    const sel = NodeSelection.create(view.state.doc, at.pos)
    view.dispatch(view.state.tr.setSelection(sel))
    return sel
  }

  return (
    <button
      draggable
      aria-label="Block ziehen oder auswählen"
      title="Ziehen zum Verschieben, Klick wählt den Block aus"
      onClick={() => (select(), editor.view.focus())}
      onDragStart={(e) => {
        const view = editor.view
        const sel = select()
        const dom = view.nodeDOM(at.pos)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', sel.node.textContent)
        if (dom instanceof HTMLElement) e.dataTransfer.setDragImage(dom, 0, 0)
        view.dragging = { slice: sel.content(), move: true }
      }}
      style={{ top: at.top + 3 }}
      className="absolute left-1 grid h-6 w-5 cursor-grab place-items-center rounded text-faint hover:bg-hover hover:text-text active:cursor-grabbing"
    >
      <DotsSixVertical size={16} weight="bold" />
    </button>
  )
}
