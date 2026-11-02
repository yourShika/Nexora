// Laufende Aufnahme: gemeinsamer Stand eines Fensters. Diktat schreibt an die Schreibmarke, Besprechung und Datei in eine eigene Seite.
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { TrayIcon } from '@tauri-apps/api/tray'
import { addLine, audioName, attachmentLink, meetingBody, SPEECH_DEFAULTS, transcriptMarkdown } from './speech.js'
import * as db from './db.js'

const IDLE = { kind: null, session: null, loading: false, startedAt: 0, lines: [], waiting: 0, done: 0, total: 0, error: '', pageId: null, stopping: false }
let state = IDLE
let finished = null // Besprechung fertig, wartet auf die Nachbearbeitung
let editor = null
let savedAt = 0
const pageVersions = new Map()
const listeners = new Set()
const notify = () => listeners.forEach((f) => f())
const set = (fields) => {
  state = { ...state, ...fields }
  notify()
}
export const onSpeech = (f) => (listeners.add(f), () => listeners.delete(f))
export const speechState = () => state
export const finishedMeeting = () => finished
export const clearFinished = () => ((finished = null), notify())
// Seite neu laden, wenn ihr Inhalt von hier aus geändert wurde
export const pageVersion = (id) => pageVersions.get(id) ?? 0
export const bumpPage = (id) => (pageVersions.set(id, pageVersion(id) + 1), notify())

let listening = false
function watch() {
  if (listening) return
  listening = true
  listen('speech-text', ({ payload: p }) => {
    if (!state.kind || (state.session !== null && p.session !== state.session)) return
    if (state.kind === 'diktat') {
      if (!editor || editor.isDestroyed) return stopSpeech().catch(() => {})
      editor.commands.insertContent(`${p.text} `)
      return
    }
    set({ lines: addLine(state.lines, p), done: Math.max(state.done, p.endMs) })
    // Zwischendurch sichern, damit bei einem Absturz nicht alles weg ist
    if (state.pageId && Date.now() - savedAt > 20_000) {
      savedAt = Date.now()
      db.update(state.pageId, { body: meetingBody({ transcript: transcriptMarkdown(state.lines) }) }).catch(() => {})
    }
  }).catch(() => {})
  listen('speech-state', ({ payload: p }) => {
    if (!state.kind || (state.session !== null && p.session !== state.session)) return
    set({ waiting: p.waiting, done: Math.max(state.done, p.done), total: p.total || state.total, ...(p.error ? { error: p.error } : {}) })
  }).catch(() => {})
}

const tray = (text) => TrayIcon.getById('main').then((t) => t?.setTooltip(text)).catch(() => {})

export async function loadSpeech() {
  try {
    return { ...SPEECH_DEFAULTS, ...JSON.parse((await db.getSetting('sprache')) ?? 'null') }
  } catch {
    return { ...SPEECH_DEFAULTS }
  }
}
export const saveSpeech = (s) => db.setSetting('sprache', JSON.stringify(s))
export const listSpeechModels = () => invoke('speech_models')
export const listDevices = () => invoke('speech_devices')
export const modelReady = async (id) => (await listSpeechModels()).some((m) => m.id === id && m.installed)

async function begin(kind, fields, run) {
  if (state.kind) throw new Error('Es läuft schon eine Aufnahme.')
  watch()
  finished = null
  savedAt = Date.now()
  set({ ...IDLE, kind, loading: true, startedAt: Date.now(), ...fields })
  try {
    const session = await run()
    set({ session, loading: false, startedAt: Date.now() })
    tray(kind === 'datei' ? 'Nexora: Audiodatei wird gelesen' : 'Nexora: Aufnahme läuft')
  } catch (e) {
    state = IDLE
    notify()
    throw e instanceof Error ? e : new Error(String(e))
  }
}

const startOptions = (mode, s, extra) => ({
  mode,
  model: s.model,
  language: s.language,
  microphone: s.microphone || null,
  speaker: s.speaker || null,
  ...extra,
  // Nur im Debug-Build ausgewertet: Testdateien statt echter Geräte
  testFiles: (import.meta.env.DEV && window.__speechTest) || null,
})

export async function startDictation(target) {
  const s = await loadSpeech()
  editor = target
  await begin('diktat', {}, () => invoke('speech_start', { options: startOptions('diktat', s, { withSpeaker: false, keepAudio: false }) }))
}

export async function startMeeting({ pageId, withSpeaker, keep }) {
  const s = await loadSpeech()
  editor = null
  await begin('besprechung', { pageId }, () => invoke('speech_start', { options: startOptions('besprechung', s, { withSpeaker, keepAudio: keep }) }))
}

export async function startFile({ pageId, path }) {
  const s = await loadSpeech()
  editor = null
  await begin('datei', { pageId }, () => invoke('speech_file', { path, model: s.model, language: s.language }))
}

// Beendet die Aufnahme, wartet auf den Rest der Erkennung und schreibt die Seite fertig
export async function stopSpeech() {
  if (!state.kind || state.stopping) return
  set({ stopping: true })
  const { kind, pageId, startedAt } = state
  let audio = null
  try {
    audio = await invoke('speech_stop')
    await new Promise((r) => setTimeout(r, 150)) // letzte Ereignisse abwarten
  } catch (e) {
    set({ error: String(e) })
  }
  const transcript = transcriptMarkdown(state.lines)
  const error = state.error
  let audioLink = null
  if (pageId) {
    if (audio) {
      try {
        const [rel, size] = await invoke('import_attachment', { source: audio, id: crypto.randomUUID(), name: audioName(new Date(startedAt)) })
        audioLink = attachmentLink(rel, size)
        await invoke('speech_cleanup', { audio }).catch(() => {})
      } catch (e) {
        finished = { error: `Die Aufnahme ließ sich nicht anhängen: ${e}` }
      }
    }
    await db.update(pageId, { body: meetingBody({ transcript, audio: audioLink }) }).catch(() => {})
    bumpPage(pageId)
    finished = { ...finished, kind, pageId, transcript, audio: audioLink, error: finished?.error || error }
  }
  editor = null
  tray('Nexora')
  state = IDLE
  notify()
}
