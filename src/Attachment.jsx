import { useState } from 'react'
import { Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { ArrowSquareOut, Copy, File, FileCode, FileDoc, FilePdf, FilePpt, FileText, FileXls, FileZip, FolderOpen } from '@phosphor-icons/react'
import { useApp } from './ctx.js'
import { TEXT_FILES, attachmentText, indexText } from './ocr.js'

// Anhänge liegen in <Daten>\anhaenge\<uuid>\<Name>; im Markdown: [[datei:<uuid>/<Name>|<Bytes>]]
const RUNNABLE = ['exe', 'msi', 'bat', 'cmd', 'com', 'ps1', 'vbs', 'js', 'jse', 'wsf', 'scr', 'lnk', 'reg', 'hta']
const ICONS = { pdf: FilePdf, doc: FileDoc, docx: FileDoc, xls: FileXls, xlsx: FileXls, ppt: FilePpt, pptx: FilePpt, csv: FileXls, zip: FileZip, '7z': FileZip, rar: FileZip, txt: FileText, log: FileText, md: FileText, ps1: FileCode, json: FileCode, xml: FileCode, yml: FileCode, yaml: FileCode }

const ext = (name) => name.split('.').pop().toLowerCase()
export const formatSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

// Abgelegte oder eingefügte Datei speichern
export async function saveAttachment(file) {
  const path = await invoke('save_attachment', new Uint8Array(await file.arrayBuffer()), {
    headers: { 'x-id': crypto.randomUUID(), 'x-file': encodeURIComponent(file.name) },
  })
  indexText() // PDF und Office gleich durchsuchbar machen, im Hintergrund
  return { path, size: file.size }
}

// Dateien über den Dateidialog wählen und übernehmen
export async function pickAttachments() {
  const picked = await open({ multiple: true, title: 'Dateien anhängen' })
  if (!picked) return []
  const files = await Promise.all([picked].flat().map(async (source) => {
    const [path, size] = await invoke('import_attachment', { source, id: crypto.randomUUID() })
    return { path, size }
  }))
  indexText()
  return files
}

export const Attachment = Node.create({
  name: 'attachment',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ path: { default: null }, size: { default: 0 } }),
  parseHTML: () => [{ tag: 'div[data-attachment]', getAttrs: (el) => ({ path: el.dataset.attachment, size: Number(el.dataset.size) || 0 }) }],
  renderHTML: ({ node }) => ['div', { 'data-attachment': node.attrs.path, 'data-size': node.attrs.size }],
  markdownTokenName: 'attachment',
  markdownTokenizer: {
    name: 'attachment',
    level: 'block',
    start: (src) => src.indexOf('[[datei:'),
    tokenize(src) {
      const m = /^\[\[datei:([0-9a-f-]{36}\/[^\]|\n]+)\|(\d+)\]\](?:\n|$)/.exec(src)
      if (m) return { type: 'attachment', raw: m[0], path: m[1], size: Number(m[2]) }
    },
  },
  parseMarkdown: (token, h) => h.createNode('attachment', { path: token.path, size: token.size }),
  renderMarkdown: ({ attrs }) => (attrs.path ? `[[datei:${attrs.path}|${attrs.size ?? 0}]]` : ''),
  addNodeView: () => ReactNodeViewRenderer(AttachmentView),
})

function AttachmentView({ node }) {
  const [error, setError] = useState('')
  const name = node.attrs.path?.split('/').slice(1).join('/') ?? 'Datei'
  const Icon = ICONS[ext(name)] ?? File
  const runnable = RUNNABLE.includes(ext(name))
  const act = (cmd) => invoke(cmd, { rel: node.attrs.path }).then(() => setError(''), (e) => setError(String(e)))
  const app = useApp()
  const [reading, setReading] = useState(false)
  // Text aus PDF (erkannt), Office- und Textdateien in die Zwischenablage; schon erfasst geht es sofort
  async function copyText() {
    setReading(true)
    try {
      const text = (await attachmentText(node.attrs.path)).trim()
      if (!text) return app?.notice('In der Datei wurde kein Text gefunden.')
      await navigator.clipboard.writeText(text)
      app?.notice('Text aus dem Anhang kopiert.')
    } catch (e) {
      setError(`Text nicht gelesen: ${e}`)
    } finally {
      setReading(false)
    }
  }
  return (
    <NodeViewWrapper contentEditable={false} data-drag-handle className="my-3">
      <div className="flex max-w-xl items-center gap-3 rounded-lg border border-line bg-raised px-3 py-2">
        <Icon size={26} weight="duotone" className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{name}</span>
          <span className="text-xs text-faint">{formatSize(node.attrs.size)}{runnable ? ', ausführbar: wird nicht per Klick geöffnet' : ''}</span>
        </span>
        {TEXT_FILES.test(name) && (
          <button onClick={copyText} disabled={reading} title="Text der Datei kopieren (PDF über die Texterkennung)" className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-text disabled:opacity-60">
            <Copy size={15} /> {reading ? 'Liest …' : 'Text'}
          </button>
        )}
        {!runnable && (
          <button onClick={() => act('open_attachment')} className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-text">
            <ArrowSquareOut size={15} /> Öffnen
          </button>
        )}
        <button onClick={() => act('reveal_attachment')} title="Im Explorer zeigen" className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-text">
          <FolderOpen size={15} /> Ordner
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </NodeViewWrapper>
  )
}
