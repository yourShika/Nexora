import { useEffect, useRef, useState } from 'react'
import { ArrowLineDown, Copy } from '@phosphor-icons/react'
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
import { LopEmbed, PageLink, PageLinkSuggest } from './Links.jsx'
import { assetUrl, isImage, relativeSrc, saveImage } from './images.js'
import { Attachment, saveAttachment } from './Attachment.jsx'
import Menu, { MenuItem } from './Menu.jsx'
import { useApp } from './ctx.js'
import { imageText } from './ocr.js'

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

// Dateien speichern und einfügen: Bilder als Bild, alles andere als Anhang.
// false, wenn keine Dateien dabei sind (dann normales Einfügen)
function insertFiles(view, files, pos, onError) {
  if (!files.length) return false
  ;(async () => {
    // Abgelegtes kommt hinter den Block unter der Maus, statt Listen oder Absätze zu zerteilen
    let at = pos == null ? null : (() => {
      const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size))
      return $pos.depth > 0 ? $pos.after(1) : pos
    })()
    for (const file of files) {
      try {
        const { schema } = view.state
        const node = isImage(file)
          ? schema.nodes.image.create({ src: await saveImage(file) })
          : schema.nodes.attachment.create(await saveAttachment(file))
        const tr = at == null ? view.state.tr.replaceSelectionWith(node) : view.state.tr.insert(Math.min(at, view.state.doc.content.size), node)
        view.dispatch(tr)
        // nächste Datei hinter die eben eingefügte, damit die Reihenfolge stimmt
        if (at != null) at = tr.mapping.map(Math.min(at, tr.before.content.size), 1)
      } catch (e) {
        onError(`${file.name} nicht gespeichert: ${e}`)
      }
    }
  })()
  return true
}

// Beim Einfügen gewinnt Text: Word legt neben dem Text auch ein Bild der Auswahl in die Zwischenablage
function pastedFiles(data) {
  if (!data || data.getData('text/plain').trim()) return []
  return [...data.files]
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
  Attachment,
  PageLink,
  PageLinkSuggest,
  LopEmbed,
  Markdown,
  SlashCommand,
]

// Inhalt kommt und geht als Markdown; ein Editor je Seite (key im Aufrufer)
export default function Editor({ markdown, onChange, onReady, editable = true }) {
  const change = useRef(onChange)
  change.current = onChange
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(null)
  const [menu, setMenu] = useState(null)
  const app = useApp()
  const wrapper = useRef(null)
  const editor = useEditor({
    extensions,
    content: markdown,
    contentType: 'markdown',
    onUpdate: ({ editor }) => change.current(editor.getMarkdown()),
    editorProps: {
      handlePaste: (view, event) => insertFiles(view, pastedFiles(event.clipboardData), null, setError),
      handleDrop: (view, event, _slice, moved) =>
        !moved && insertFiles(view, [...(event.dataTransfer?.files ?? [])], view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos, setError),
    },
  })

  useEffect(() => {
    if (editor) onReady?.(editor)
  }, [editor, onReady])

  // Gesperrte Seite: lesen und Codeblöcke ausführen, aber nicht bearbeiten
  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable)
  }, [editor, editable])

  useEffect(() => {
    if (!zoom) return
    const close = (e) => e.key === 'Escape' && setZoom(null)
    addEventListener('keydown', close)
    return () => removeEventListener('keydown', close)
  }, [zoom])

  // Rechtsklick auf ein Bild: erkannten Text kopieren oder als Absätze darunter einfügen
  function imageMenu(e) {
    const file = e.target.tagName === 'IMG' && relativeSrc(e.target.getAttribute('src'))
    if (!file?.startsWith?.('bilder/')) return
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, file })
  }
  async function withText(file, use) {
    setMenu(null)
    let text
    try {
      text = (await imageText(file)).trim()
    } catch (err) {
      return setError(`Texterkennung fehlgeschlagen: ${err}`)
    }
    if (!text) return app?.notice('Kein Text im Bild gefunden.')
    try {
      await use(text)
    } catch (err) {
      setError(`Text aus dem Bild nicht übernommen: ${err}`)
    }
  }
  const copyText = (file) => withText(file, (text) => navigator.clipboard.writeText(text).then(() => app?.notice('Text aus dem Bild kopiert.')))
  const insertText = (file) =>
    withText(file, (text) => {
      let at = null
      editor.state.doc.descendants((n, pos) => {
        if (at === null && n.type.name === 'image' && n.attrs.src === file) at = pos + n.nodeSize
        return at === null
      })
      if (at === null) return
      const lines = text.split('\n').filter((l) => l.trim())
      editor.chain().insertContentAt(at, lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }))).run()
    })

  return (
    <>
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem icon={Copy} onClick={() => copyText(menu.file)}>Text aus dem Bild kopieren</MenuItem>
          {editable && <MenuItem icon={ArrowLineDown} onClick={() => insertText(menu.file)}>Text unter dem Bild einfügen</MenuItem>}
        </Menu>
      )}
      {error && (
        <p role="alert" className="mb-3 text-danger">
          {error} <button onClick={() => setError('')} className="underline">Ausblenden</button>
        </p>
      )}
      {/* Doppelklick auf ein Bild zeigt es groß; links Platz für den Ziehgriff */}
      <div ref={wrapper} onDoubleClick={(e) => e.target.tagName === 'IMG' && setZoom(e.target.src)} onContextMenu={imageMenu} className="relative -ml-8 pl-8">
        {editable && <BlockHandle editor={editor} wrapper={wrapper} />}
        <EditorContent editor={editor} />
      </div>
      {zoom && (
        <div role="dialog" aria-label="Bild groß" onClick={() => setZoom(null)} className="anim-fade fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-[rgb(10_20_22/0.8)] p-8">
          <img src={zoom} alt="" className="anim-zoom max-h-full max-w-full rounded shadow-[var(--shadow)]" />
        </div>
      )}
    </>
  )
}
