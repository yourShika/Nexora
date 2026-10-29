import { Sparkle, X } from '@phosphor-icons/react'
import { NEWS } from './news.js'

const day = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
// **fett** aus news.js
const rich = (text) => text.split('**').map((part, i) => (i % 2 ? <strong key={i} className="font-semibold text-text">{part}</strong> : part))

// „Neu in Nexora“: nach einem Update einmal von selbst, sonst über die Benutzer-Anzeige unten links
export default function News({ version, onClose }) {
  const latest = NEWS.find((n) => n.version === version) ?? NEWS[0]
  return (
    <div role="dialog" aria-modal="true" aria-label="Neuigkeiten" className="anim-fade fixed inset-0 z-50 grid place-items-center bg-[rgb(10_20_22/0.35)] p-6" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="anim-pop flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl border border-line bg-raised shadow-[var(--shadow)]">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <Sparkle size={22} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
          <div className="flex-1">
            <h2 className="text-lg font-semibold">Neu in Nexora {latest.version}</h2>
            <p className="text-sm text-muted">{latest.title}, {day(latest.date)}</p>
          </div>
          <button autoFocus aria-label="Schließen" onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-text"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {NEWS.slice(NEWS.indexOf(latest)).map((n) => (
            <section key={n.version} className="mb-6 last:mb-0">
              {n !== latest && <h3 className="mb-1.5 font-medium">{n.version} · {n.title} <span className="text-xs font-normal text-faint">{day(n.date)}</span></h3>}
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted marker:text-faint">
                {n.items.map((it, i) => <li key={i}>{rich(it)}</li>)}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
