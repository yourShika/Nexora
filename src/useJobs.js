import { useCallback, useEffect, useRef, useState } from 'react'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import * as db from './db.js'
import { readEvents } from './outlook.js'
import { compareEvents, describeChanges, dueJobs, overviewMarkdown, snapshot } from './jobs.js'

const MAX_RUNS = 100
const stateKey = (id) => `aufgabe-stand:${id}`

async function notify(title, body) {
  if ((await isPermissionGranted()) || (await requestPermission()) === 'granted') sendNotification({ title, body })
}

// Eine Aufgabe ausführen; Rückgabe für den Verlauf, ein Fehler landet dort als fehlgeschlagener Lauf
async function execute(job, api, setOptions) {
  const o = job.options ?? {}
  if (job.kind === 'outlook') return { text: await api.outlook() }
  if (job.kind === 'onenote') return { text: await api.onenote(o.notebook) }
  if (job.kind === 'backup') return { text: await api.backup() }
  if (job.kind === 'overview') {
    const body = overviewMarkdown(await readEvents(), o.days, job.name)
    // immer eine eigene Seite: fremde Seiten überschreibt die Aufgabe nie. Liegt sie im Papierkorb, entsteht eine neue
    let page = o.page
    if (!page || !api.alive(page)) {
      if (!api.alive(o.notebook)) throw new Error('Das gewählte Notizbuch gibt es nicht mehr. Bitte die Aufgabe bearbeiten.')
      page = (await db.create('page', o.notebook, job.name)).id
      setOptions({ page })
    }
    await db.update(page, { body, locked: 1 })
    await api.reload()
    api.pageWritten(page)
    return { text: `Seite „${job.name}“ neu geschrieben` }
  }
  if (job.kind === 'compare') {
    const fresh = snapshot(await readEvents(), o.days)
    const saved = await db.getSetting(stateKey(job.id))
    await db.setSetting(stateKey(job.id), JSON.stringify(fresh))
    if (!saved) return { text: `Ausgangsstand gemerkt: ${fresh.events.length} Termine` }
    const { lines, summary } = describeChanges(compareEvents(JSON.parse(saved), fresh))
    return { text: summary, lines, changed: lines.length > 0 }
  }
  throw new Error(`Unbekannte Aufgabe: ${job.kind}`)
}

/*
 * Aufgaben: laufen nur im Hauptfenster, nacheinander, auch versteckt im Tray.
 * Gespeichert als Einstellungen (kommen mit Sicherungen mit): "aufgaben", "aufgaben-verlauf", je Vergleich "aufgabe-stand:<id>".
 * api: { outlook(), onenote(notebook), backup(), alive(id), reload(), pageWritten(id) }, immer der aktuelle Stand
 */
export function useJobs(active, api) {
  const [jobs, setJobs] = useState([])
  const [runs, setRuns] = useState([])
  const [running, setRunning] = useState(null)
  const list = useRef([])
  const history = useRef([])
  const busy = useRef(false)
  const apiRef = useRef(api)
  apiRef.current = api

  const store = useCallback((next) => {
    list.current = next
    setJobs(next)
    return db.setSetting('aufgaben', JSON.stringify(next))
  }, [])
  const patch = useCallback((id, fields) => store(list.current.map((j) => (j.id === id ? { ...j, ...fields } : j))), [store])

  const run = useCallback(
    async (id, { manual = false } = {}) => {
      const job = list.current.find((j) => j.id === id)
      if (!job || busy.current) return
      busy.current = true
      setRunning(id)
      let result
      try {
        result = { ok: true, ...(await execute(job, apiRef.current, (o) => patch(id, { options: { ...list.current.find((j) => j.id === id)?.options, ...o } }))) }
      } catch (e) {
        result = { ok: false, text: String(e?.message ?? e) }
      }
      const at = new Date().toISOString()
      // ab jetzt zählt der Plan neu: Verpasstes läuft nur einmal
      await patch(id, { since: at, last: at, lastOk: result.ok, lastText: result.text }).catch(() => {})
      history.current = [{ id: crypto.randomUUID(), job: id, name: job.name, at, ok: result.ok, text: result.text, lines: result.lines ?? [] }, ...history.current].slice(0, MAX_RUNS)
      setRuns(history.current)
      db.setSetting('aufgaben-verlauf', JSON.stringify(history.current)).catch(() => {})
      busy.current = false
      setRunning(null)
      if (manual) return
      // melden nur bei Unterschieden und beim ersten Fehlschlag in Folge, sonst meldet jeder Lauf dasselbe
      if (!result.ok && job.lastOk !== false) notify(`Aufgabe fehlgeschlagen: ${job.name}`, result.text).catch(() => {})
      if (result.changed) notify(`${job.name}: ${result.text}`, result.lines.slice(0, 3).join('\n')).catch(() => {})
    },
    [patch],
  )

  useEffect(() => {
    if (!active) return
    let stop = false
    const read = (key) => db.getSetting(key).then((v) => JSON.parse(v ?? '[]'), () => [])
    Promise.all([read('aufgaben'), read('aufgaben-verlauf')]).then(([saved, past]) => {
      if (stop) return
      list.current = saved
      history.current = past
      setJobs(saved)
      setRuns(past)
    })
    const tick = async () => {
      if (busy.current) return
      for (const j of dueJobs(list.current, new Date())) await run(j.id)
    }
    // nach dem Start erst etwas Luft, dann alle 30 s wie die Erinnerungen
    const first = setTimeout(tick, 15_000)
    const timer = setInterval(tick, 30_000)
    return () => {
      stop = true
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [active, run])

  // Anlegen, Ändern und Einschalten zählen als Neubeginn: nichts läuft sofort los, nur weil der Plan schon vorbei wäre
  const save = useCallback(
    (job) => {
      const fields = { ...job, since: new Date().toISOString() }
      return store(list.current.some((j) => j.id === job.id) ? list.current.map((j) => (j.id === job.id ? { ...j, ...fields } : j)) : [...list.current, { enabled: true, ...fields, id: crypto.randomUUID() }])
    },
    [store],
  )
  const toggle = useCallback((id, enabled) => patch(id, { enabled, since: new Date().toISOString() }), [patch])
  const remove = useCallback(
    (id) => {
      db.deleteSetting(stateKey(id)).catch(() => {})
      history.current = history.current.filter((r) => r.job !== id)
      setRuns(history.current)
      db.setSetting('aufgaben-verlauf', JSON.stringify(history.current)).catch(() => {})
      return store(list.current.filter((j) => j.id !== id))
    },
    [store],
  )
  return { jobs, runs, running, run: (id) => run(id, { manual: true }), save, toggle, remove }
}
