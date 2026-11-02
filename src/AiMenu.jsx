import { useEffect, useRef, useState } from 'react'
import { ArrowLineDown, ArrowsClockwise, Check, GearSix, PencilSimple, ShieldWarning, Sparkle, X } from '@phosphor-icons/react'
import { ACTIONS, cleanAnswer, hostOf, needsConsent, problemOf, SYSTEM, userMessage, withConsent } from './ai.js'
import { aiSettings, complete, currentProvider, hasKey, onAiChange, saveAi, watchAi } from './aiClient.js'
import { maskSecrets, secretSpans } from './secrets.js'
import Menu, { MenuItem } from './Menu.jsx'
import SecretDialog from './SecretDialog.jsx'

// Markierung als Markdown: Das ist genau das, was an den Anbieter geht
export function selectionMarkdown(editor, { from, to }) {
  const { doc } = editor.state
  const content = doc.slice(from, to).content.toJSON()
  // Innerhalb eines Absatzes liefert slice nur die Textstücke, die müssen wieder in einen Absatz
  const inline = doc.resolve(from).sameParent(doc.resolve(to))
  return editor.markdown.serialize({ type: 'doc', content: inline ? [{ type: 'paragraph', content }] : content }).trim()
}

// Ein einzelner Absatz innerhalb eines Absatzes wird eingesetzt, ohne den Absatz zu teilen
function replaceRange(editor, range, md) {
  const blocks = editor.markdown.parse(md).content ?? []
  const inline = editor.state.doc.resolve(range.from).sameParent(editor.state.doc.resolve(range.to)) && blocks.length === 1 && blocks[0].type === 'paragraph'
  editor.chain().focus().insertContentAt(range, inline ? blocks[0].content ?? [] : blocks).run()
}

function insertBelow(editor, range, md) {
  const $to = editor.state.doc.resolve(range.to)
  editor.chain().focus().insertContentAt($to.depth > 0 ? $to.after(1) : range.to, editor.markdown.parse(md).content ?? []).run()
}

const Modal = ({ label, onClose, wide, children }) => (
  <div
    role="dialog"
    aria-label={label}
    onClick={(e) => e.target === e.currentTarget && onClose()}
    onKeyDown={(e) => e.key === 'Escape' && onClose()}
    className="anim-fade fixed inset-0 z-50 flex justify-center bg-[rgb(10_20_22/0.4)] px-4 pt-[12vh]"
  >
    <div className={`anim-pop h-fit max-h-[76vh] ${wide ? 'w-[46rem]' : 'w-[32rem]'} max-w-full overflow-y-auto rounded-xl border border-line bg-raised p-5 shadow-[var(--shadow)]`}>{children}</div>
  </div>
)

