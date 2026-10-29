import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { pickAttachments } from './Attachment.jsx'
import { pickVault } from './Vault.jsx'
import { pickEmoji } from './EmojiPicker.jsx'
import {
  ChartBar, CheckSquare, Smiley, Code, FlowArrow, Key, Scribble, LinkSimple, ListBullets, ListChecks, ListNumbers, Minus, Paperclip, Quotes, Table, TextHOne, TextHThree, TextHTwo, TextT,
} from '@phosphor-icons/react'

// `keys`: weitere Suchwörter, damit auch "todo", "h1" oder "pre" trifft
const ITEMS = [
  { title: 'Text', keys: 'absatz paragraph', icon: TextT, run: (c) => c.setParagraph() },
  { title: 'Überschrift 1', keys: 'h1 titel', icon: TextHOne, run: (c) => c.setHeading({ level: 1 }) },
  { title: 'Überschrift 2', keys: 'h2', icon: TextHTwo, run: (c) => c.setHeading({ level: 2 }) },
  { title: 'Überschrift 3', keys: 'h3', icon: TextHThree, run: (c) => c.setHeading({ level: 3 }) },
  { title: 'Aufzählung', keys: 'liste bullet ul', icon: ListBullets, run: (c) => c.toggleBulletList() },
  { title: 'Nummerierung', keys: 'liste nummer ol', icon: ListNumbers, run: (c) => c.toggleOrderedList() },
  { title: 'Checkliste', keys: 'todo aufgabe task', icon: CheckSquare, run: (c) => c.toggleTaskList() },
  { title: 'Zitat', keys: 'quote', icon: Quotes, run: (c) => c.toggleBlockquote() },
  { title: 'Code', keys: 'codeblock pre skript script', icon: Code, run: (c) => c.toggleCodeBlock({ language: 'powershell' }) },
  { title: 'Diagramm', keys: 'chart statistik zahlen balken torte linie kreis grafik', icon: ChartBar, run: (c) => c.insertContent({ type: 'codeBlock', attrs: { language: 'diagramm' }, content: [{ type: 'text', text: 'typ: balken\ntitel: Beispiel\nquelle: tabelle\n---\nMonat;Offen;Erledigt\nJan;4;10\nFeb;6;12\nMär;3;15' }] }) },
  { title: 'Ablaufdiagramm', keys: 'mermaid flussdiagramm ablauf flowchart sequenz', icon: FlowArrow, run: (c) => c.insertContent({ type: 'codeBlock', attrs: { language: 'mermaid' }, content: [{ type: 'text', text: 'flowchart LR\n  A[Start] --> B[Ende]' }] }) },
  { title: 'Zeichnung', keys: 'zeichnen skizze stift ink drawing malen', icon: Scribble, run: (c) => c.insertContent({ type: 'drawing', attrs: { h: 240, ink: [] } }) },
  { title: 'Tabelle', keys: 'table', icon: Table, run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { title: 'Trennlinie', keys: 'hr linie divider', icon: Minus, run: (c) => c.setHorizontalRule() },
  { title: 'Seite verlinken', keys: 'link verweis [[', icon: LinkSimple, run: (c) => c.insertContent('[[') },
  { title: 'Emoji', keys: 'smiley symbol icon zeichen', icon: Smiley, run: (c, editor) => (emoji(editor), c) },
  { title: 'Tresor-Eintrag', keys: 'vault passwort kennwort bitwarden zugang', icon: Key, run: (c, editor) => (pickVault(editor), c) },
  { title: 'LOP-Liste einbetten', keys: 'lop liste datenbank punkte', icon: ListChecks, run: (c) => c.insertContent({ type: 'lopEmbed', attrs: { id: null } }) },
  { title: 'Datei anhängen', keys: 'anhang datei pdf upload', icon: Paperclip, run: (c, editor) => (attach(editor), c) },
]

// Emoji-Auswahl an der Schreibmarke, das gewählte kommt an dieselbe Stelle
// (Stelle erst danach lesen: das /-Menü löscht "/emoji" erst nach diesem Aufruf)
async function emoji(editor) {
  const r = editor.view.coordsAtPos(editor.state.selection.from)
  const e = await pickEmoji({ x: r.left, y: r.bottom + 6 })
  if (e) editor.chain().focus().insertContent(e).run()
  else editor.commands.focus()
}

const List = forwardRef(function List({ items, command }, ref) {
  const [active, setActive] = useState(0)
  useEffect(() => setActive(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (!items.length) return false
      if (event.key === 'ArrowDown') return setActive((active + 1) % items.length), true
      if (event.key === 'ArrowUp') return setActive((active + items.length - 1) % items.length), true
      if (event.key === 'Enter' || event.key === 'Tab') return command(items[active]), true
      return false
    },
  }))

  if (!items.length) {
    return <div className="w-60 rounded-lg border border-line bg-raised px-3 py-2 text-muted shadow-[var(--shadow)]">Kein Block gefunden</div>
  }
  return (
    <div role="listbox" className="max-h-80 w-60 overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-[var(--shadow)]">
      {items.map((item, i) => (
        <button
          key={item.title}
          role="option"
          aria-selected={i === active}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => (e.preventDefault(), command(item))}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${i === active ? 'bg-hover' : ''}`}
        >
          <item.icon size={18} className="text-muted" />
          {item.title}
        </button>
      ))}
    </div>
  )
})

function place(el, rect) {
  const r = rect?.()
  if (!r) return
  el.style.left = `${Math.min(r.left, innerWidth - el.offsetWidth - 8)}px`
  const below = r.bottom + 6
  el.style.top = `${below + el.offsetHeight > innerHeight - 8 ? r.top - el.offsetHeight - 6 : below}px`
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        items: ({ query }) => {
          const q = query.toLowerCase()
          return ITEMS.filter((i) => `${i.title} ${i.keys}`.toLowerCase().includes(q))
        },
        command: ({ editor, range, props }) => props.run(editor.chain().focus().deleteRange(range), editor).run(),
        render: popup(List),
      }),
    ]
  },
})

// Auswahlliste unter dem Cursor für Suggestion-Plugins (Slash-Menü, Seitenlinks)
export function popup(Component) {
  return () => {
    let view
    return {
      onStart(props) {
        view = new ReactRenderer(Component, { props, editor: props.editor })
        Object.assign(view.element.style, { position: 'fixed', zIndex: 40 })
        view.element.className = 'anim-pop'
        document.body.append(view.element)
        requestAnimationFrame(() => place(view.element, props.clientRect))
      },
      onUpdate(props) {
        view.updateProps(props)
        view.element.style.display = ''
        place(view.element, props.clientRect)
      },
      onKeyDown({ event }) {
        if (event.key === 'Escape') return (view.element.style.display = 'none'), true
        return view.element.style.display !== 'none' && (view.ref?.onKeyDown(event) ?? false)
      },
      onExit() {
        view.element.remove()
        view.destroy()
      },
    }
  }
}

// Dateidialog, danach die gewählten Dateien als Anhänge an der Cursorstelle einfügen
function attach(editor) {
  pickAttachments()
    .then((list) => list.length && editor.chain().focus().insertContent(list.map((attrs) => ({ type: 'attachment', attrs }))).run())
    .catch((e) => alert(`Anhang nicht übernommen: ${e}`))
}
