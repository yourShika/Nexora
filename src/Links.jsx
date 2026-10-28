import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Extension, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { ListChecks } from '@phosphor-icons/react'
import { popup } from './SlashMenu.jsx'
import { NodeIcon } from './Sidebar.jsx'
import { QuickAdd, RowItem } from './Rows.jsx'
import { useApp } from './ctx.js'
import { fieldsOf, isDone } from './fields.js'
import { norm } from './Search.jsx'

// Aktueller Stand der Knoten für Markdown und Vorschläge (setzt App bei jeder Änderung)
let data = { get: () => null, list: () => [] }
export const setLinkData = (d) => (data = d)

const ID = '[0-9a-f-]{36}'

// Seitenlink: [[Titel|id]]; angezeigt wird immer der aktuelle Titel
export const PageLink = Node.create({
  name: 'pageLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ id: { default: null }, title: { default: '' } }),
  parseHTML: () => [{ tag: 'span[data-page-link]', getAttrs: (el) => ({ id: el.dataset.pageLink, title: el.textContent }) }],
  renderHTML: ({ node }) => ['span', { 'data-page-link': node.attrs.id }, node.attrs.title],
  markdownTokenName: 'pageLink',
  markdownTokenizer: {
    name: 'pageLink',
    level: 'inline',
    start: (src) => src.indexOf('[['),
    tokenize(src) {
      const m = new RegExp(`^\\[\\[([^\\]|\\n]*)\\|(${ID})\\]\\]`).exec(src)
      if (m) return { type: 'pageLink', raw: m[0], title: m[1], id: m[2] }
    },
  },
  parseMarkdown: (token, h) => h.createNode('pageLink', { id: token.id, title: token.title }),
  renderMarkdown: ({ attrs }) => `[[${(data.get(attrs.id)?.title || attrs.title || 'Ohne Titel').replace(/[|\]\n]/g, ' ')}|${attrs.id}]]`,
  addNodeView: () => ReactNodeViewRenderer(PageLinkView),
})

function PageLinkView({ node }) {
  const app = useApp()
  const target = app?.alive.get(node.attrs.id)
  return (
    <NodeViewWrapper as="span" className="pagelink">
      <button
        contentEditable={false}
        onClick={() => target && app.open(target.id)}
        title={target ? 'Seite öffnen' : 'Diese Seite gibt es nicht mehr (Papierkorb?)'}
        className={`inline-flex items-center gap-1 rounded px-1 align-baseline ${target ? 'text-accent hover:bg-accent-soft' : 'text-faint line-through'}`}
      >
        {target && <NodeIcon node={target} size={14} />}
        <span className="underline decoration-accent/40 underline-offset-2">{target?.title || node.attrs.title || 'Ohne Titel'}</span>
      </button>
    </NodeViewWrapper>
  )
}

