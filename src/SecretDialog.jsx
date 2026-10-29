import { ShieldWarning } from '@phosphor-icons/react'
import { maskSecrets } from './secrets.js'

// Passwort-Warnung beim Einfügen (Editor) und bei "Zwischenablage in den Eingang".
// onChoose: 'masked' | 'raw' | null (abbrechen)
export default function SecretDialog({ text, spans, onChoose }) {
  return (
    <div
      role="dialog"
      aria-label="Passwort-Warnung"
      onClick={(e) => e.target === e.currentTarget && onChoose(null)}
      onKeyDown={(e) => e.key === 'Escape' && onChoose(null)}
      className="anim-fade fixed inset-0 z-50 flex justify-center bg-[rgb(10_20_22/0.4)] px-4 pt-[16vh]"
    >
      <div className="anim-pop h-fit w-[32rem] max-w-full rounded-xl border border-line bg-raised p-5 shadow-[var(--shadow)]">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <ShieldWarning size={18} className="text-danger" /> Sieht nach einem Passwort aus
        </h2>
        <p className="mb-3 text-sm text-muted">
          Nexora speichert Text unverschlüsselt in der Datenbank, in Sicherungen und im Versionsverlauf. Passwörter gehören in den Tresor
          (/Tresor-Eintrag, in Runbooks {'{{vault:Name}}'}).
        </p>
        <pre className="mb-4 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--code-bg)] px-3 py-2 text-sm">{maskSecrets(text, spans).slice(0, 600)}</pre>
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={() => onChoose(null)} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Abbrechen</button>
          <button onClick={() => onChoose('raw')} className="rounded-md border border-line px-3 py-1.5 hover:bg-hover">Trotzdem einfügen</button>
          <button autoFocus onClick={() => onChoose('masked')} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-bg">
            Als •••••• einfügen
          </button>
        </div>
      </div>
    </div>
  )
}
