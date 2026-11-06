import { useEffect, useRef, useState } from 'react'
import { ArrowLineDown, BookOpenText, Copy, ImageSquare, PencilSimple } from '@phosphor-icons/react'
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react'
import { Extension, generateHTML, generateJSON, resolveExtensions } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { invoke } from '@tauri-apps/api/core'
import { MarkdownManager } from '@tiptap/markdown'
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
import { BackgroundColor, Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { SlashCommand } from './SlashMenu.jsx'
import { CodeBlockView } from './CodeBlock.jsx'
import BlockHandle from './BlockHandle.jsx'
import { LopEmbed, PageLink, PageLinkSuggest } from './Links.jsx'
import { Mentions } from './Mentions.jsx'
import { assetUrl, imagePng, isImage, relativeSrc, saveImage } from './images.js'
import { Attachment, saveAttachment } from './Attachment.jsx'
import { Drawing } from './Drawing.jsx'
import { VaultRef } from './Vault.jsx'
import Menu, { MenuItem } from './Menu.jsx'
import { useApp } from './ctx.js'
import { imageText } from './ocr.js'
import { maskSecrets, secretSpans } from './secrets.js'
import { adminLinks } from './adminlinks.js'
import { addOwnWord, AutoText, learnArea, misspelledAt, suggestionsFor } from './writing.js'
import AiMenu from './AiMenu.jsx'
import SecretDialog from './SecretDialog.jsx'
import ImageEditor from './ImageEditor.jsx'

const lowlight = createLowlight(common)
lowlight.register({ powershell, dos, dockerfile, nginx })
lowlight.registerAlias({ plaintext: ['mermaid', 'diagramm'] }) // Diagramm-Code nicht raten lassen

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

// Admin-Links (\\server\freigabe, C:\Pfad, rdp://, ssh://) gepunktet unterstreichen; geöffnet wird mit Strg+Klick (handleClick)
function adminDecorations(doc) {
  const decos = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'codeBlock') return false
    if (node.isText) for (const l of adminLinks(node.text)) decos.push(Decoration.inline(pos + l.from, pos + l.to, { class: 'adminlink', title: 'Strg+Klick öffnet' }))
  })
  return DecorationSet.create(doc, decos)
}
const AdminLinks = Extension.create({
  name: 'adminLinks',
  addProseMirrorPlugins() {
    const key = new PluginKey('adminLinks')
    return [
      new Plugin({
        key,
        state: { init: (_, { doc }) => adminDecorations(doc), apply: (tr, old) => (tr.docChanged ? adminDecorations(tr.doc) : old) },
        props: { decorations: (state) => key.getState(state) },
      }),
    ]
  },
})

// Admin-Link unter dem Mauszeiger; Knoten wie Seitenlinks zählen als ein Zeichen, damit die Stellen stimmen
function adminLinkAt(view, pos) {
  const $pos = view.state.doc.resolve(pos)
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, '\ufffc')
  return adminLinks(text).find((l) => l.from <= $pos.parentOffset && $pos.parentOffset <= l.to)
}

