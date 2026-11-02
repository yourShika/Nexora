import { useEffect, useMemo, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ArrowsClockwise, Check, DownloadSimple, FolderOpen, GearSix, ListChecks, Microphone, ShieldWarning, Sparkle, Stop, Trash, X } from '@phosphor-icons/react'
import { cleanAnswer, hostOf, needsConsent, problemOf, SYSTEM, userMessage, withConsent } from './ai.js'
import { aiSettings, complete, currentProvider, hasKey, loadAi, saveAi } from './aiClient.js'
import { maskSecrets, secretSpans } from './secrets.js'
import { clock, meetingBody, meetingTitle, parseTasks, SPEECH_LANGUAGES, SPEECH_MODELS, SUMMARY_PROMPT, taskProps, TASKS_PROMPT, transcriptParts } from './speech.js'
import { bumpPage, clearFinished, finishedMeeting, listDevices, listSpeechModels, loadSpeech, modelReady, onSpeech, pageVersion, saveSpeech, speechState, startDictation, startFile, startMeeting, stopSpeech } from './speechStore.js'
import { fieldsOf } from './fields.js'
import * as db from './db.js'
import Select from './Select.jsx'

function useSpeech() {
  const [, redraw] = useState(0)
  useEffect(() => onSpeech(() => redraw((n) => n + 1)), [])
  return speechState()
}

const Modal = ({ label, onClose, wide, children }) => (
  <div
    role="dialog"
    aria-label={label}
    onClick={(e) => e.target === e.currentTarget && onClose?.()}
    onKeyDown={(e) => e.key === 'Escape' && onClose?.()}
    className="anim-fade fixed inset-0 z-50 flex justify-center bg-[rgb(10_20_22/0.4)] px-4 pt-[10vh]"
  >
    <div className={`anim-pop h-fit max-h-[80vh] ${wide ? 'w-[46rem]' : 'w-[34rem]'} max-w-full overflow-y-auto rounded-xl border border-line bg-raised p-5 shadow-[var(--shadow)]`}>{children}</div>
  </div>
)

