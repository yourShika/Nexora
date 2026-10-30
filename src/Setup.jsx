import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Compass, FileArrowDown, FolderSimple, DownloadSimple, PlugsConnected, X } from '@phosphor-icons/react'
import { AutostartToggle, HotkeyRow, ProfileSection, TeamSection, ThemeChoice } from './Settings.jsx'
import { HOTKEYS } from './hotkey.js'
import { motionOn } from './theme.js'
import { useApp } from './ctx.js'
import { HELP_TITLE, SEED_BOOK, placeTip } from './setup.js'

// Tab bleibt im Dialog (Strg+Tab wechselt weiter die Reiter)
export function trapTab(e, box) {
  if (e.key !== 'Tab' || e.ctrlKey || !box) return
  const all = [...box.querySelectorAll('button:not(:disabled), input:not(:disabled), select, summary, [tabindex="0"]')].filter((x) => x.offsetParent !== null)
  if (!all.length) return
  const at = document.activeElement
  const edge = e.shiftKey ? all[0] : all.at(-1)
  if (at === edge || !box.contains(at)) {
    e.preventDefault()
    ;(e.shiftKey ? all.at(-1) : all[0]).focus()
  }
}

const STEPS = ['benutzer', 'aussehen', 'notizbuch', 'schnell', 'fertig']

export function Option({ value, choice, onChoice, title, text }) {
  return (
    <button
      role="radio"
      aria-checked={choice === value}
      onClick={() => onChoice(value)}
      className={`rounded-md border px-3 py-2 text-left ${choice === value ? 'border-accent bg-accent-soft' : 'border-line bg-raised hover:border-faint'}`}
    >
      <span className="block font-medium">{title}</span>
      <span className="block text-sm text-muted">{text}</span>
    </button>
  )
}

function NotebookStep({ first, others, name, onName, choice, onChoice, applied, actions }) {
  const importers = [
    [PlugsConnected, 'OneNote verbinden', actions.oneNoteDialog],
    [FolderSimple, 'Obsidian-Vault', () => actions.importForeign('obsidian')],
    [DownloadSimple, 'Notion-Export', () => actions.importForeign('notion')],
    [FileArrowDown, 'Nexora-Datei', actions.importNexora],
  ]
  // „Keins“ gibt es von Hand immer, beim ersten Start, sobald etwas übernommen wurde
  const canSkip = !first || others > 0
  return (
    <>
      {applied ? (
        <p className="mb-5 rounded-md bg-accent-soft px-3 py-2">{applied}</p>
      ) : (
        <>
          <p className="mb-3 text-muted">{first ? 'Gib deinem Notizbuch einen Namen. Beispiele helfen beim Ausprobieren und lassen sich später einfach löschen.' : 'Lege bei Bedarf ein weiteres Notizbuch an. Deine vorhandenen Notizbücher bleiben, wie sie sind.'}</p>
          <div role="radiogroup" aria-label="Inhalt des Notizbuchs" className="mb-3 grid gap-2">
            {canSkip && <Option value="keins" choice={choice} onChoice={onChoice} title={first ? 'Keins' : 'Kein neues Notizbuch'} text={first ? 'Das Beispiel-Notizbuch kommt in den Papierkorb.' : 'Dieser Schritt ändert nichts.'} />}
            <Option value="beispiele" choice={choice} onChoice={onChoice} title="Mit Beispielen" text={`Erste Schritte mit Beispielseite, Beispielliste und „${HELP_TITLE}“ zum Nachlesen.`} />
            <Option value="leer" choice={choice} onChoice={onChoice} title="Leer" text="Ein leeres Notizbuch, du legst alles selbst an." />
          </div>
          {choice !== 'keins' && (
            <label className="mb-5 block">
              <span className="mb-1 block text-sm text-muted">Name</span>
              <input value={name} onChange={(e) => onName(e.target.value)} className="w-full rounded-md border border-line bg-raised px-3 py-1.5 focus:border-accent focus:outline-none" />
            </label>
          )}
        </>
      )}
      <div className="mb-1.5 text-sm text-muted">{first && !applied ? 'Oder vorhandene Notizen übernehmen' : 'Vorhandene Notizen übernehmen'}</div>
      <div className="grid grid-cols-2 gap-2">
        {importers.map(([Icon, label, run]) => (
          <button key={label} onClick={run} className="flex items-center gap-2 rounded-md border border-line bg-raised px-3 py-1.5 text-left hover:border-faint">
            <Icon size={16} className="shrink-0 text-muted" /> {label}
          </button>
        ))}
      </div>
    </>
  )
}

