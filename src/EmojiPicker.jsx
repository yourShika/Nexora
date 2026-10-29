import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Menu from './Menu.jsx'

// Gruppen von emojibase (2 = Hautfarben-Bausteine, nicht einzeln wählbar)
const GROUPS = [[0, 'Smileys & Emotionen', '😀'], [1, 'Menschen & Körper', '👋'], [3, 'Tiere & Natur', '🐻'], [4, 'Essen & Trinken', '🍎'], [5, 'Reisen & Orte', '🚗'], [6, 'Aktivitäten', '⚽'], [7, 'Gegenstände', '💡'], [8, 'Symbole', '❤️'], [9, 'Flaggen', '🏁']]
const COLS = 9
const RECENT = 'nexora-emoji-zuletzt'

// Deutsche Namen und Stichwörter erst beim ersten Öffnen laden (eigene Datei im Paket).
// shortcut: nur bis Emoji 15, neuere zeigt die Windows-Schrift als Kästchen; anheben, wenn Windows sie kann
let cache = null
const load = async () =>
  (cache ??= (await import('emojibase-data/de/data.json')).default
    .filter((e) => e.group != null && e.group !== 2 && (e.version ?? 0) <= 15)
    .sort((a, b) => a.order - b.order))

const recent = () => {
  try {
    return JSON.parse(localStorage.getItem(RECENT) || '[]')
  } catch {
    return []
  }
}

// Emoji-Auswahl im Nexora-Stil statt Win+. : Suche ("drucker", "schloss"), Gruppen, zuletzt benutzte.
// Enter im Suchfeld nimmt den ersten Treffer, Pfeiltasten wandern durch das Raster
export function EmojiPicker({ onPick }) {
  const [list, setList] = useState(cache)
  const [q, setQ] = useState('')
  const [hover, setHover] = useState(null)
  const area = useRef(null)
  useEffect(() => {
    if (!list) load().then(setList).catch(() => setList([]))
  }, [])

  const needle = q.trim().toLowerCase()
  // genauer Name oder Stichwort zuerst, dann Wortanfang, zuletzt irgendwo im Namen ("schloss" vor "geschlossen")
  const score = (e) => {
    const l = e.label.toLowerCase()
    if (l === needle || e.tags?.includes(needle)) return 0
    if (l.split(/[\s-]+/).some((w) => w.startsWith(needle))) return 1
    if (e.tags?.some((t) => t.startsWith(needle))) return 2
    return l.includes(needle) ? 3 : null
  }
  const hits = list && needle ? list.map((e) => [score(e), e]).filter(([s]) => s !== null).sort((a, b) => a[0] - b[0]).slice(0, 180).map(([, e]) => e) : null
  const last = list ? recent().map((ch) => list.find((e) => e.emoji === ch)).filter(Boolean) : []

  const pick = (e) => {
    try {
      localStorage.setItem(RECENT, JSON.stringify([e.emoji, ...recent().filter((x) => x !== e.emoji)].slice(0, 2 * COLS)))
    } catch {}
    onPick(e.emoji)
  }
  function grid(e) {
    const all = [...area.current.querySelectorAll('[data-emoji]')]
    const i = all.indexOf(document.activeElement)
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLS, ArrowDown: COLS }[e.key]
    if (i < 0 || !step) return
    e.preventDefault()
    all[Math.min(all.length - 1, Math.max(0, i + step))]?.focus()
  }
  const cell = (e) => (
    <button
      key={e.hexcode}
      data-emoji
      aria-label={e.label}
      title={e.label}
      onClick={() => pick(e)}
      onMouseEnter={() => setHover(e)}
      onFocus={() => setHover(e)}
      className="grid size-8 place-items-center rounded text-xl hover:bg-hover focus:bg-hover focus:outline-none"
    >
      {e.emoji}
    </button>
  )
  const section = (title, items, id) =>
    items.length > 0 && (
      <section key={title} data-group={id}>
        <h3 className="sticky top-0 z-10 bg-raised/95 px-1 py-1 text-xs font-medium text-faint">{title}</h3>
        <div role="group" aria-label={title} className="grid grid-cols-9">{items.map(cell)}</div>
      </section>
    )

  return (
    <div className="w-[19.5rem] p-1">
      <input
        data-autofocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits?.[0]) (e.preventDefault(), pick(hits[0]))
          if (e.key === 'ArrowDown') (e.preventDefault(), area.current.querySelector('[data-emoji]')?.focus())
        }}
        placeholder="Emoji suchen, z. B. drucker"
        aria-label="Emoji suchen"
        className="mb-1 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
      {!needle && (
        <div className="mb-1 flex justify-between" role="group" aria-label="Gruppen">
          {GROUPS.map(([id, name, icon]) => (
            <button key={id} aria-label={name} title={name} onClick={() => area.current.querySelector(`[data-group="${id}"]`)?.scrollIntoView({ block: 'start' })} className="grid size-8 place-items-center rounded text-base opacity-70 hover:bg-hover hover:opacity-100">
              {icon}
            </button>
          ))}
        </div>
      )}
      <div ref={area} onKeyDown={grid} className="h-64 overflow-y-auto">
        {!list ? (
          <p className="p-3 text-sm text-muted">Lädt …</p>
        ) : hits ? (
          hits.length ? <div role="group" aria-label="Treffer" className="grid grid-cols-9">{hits.map(cell)}</div> : <p className="p-3 text-sm text-muted">Nichts gefunden.</p>
        ) : (
          [section('Zuletzt benutzt', last, 'zuletzt'), ...GROUPS.map(([id, name]) => section(name, list.filter((e) => e.group === id), id))]
        )}
      </div>
      <div className="flex h-9 items-center gap-2 border-t border-line px-1 pt-1 text-sm text-muted">
        {hover && <span className="text-2xl leading-none">{hover.emoji}</span>}
        <span className="truncate">{hover?.label ?? 'Emoji wählen'}</span>
      </div>
    </div>
  )
}

// Für das /-Menü: Auswahl an der Schreibmarke öffnen; liefert das Emoji oder null (Esc, daneben geklickt)
export function pickEmoji({ x, y }) {
  return new Promise((resolve) => {
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    const done = (emoji) => {
      root.unmount()
      host.remove()
      resolve(emoji)
    }
    root.render(
      <Menu x={x} y={y} onClose={() => done(null)} role="dialog" label="Emoji einfügen">
        <EmojiPicker onPick={done} />
      </Menu>,
    )
  })
}