// Farbe, Hervorhebung, Schrift und Größe (z. B. aus OneNote) stehen im Markdown als <span style>. Der Inhalt bleibt
// Markdown und wird auch so gelesen: als HTML gelesen ging Fett verloren und jedes Speichern verdoppelte die
// Backslashes (LOP-058)
const STYLE = [['color', 'color'], ['backgroundColor', 'background-color'], ['fontFamily', 'font-family'], ['fontSize', 'font-size']]
function spanAttrs(style) {
  const attrs = {}
  for (const part of style.split(';')) {
    const [prop, ...rest] = part.split(':')
    const key = STYLE.find(([, p]) => p === prop.trim().toLowerCase())?.[0]
    if (key && rest.join(':').trim()) attrs[key] = rest.join(':').trim()
  }
  return attrs
}
const Stil = TextStyle.extend({
  markdownTokenName: 'nexoraSpan',
  markdownTokenizer: {
    name: 'nexoraSpan',
    level: 'inline',
    start: (src) => src.indexOf('<span style="'),
    tokenize(src, _tokens, h) {
      const open = /^<span style="([^"<>]*)">/.exec(src)
      if (!open) return
      // passendes </span>, innere Spans zählen mit
      const tag = /<span\b[^>]*>|<\/span>/g
      tag.lastIndex = open[0].length
      for (let depth = 1, m; (m = tag.exec(src)); ) {
        depth += m[0] === '</span>' ? -1 : 1
        if (!depth) return { type: 'nexoraSpan', raw: src.slice(0, tag.lastIndex), style: open[1], tokens: h.inlineTokens(src.slice(open[0].length, m.index)) }
      }
    },
  },
  // ein Text hat nur einen Stil: innere Spans ergänzen den äußeren statt ihn zu ersetzen
  parseMarkdown: (token, h) => {
    const attrs = spanAttrs(token.style)
    const style = (nodes) =>
      nodes.map((n) => {
        if (n.type !== 'text') return n.content ? { ...n, content: style(n.content) } : n
        const own = n.marks?.find((m) => m.type === 'textStyle')
        return { ...n, marks: [...(n.marks ?? []).filter((m) => m !== own), { type: 'textStyle', attrs: { ...attrs, ...own?.attrs } }] }
      })
    return style(h.parseInline(token.tokens))
  },
  renderMarkdown: (node, h) => {
    const css = STYLE.filter(([k]) => node.attrs?.[k]).map(([k, prop]) => `${prop}: ${String(node.attrs[k]).replace(/"/g, "'")}`).join('; ')
    return css ? `<span style="${css}">${h.renderChildren(node)}</span>` : h.renderChildren(node)
  },
})

const extensions = [
  StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true } }),
  Stil,
  Color,
  BackgroundColor,
  FontFamily,
  FontSize,
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
  Drawing,
  PageLink,
  PageLinkSuggest,
  Mentions,
  LopEmbed,
  VaultRef,
  AdminLinks,
  AutoText,
  Markdown,
  SlashCommand,
]

// HTML (z. B. aus OneNote) in genau das Markdown, das der Editor auch schreibt
let manager
export function htmlToMarkdown(html) {
  manager ??= new MarkdownManager({ extensions: resolveExtensions(extensions) })
  return manager.serialize(generateJSON(html, extensions))
}
// Umgekehrt fürs Zurückschreiben nach OneNote: Markdown → Blöcke (JSON) → HTML einzelner Blöcke
export function markdownToJson(md) {
  manager ??= new MarkdownManager({ extensions: resolveExtensions(extensions) })
  return manager.parse(md)
}
export const jsonToHtml = (nodes) => generateHTML({ type: 'doc', content: nodes }, extensions)

