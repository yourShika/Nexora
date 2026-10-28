import { useEffect, useMemo, useState } from 'react'
import { ArrowCounterClockwise, X } from '@phosphor-icons/react'
import * as db from './db.js'
import { collapse, diffLines } from './diff.js'

const when = (iso) => {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today ? `Heute, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

// Frühere Fassungen einer Seite: Unterschied zum jetzigen Stand und Zurückholen
export default function History({ nodeId, current, onRestore, onClose }) {
  const [list, setList] = useState(null)
  const [sel, setSel] = useState(null)

  useEffect(() => {
    db.versions(nodeId)
      .then((v) => (setList(v), setSel(v[0] ?? null)))
      .catch(() => setList([]))
  }, [nodeId])

  const diff = useMemo(() => (sel ? collapse(diffLines(sel.body, current)) : []), [sel, current])
  const changes = diff.filter((d) => d.type === 'add' || d.type === 'del').length

  return (
    <aside aria-label="Verlauf" className="anim-panel flex w-[26rem] shrink-0 flex-col border-l border-line bg-side">
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <h2 className="font-semibold">Verlauf</h2>
        <button aria-label="Schließen" onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-text"><X size={16} /></button>
      </div>
      {list === null ? null : !list.length ? (
        <p className="px-4 text-muted">Noch keine früheren Fassungen. Beim Bearbeiten legt Nexora höchstens alle 10 Minuten eine an und hebt sie 90 Tage auf.</p>
      ) : (
        <>
          <ul role="listbox" aria-label="Fassungen" className="max-h-56 shrink-0 overflow-y-auto border-b border-line px-2 pb-2">
            {list.map((v) => (
              <li key={v.id}>
                <button
                  role="option"
                  aria-selected={sel?.id === v.id}
                  onClick={() => setSel(v)}
                  className={`w-full rounded-md px-2 py-1.5 text-left ${sel?.id === v.id ? 'bg-accent-soft' : 'hover:bg-hover'}`}
                >
                  {when(v.created_at)}
                </button>
              </li>
            ))}
          </ul>
          {sel && (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
                <span className="text-xs text-muted">
                  {changes ? <>Rot nur in dieser Fassung, grün seitdem dazugekommen</> : 'Gleich wie jetzt'}
                </span>
                <button
                  onClick={() => onRestore(sel)}
                  disabled={!changes}
                  className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-medium text-white disabled:opacity-50 dark:text-bg"
                >
                  <ArrowCounterClockwise size={15} /> Wiederherstellen
                </button>
              </div>
              <pre className="flex-1 overflow-auto px-2 pb-6 font-mono text-xs leading-5">
                {diff.map((d, i) =>
                  d.type === 'gap' ? (
                    <div key={i} className="px-2 py-0.5 text-faint">… {d.count} unveränderte Zeilen</div>
                  ) : (
                    <div
                      key={i}
                      className={`whitespace-pre-wrap break-words px-2 ${d.type === 'del' ? 'bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-danger' : d.type === 'add' ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : 'text-muted'}`}
                    >
                      {d.type === 'del' ? '− ' : d.type === 'add' ? '+ ' : '  '}{d.text || ' '}
                    </div>
                  ),
                )}
              </pre>
            </>
          )}
        </>
      )}
    </aside>
  )
}
