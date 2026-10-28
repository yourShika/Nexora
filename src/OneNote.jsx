import { useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { listNotebooks } from './onenote.js'

// Notizbuch aus dem installierten OneNote auswählen und verbinden (nur lesend)
export default function OneNoteConnect({ connected, busy, onConnect, onClose }) {
  const [books, setBooks] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    listNotebooks().then(setBooks, (e) => setError(String(e)))
  }, [])

  return (
    <div
      role="dialog"
      aria-label="OneNote-Notizbuch verbinden"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
      className="anim-fade fixed inset-0 z-40 flex justify-center bg-[rgb(10_20_22/0.4)] px-4 pt-[12vh]"
    >
      <div className="anim-pop h-fit w-[30rem] max-w-full rounded-xl border border-line bg-raised p-5 shadow-[var(--shadow)]">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold">OneNote-Notizbuch verbinden</h2>
          <button aria-label="Schließen" disabled={!!busy} onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-text">
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-sm text-muted">
          Nexora liest das Notizbuch aus dem installierten OneNote und legt es als eigenes Notizbuch an; in OneNote ändert sich nichts.
          Übernommene Seiten sind gesperrt. Neue Änderungen holt später „Mit OneNote abgleichen“ im Rechtsklick-Menü des Notizbuchs.
        </p>
        {error ? (
          <p className="text-danger">OneNote ist nicht erreichbar: {error}</p>
        ) : !books ? (
          <p className="text-muted">Frage OneNote nach Notizbüchern …</p>
        ) : !books.length ? (
          <p className="text-muted">In OneNote ist kein Notizbuch geöffnet.</p>
        ) : (
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {books.map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover">
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                {connected.has(b.id) ? (
                  <span className="text-xs text-faint">verbunden</span>
                ) : (
                  <button disabled={!!busy} onClick={() => onConnect(b)} className="rounded-md bg-accent px-2.5 py-1 text-sm font-medium text-white disabled:opacity-50 dark:text-bg">
                    Verbinden
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {busy && (
          <p className="mt-3 text-sm text-muted" aria-live="polite">
            {busy}
          </p>
        )}
      </div>
    </div>
  )
}
