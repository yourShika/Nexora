import { useEffect, useRef, useState } from 'react'
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Placeholder } from '@tiptap/extensions'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import powershell from 'highlight.js/lib/languages/powershell'
import dos from 'highlight.js/lib/languages/dos'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import nginx from 'highlight.js/lib/languages/nginx'
import Image from '@tiptap/extension-image'
import { SlashCommand } from './SlashMenu.jsx'
import { CodeBlockView } from './CodeBlock.jsx'
import BlockHandle from './BlockHandle.jsx'
import { assetUrl, isImage, relativeSrc, saveImage } from './images.js'

const lowlight = createLowlight(common)
lowlight.register({ powershell, dos, dockerfile, nginx })

// Bild mit Breite im Obsidian-Format "![alt|400](bilder/x.png)"; Höhe folgt dem Seitenverhältnis
const Bild = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      src: { default: null, parseHTML: (el) => relativeSrc(el.getAttribute('src')), renderHTML: (a) => ({ src: assetUrl(a.src) }) },
      height: { default: null, renderHTML: () => ({}) },
    }
  },
  parseMarkdown: (token, h) => {
    const [alt, width] = (token.text ?? '').split('|')
    return h.createNode('image', { src: token.href, title: token.title || null, alt: alt || null, width: /^\d+$/.test(width ?? '') ? Number(width) : null })
  },
  renderMarkdown: ({ attrs }) => `![${attrs.alt ?? ''}${attrs.width ? `|${Math.round(attrs.width)}` : ''}](${attrs.src ?? ''})`,
}).configure({
  resize: { enabled: true, alwaysPreserveAspectRatio: true, minWidth: 60, minHeight: 40, directions: ['left', 'right', 'bottom-left', 'bottom-right'] },
})

// Bilddateien speichern und einfügen; false, wenn keine Bilder dabei sind (dann normales Einfügen)
function insertImages(view, files, pos, onError) {
  const images = files.filter(isImage)
  if (!images.length) return false
  ;(async () => {
    for (const file of images) {
      try {
        const node = view.state.schema.nodes.image.create({ src: await saveImage(file) })
        const tr = pos == null ? view.state.tr.replaceSelectionWith(node) : view.state.tr.insert(Math.min(pos, view.state.doc.content.size), node)
        view.dispatch(tr)
      } catch (e) {
        onError(`Bild nicht gespeichert: ${e}`)
      }
    }
  })()
  return true
}

const extensions = [
  StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true } }),
  CodeBlockLowlight.extend({ addNodeView: () => ReactNodeViewRenderer(CodeBlockView) }).configure({ lowlight }),
  TaskList,
  TaskItem.configure({
    nested: true,
    a11y: { checkboxLabel: (node, checked) => `${checked ? 'Erledigt' : 'Offen'}: ${node.textContent || 'leerer Punkt'}` },
  }),
  TableKit.configure({ table: { resizable: true } }),
  Placeholder.configure({
    placeholder: ({ node }) => (node.type.name === 'heading' ? 'Überschrift' : 'Tippe / für Blöcke'),
  }),
  Bild,
  Markdown,
  SlashCommand,
]

// Inhalt kommt und geht als Markdown; ein Editor je Seite (key im Aufrufer)
export default function Editor({ markdown, onChange, onReady }) {
  const change = useRef(onChange)
  change.current = onChange
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(null)
  const wrapper = useRef(null)
  const editor = useEditor({
    extensions,
    content: markdown,
    contentType: 'markdown',
    onUpdate: ({ editor }) => change.current(editor.getMarkdown()),
    editorProps: {
      handlePaste: (view, event) => insertImages(view, [...(event.clipboardData?.files ?? [])], null, setError),
      handleDrop: (view, event, _slice, moved) =>
        !moved && insertImages(view, [...(event.dataTransfer?.files ?? [])], view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos, setError),
    },
  })

  useEffect(() => {
    if (editor) onReady?.(editor)
  }, [editor, onReady])

  useEffect(() => {
    if (!zoom) return
    const close = (e) => e.key === 'Escape' && setZoom(null)
    addEventListener('keydown', close)
    return () => removeEventListener('keydown', close)
  }, [zoom])

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 text-danger">
          {error} <button onClick={() => setError('')} className="underline">Ausblenden</button>
        </p>
      )}
      {/* Doppelklick auf ein Bild zeigt es groß; links Platz für den Ziehgriff */}
      <div ref={wrapper} onDoubleClick={(e) => e.target.tagName === 'IMG' && setZoom(e.target.src)} className="relative -ml-8 pl-8">
        <BlockHandle editor={editor} wrapper={wrapper} />
        <EditorContent editor={editor} />
      </div>
      {zoom && (
        <div role="dialog" aria-label="Bild groß" onClick={() => setZoom(null)} className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-[rgb(10_20_22/0.8)] p-8">
          <img src={zoom} alt="" className="max-h-full max-w-full rounded shadow-[var(--shadow)]" />
        </div>
      )}
    </>
  )
}