// Einrichtung: beim ersten Start einer neuen Installation von selbst, sonst über das Menü unten links.
// Profil, Aussehen und Tasten gelten sofort; nur das Notizbuch wird mit „Weiter“ angelegt
export default function Setup({ first, actions, hotkeys, hotkeyBusy, onHotkey, onClose }) {
  const [step, setStep] = useState(0)
  const [team, setTeam] = useState(false)
  const [name, setName] = useState(first ? 'Mein Notizbuch' : '')
  const [choice, setChoice] = useState(first ? 'beispiele' : 'keins')
  const [applied, setApplied] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef(null)
  const heading = useRef(null)
  const app = useApp()
  const others = [...app.alive.values()].filter((n) => n.kind === 'notebook' && n.id !== SEED_BOOK).length

  useEffect(() => heading.current?.focus(), [step])
  // Beim ersten Start heißt „übernehmen“ meist: statt der Beispiele
  useEffect(() => {
    if (first && others > 0) setChoice('keins')
  }, [first, others])

  const id = STEPS[step]
  const titles = {
    benutzer: first ? 'Willkommen bei Nexora' : 'Einrichtung',
    aussehen: 'Wie soll Nexora aussehen?',
    notizbuch: first ? 'Dein erstes Notizbuch' : 'Notizbücher',
    schnell: 'Schnell etwas festhalten',
    fertig: 'Alles bereit',
  }
  const capture = HOTKEYS.find((h) => h.id === 'capture')

  async function next() {
    if (id === 'notizbuch' && !applied && (first || choice !== 'keins')) {
      setBusy(true)
      const text = await actions.setupNotebook(first, name, choice)
      setBusy(false)
      if (text === null) return // Fehler: Meldung kommt von der App, hier bleiben
      setApplied(text)
    }
    setStep(step + 1)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-title"
      className="anim-fade fixed inset-0 z-40 grid place-items-center bg-[rgb(10_20_22/0.35)] p-6"
      onKeyDown={(e) => {
        trapTab(e, box.current)
        if (e.key === 'Escape' && !e.defaultPrevented) onClose(false)
      }}
    >
      <div ref={box} className="anim-pop flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-line bg-raised shadow-[var(--shadow)]">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 id="setup-title" ref={heading} tabIndex={-1} className="flex-1 text-lg font-semibold outline-none">{titles[id]}</h2>
          <span className="text-xs tabular-nums text-faint">Schritt {step + 1} von {STEPS.length}</span>
          <button aria-label="Einrichtung schließen" title="Später" onClick={() => onClose(false)} className="rounded p-1 text-muted hover:bg-hover hover:text-text"><X size={16} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {id === 'benutzer' && (
            <>
              {first && <p className="mb-5">Ein paar Angaben, dann kann es losgehen. Alles lässt sich später unter Einstellungen ändern.</p>}
              <ProfileSection />
              <details onToggle={(e) => setTeam(e.currentTarget.open)} className="-mt-4">
                <summary className="cursor-pointer select-none rounded text-muted hover:text-text">Mit einem Team-Server verbinden (optional)</summary>
                {team && <div className="mt-3"><TeamSection /></div>}
              </details>
            </>
          )}
          {id === 'aussehen' && <ThemeChoice />}
          {id === 'notizbuch' && <NotebookStep first={first} others={others} name={name} onName={setName} choice={choice} onChoice={setChoice} applied={applied} actions={actions} />}
          {id === 'schnell' && (
            <>
              <p className="mb-4 text-muted">Mit dieser Tastenkombination erfasst du überall in Windows einen Punkt, solange Nexora läuft, auch versteckt im Tray. Er landet im Eingang. Zum Ändern klicken und die neue Kombination drücken.</p>
              <HotkeyRow item={capture} accel={hotkeys.capture} busy={hotkeyBusy.includes('capture')} onChange={onHotkey} />
              <div className="mt-5"><AutostartToggle /></div>
            </>
          )}
          {id === 'fertig' && (
            <>
              <p className="mb-3">Nexora ist eingerichtet. Der Rundgang zeigt dir in wenigen kurzen Stationen, wo was liegt.</p>
              <p className="text-muted">Einrichtung und Rundgang findest du jederzeit wieder: Klick auf deinen Namen unten links. Alles Weitere steht unter Einstellungen{first && choice === 'beispiele' ? ` und zum Nachlesen auf der Seite „${HELP_TITLE}“` : ''}.</p>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          {step > 0 && <button onClick={() => setStep(step - 1)} className="rounded-md px-3 py-1.5 hover:bg-hover">Zurück</button>}
          <span className="flex-1" />
          {id === 'fertig' ? (
            <>
              <button onClick={() => onClose(false)} className="rounded-md px-3 py-1.5 hover:bg-hover">Fertig</button>
              <button autoFocus onClick={() => onClose(true)} className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-bg"><Compass size={16} /> Rundgang starten</button>
            </>
          ) : (
            <>
              {id === 'notizbuch' && !applied && first && <button onClick={() => setStep(step + 1)} className="rounded-md px-3 py-1.5 hover:bg-hover">Überspringen</button>}
              <button disabled={busy} onClick={next} className="rounded-md bg-accent px-4 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg">Weiter</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Sichtbarer Teil eines Bereichs: abgeschnitten an scrollenden Vorfahren und am Fenster
function visibleRect(el) {
  let { left, top, right, bottom } = el.getBoundingClientRect()
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (!/auto|scroll|hidden/.test(getComputedStyle(p).overflowY)) continue
    const r = p.getBoundingClientRect()
    left = Math.max(left, r.left)
    top = Math.max(top, r.top)
    right = Math.min(right, r.right)
    bottom = Math.min(bottom, r.bottom)
  }
  left = Math.max(left, 0)
  top = Math.max(top, 0)
  right = Math.min(right, innerWidth)
  bottom = Math.min(bottom, innerHeight)
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null
}

// Rundgang: hebt je Station einen Bereich hervor, daneben die Erklärung. Die Oberfläche dahinter ist gesperrt.
// Fehlt ein Bereich (z. B. Seitenleiste zu schmal), steht die Erklärung mittig
export function Tour({ stations, onOpen, onClose }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const [size, setSize] = useState({ w: 340, h: 190 })
  const [win, setWin] = useState({ w: innerWidth, h: innerHeight })
  const tip = useRef(null)
  const s = stations[i]
  const last = i === stations.length - 1

  useEffect(() => {
    if (s.view) onOpen(s.view)
    // onOpen ändert sich mit jedem Rendern, die Station zählt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.view])

  // Ansichten bauen sich erst auf und Fenster ändern ihre Größe: darum laufend nachmessen, statt auf Ereignisse zu warten
  useLayoutEffect(() => {
    let scrolled = false
    const measure = () => {
      const el = document.querySelector(`[data-tour="${s.target}"]`)
      if (el && !scrolled) {
        el.scrollIntoView({ block: 'nearest' })
        scrolled = true
      }
      const next = el ? visibleRect(el) : null
      setRect((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
      setWin((old) => (old.w === innerWidth && old.h === innerHeight ? old : { w: innerWidth, h: innerHeight }))
      if (tip.current) {
        const { offsetWidth: w, offsetHeight: h } = tip.current
        setSize((old) => (old.w === w && old.h === h ? old : { w, h }))
      }
    }
    measure()
    const timer = setInterval(measure, 200)
    return () => clearInterval(timer)
  }, [s.target])

  useEffect(() => {
    const key = (e) => {
      trapTab(e, tip.current)
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') last ? onClose() : setI((x) => x + 1)
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
      else return
      e.stopPropagation()
    }
    addEventListener('keydown', key, true)
    return () => removeEventListener('keydown', key, true)
  }, [last, onClose])

  const pad = 4
  const hole = rect && { left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad }
  const pos = placeTip(hole, size, win)
  const moving = motionOn() ? 'transition-all duration-200' : ''
  return (
    <div role="dialog" aria-modal="true" aria-label="Rundgang durch Nexora" className="fixed inset-0 z-50" onMouseDown={(e) => e.preventDefault()}>
      {hole ? (
        <div aria-hidden className={`absolute rounded-lg outline outline-2 outline-[var(--accent)] ${moving}`} style={{ ...hole, boxShadow: '0 0 0 9999px rgb(10 20 22 / 0.5)' }} />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[rgb(10_20_22/0.5)]" />
      )}
      <div ref={tip} className={`absolute w-[340px] max-w-[calc(100vw-16px)] rounded-xl border border-line bg-raised p-4 shadow-[var(--shadow)] ${moving}`} style={{ left: pos.x, top: pos.y }}>
        <div className="mb-1 text-xs tabular-nums text-faint">Station {i + 1} von {stations.length}</div>
        <h2 className="mb-1 font-semibold">{s.title}</h2>
        <p aria-live="polite" className="mb-4 text-sm text-muted">{s.text}</p>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-text">Beenden</button>
          <span className="flex-1" />
          {i > 0 && <button onClick={() => setI(i - 1)} className="rounded-md px-3 py-1 text-sm hover:bg-hover">Zurück</button>}
          <button key={i} autoFocus onClick={() => (last ? onClose() : setI(i + 1))} className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white dark:text-bg">{last ? 'Fertig' : 'Weiter'}</button>
        </div>
      </div>
    </div>
  )
}
