import { useEffect, useMemo, useState } from 'react'
import { ArrowCounterClockwise, ClockCounterClockwise, PencilSimpleLine, X } from '@phosphor-icons/react'
import * as db from './db.js'
import { collapse, diffLines } from './diff.js'
import { readable } from './free.js'

const when = (iso) => {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today ? `Heute, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

// Verlauf einer Seite: frühere Fassungen des Textes (Unterschied zum jetzigen Stand, Zurückholen) und dazwischen
// alles andere, was sich geändert hat (Umbenennen, Verschieben, Felder, Sperren, Papierkorb …) aus der Tabelle activity
export default function History({ nodeId, current, onRestore, onClose }) {
  const [list, setList] = useState(null)
  const [changes, setChanges] = useState([])
  const [sel, setSel] = useState(null)

  useEffect(() => {
    db.versions(nodeId)
      .then((v) => (setList(v), setSel(v[0] ?? null)))
      .catch(() => setList([]))
    db.activity(nodeId).then((a) => setChanges(a.filter((x) => x.kind === 'change')), () => {})
  }, [nodeId])

  // je Fassung: was danach dazukam und wegfiel (zur nächstneueren, die neueste zum jetzigen Stand); höchstens 30
  const counts = useMemo(() => {
    const out = new Map()
    ;(list ?? []).slice(0, 30).forEach((v, i) => {
      const d = diffLines(readable(v.body), readable(i ? list[i - 1].body : current))
      out.set(v.id, [d.filter((x) => x.type === 'add').length, d.filter((x) => x.type === 'del').length])
    })
    return out
  }, [list, current])
  const timeline = useMemo(
    () => [...(list ?? []).map((v) => ({ ...v, version: true })), ...changes].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [list, changes],
  )

  const diff = useMemo(() => (sel ? collapse(diffLines(readable(sel.body), readable(current))) : []), [sel, current])
  const changed = diff.filter((d) => d.type === 'add' || d.type === 'del').length

  return (
    <aside aria-label="Verlauf" className="anim-panel flex w-[26rem] shrink-0 flex-col border-l border-line bg-side">
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <h2 className="font-semibold">Verlauf</h2>
        <button aria-label="Schließen" onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-text"><X size={16} /></button>
      </div>
      {list === null ? null : !timeline.length ? (
        <p className="px-4 text-muted">Noch nichts im Verlauf. Beim Bearbeiten legt Nexora höchstens alle 10 Minuten eine Fassung an und hebt sie 90 Tage auf; Umbenennen, Verschieben und Felder stehen sofort hier.</p>
      ) : (
        <>
          <ul aria-label="Verlauf" className="max-h-72 shrink-0 overflow-y-auto border-b border-line px-2 pb-2">
            {timeline.map((v) =>
              v.version ? (
                <li key={`v${v.id}`}>
                  <button
                    aria-pressed={sel?.id === v.id}
                    onClick={() => setSel(v)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${sel?.id === v.id ? 'bg-accent-soft' : 'hover:bg-hover'}`}
                  >
                    <ClockCounterClockwise size={14} className="shrink-0 text-faint" />
                    <span className="flex-1">{when(v.created_at)}</span>
                    {counts.has(v.id) && (counts.get(v.id)[0] || counts.get(v.id)[1]) ? (
                      <span className="text-xs tabular-nums" title="Zeilen, die danach dazukamen / wegfielen">
                        <span className="text-accent">+{counts.get(v.id)[0]}</span> <span className="text-danger">−{counts.get(v.id)[1]}</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              ) : (
                <li key={`a${v.id}`} className="flex items-start gap-2 px-2 py-1.5 text-sm">
                  <PencilSimpleLine size={14} className="mt-0.5 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 text-muted">{v.text}</span>
                  <time className="shrink-0 text-xs text-faint">{when(v.created_at)}</time>
                </li>
              ),
            )}
          </ul>
          {sel && (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
                <span className="text-xs text-muted">
                  {changed ? <>Rot nur in dieser Fassung, grün seitdem dazugekommen</> : 'Gleich wie jetzt'}
                </span>
                <button
                  onClick={() => onRestore(sel)}
                  disabled={!changed}
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