const LinkList = forwardRef(function LinkList({ items, command }, ref) {
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
  return (
    <div role="listbox" className="max-h-80 w-80 overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-[var(--shadow)]">
      {items.length ? items.map((n, i) => (
        <button
          key={n.id}
          role="option"
          aria-selected={i === active}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => (e.preventDefault(), command(n))}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left ${i === active ? 'bg-hover' : ''}`}
        >
          <NodeIcon node={n} />
          <span className="min-w-0 flex-1 truncate">{n.title || 'Ohne Titel'}</span>
        </button>
      )) : <p className="px-2 py-1.5 text-muted">Keine passende Seite</p>}
    </div>
  )
})

// "[[" öffnet die Seitenauswahl
export const PageLinkSuggest = Extension.create({
  name: 'pageLinkSuggest',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '[[',
        allowSpaces: true,
        // eigener Schlüssel, sonst kollidiert das Plugin mit dem Slash-Menü
        pluginKey: new PluginKey('pageLinkSuggest'),
        items: ({ query }) => {
          const q = norm(query)
          return data.list().filter((n) => ['page', 'database', 'row', 'section'].includes(n.kind) && norm(n.title).includes(q)).slice(0, 30)
        },
        command: ({ editor, range, props }) =>
          editor.chain().focus().insertContentAt(range, [{ type: 'pageLink', attrs: { id: props.id, title: props.title } }, { type: 'text', text: ' ' }]).run(),
        render: popup(LinkList),
      }),
    ]
  },
})

// Eingebettete LOP-Liste: eigene Zeile [[lop:id]] bzw. [[lop:id|alle]]
export const LopEmbed = Node.create({
  name: 'lopEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ id: { default: null }, filter: { default: 'offen' } }),
  parseHTML: () => [{ tag: 'div[data-lop]', getAttrs: (el) => ({ id: el.dataset.lop || null }) }],
  renderHTML: ({ node }) => ['div', { 'data-lop': node.attrs.id ?? '' }],
  markdownTokenName: 'lopEmbed',
  markdownTokenizer: {
    name: 'lopEmbed',
    level: 'block',
    start: (src) => src.indexOf('[[lop:'),
    tokenize(src) {
      const m = new RegExp(`^\\[\\[lop:(${ID})(?:\\|(alle))?\\]\\](?:\\n|$)`).exec(src)
      if (m) return { type: 'lopEmbed', raw: m[0], id: m[1], filter: m[2] ? 'alle' : 'offen' }
    },
  },
  parseMarkdown: (token, h) => h.createNode('lopEmbed', { id: token.id, filter: token.filter }),
  renderMarkdown: ({ attrs }) => (attrs.id ? `[[lop:${attrs.id}${attrs.filter === 'alle' ? '|alle' : ''}]]` : ''),
  addNodeView: () => ReactNodeViewRenderer(LopEmbedView),
})

function LopEmbedView({ node, updateAttributes, editor }) {
  const app = useApp()
  if (!app) return <NodeViewWrapper />
  const list = app.alive.get(node.attrs.id)

  if (!list || list.kind !== 'database') {
    return (
      <NodeViewWrapper className="my-3 rounded-lg border border-dashed border-line p-3" contentEditable={false}>
        <label className="flex items-center gap-2 text-muted">
          <ListChecks size={18} /> Welche Liste soll hier stehen?
          <select
            value=""
            disabled={!editor.isEditable}
            onChange={(e) => updateAttributes({ id: e.target.value })}
            className="rounded-md border border-line bg-raised px-2 py-1 text-text"
          >
            <option value="">Liste wählen</option>
            {app.databases.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </label>
      </NodeViewWrapper>
    )
  }

  const fields = fieldsOf(list)
  const rows = app.rowsOf(list.id).filter((r) => node.attrs.filter === 'alle' || !isDone(r, fields))
  return (
    <NodeViewWrapper className="my-4 rounded-lg border border-line" contentEditable={false} data-drag-handle>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button onClick={() => app.open(list.id)} className="flex min-w-0 items-center gap-2 font-medium hover:text-accent">
          <NodeIcon node={list} /> <span className="truncate">{list.title || 'Ohne Titel'}</span>
        </button>
        <span className="text-xs text-faint">{rows.length}</span>
        <span className="flex-1" />
        <button
          onClick={() => updateAttributes({ filter: node.attrs.filter === 'alle' ? 'offen' : 'alle' })}
          disabled={!editor.isEditable}
          className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-hover hover:text-text"
        >
          {node.attrs.filter === 'alle' ? 'Alle Punkte' : 'Nur offene'}
        </button>
      </div>
      {rows.length > 0 && (
        <ul className="divide-y divide-line">
          {rows.map((r) => <RowItem key={r.id} row={r} db={list} onOpen={app.open} onToggle={app.toggleRow} />)}
        </ul>
      )}
      <div className="px-3 pt-3">
        <QuickAdd onAdd={(title, props) => app.addRow(list.id, title, props)} />
      </div>
    </NodeViewWrapper>
  )
}