// Immer sichtbar, solange etwas läuft: Eine Aufnahme ist nie heimlich
export function SpeechBar() {
  const s = useSpeech()
  const [, tick] = useState(0)
  const [hint, setHint] = useState('')
  useEffect(() => {
    if (!s.kind) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [s.kind])
  useEffect(() => {
    const off = listen('speech-keep-open', () => setHint('Die Aufnahme läuft noch. Beende sie zuerst, dann lässt sich das Fenster schließen.'))
    return () => void off.then((f) => f())
  }, [])
  useEffect(() => {
    if (s.kind) return
    setHint('')
  }, [s.kind])
  if (!s.kind) return null
  const percent = s.total ? Math.min(100, Math.round((s.done / s.total) * 100)) : 0
  const what = s.loading ? 'Spracherkennung startet …' : s.kind === 'diktat' ? 'Diktat läuft' : s.kind === 'datei' ? `Audiodatei wird gelesen, ${percent} %` : 'Besprechung wird aufgenommen'
  return (
    <div role="status" aria-label="Aufnahme" className="anim-pop fixed bottom-4 left-1/2 z-40 flex w-max max-w-[90vw] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-1 rounded-3xl border border-line bg-raised py-1.5 pl-4 pr-2 shadow-[var(--shadow)]">
      <span className={`size-2.5 shrink-0 rounded-full ${s.kind === 'datei' ? 'bg-accent' : 'animate-pulse bg-danger'}`} />
      <span className="font-medium">{s.stopping ? 'Rest wird erkannt …' : what}</span>
      {!s.loading && s.kind !== 'datei' && <span className="tabular-nums text-muted">{clock(Date.now() - s.startedAt)}</span>}
      {s.waiting > 15 && !s.stopping && s.kind !== 'datei' && <span className="text-sm text-muted">Die Erkennung hängt {s.waiting} s hinterher</span>}
      {s.error && <span role="alert" className="max-w-96 truncate text-sm text-danger" title={s.error}>{s.error}</span>}
      {hint && <span role="alert" className="text-sm text-danger">{hint}</span>}
      <button onClick={() => stopSpeech().catch(() => {})} disabled={s.stopping} className="flex items-center gap-1.5 rounded-full bg-danger px-3 py-1 font-medium text-white disabled:opacity-50">
        <Stop size={14} weight="fill" /> {s.kind === 'datei' ? 'Abbrechen' : 'Beenden'}
      </button>
    </div>
  )
}

// Diktat an der Schreibmarke; fehlt das Modell, geht es zu den Einstellungen
export async function dictate(editor, app) {
  if (speechState().kind === 'diktat') return stopSpeech()
  const { model } = await loadSpeech()
  if (!(await modelReady(model))) {
    app?.notice?.('Für das Diktat fehlt noch das Sprachmodell (Einstellungen → Sprache).')
    return app?.openSpeechSettings?.()
  }
  try {
    await startDictation(editor)
  } catch (e) {
    app?.notice?.(String(e.message ?? e))
  }
}

// Während der Aufnahme zeigt die Seite die laufende Mitschrift statt des Editors
export function useLivePage(id) {
  const s = useSpeech()
  return { live: !!s.kind && s.pageId === id, lines: s.pageId === id ? s.lines : [], version: pageVersion(id), waiting: s.waiting, loading: s.loading }
}

export function LiveTranscript({ lines, loading }) {
  const parts = transcriptParts(lines)
  return (
    <div aria-live="polite" className="flex flex-col gap-3 leading-relaxed">
      {parts.map((p) => (
        <p key={`${p.source}-${p.startMs}`}>
          {p.who && <strong>{p.who} </strong>}
          <span className="text-muted">({clock(p.startMs)})</span> {p.text}
        </p>
      ))}
      {!parts.length && <p className="text-muted">{loading ? 'Die Spracherkennung startet …' : 'Noch nichts erkannt. Der Text erscheint etwa alle 10 Sekunden.'}</p>}
    </div>
  )
}

// Wo die Mitschrift landet: Notizbücher und Abschnitte des aktuellen Bereichs
function placesOf(app) {
  const alive = [...app.alive.values()]
  const pathOf = (n) => {
    const parts = []
    for (let at = n; at; at = app.alive.get(at.parent_id)) parts.unshift(at.title || 'Ohne Titel')
    return parts.join(' / ')
  }
  return alive
    .filter((n) => ['notebook', 'section'].includes(n.kind) && !n.template && app.areaOf(n.id) === app.textArea)
    .map((n) => ({ id: n.id, name: pathOf(n) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

export function MeetingDialog({ app, onClose }) {
  const places = useMemo(() => placesOf(app), [app])
  const [source, setSource] = useState('beides')
  const [place, setPlace] = useState(places[0]?.id ?? '')
  const [agreed, setAgreed] = useState(false)
  const [keep, setKeep] = useState(true)
  const [ready, setReady] = useState(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    loadSpeech()
      .then((s) => (setKeep(s.keepAudio), modelReady(s.model)))
      .then(setReady)
      .catch(() => setReady(false))
  }, [])
  const isFile = source === 'datei'

  async function go() {
    setBusy(true)
    setProblem('')
    try {
      let path = null
      if (isFile) {
        path = await openDialog({ title: 'Audiodatei wählen', filters: [{ name: 'Audio und Video', extensions: ['wav', 'mp3', 'm4a', 'aac', 'wma', 'mp4', 'flac'] }] })
        if (!path) return setBusy(false)
      }
      const title = meetingTitle(new Date(), isFile ? 'Audiodatei' : 'Besprechung')
      const pageId = await app.createPage(place, title, meetingBody({ transcript: '' }))
      if (isFile) await startFile({ pageId, path })
      else await startMeeting({ pageId, withSpeaker: source === 'beides', keep })
      onClose()
    } catch (e) {
      setProblem(String(e.message ?? e))
      setBusy(false)
    }
  }

  return (
    <Modal label="Besprechung" onClose={onClose}>
      <h2 className="mb-2 flex items-center gap-2 font-semibold"><Microphone size={18} className="text-accent" /> Besprechung mitschreiben</h2>
      <p className="mb-3 text-sm text-muted">Die Sprache wird nur auf diesem PC in Text umgewandelt, das Audio verlässt ihn nicht. Nexora tritt keinem Gespräch bei, sondern hört Mikrofon und PC-Ton mit. Die Mitschrift unterscheidet „Ich“ und „Andere“, aber keine einzelnen Personen.</p>
      {ready === false && (
        <p role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-hover px-3 py-2 text-sm">
          Dafür fehlt noch das Sprachmodell.
          <button onClick={() => (onClose(), app.openSpeechSettings())} className="flex items-center gap-1 font-medium text-accent hover:underline"><GearSix size={14} /> Einstellungen → Sprache</button>
        </p>
      )}
      <div role="radiogroup" aria-label="Quelle" className="mb-3 flex flex-col gap-1.5">
        {[['beides', 'Mikrofon und PC-Ton', 'Für Online-Besprechungen, z. B. Teams.'], ['mikrofon', 'Nur Mikrofon', 'Alle sitzen in einem Raum.'], ['datei', 'Audiodatei einlesen', 'Vorhandene Aufnahme, z. B. WAV, MP3, M4A.']].map(([id, label, hint]) => (
          <label key={id} className="flex items-start gap-2.5">
            <input type="radio" name="quelle" checked={source === id} onChange={() => setSource(id)} className="mt-1 size-4 accent-[var(--accent)]" />
            <span>{label}<span className="block text-sm text-muted">{hint}</span></span>
          </label>
        ))}
      </div>
      <label className="mb-3 block">
        <span className="mb-0.5 block text-sm text-muted">Seite anlegen in</span>
        <Select value={place} onChange={(e) => setPlace(e.target.value)} aria-label="Seite anlegen in" className="w-full rounded-md border border-line bg-raised px-2 py-1">
          {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </label>
      {!isFile && (
        <>
          <label className="mb-3 flex items-start gap-2.5">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
            <span>Aufnahme behalten<span className="block text-sm text-muted">Liegt danach als Anhang an der Seite. Sonst bleibt nur der Text.</span></span>
          </label>
          <div className="mb-3 rounded-md border border-line px-3 py-2">
            <p className="mb-2 flex items-start gap-2 text-sm"><ShieldWarning size={18} className="mt-0.5 shrink-0 text-danger" /> Gespräche ohne Einwilligung aufzunehmen oder mitzuhören kann strafbar sein (§ 201 StGB). Sag allen Beteiligten vorher Bescheid.</p>
            <label className="flex items-start gap-2.5 font-medium">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
              Alle Beteiligten sind einverstanden
            </label>
          </div>
        </>
      )}
      {problem && <p role="alert" className="mb-3 break-words text-sm text-danger">{problem}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Abbrechen</button>
        <button onClick={go} disabled={busy || !ready || !place || (!isFile && !agreed)} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg">
          {isFile ? <FolderOpen size={16} /> : <Microphone size={16} />} {isFile ? 'Datei wählen' : 'Aufnahme starten'}
        </button>
      </div>
    </Modal>
  )
}

// Nach der Aufnahme: Zusammenfassung und Aufgaben, beides nur auf Klick über den KI-Anbieter
export function MeetingDone({ app }) {
  const [, redraw] = useState(0)
  useEffect(() => onSpeech(() => redraw((n) => n + 1)), [])
  const meeting = finishedMeeting()
  const [stage, setStage] = useState('menu') // menu | consent | busy | summary | tasks | error | setup
  const [want, setWant] = useState(null)
  const [summary, setSummary] = useState('')
  const [tasks, setTasks] = useState([])
  const [picked, setPicked] = useState(new Set())
  const [list, setList] = useState('')
  const [problem, setProblem] = useState('')
  const [masked, setMasked] = useState(false)
  const [saved, setSaved] = useState({ summary: false, tasks: 0 })
  useEffect(() => {
    setStage('menu')
    setSummary('')
    setTasks([])
    setSaved({ summary: false, tasks: 0 })
  }, [meeting?.pageId])
  if (!meeting?.pageId) return null
  const provider = () => currentProvider()
  const close = () => clearFinished()
  const empty = !meeting.transcript

  async function run(kind, approved = false) {
    await loadAi()
    const p = provider()
    const missing = p ? problemOf(p, await hasKey(p.id).catch(() => false)) : problemOf(null, false)
    if (missing) return setProblem(missing), setStage('setup')
    if (!approved && needsConsent(aiSettings(), p)) return setWant(kind), setStage('consent')
    const spans = secretSpans(meeting.transcript)
    setMasked(spans.length > 0)
    const text = spans.length ? maskSecrets(meeting.transcript, spans) : meeting.transcript
    setWant(kind)
    setStage('busy')
    try {
      const a = await complete(p, SYSTEM, userMessage(kind === 'summary' ? SUMMARY_PROMPT : TASKS_PROMPT, text))
      if (kind === 'summary') {
        setSummary(cleanAnswer(a.text))
        setStage('summary')
      } else {
        const found = parseTasks(a.text)
        setTasks(found)
        setPicked(new Set(found.map((_, i) => i)))
        const lists = app.databases
        setList((l) => l || lists[0]?.id || '')
        setStage('tasks')
      }
    } catch (e) {
      setProblem(String(e))
      setStage('error')
    }
  }

  function approve() {
    saveAi(withConsent(aiSettings(), provider())).catch(() => {})
    run(want, true)
  }

  async function takeSummary() {
    await db.update(meeting.pageId, { body: meetingBody({ summary, transcript: meeting.transcript, audio: meeting.audio }) })
    bumpPage(meeting.pageId)
    setSaved((s) => ({ ...s, summary: true }))
    setStage('menu')
  }

  async function takeTasks() {
    const target = app.databases.find((d) => d.id === list)
    if (!target) return
    const fields = fieldsOf(target)
    const chosen = tasks.filter((_, i) => picked.has(i))
    for (const t of chosen) await app.addRow(target.id, t.title, taskProps(t, fields))
    setSaved((s) => ({ ...s, tasks: s.tasks + chosen.length }))
    setStage('menu')
  }

  const label = meeting.kind === 'datei' ? 'Audiodatei gelesen' : 'Besprechung beendet'
  if (stage === 'consent') {
    const p = provider()
    return (
      <Modal label="Mitschrift senden?" onClose={() => setStage('menu')}>
        <h2 className="mb-1 flex items-center gap-2 font-semibold"><ShieldWarning size={18} className="text-accent" /> Mitschrift an {p.name} senden?</h2>
        <p className="mb-3 text-sm text-muted">Die ganze Mitschrift ({meeting.transcript.length} Zeichen) verlässt diesen PC und geht an <code className="font-mono">{hostOf(p.base)}</code>. Sie enthält, was alle Beteiligten gesagt haben. Bei diesem Anbieter fragt Nexora danach nicht mehr, gesendet wird aber nur auf Klick.</p>
        <div className="flex justify-end gap-2">
          <button onClick={() => setStage('menu')} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Abbrechen</button>
          <button autoFocus onClick={approve} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-bg">Senden</button>
        </div>
      </Modal>
    )
  }
  if (stage === 'summary') {
    return (
      <Modal label="Zusammenfassung" onClose={() => setStage('menu')} wide>
        <h2 className="mb-2 flex items-center gap-2 font-semibold"><Sparkle size={18} className="text-accent" /> Zusammenfassung</h2>
        {masked && <p className="mb-2 text-sm text-muted">Was nach Passwort aussah, ging maskiert raus.</p>}
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={12} aria-label="Zusammenfassung" className="mb-3 w-full resize-y rounded-md border border-line bg-raised px-3 py-2 outline-none focus:border-accent" />
        <div className="flex justify-end gap-2">
          <button onClick={() => setStage('menu')} className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted hover:bg-hover"><X size={16} /> Verwerfen</button>
          <button onClick={() => run('summary', true)} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:bg-hover"><ArrowsClockwise size={16} /> Nochmal</button>
          <button autoFocus onClick={takeSummary} disabled={!summary.trim()} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg"><Check size={16} /> In die Seite übernehmen</button>
        </div>
      </Modal>
    )
  }
  if (stage === 'tasks') {
    return (
      <Modal label="Aufgaben" onClose={() => setStage('menu')} wide>
        <h2 className="mb-2 flex items-center gap-2 font-semibold"><ListChecks size={18} className="text-accent" /> Vorgeschlagene Aufgaben</h2>
        {tasks.length === 0 ? <p className="mb-3 text-muted">Die KI hat keine Aufgaben gefunden.</p> : (
          <ul className="mb-3 flex flex-col gap-1.5">
            {tasks.map((t, i) => (
              <li key={i}>
                <label className="flex items-start gap-2.5">
                  <input type="checkbox" checked={picked.has(i)} onChange={(e) => setPicked((s) => {
                    const n = new Set(s)
                    if (e.target.checked) n.add(i)
                    else n.delete(i)
                    return n
                  })} className="mt-1 size-4 accent-[var(--accent)]" />
                  <span>{t.title}{(t.person || t.due) && <span className="block text-sm text-muted">{[t.person, t.due].filter(Boolean).join(' · ')}</span>}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {tasks.length > 0 && (
          <label className="mb-3 block">
            <span className="mb-0.5 block text-sm text-muted">In diese Liste</span>
            <Select value={list} onChange={(e) => setList(e.target.value)} aria-label="In diese Liste" className="w-full rounded-md border border-line bg-raised px-2 py-1">
              {app.databases.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </Select>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={() => setStage('menu')} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Zurück</button>
          {tasks.length > 0 && <button autoFocus onClick={takeTasks} disabled={!picked.size || !list} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg"><Check size={16} /> {picked.size} übernehmen</button>}
        </div>
      </Modal>
    )
  }
  return (
    <Modal label={label} onClose={close}>
      <h2 className="mb-2 flex items-center gap-2 font-semibold"><Check size={18} className="text-accent" /> {label}</h2>
      {empty ? <p className="mb-3 text-muted">Es wurde nichts erkannt.</p> : <p className="mb-3 text-muted">Die Mitschrift steht in der Seite{meeting.audio ? ', die Aufnahme als Anhang darunter' : ''}.</p>}
      {meeting.error && <p role="alert" className="mb-3 break-words text-sm text-danger">{meeting.error}</p>}
      {stage === 'busy' && <p className="mb-3 flex items-center gap-2"><Sparkle size={18} className="animate-pulse text-accent" /> {provider()?.name} arbeitet …</p>}
      {stage === 'error' && <p role="alert" className="mb-3 break-words text-sm text-danger">{problem}</p>}
      {stage === 'setup' && (
        <p role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          {problem}
          <button onClick={() => (close(), app.openAiSettings())} className="flex items-center gap-1 font-medium text-accent hover:underline"><GearSix size={14} /> Einstellungen → KI</button>
        </p>
      )}
      {saved.summary && <p className="mb-1 text-sm text-accent">Zusammenfassung steht oben in der Seite.</p>}
      {saved.tasks > 0 && <p className="mb-1 text-sm text-accent">{saved.tasks} Aufgaben in die Liste übernommen.</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button onClick={close} className="rounded-md px-3 py-1.5 text-muted hover:bg-hover">Fertig</button>
        {!empty && (
          <>
            <button onClick={() => run('tasks')} disabled={stage === 'busy'} className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:bg-hover disabled:opacity-50"><ListChecks size={16} /> Aufgaben vorschlagen</button>
            <button onClick={() => run('summary')} disabled={stage === 'busy'} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg"><Sparkle size={16} /> Zusammenfassen</button>
          </>
        )}
      </div>
    </Modal>
  )
}

const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`

export function SpeechSettings() {
  const [s, setS] = useState(null)
  const [models, setModels] = useState([])
  const [devices, setDevices] = useState({ microphones: [], speakers: [] })
  const [loading, setLoading] = useState(null) // { id, done, total }
  const [message, setMessage] = useState('')
  const refresh = () => listSpeechModels().then(setModels).catch(() => {})
  useEffect(() => {
    loadSpeech().then(setS).catch(() => {})
    refresh()
    listDevices().then(setDevices).catch(() => {})
    const off = listen('speech-download', ({ payload }) => setLoading(payload))
    return () => void off.then((f) => f())
  }, [])
  if (!s) return null
  const change = (fields) => {
    const next = { ...s, ...fields }
    setS(next)
    saveSpeech(next).catch((e) => setMessage(`Nicht gespeichert: ${e}`))
  }
  async function download(id) {
    setMessage('')
    setLoading({ id, done: 0, total: 0 })
    try {
      await invoke('speech_download', { id })
      await refresh()
    } catch (e) {
      if (String(e) !== 'abgebrochen') setMessage(String(e))
    } finally {
      setLoading(null)
    }
  }
  async function importFile(id) {
    const source = await openDialog({ title: 'Modelldatei wählen', filters: [{ name: 'Sprachmodell', extensions: ['bin'] }] })
    if (!source) return
    setMessage('')
    setLoading({ id, done: 0, total: 0 })
    try {
      await invoke('speech_import_model', { id, source })
      await refresh()
    } catch (e) {
      setMessage(String(e))
    } finally {
      setLoading(null)
    }
  }
  async function remove(id) {
    try {
      await invoke('speech_delete_model', { id })
      await refresh()
    } catch (e) {
      setMessage(String(e))
    }
  }
  const info = (id) => models.find((m) => m.id === id)
  return (
    <section className="mb-10">
      <h2 className="mb-1 font-semibold">Sprache in Text</h2>
      <p className="mb-3 text-muted">
        Diktat mit /Diktat in einer Seite, Besprechungen und Audiodateien über „Besprechung“ in der Seitenleiste. Die Erkennung läuft nur auf diesem PC mit Whisper, das Audio verlässt ihn nicht. Nur die Zusammenfassung nutzt auf Klick deinen KI-Anbieter.
      </p>
      <h3 className="mb-1 font-medium">Sprachmodell</h3>
      <ul className="mb-4 flex flex-col gap-2">
        {SPEECH_MODELS.map((m) => {
          const installed = info(m.id)?.installed
          const mine = loading?.id === m.id
          return (
            <li key={m.id} className="rounded-lg border border-line bg-raised px-3 py-2">
              <div className="flex flex-wrap items-center gap-3">
                <input type="radio" name="modell" checked={s.model === m.id} onChange={() => change({ model: m.id })} aria-label={`${m.label} verwenden`} className="size-4 accent-[var(--accent)]" />
                <span className="min-w-0 flex-1">{m.label} <span className="text-sm text-muted">{m.size}{installed ? ', geladen' : ''}</span><span className="block text-sm text-muted">{m.hint}</span></span>
                {installed ? (
                  <button onClick={() => remove(m.id)} aria-label={`${m.label} löschen`} className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-danger"><Trash size={14} /> Löschen</button>
                ) : mine ? (
                  <button onClick={() => invoke('speech_download_cancel').catch(() => {})} className="rounded-md px-2 py-1 text-sm text-muted hover:bg-hover">Abbrechen</button>
                ) : (
                  <span className="flex gap-1.5">
                    <button onClick={() => download(m.id)} disabled={!!loading} className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm hover:bg-hover disabled:opacity-50"><DownloadSimple size={14} /> Laden</button>
                    <button onClick={() => importFile(m.id)} disabled={!!loading} title="Für PCs ohne Zugang zu Hugging Face: die Datei von Hand holen und hier wählen" className="rounded-md px-2 py-1 text-sm text-muted hover:bg-hover disabled:opacity-50">Aus Datei</button>
                  </span>
                )}
              </div>
              {mine && (
                <div className="mt-2" role="progressbar" aria-valuenow={loading.total ? Math.round((loading.done / loading.total) * 100) : 0} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-1.5 overflow-hidden rounded-full bg-hover"><div className="h-full bg-accent" style={{ width: `${loading.total ? (loading.done / loading.total) * 100 : 0}%` }} /></div>
                  {loading.total > 0 && <p className="mt-1 text-sm text-muted">{mb(loading.done)} von {mb(loading.total)}</p>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-0.5 block text-sm text-muted">Gesprochene Sprache</span>
          <Select value={s.language} onChange={(e) => change({ language: e.target.value })} aria-label="Gesprochene Sprache" className="w-full rounded-md border border-line bg-raised px-2 py-1">
            {SPEECH_LANGUAGES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-sm text-muted">Mikrofon</span>
          <Select value={s.microphone} onChange={(e) => change({ microphone: e.target.value })} aria-label="Mikrofon" className="w-full rounded-md border border-line bg-raised px-2 py-1">
            <option value="">Standard von Windows</option>
            {devices.microphones.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </label>
        <label className="block">
          <span className="mb-0.5 block text-sm text-muted">PC-Ton von</span>
          <Select value={s.speaker} onChange={(e) => change({ speaker: e.target.value })} aria-label="PC-Ton von" className="w-full rounded-md border border-line bg-raised px-2 py-1">
            <option value="">Standard von Windows</option>
            {devices.speakers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </label>
      </div>
      <label className="mb-3 flex items-start gap-3">
        <input type="checkbox" checked={s.keepAudio} onChange={(e) => change({ keepAudio: e.target.checked })} className="mt-1 size-4 shrink-0 accent-[var(--accent)]" />
        <span>Aufnahme von Besprechungen behalten<span className="block text-sm text-muted">Vorbelegung im Startfenster. Die Aufnahme liegt dann als Anhang an der Seite, etwa 45 MB je Stunde.</span></span>
      </label>
      {message && <p role="alert" className="mb-3 break-words text-danger">{message}</p>}
      <p className="text-sm text-muted">Spracherkennung: whisper.cpp (MIT), im Programmordner unter <code className="font-mono">whisper</code>. Sprachmodelle von Hugging Face, die Prüfsumme wird kontrolliert.</p>
    </section>
  )
}
