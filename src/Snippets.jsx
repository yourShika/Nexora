import { useEffect, useMemo, useState } from 'react'
import { Check, Code, Copy } from '@phosphor-icons/react'
import * as db from './db.js'
import { View } from './Rows.jsx'
import { LANGUAGES } from './CodeBlock.jsx'
import { norm } from './Search.jsx'
import { codeBlocks } from './runner.js'
export { codeBlocks }

// Alle Codeblöcke aus allen Seiten, nach Sprache und Text filterbar
export default function Snippets({ alive, pathOf, onOpen }) {
  const [items, setItems] = useState(null)
  const [lang, setLang] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    db.pagesWithCode()
      .then((pages) => setItems(pages.filter((p) => alive.has(p.id)).flatMap((p) => codeBlocks(p.body).map((b, i) => ({ ...b, page: p.id, key: `${p.id}-${i}` })))))
      .catch(() => setItems([]))
  }, [alive])

  const langs = useMemo(() => [...new Set((items ?? []).map((i) => i.lang))].sort(), [items])
  const shown = (items ?? []).filter((i) => (!lang || i.lang === lang) && (!q || norm(i.code).includes(norm(q)) || norm(alive.get(i.page)?.title).includes(norm(q))))

  return (
    <View title="Snippets" icon={Code} sub="Alle Codeblöcke aus deinen Seiten">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Code oder Seite suchen"
          aria-label="Snippets durchsuchen"
          className="w-64 rounded-md border border-line bg-raised px-3 py-1.5 outline-none focus:border-accent"
        />
        {['', ...langs].map((l) => (
          <button
            key={l || 'alle'}
            onClick={() => setLang(l)}
            className={`rounded-md px-2.5 py-1 ${lang === l ? 'bg-accent-soft text-text' : 'text-muted hover:bg-hover hover:text-text'}`}
          >
            {l ? LANGUAGES[l] ?? l : 'Alle'}
          </button>
        ))}
      </div>
      {items === null ? null : shown.length ? (
        <ul className="space-y-3">
          {shown.map((s) => <Snippet key={s.key} s={s} path={pathOf(s.page)} onOpen={() => onOpen(s.page)} />)}
        </ul>
      ) : (
        <p className="text-muted">{items.length ? 'Nichts gefunden.' : 'Noch keine Codeblöcke. Tippe in einer Seite / und wähle Code.'}</p>
      )}
    </View>
  )
}

function Snippet({ s, path, onOpen }) {
  const [copied, setCopied] = useState(false)
  const lines = s.code.split('\n')
  return (
    <li className="overflow-hidden rounded-lg border border-line bg-[var(--code-bg)]">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-xs">
        <span className="font-medium text-muted">{LANGUAGES[s.lang] ?? s.lang}</span>
        <button onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-faint hover:text-accent">
          {path.map((p) => p.title || 'Ohne Titel').join(' / ')}
        </button>
        <button
          onClick={() => navigator.clipboard.writeText(s.code).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-muted hover:bg-hover hover:text-text"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Kopiert' : 'Kopieren'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2 font-mono text-xs leading-5">
        {lines.slice(0, 8).join('\n')}
        {lines.length > 8 && <span className="text-faint">{`\n… ${lines.length - 8} weitere Zeilen`}</span>}
      </pre>
    </li>
  )
}
