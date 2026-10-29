import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Code, MagnifyingGlass } from '@phosphor-icons/react'
import * as db from './db.js'
import { codeBlocks, fill, placeholders } from './runner.js'
import { VaultUnlock, vault } from './Vault.jsx'

const norm = (s) => (s ?? '').toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '')

// Snippet-Picker (Strg+Alt+S): über jedem Programm einen Codeblock suchen und ins vorher aktive Fenster einfügen
export default function Picker() {
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [ask, setAsk] = useState(null) // Platzhalter: { code, names, values }
  const [unlock, setUnlock] = useState(null) // { status, code }
  const [error, setError] = useState('')
  const input = useRef(null)
  const hide = () => getCurrentWindow().hide()

  async function load() {
    const [pages, all] = await Promise.all([db.pagesWithCode(), db.allNodes()])
    const alive = new Map(all.filter((n) => !n.deleted_at).map((n) => [n.id, n]))
    setItems(pages.filter((p) => alive.has(p.id)).flatMap((p) => codeBlocks(p.body).map((b, i) => ({ ...b, title: alive.get(p.id).title || 'Ohne Titel', key: `${p.id}-${i}` }))))
  }
  // Bei jedem Öffnen frisch laden und von vorn anfangen
  useEffect(() => {
    const reset = () => (load().catch((e) => setError(String(e))), setQ(''), setActive(0), setAsk(null), setUnlock(null), setError(''), setTimeout(() => input.current?.focus(), 30))
    reset()
    addEventListener('focus', reset)
    return () => removeEventListener('focus', reset)
  }, [])

  const shown = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean)
    return items.filter((i) => words.every((w) => norm(`${i.title} ${i.lang} ${i.code}`).includes(w))).slice(0, 60)
  }, [items, q])

  async function paste(code) {
    setError('')
    if (code.includes('{{vault:')) {
      const s = await vault.status().catch(() => null)
      if (s?.status === 'locked') return setUnlock({ status: s, code })
      if (s?.status !== 'unlocked') return setError('Der Codeblock braucht den Tresor; der ist auf diesem PC nicht eingerichtet (Einstellungen → Tresor).')
    }
    invoke('picker_paste', { text: code }).catch((e) => setError(String(e)))
  }

  async function choose(item) {
    const names = placeholders(item.code)
    if (!names.length) return paste(item.code)
    let last = {}
    try {
      last = JSON.parse((await db.getSetting('placeholders')) || '{}')
    } catch {}
    setAsk({ code: item.code, names, values: Object.fromEntries(names.map((n) => [n, last[n] ?? ''])) })
  }

  async function fillAndPaste(e) {
    e.preventDefault()
    const { code, values } = ask
    db.getSetting('placeholders')
      .then((s) => db.setSetting('placeholders', JSON.stringify({ ...JSON.parse(s || '{}'), ...values })))
      .catch(() => {})
    setAsk(null)
    paste(fill(code, values))
  }

  function keys(e) {
    if (e.key === 'Escape') return hide()
    if (!shown.length) return
    if (e.key === 'ArrowDown') e.preventDefault(), setActive((active + 1) % shown.length)
    if (e.key === 'ArrowUp') e.preventDefault(), setActive((active + shown.length - 1) % shown.length)
    if (e.key === 'Enter') e.preventDefault(), choose(shown[Math.min(active, shown.length - 1)])
  }

  if (unlock) return <VaultUnlock status={unlock.status} onDone={(ok) => (setUnlock(null), ok ? paste(unlock.code) : input.current?.focus())} />

  return (
    <div className="flex h-screen flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-[var(--shadow)]">
      {ask ? (
        <form onSubmit={fillAndPaste} onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setAsk(null))} className="flex flex-col gap-3 p-4">
          <p className="font-semibold">Platzhalter ausfüllen</p>
          {ask.names.map((n, i) => (
            <label key={n} className="flex flex-col gap-1 text-sm text-muted">
              {n}
              <input
                autoFocus={i === 0}
                value={ask.values[n]}
                onChange={(e) => setAsk({ ...ask, values: { ...ask.values, [n]: e.target.value } })}
                className="rounded-md border border-line bg-bg px-3 py-1.5 text-text outline-none focus:border-accent"
              />
            </label>
          ))}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAsk(null)} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Zurück</button>
            <button className="rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-bg">Einfügen</button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-line px-4">
            <MagnifyingGlass size={18} className="shrink-0 text-muted" />
            <input
              ref={input}
              value={q}
              onChange={(e) => (setQ(e.target.value), setActive(0))}
              onKeyDown={keys}
              placeholder="Snippet suchen, Enter fügt ein, Esc schließt"
              aria-label="Snippet suchen"
              className="h-12 flex-1 bg-transparent outline-none placeholder:text-faint"
            />
          </div>
          <ul role="listbox" aria-label="Snippets" className="flex-1 overflow-y-auto p-1">
            {shown.map((i, n) => (
              <li key={i.key}>
                <button
                  role="option"
                  aria-selected={n === active}
                  onMouseEnter={() => setActive(n)}
                  onClick={() => choose(i)}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left ${n === active ? 'bg-hover' : ''}`}
                >
                  <code className="w-full truncate font-mono text-sm">{i.code.split('\n').find((l) => l.trim()) ?? ''}</code>
                  <span className="flex items-center gap-1.5 text-xs text-muted">
                    <Code size={12} /> {i.title} · {i.lang}
                    {i.code.includes('{{') && <span className="text-accent">· Platzhalter</span>}
                  </span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="px-3 py-6 text-center text-muted">{items.length ? 'Nichts gefunden.' : 'Noch keine Codeblöcke in deinen Seiten.'}</li>}
          </ul>
          {error && <p className="border-t border-line px-4 py-2 text-sm text-danger">{error}</p>}
        </>
      )}
    </div>
  )
}