// Inhalt kommt und geht als Markdown; ein Editor je Seite (key im Aufrufer)
export default function Editor({ markdown, onChange, onReady, editable = true }) {
  const change = useRef(onChange)
  change.current = onChange
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(null)
  const [menu, setMenu] = useState(null)
  const [spell, setSpell] = useState(null) // Rechtsklick auf ein rot markiertes Wort
  const [editImage, setEditImage] = useState(null) // Bild im Bild-Editor ("bilder/…")
  // Passwort-Warnung: das abgefangene Einfügen wartet hier auf die Entscheidung
  const [secret, setSecret] = useState(null)
  const bypass = useRef(false)
  const app = useApp()
  const wrapper = useRef(null)
  const editor = useEditor({
    extensions,
    content: markdown,
    contentType: 'markdown',
    onUpdate: ({ editor }) => change.current?.(editor.getMarkdown()), // ohne onChange: nur lesen (Lesemodus)
    editorProps: {
      attributes: { spellcheck: 'false' }, // die Prüfung kommt aus writing.js, nicht vom WebView
      handlePaste: (view, event) => {
        if (insertFiles(view, pastedFiles(event.clipboardData), null, setError)) return true
        if (bypass.current) return false
        const text = event.clipboardData?.getData('text/plain') ?? ''
        const spans = secretSpans(text)
        if (!spans.length) return false
        setSecret({ view, text, spans })
        return true
      },
      handleClick: (view, pos, event) => {
        if (!(event.ctrlKey || event.metaKey)) return false
        const link = adminLinkAt(view, pos)
        if (!link) return false
        invoke('open_admin_link', { target: link.target }).catch((e) => setError(String(e)))
        return true
      },
      handleDrop: (view, event, _slice, moved) =>
        !moved && insertFiles(view, [...(event.dataTransfer?.files ?? [])], view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos, setError),
    },
  })

  useEffect(() => {
    if (editor) onReady?.(editor)
  }, [editor, onReady])

  // Autofüllen lernt aus dem Bereich, in dem diese Seite liegt
  const area = editable ? app?.textArea : null
  useEffect(() => {
    if (area) learnArea(area)
  }, [area])

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
    if (!file?.startsWith?.('bilder/')) return spellMenu(e)
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, file })
  }
  // Rechtsklick auf ein rot markiertes Wort: Vorschläge und „Ins Wörterbuch“
  function spellMenu(e) {
    if (!editor || !editable || !e.target.closest?.('.spell-error')) return
    const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
    const hit = at && misspelledAt(editor.view, at.pos)
    if (!hit) return
    e.preventDefault()
    setSpell({ ...hit, x: e.clientX, y: e.clientY, options: null })
    suggestionsFor(hit.word).then((options) => setSpell((s) => (s && s.from === hit.from ? { ...s, options } : s)))
  }
  function replaceWord(text) {
    const { from, to, word } = spell
    setSpell(null)
    const { view } = editor
    if (view.state.doc.textBetween(from, to) === word) view.dispatch(view.state.tr.insertText(text, from, to))
    view.focus()
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
  // Promise im ClipboardItem: der Schreibvorgang beginnt noch im Klick, das Bild wird danach gelesen
  const copyImage = (file) => {
    setMenu(null)
    navigator.clipboard.write([new ClipboardItem({ 'image/png': imagePng(file) })]).then(
      () => app?.notice('Bild kopiert.'),
      (err) => setError(`Bild nicht kopiert: ${err}`),
    )
  }
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

  function pasteChosen(choice) {
    const { view, text, spans } = secret
    setSecret(null)
    view.focus()
    if (!choice) return
    bypass.current = true
    view.pasteText(choice === 'masked' ? maskSecrets(text, spans) : text)
    bypass.current = false
  }

  return (
    <>
      {secret && <SecretDialog text={secret.text} spans={secret.spans} onChoose={pasteChosen} />}
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem icon={ImageSquare} onClick={() => copyImage(menu.file)}>Bild kopieren</MenuItem>
          {editable && <MenuItem icon={PencilSimple} onClick={() => (setMenu(null), setEditImage(menu.file))}>Bild bearbeiten …</MenuItem>}
          <MenuItem icon={Copy} onClick={() => copyText(menu.file)}>Text aus dem Bild kopieren</MenuItem>
          {editable && <MenuItem icon={ArrowLineDown} onClick={() => insertText(menu.file)}>Text unter dem Bild einfügen</MenuItem>}
        </Menu>
      )}
      {spell && (
        <Menu x={spell.x} y={spell.y} onClose={() => setSpell(null)} label={`Rechtschreibung: ${spell.word}`}>
          {spell.options === null && <p className="px-2 py-1.5 text-muted">Suche Vorschläge …</p>}
          {spell.options?.length === 0 && <p className="px-2 py-1.5 text-muted">Keine Vorschläge</p>}
          {spell.options?.map((s) => <MenuItem key={s} onClick={() => replaceWord(s)}>{s}</MenuItem>)}
          <div className="my-1 border-t border-line" />
          <MenuItem icon={BookOpenText} onClick={() => (addOwnWord(spell.word).catch((e) => setError(String(e))), setSpell(null), editor.view.focus())}>Ins Wörterbuch aufnehmen</MenuItem>
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
      {editable && editor && <AiMenu editor={editor} onSettings={app?.openAiSettings} />}
      {editImage && (
        <ImageEditor
          file={editImage}
          onClose={() => setEditImage(null)}
          onSave={(next) => {
            // das bearbeitete Bild ersetzt das alte an derselben Stelle (Breite bleibt)
            let at = null
            editor.state.doc.descendants((n, pos) => {
              if (at === null && n.type.name === 'image' && n.attrs.src === editImage) at = pos
              return at === null
            })
            if (at !== null) editor.view.dispatch(editor.state.tr.setNodeAttribute(at, 'src', next))
            setEditImage(null)
          }}
        />
      )}
      {zoom && (
        <div role="dialog" aria-label="Bild groß" onClick={() => setZoom(null)} className="anim-fade fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-[rgb(10_20_22/0.8)] p-8">
          <img src={zoom} alt="" className="anim-zoom max-h-full max-w-full rounded shadow-[var(--shadow)]" />
        </div>
      )}
    </>
  )
}