// Ablauf eines KI-Befehls: Anweisung (nur bei eigener), Passwort-Prüfung, Rückfrage, Anfrage, Vorschau.
// Es geht nur der markierte Text raus; übernommen wird erst auf Klick, Strg+Z macht es rückgängig
function AiDialog({ editor, range, action, onClose, onSettings }) {
  const original = useRef(selectionMarkdown(editor, range))
  const settings = aiSettings()
  const provider = currentProvider()
  const [stage, setStage] = useState(action ? 'start' : 'ask') // ask | secret | consent | busy | done | error | setup
  const [instruction, setInstruction] = useState(action?.prompt ?? '')
  const [text, setText] = useState(original.current)
  const [masked, setMasked] = useState(false)
  const [result, setResult] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [problem, setProblem] = useState('')
  const [saveName, setSaveName] = useState('')
  const run = useRef(0)
  useEffect(() => () => void run.current++, [])

  async function send(sendText, prompt) {
    const mine = ++run.current
    setStage('busy')
    try {
      const a = await complete(provider, SYSTEM, userMessage(prompt, sendText))
      if (mine !== run.current) return
      setResult(cleanAnswer(a.text))
      setTruncated(a.truncated)
      setStage('done')
    } catch (e) {
      if (mine !== run.current) return
      setProblem(String(e))
      setStage('error')
    }
  }

  const askConsent = (sendText, prompt) => (needsConsent(aiSettings(), provider) ? setStage('consent') : send(sendText, prompt))

  async function begin(prompt) {
    const missing = provider ? problemOf(provider, await hasKey(provider.id).catch(() => false)) : problemOf(null, false)
    if (missing) return setProblem(missing), setStage('setup')
    setInstruction(prompt)
    if (secretSpans(text).length) return setStage('secret')
    askConsent(text, prompt)
  }

  useEffect(() => {
    if (action) begin(action.prompt)
    // nur beim Öffnen
  }, [])

  function chooseSecret(choice) {
    if (!choice) return onClose()
    let next = text
    if (choice === 'masked') {
      next = maskSecrets(text, secretSpans(text))
      setText(next)
      setMasked(true)
    }
    askConsent(next, instruction)
  }

  function approve() {
    saveAi(withConsent(aiSettings(), provider)).catch(() => {})
    send(text, instruction)
  }

  function savePrompt() {
    if (!saveName.trim() || !instruction.trim()) return
    const s = aiSettings()
    saveAi({ ...s, prompts: [...s.prompts, { id: crypto.randomUUID(), label: saveName.trim(), prompt: instruction.trim() }] }).catch(() => {})
    setSaveName('')
  }

  const apply = (how) => {
    how(editor, range, result)
    onClose()
  }

  if (stage === 'start') return null
  if (stage === 'secret') {
    return (
      <SecretDialog
        text={text}
        spans={secretSpans(text)}
        onChoose={chooseSecret}
        hint={`Diese Stelle würde an ${provider.name} gehen. Maskiert schickst du „••••••“ statt des Werts.`}
        rawLabel="Trotzdem senden"
        maskedLabel="Als •••••• senden"
      />
    )
  }
  if (stage === 'consent') {
    return (
      <Modal label="Text senden?" onClose={onClose}>
        <h2 className="mb-1 flex items-center gap-2 font-semibold"><ShieldWarning size={18} className="text-accent" /> Text an {provider.name} senden?</h2>
        <p className="mb-3 text-sm text-muted">
          Der markierte Text ({original.current.length} Zeichen) verlässt diesen PC und geht an <code className="font-mono">{hostOf(provider.base)}</code>. Was der Anbieter damit tut, regeln seine Bedingungen. Bei diesem Anbieter fragt Nexora danach nicht mehr, es geht aber weiterhin nur Markiertes raus und nur, wenn du klickst.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Abbrechen</button>
          <button autoFocus onClick={approve} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-bg">Senden</button>
        </div>
      </Modal>
    )
  }
  if (stage === 'setup') {
    return (
      <Modal label="KI einrichten" onClose={onClose}>
        <h2 className="mb-1 flex items-center gap-2 font-semibold"><Sparkle size={18} className="text-accent" /> KI einrichten</h2>
        <p className="mb-3 text-sm text-muted">{problem}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Schließen</button>
          <button autoFocus onClick={() => (onClose(), onSettings?.())} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-bg"><GearSix size={16} /> Einstellungen öffnen</button>
        </div>
      </Modal>
    )
  }
  if (stage === 'ask') {
    return (
      <Modal label="Eigene Anweisung" onClose={onClose}>
        <h2 className="mb-2 flex items-center gap-2 font-semibold"><PencilSimple size={18} className="text-accent" /> Eigene Anweisung</h2>
        <textarea
          autoFocus
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && instruction.trim() && begin(instruction)}
          rows={3}
          placeholder="Was soll mit dem markierten Text passieren? Zum Beispiel: Als höfliche Mail formulieren"
          aria-label="Anweisung"
          className="mb-3 w-full resize-y rounded-md border border-line bg-raised px-3 py-2 outline-none placeholder:text-faint focus:border-accent"
        />
        <div className="mb-3 flex items-center gap-2">
          <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Name zum Speichern" aria-label="Name zum Speichern" className="w-52 rounded-md border border-line bg-raised px-2 py-1 text-sm outline-none placeholder:text-faint focus:border-accent" />
          <button onClick={savePrompt} disabled={!saveName.trim() || !instruction.trim()} className="rounded-md border border-line px-2 py-1 text-sm hover:bg-hover disabled:opacity-50">Anweisung speichern</button>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Abbrechen</button>
          <button onClick={() => begin(instruction)} disabled={!instruction.trim()} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg">Ausführen</button>
        </div>
      </Modal>
    )
  }
  if (stage === 'busy') {
    return (
      <Modal label="KI arbeitet" onClose={onClose}>
        <p className="mb-3 flex items-center gap-2"><Sparkle size={18} className="animate-pulse text-accent" /> {provider.name} arbeitet …</p>
        <div className="flex justify-end"><button autoFocus onClick={onClose} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Abbrechen</button></div>
      </Modal>
    )
  }
  if (stage === 'error') {
    return (
      <Modal label="KI-Fehler" onClose={onClose}>
        <h2 className="mb-1 font-semibold">Das hat nicht geklappt</h2>
        <p role="alert" className="mb-3 break-words text-sm text-danger">{problem}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Schließen</button>
          {onSettings && <button onClick={() => (onClose(), onSettings())} className="rounded-md border border-line px-3 py-1.5 hover:bg-hover">Einstellungen</button>}
          <button autoFocus onClick={() => send(text, instruction)} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-bg"><ArrowsClockwise size={16} /> Nochmal</button>
        </div>
      </Modal>
    )
  }
  return (
    <Modal label="Ergebnis der KI" onClose={onClose} wide>
      <h2 className="mb-2 flex items-center gap-2 font-semibold"><Sparkle size={18} className="text-accent" /> Ergebnis von {provider.name}</h2>
      {truncated && <p role="alert" className="mb-2 text-sm text-danger">Die Antwort wurde abgeschnitten, weil sie zu lang war.</p>}
      {masked && <p role="alert" className="mb-2 text-sm text-danger">Maskierte Stellen (••••••) ersetzen beim Übernehmen die echten Werte. „Darunter einfügen“ lässt das Original stehen.</p>}
      <textarea value={result} onChange={(e) => setResult(e.target.value)} rows={10} aria-label="Ergebnis" className="mb-3 w-full resize-y rounded-md border border-line bg-raised px-3 py-2 outline-none focus:border-accent" />
      <details className="mb-3 text-sm text-muted">
        <summary className="cursor-pointer">Vorher</summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[var(--code-bg)] px-3 py-2">{original.current}</pre>
      </details>
      <div className="flex flex-wrap justify-end gap-2">
        <button onClick={onClose} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted hover:bg-hover"><X size={16} /> Verwerfen</button>
        <button onClick={() => send(text, instruction)} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:bg-hover"><ArrowsClockwise size={16} /> Nochmal</button>
        <button onClick={() => apply(insertBelow)} disabled={!result.trim()} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:bg-hover disabled:opacity-50"><ArrowLineDown size={16} /> Darunter einfügen</button>
        <button autoFocus={!masked} onClick={() => apply(replaceRange)} disabled={!result.trim()} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg"><Check size={16} /> Übernehmen</button>
      </div>
    </Modal>
  )
}

