import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { UserPlus } from '@phosphor-icons/react'
import { popup } from './SlashMenu.jsx'
import { useApp } from './ctx.js'
import { chipHex } from './fields.js'
import { colorOf, initials } from './people.js'
import { findMentions, mentionData, personHits, textParts } from './mentions.js'
import { tokenAt } from './quick.js'

// Erwähnen mit @ (LOP-060): im Editor nur Darstellung als Chip (Dekoration), der Text bleibt "@Name"
const names = () => mentionData().people.map((p) => p.name)
const hexOf = (people, name) => chipHex(colorOf(people.find((p) => p.name === name) ?? { name }))
const inCode = (node) => node.type.spec.code || node.marks?.some((m) => m.type.spec.code)

function chips(doc) {
  const { people } = mentionData()
  const list = people.map((p) => p.name)
  const decos = []
  if (list.length)
    doc.descendants((node, pos) => {
      if (node.type.spec.code) return false
      if (!node.isText || inCode(node)) return
      for (const m of findMentions(node.text, list))
        decos.push(Decoration.inline(pos + m.from, pos + m.to, { class: 'mention', 'data-person': m.name, style: `--chip: ${hexOf(people, m.name)}`, title: `${m.name} · Strg+Klick zeigt alle Stellen` }))
    })
  return DecorationSet.create(doc, decos)
}

export const Mentions = Extension.create({
  name: 'mentions',
  addProseMirrorPlugins() {
    let last = { doc: null, key: '', set: DecorationSet.empty }
    return [
      new Plugin({
        key: new PluginKey('mentionChips'),
        props: {
          decorations(state) {
            const key = mentionData().people.map((p) => `${p.name}:${p.color ?? ''}`).join('|')
            if (last.doc !== state.doc || last.key !== key) last = { doc: state.doc, key, set: chips(state.doc) }
            return last.set
          },
          // wie Links: beim Schreiben Strg+Klick, auf gesperrten Seiten ein einfacher Klick
          handleClick(view, pos, event) {
            const el = event.target.closest?.('.mention')
            if (!el || (view.editable && !(event.ctrlKey || event.metaKey))) return false
            mentionData().find(el.dataset.person)
            return true
          },
        },
      }),
      Suggestion({
        editor: this.editor,
        char: '@',
        pluginKey: new PluginKey('mentionSuggest'),
        allow: ({ state, range }) => {
          const $at = state.doc.resolve(range.from)
          return !$at.parent.type.spec.code && !$at.marks().some((m) => m.type.spec.code)
        },
        items: ({ query }) => personHits(names(), query),
        command: ({ editor, range, props }) => {
          if (props.isNew) mentionData().add(props.name)
          editor.chain().focus().insertContentAt(range, [{ type: 'text', text: `@${props.name} ` }]).run()
        },
        render: popup(PersonPopup),
      }),
    ]
  },
})

// Auswahlliste der Personen, für den Editor und für Eingabefelder
function Hits({ items, active, onActive, onPick, style }) {
  const app = useApp()
  const people = app?.people ?? []
  return (
    <ul role="listbox" aria-label="Personen" style={style} onMouseDown={(e) => e.preventDefault()} className="anim-pop w-64 rounded-lg border border-line bg-raised p-1 text-sm shadow-[var(--shadow)]">
      {items.length ? (
        items.map((h, i) => (
          <li key={`${h.isNew ? '+' : ''}${h.name}`} role="option" aria-selected={i === active} onMouseEnter={() => onActive(i)} onClick={() => onPick(h)} className={`flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 ${i === active ? 'bg-hover' : ''}`}>
            {h.isNew ? (
              <UserPlus size={16} className="shrink-0 text-muted" />
            ) : (
              <span style={{ background: hexOf(people, h.name) }} className="grid size-5 shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white">{initials(h.name)}</span>
            )}
            <span className="min-w-0 flex-1 truncate">{h.isNew ? `Neue Person: ${h.name}` : h.name}</span>
          </li>
        ))
      ) : (
        <li className="px-2 py-1.5 text-muted">Namen tippen für eine neue Person</li>
      )}
    </ul>
  )
}

const PersonPopup = forwardRef(function PersonPopup({ items, command }, ref) {
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
  return <Hits items={items} active={active} onActive={setActive} onPick={command} />
})

// @-Vorschläge für ein Eingabefeld oder Textfeld: ref, onSelect/onChange → track, onKeyDown → keyDown zuerst, onBlur → close.
// Die Liste hängt am Fenster (fixed), damit Tabellen mit Scrollbereich sie nicht abschneiden
export function useMentionInput(value, onValue) {
  const app = useApp()
  const ref = useRef(null)
  const [caret, setCaret] = useState(null)
  const [active, setActive] = useState(0)
  const [off, setOff] = useState(false)
  const token = caret === null || off ? null : tokenAt(value, caret)
  const hits = token?.sign === '@' ? personHits((app?.people ?? []).map((p) => p.name), token.query) : []
  function pick(hit) {
    if (hit.isNew) mentionData().add(hit.name)
    const insert = `@${hit.name} `
    onValue(value.slice(0, token.start) + insert + value.slice(caret))
    const at = token.start + insert.length
    setCaret(at)
    setActive(0)
    requestAnimationFrame(() => ref.current?.setSelectionRange(at, at))
  }
  const track = (e) => (setCaret(e.target.selectionStart ?? e.target.value.length), setOff(false))
  function keyDown(e) {
    if (!hits.length) return false
    const n = Math.min(active, hits.length - 1)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setActive((n + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length)
    else if (e.key === 'Enter' || e.key === 'Tab') pick(hits[n])
    else if (e.key === 'Escape') (setOff(true), e.stopPropagation())
    else return false
    e.preventDefault()
    return true
  }
  const r = hits.length ? ref.current?.getBoundingClientRect() : null
  const list = r && createPortal(<Hits items={hits} active={Math.min(active, hits.length - 1)} onActive={setActive} onPick={pick} style={{ position: 'fixed', left: r.left, top: r.bottom + 4, zIndex: 40 }} />, document.body)
  return { ref, track, keyDown, list, close: () => setCaret(null) }
}

// Text mit klickbaren Links und Personen-Chips (Kommentare)
export function RichText({ text }) {
  const app = useApp()
  const people = app?.people ?? []
  return textParts(text, people.map((p) => p.name)).map((p, i) =>
    p.url ? (
      <a key={i} href={p.url} className="text-accent underline">{p.text}</a>
    ) : p.person ? (
      <button key={i} type="button" onClick={() => app.findPerson(p.person)} title={`${p.person} · alle Stellen zeigen`} style={{ '--chip': hexOf(people, p.person) }} className="mention">
        {p.text}
      </button>
    ) : (
      p.text
    ),
  )
}
