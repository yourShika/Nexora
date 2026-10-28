import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, MagnifyingGlass } from '@phosphor-icons/react'
import * as db from './db.js'
import { NodeIcon } from './Sidebar.jsx'
import { fieldsOf, option, statusField } from './fields.js'

export const norm = (s) => (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

// "#tag @person status:offen in:exchange rest" -> Filter + Suchwörter
export function parseSearch(q) {
  const f = { tags: [], text: [] }
  for (const tok of q.trim().split(/\s+/).filter(Boolean)) {
    if (/^#./.test(tok)) f.tags.push(norm(tok.slice(1)))
    else if (/^@./.test(tok)) f.person = norm(tok.slice(1))
    else if (/^status:./i.test(tok)) f.status = norm(tok.slice(7))
    else if (/^in:./i.test(tok)) f.in = norm(tok.slice(3))
    else f.text.push(norm(tok))
  }
  return f
}

// FTS5-Ausdruck: trigram braucht mindestens 3 Zeichen pro Wort
export const ftsQuery = (words) => words.filter((w) => w.length >= 3).map((w) => `"${w.replace(/"/g, '""')}"`).join(' ')

const hasFilters = (f) => f.tags.length || f.person || f.status || f.in

export default function Search({ tree, pathOf, commands, onOpen, onClose }) {
  const [q, setQ] = useState('')
  const [fts, setFts] = useState([])
  const [active, setActive] = useState(0)
  const list = useRef(null)
  const f = useMemo(() => parseSearch(q), [q])

  // Volltext leicht verzögert, damit nicht jeder Tastendruck die Datenbank fragt
  useEffect(() => {
    const match = ftsQuery(f.text)
    if (!match) return setFts([])
    let alive = true
    const t = setTimeout(() => db.search(match).then((r) => alive && setFts(r)).catch(() => alive && setFts([])), 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [f])

  const results = useMemo(() => {
    const nodes = [...tree.alive.values()]
    const dbOf = (n) => (n.kind === 'row' ? tree.alive.get(n.parent_id) : null)
    const passes = (n) => {
      if (f.tags.length && !f.tags.every((t) => (n.props?.tags ?? []).some((x) => norm(x) === t))) return false
      if (f.person && !norm(n.props?.person).includes(f.person)) return false
      if (f.status) {
        const o = option(statusField(fieldsOf(dbOf(n))), n.props?.status)
        if (n.kind !== 'row' || !o || !(norm(o.name).startsWith(f.status) || norm(o.id).startsWith(f.status))) return false
      }
      if (f.in && !pathOf(n.id).slice(0, -1).some((p) => norm(p.title).includes(f.in))) return false
      return true
    }

    const cmds = commands.filter((c) => !hasFilters(f) && f.text.every((w) => norm(c.label).includes(w)))
    if (!f.text.length && !hasFilters(f)) {
      const recent = nodes.filter((n) => n.opened_at && n.kind !== 'notebook').sort((a, b) => b.opened_at.localeCompare(a.opened_at)).slice(0, 8)
      return [...recent.map((n) => ({ node: n })), ...cmds.map((c) => ({ cmd: c }))]
    }
    const byTitle = nodes
      .filter((n) => f.text.every((w) => norm(n.title).includes(w)) && passes(n))
      .sort((a, b) => Number(!norm(b.title).startsWith(f.text[0] ?? '')) - Number(!norm(a.title).startsWith(f.text[0] ?? '')) || b.updated_at.localeCompare(a.updated_at))
    const seen = new Set(byTitle.map((n) => n.id))
    const byText = fts
      .filter((r) => !seen.has(r.id) && tree.alive.has(r.id) && passes(tree.alive.get(r.id)))
      .map((r) => ({ node: tree.alive.get(r.id), snip: r.snip }))
    return [...cmds.map((c) => ({ cmd: c })), ...byTitle.slice(0, 30).map((n) => ({ node: n })), ...byText].slice(0, 50)
  }, [f, fts, tree, pathOf, commands])

  useEffect(() => setActive(0), [results.length, q])
  useEffect(() => {
    list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = (r) => {
    onClose()
    r.cmd ? r.cmd.run() : onOpen(r.node.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-[rgb(10_20_22/0.35)] pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Suchen" className="flex h-fit max-h-[70vh] w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-[var(--shadow)]">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <MagnifyingGlass size={18} className="shrink-0 text-muted" />
          <input
            autoFocus
            value={q}
            aria-label="Suchbegriff"
            placeholder="Seiten, Punkte, Code und Befehle durchsuchen"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') e.preventDefault(), setActive((a) => Math.min(a + 1, results.length - 1))
              if (e.key === 'ArrowUp') e.preventDefault(), setActive((a) => Math.max(a - 1, 0))
              if (e.key === 'Enter' && results[active]) choose(results[active])
              if (e.key === 'Escape') onClose()
            }}
            className="h-12 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint focus-visible:outline-none"
          />
        </div>
        <ul ref={list} role="listbox" aria-label="Treffer" className="overflow-y-auto p-1.5">
          {!q && results.length > 0 && <li className="px-2.5 pb-1 pt-1.5 text-xs text-faint">Zuletzt geöffnet</li>}
          {results.map((r, i) => (
            <li
              key={r.cmd?.label ?? r.node.id}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(r)}
              className={`flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2 ${i === active ? 'bg-hover' : ''}`}
            >
              {r.cmd ? (
                <>
                  <ArrowRight size={16} className="mt-0.5 shrink-0 text-accent" />
                  <span className="flex-1">{r.cmd.label}</span>
                  <span className="text-xs text-faint">Befehl</span>
                </>
              ) : (
                <>
                  <span className="mt-0.5 shrink-0"><NodeIcon node={r.node} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.node.title || 'Ohne Titel'}</span>
                    <span className="block truncate text-xs text-faint">
                      {r.node.kind === 'row' && !r.node.parent_id ? 'Eingang' : pathOf(r.node.id).slice(0, -1).map((p) => p.title || 'Ohne Titel').join(' / ')}
                    </span>
                    {r.snip?.includes('\u0001') && <Snippet text={r.snip} />}
                  </span>
                </>
              )}
            </li>
          ))}
          {q && !results.length && <li className="px-3 py-6 text-center text-muted">Nichts gefunden</li>}
        </ul>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs text-faint">
          <span>#tag</span><span>@person</span><span>status:offen</span><span>in:Liste</span>
          <span className="flex-1" />
          <span>↑↓ wählen, Enter öffnen, Esc schließen</span>
        </div>
      </div>
    </div>
  )
}

// Markdown-Zeichen raus, Treffer (zwischen \u0001 und \u0002) hervorheben
function Snippet({ text }) {
  const clean = text.replace(/[#*`>_|]|\[[ xX]\]/g, '').replace(/\s+/g, ' ')
  return (
    <span className="mt-0.5 block truncate text-xs text-muted">
      {clean.split(/(\u0001[^\u0002]*\u0002)/).map((part, i) =>
        part.startsWith('\u0001') ? <mark key={i} className="rounded-sm bg-accent-soft text-text">{part.slice(1, -1)}</mark> : part,
      )}
    </span>
  )
}
