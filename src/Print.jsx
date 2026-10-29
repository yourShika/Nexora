import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from '@phosphor-icons/react'
import * as db from './db.js'
import Editor from './Editor.jsx'
import FreeCanvas from './FreeCanvas.jsx'
import { isFree } from './free.js'
import { describe, formatNr } from './fields.js'
import { printTheme } from './theme.js'

const PAPER = 680 // A4 hochkant mit 16 mm Rand, in CSS-Pixeln
const noop = () => {}

// Warten, bis Bilder geladen und Mermaid-Diagramme gezeichnet sind (höchstens 8 s)
async function settle(el) {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const busy = [...el.querySelectorAll('img')].some((img) => !img.complete) || el.querySelector('[data-pending]')
    if (!busy && i >= 3) return
  }
}

// Freie Seiten sind oft breiter als das Blatt: dann verkleinert drucken statt abschneiden
function fit(el) {
  for (const free of el.querySelectorAll('.print-free')) {
    if (free.scrollWidth > PAPER) free.style.zoom = PAPER / free.scrollWidth
  }
}

// Seiten unsichtbar aufbauen und drucken; immer hell. Als PDF: im Druckdialog "Microsoft Print to PDF" wählen.
// pages: [{ node, path, fields, list }], fields nur bei LOP-Punkten
export default function Print({ pages, onDone }) {
  const [bodies, setBodies] = useState(null)
  const root = useRef(null)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    printTheme(true)
    Promise.all(pages.map((p) => db.loadBody(p.node.id))).then(setBodies, (e) => done.current(`Seite nicht geladen: ${e}`))
    return () => printTheme(false)
  }, [pages])

  useEffect(() => {
    if (!bodies) return
    let alive = true
    settle(root.current).then(() => {
      if (!alive) return
      fit(root.current)
      addEventListener('afterprint', () => done.current(), { once: true })
      window.print()
    })
    return () => {
      alive = false
    }
  }, [bodies])

  const printed = new Date().toLocaleDateString('de-DE', { dateStyle: 'long' })
  return createPortal(
    <div id="print-root" ref={root} aria-hidden>
      {bodies &&
        pages.map(({ node, path, fields, list }, i) => (
          <section key={node.id} className="print-page">
            <p className="mb-1 text-xs text-muted">
              {path.map((p) => p.title || 'Ohne Titel').join(' / ')} · gedruckt am {printed}
            </p>
            <h1 className="mb-4 text-[28px] font-semibold leading-tight tracking-tight">{node.title || 'Ohne Titel'}</h1>
            {fields && (
              <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                {fields
                  .filter((f) => describe(f, node.props?.[f.id]) !== '–')
                  .map((f) => (
                    <div key={f.id} className="contents">
                      <dt className="text-muted">{f.name}</dt>
                      <dd>{f.type === 'nr' ? formatNr(list, node.props[f.id]) : describe(f, node.props[f.id])}</dd>
                    </div>
                  ))}
              </dl>
            )}
            {isFree(bodies[i]) ? (
              <div className="print-free">
                <FreeCanvas body={bodies[i]} editable={false} onChange={noop} />
              </div>
            ) : (
              <Editor markdown={bodies[i]} editable={false} onChange={noop} />
            )}
          </section>
        ))}
    </div>,
    document.body,
  )
}

// Hat die Seite Unterseiten, wird vorher gefragt
export function PrintAsk({ node, count, onChoose }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Drucken" className="anim-fade fixed inset-0 z-50 grid place-items-center bg-[rgb(10_20_22/0.35)] p-6" onClick={() => onChoose(null)} onKeyDown={(e) => e.key === 'Escape' && onChoose(null)}>
      <div onClick={(e) => e.stopPropagation()} className="anim-pop w-full max-w-sm rounded-lg border border-line bg-raised p-4 shadow-[var(--shadow)]">
        <h2 className="mb-1 flex items-center gap-2 font-medium"><Printer size={18} className="text-accent" /> „{node.title || 'Ohne Titel'}“ drucken</h2>
        <p className="mb-4 text-sm text-muted">Die Seite hat {count === 1 ? 'eine Unterseite' : `${count} Unterseiten`}. Als PDF: im Druckdialog „Microsoft Print to PDF“ wählen.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={() => onChoose(null)} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Abbrechen</button>
          <button onClick={() => onChoose(false)} className="rounded-md border border-line px-3 py-1.5 hover:bg-hover">Nur diese Seite</button>
          <button autoFocus onClick={() => onChoose(true)} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-bg">Mit Unterseiten</button>
        </div>
      </div>
    </div>
  )
}