// Knopf neben der Markierung und das Menü dazu; Strg+J öffnet es an der Markierung. Der Knopf erscheint erst, wenn ein Anbieter
// eingerichtet ist, das Rechtsklick-Menü von Windows (Kopieren, Einfügen) bleibt unberührt
export default function AiMenu({ editor, onSettings }) {
  const [, redraw] = useState(0)
  const [spot, setSpot] = useState(null)
  const [menu, setMenu] = useState(null)
  const [job, setJob] = useState(null)
  useEffect(() => {
    watchAi()
    return onAiChange(() => redraw((n) => n + 1))
  }, [])

  const busy = useRef(false)
  busy.current = !!(menu || job)
  useEffect(() => {
    if (!editor) return
    const { view } = editor
    const place = () => {
      if (busy.current) return
      const { from, to, empty } = editor.state.selection
      if (empty || !editor.isEditable || !view.hasFocus() || !editor.state.doc.textBetween(from, to, ' ').trim()) return setSpot(null)
      const end = view.coordsAtPos(to)
      setSpot({ x: end.right, y: end.bottom, from, to })
    }
    const hide = () => !busy.current && setSpot(null)
    const openHere = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'j') return
      const { from, to, empty } = editor.state.selection
      if (empty) return
      e.preventDefault()
      const end = view.coordsAtPos(to)
      setMenu({ x: end.left, y: end.bottom + 4, from, to })
    }
    // Erst wenn die Maus los ist, sonst springt der Knopf beim Ziehen mit
    view.dom.addEventListener('mouseup', place)
    view.dom.addEventListener('keyup', place)
    view.dom.addEventListener('keydown', openHere)
    editor.on('blur', hide)
    editor.on('update', hide)
    addEventListener('scroll', hide, true)
    return () => {
      view.dom.removeEventListener('mouseup', place)
      view.dom.removeEventListener('keyup', place)
      view.dom.removeEventListener('keydown', openHere)
      editor.off('blur', hide)
      editor.off('update', hide)
      removeEventListener('scroll', hide, true)
    }
  }, [editor])

  const { prompts, providers } = aiSettings()
  const start = (action) => {
    const range = { from: menu.from, to: menu.to }
    setMenu(null)
    setSpot(null)
    setJob({ range, action })
  }
  const closeJob = () => {
    setJob(null)
    editor?.view.focus()
  }

  return (
    <>
      {spot && providers.length > 0 && !menu && !job && (
        <button
          // Der Klick darf die Markierung nicht aufheben
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenu({ x: spot.x, y: spot.y + 8, from: spot.from, to: spot.to })}
          title="KI (Strg+J)"
          aria-label="KI für die Markierung"
          style={{ left: Math.min(spot.x + 6, innerWidth - 60), top: Math.min(spot.y + 4, innerHeight - 36) }}
          className="anim-pop fixed z-30 flex items-center gap-1 rounded-md border border-line bg-raised px-2 py-1 text-sm shadow-[var(--shadow)] hover:border-faint"
        >
          <Sparkle size={14} className="text-accent" /> KI
        </button>
      )}
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => (setMenu(null), editor?.view.focus())} label="KI-Befehle">
          {ACTIONS.map((a) => <MenuItem key={a.id} onClick={() => start(a)}>{a.label}</MenuItem>)}
          {prompts.map((p) => <MenuItem key={p.id} onClick={() => start(p)}>{p.label}</MenuItem>)}
          <div className="my-1 border-t border-line" />
          <MenuItem icon={PencilSimple} onClick={() => start(null)}>Eigene Anweisung …</MenuItem>
          {onSettings && <MenuItem icon={GearSix} onClick={() => (setMenu(null), onSettings())}>KI einstellen …</MenuItem>}
        </Menu>
      )}
      {job && <AiDialog editor={editor} range={job.range} action={job.action} onClose={closeJob} onSettings={onSettings} />}
    </>
  )
}
