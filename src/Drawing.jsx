import { useRef, useState } from 'react'
import { Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { drawingLine, parseDrawing } from './free.js'
import { InkOverlay, InkToolbar, TOOLS, useInk, useStrokes } from './Ink.jsx'

// Zeichnungs-Block in normalen Seiten; im Markdown eine unsichtbare Zeile "<!-- nexora:zeichnung h=… | Strich … -->"
export const Drawing = Node.create({
  name: 'drawing',
  group: 'block',
  atom: true,
  addAttributes: () => ({ h: { default: 240 }, ink: { default: [] } }),
  // Kopieren und Einfügen zwischen Seiten läuft über HTML
  parseHTML: () => [{ tag: 'div[data-drawing]', getAttrs: (el) => parseDrawing(el.dataset.drawing) ?? false }],
  renderHTML: ({ node }) => ['div', { 'data-drawing': drawingLine(node.attrs) }],
  markdownTokenName: 'drawing',
  markdownTokenizer: {
    name: 'drawing',
    level: 'block',
    start: (src) => src.indexOf('<!-- nexora:zeichnung '),
    tokenize(src) {
      const m = /^<!-- nexora:zeichnung [^\n]*-->(?:\n|$)/.exec(src)
      const d = m && parseDrawing(m[0])
      if (d) return { type: 'drawing', raw: m[0], height: d.h, ink: d.ink }
    },
  },
  parseMarkdown: (token, h) => h.createNode('drawing', { h: token.height, ink: token.ink }),
  renderMarkdown: ({ attrs }) => drawingLine(attrs),
  addNodeView: () => ReactNodeViewRenderer(DrawingView),
})

const BLOCK_TOOLS = TOOLS.filter((t) => t.id !== 'write')
const MIN_H = 80

function DrawingView({ node, updateAttributes, editor }) {
  const root = useRef(null)
  const area = useRef(null)
  const [height, setHeight] = useState(null) // während des Ziehens
  const editable = editor.isEditable
  const local = (e) => {
    const r = area.current.getBoundingClientRect()
    return [Math.round(e.clientX - r.left), Math.round(e.clientY - r.top)]
  }
  // Rückgängig übernimmt der Editor (Strg+Z), darum kein eigener Verlauf
  const k = useInk({ ink: node.attrs.ink, setInk: (ink) => updateAttributes({ ink }), local, editable, container: root, initialTool: 'pen' })
  const strokes = useStrokes(k.shown)
  const h = height ?? node.attrs.h

  function resize(e) {
    e.preventDefault()
    const startY = e.clientY
    let next = node.attrs.h
    const move = (ev) => setHeight((next = Math.max(MIN_H, Math.round(node.attrs.h + ev.clientY - startY))))
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      setHeight(null)
      if (next !== node.attrs.h) updateAttributes({ h: next })
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  return (
    <NodeViewWrapper contentEditable={false} className="drawing my-4">
      <div ref={root} className="rounded-lg border border-line">
        {editable && <InkToolbar k={k} tools={BLOCK_TOOLS} className="m-1 border-transparent bg-transparent" />}
        <div ref={area} className="relative overflow-hidden" style={{ height: h }}>
          <svg
            aria-label={`Zeichnung mit ${node.attrs.ink.length} Strichen`}
            onPointerDown={(e) => {
              if (!editable) return
              editor.view.focus() // damit Strg+Z im Editor den letzten Strich zurücknimmt
              k.down(e)
            }}
            className={`absolute inset-0 size-full ${editable ? (k.tool === 'lasso' ? 'touch-none' : 'cursor-crosshair touch-none') : ''}`}
          >
            {strokes}
            <InkOverlay k={k} />
          </svg>
          {!node.attrs.ink.length && editable && <p className="pointer-events-none absolute left-3 top-2 text-sm text-faint">Hier zeichnen</p>}
        </div>
        {editable && <div onPointerDown={resize} title="Höhe ändern" aria-label="Höhe ändern" className="h-2 cursor-ns-resize rounded-b-lg hover:bg-hover" />}
      </div>
    </NodeViewWrapper>
  )
}
