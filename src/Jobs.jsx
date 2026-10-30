import { useEffect, useRef, useState } from 'react'
import { CheckCircle, PencilSimple, Play, Plus, Timer, WarningCircle, X } from '@phosphor-icons/react'
import { Choice } from './Settings.jsx'
import { Option, trapTab } from './Setup.jsx'
import { ConfirmButton } from './Overview.jsx'
import Select from './Select.jsx'
import { TimeInput } from './DatePicker.jsx'
import { ALL_DAYS, INTERVALS, JOB_KINDS, RANGES, WEEKDAYS, WORK_DAYS, defaultOptions, defaultSchedule, describeSchedule, formatRun, nextRun, nextRuns, scheduleError } from './jobs.js'

const field = 'rounded-md border border-line bg-raised px-2 py-1 focus:border-accent focus:outline-none'
const quiet = 'rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-text'

// Eine oder mehrere Uhrzeiten. Das Feld übernimmt beim Verlassen, mit Enter oder aus der Liste; danach steht es wieder leer bereit.
// Der Knopf braucht darum nichts zu tun: Der Klick darauf verlässt das Feld
function TimeList({ times, onChange }) {
  const [round, setRound] = useState(0)
  const wrap = useRef(null)
  const enter = useRef(false)
  useEffect(() => {
    if (enter.current) wrap.current.querySelector('input')?.focus()
    enter.current = false
  }, [round])
  const take = (t) => {
    if (t && !times.includes(t)) onChange([...times, t].sort())
    setRound((r) => r + 1)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {times.map((t) => (
        <span key={t} className="flex items-center gap-1 rounded-md border border-line bg-bg px-2 py-1 tabular-nums">
          {t}
          <button aria-label={`${t} entfernen`} onClick={() => onChange(times.filter((x) => x !== t))} className="rounded text-muted hover:text-text"><X size={13} /></button>
        </span>
      ))}
      <span ref={wrap} onKeyDownCapture={(e) => (enter.current = e.key === 'Enter')}>
        <TimeInput key={round} value="" onChange={take} aria-label="Weitere Uhrzeit" className={`w-20 ${field}`} />
      </span>
      <button className="rounded-md border border-line px-2 py-1 text-sm hover:bg-hover">Hinzufügen</button>
    </div>
  )
}

function DayPicker({ days, onChange }) {
  const flip = (d) => onChange(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())
  return (
    <div className="mb-4">
      <div className="mb-1.5 text-sm text-muted">An welchen Tagen</div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Wochentage">
        {WEEKDAYS.map((name, i) => (
          <button key={name} aria-pressed={days.includes(i + 1)} onClick={() => flip(i + 1)} className={`size-9 rounded-md border text-sm ${days.includes(i + 1) ? 'border-accent bg-accent-soft font-medium' : 'border-line bg-raised text-muted hover:border-faint'}`}>
            {name}
          </button>
        ))}
        <button onClick={() => onChange([...WORK_DAYS])} className={`ml-1 ${quiet}`}>Mo bis Fr</button>
        <button onClick={() => onChange([...ALL_DAYS])} className={quiet}>Jeden Tag</button>
      </div>
    </div>
  )
}

// Zeitplan wie bei Cron, nur zum Anklicken; unten steht in Klartext, was daraus wird
function ScheduleEditor({ value: s, onChange }) {
  const set = (fields) => onChange({ ...s, ...fields })
  const error = scheduleError(s)
  return (
    <div>
      <Choice label="Wie oft" value={s.mode} onChange={(mode) => set({ mode })} options={[['times', 'Zu festen Uhrzeiten'], ['every', 'Regelmäßig'], ['monthly', 'Einmal im Monat']]} />
      {s.mode !== 'monthly' && <DayPicker days={s.days} onChange={(days) => set({ days })} />}
      {s.mode === 'times' && (
        <div className="mb-4">
          <div className="mb-1.5 text-sm text-muted">Um wie viel Uhr</div>
          <TimeList times={s.times} onChange={(times) => set({ times })} />
        </div>
      )}
      {s.mode === 'every' && (
        <div className="mb-4 space-y-3">
          <label className="flex items-center gap-2">
            <span className="text-sm text-muted">Abstand</span>
            <Select value={String(s.minutes)} onChange={(e) => set({ minutes: Number(e.target.value) })} className={field}>
              {INTERVALS.map(([m, label]) => <option key={m} value={m}>{label === 'Stunde' ? 'jede Stunde' : `alle ${label}`}</option>)}
            </Select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.window} onChange={(e) => set({ window: e.target.checked })} className="size-4 accent-[var(--accent)]" />
              Nur in diesem Zeitfenster
            </label>
            {s.window && (
              <>
                <TimeInput value={s.from} onChange={(from) => set({ from })} aria-label="Zeitfenster von" className={`w-20 ${field}`} />
                <span className="text-muted">bis</span>
                <TimeInput value={s.to} onChange={(to) => set({ to })} aria-label="Zeitfenster bis" className={`w-20 ${field}`} />
              </>
            )}
          </div>
        </div>
      )}
      {s.mode === 'monthly' && (
        <div className="mb-4 space-y-3">
          <label className="flex items-center gap-2">
            <span className="text-sm text-muted">Am</span>
            <Select value={String(s.day)} onChange={(e) => set({ day: e.target.value === 'last' ? 'last' : Number(e.target.value) })} className={field}>
              {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}.</option>)}
              <option value="last">letzten Tag</option>
            </Select>
            {s.day > 28 && <span className="text-sm text-muted">In kürzeren Monaten am letzten Tag.</span>}
          </label>
          <TimeList times={s.times} onChange={(times) => set({ times })} />
        </div>
      )}
      <div className="rounded-md bg-accent-soft px-3 py-2 text-sm" aria-live="polite">
        {error ? (
          <span role="alert" className="text-danger">{error}</span>
        ) : (
          <>
            <div className="font-medium">{describeSchedule(s)}</div>
            <div className="text-muted">Nächste Läufe: {nextRuns(s, new Date()).map(formatRun).join(' · ')}</div>
          </>
        )}
      </div>
    </div>
  )
}

function JobForm({ job, notebooks, oneNoteBooks, alive, onSave, onClose }) {
  const [draft, setDraft] = useState(() => job ?? { name: '', kind: 'overview', schedule: defaultSchedule(), options: { ...defaultOptions('overview'), notebook: notebooks[0]?.id } })
  const box = useRef(null)
  const heading = useRef(null)
  useEffect(() => heading.current?.focus(), [])
  const set = (fields) => setDraft((d) => ({ ...d, ...fields }))
  const setOption = (fields) => setDraft((d) => ({ ...d, options: { ...d.options, ...fields } }))
  const pick = (kind) => set({ kind, options: { ...defaultOptions(kind), ...(kind === 'overview' ? { notebook: draft.options?.notebook ?? notebooks[0]?.id } : {}) } })
  const page = draft.options?.page && alive.get(draft.options.page)
  const blocked = scheduleError(draft.schedule) || (draft.kind === 'overview' && !page && !draft.options?.notebook ? 'Bitte zuerst ein Notizbuch anlegen.' : '')
  const range = (label) => (
    <label className="mb-3 flex items-center gap-2">
      <span className="text-sm text-muted">{label}</span>
      <Select value={String(draft.options.days)} onChange={(e) => setOption({ days: Number(e.target.value) })} className={field}>
        {RANGES.map(([d, text]) => <option key={d} value={d}>{text}</option>)}
      </Select>
    </label>
  )
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-title"
      className="anim-fade fixed inset-0 z-40 grid place-items-center bg-[rgb(10_20_22/0.35)] p-6"
      onKeyDown={(e) => {
        trapTab(e, box.current)
        if (e.key === 'Escape' && !e.defaultPrevented) onClose()
      }}
    >
      <div ref={box} className="anim-pop flex max-h-[88vh] w-full max-w-2xl flex-col rounded-xl border border-line bg-raised shadow-[var(--shadow)]">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 id="job-title" ref={heading} tabIndex={-1} className="flex-1 text-lg font-semibold outline-none">{job ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}</h2>
          <button aria-label="Schließen" onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-text"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-1.5 text-sm text-muted">Was soll passieren</div>
          <div role="radiogroup" aria-label="Art der Aufgabe" className="mb-3 grid gap-2">
            {Object.entries(JOB_KINDS).map(([id, k]) => <Option key={id} value={id} choice={draft.kind} onChoice={pick} title={k.label} text={k.text} />)}
          </div>
          {draft.kind === 'overview' && (
            <>
              {range('Zeitraum')}
              {page ? (
                <p className="mb-3 text-sm text-muted">Schreibt in die Seite „{page.title || 'Ohne Titel'}“.</p>
              ) : (
                <label className="mb-3 flex items-center gap-2">
                  <span className="text-sm text-muted">Eigene Seite anlegen in</span>
                  <Select value={draft.options.notebook ?? ''} onChange={(e) => setOption({ notebook: e.target.value })} className={field}>
                    {notebooks.map((n) => <option key={n.id} value={n.id}>{n.title || 'Ohne Titel'}</option>)}
                  </Select>
                </label>
              )}
            </>
          )}
          {draft.kind === 'compare' && range('Termine der nächsten')}
          {draft.kind === 'onenote' && (
            oneNoteBooks.length ? (
              <label className="mb-3 flex items-center gap-2">
                <span className="text-sm text-muted">Notizbuch</span>
                <Select value={draft.options.notebook ?? 'alle'} onChange={(e) => setOption({ notebook: e.target.value })} className={field}>
                  <option value="alle">Alle verbundenen</option>
                  {oneNoteBooks.map((n) => <option key={n.id} value={n.id}>{n.title || 'Ohne Titel'}</option>)}
                </Select>
              </label>
            ) : (
              <p className="mb-3 text-sm text-muted">Noch ist kein Notizbuch mit OneNote verbunden. Das Stecker-Symbol neben „Notizbücher“ verbindet eines.</p>
            )
          )}
          <div className="mt-5"><ScheduleEditor value={draft.schedule} onChange={(schedule) => set({ schedule })} /></div>
          <label className="mt-5 block">
            <span className="mb-1 block text-sm text-muted">Name (optional)</span>
            <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder={JOB_KINDS[draft.kind].name ?? JOB_KINDS[draft.kind].label} className="w-full rounded-md border border-line bg-raised px-3 py-1.5 focus:border-accent focus:outline-none" />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 hover:bg-hover">Abbrechen</button>
          <button disabled={!!blocked} onClick={() => onSave({ ...draft, name: draft.name.trim() || (JOB_KINDS[draft.kind].name ?? JOB_KINDS[draft.kind].label) })} className="rounded-md bg-accent px-4 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg">Speichern</button>
        </div>
      </div>
    </div>
  )
}

const StatusIcon = ({ ok }) => (ok ? <CheckCircle size={15} className="mt-0.5 shrink-0 text-accent" aria-label="Erfolgreich" /> : <WarningCircle size={15} className="mt-0.5 shrink-0 text-danger" aria-label="Fehlgeschlagen" />)
const stampOf = (iso) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })

// Ansicht „Aufgaben“: Liste mit nächstem Lauf, darunter die letzten Läufe
export default function Jobs({ state, notebooks, oneNoteBooks, alive }) {
  const { jobs, runs, running, run, save, toggle, remove } = state
  const [editing, setEditing] = useState(null) // Aufgabe oder 'neu'
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((x) => x + 1), 30_000) // „Nächster Lauf“ aktuell halten
    return () => clearInterval(timer)
  }, [])
  const next = (j) => {
    if (!j.enabled) return 'ausgeschaltet'
    const at = nextRun(j.schedule, new Date(j.since))
    return !at ? 'nie' : at <= new Date() ? 'gleich' : formatRun(at)
  }
  return (
    <div className="h-full overflow-y-auto px-6 pb-24 pt-14 md:px-12">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="flex flex-1 items-center gap-3 text-[32px] font-semibold leading-tight tracking-tight"><Timer size={28} className="text-accent" /> Aufgaben</h1>
        <button onClick={() => setEditing('neu')} className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-bg"><Plus size={16} /> Neue Aufgabe</button>
      </div>
      <p className="mb-6 text-muted">Laufen von selbst zu den gewählten Zeiten, solange Nexora läuft, auch versteckt im Tray. Was verpasst wurde, läuft beim nächsten Start einmal nach. Eine Windows-Meldung kommt nur bei Fehlern und gefundenen Änderungen.</p>

      {jobs.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-start gap-3 py-3">
              <input type="checkbox" checked={j.enabled} aria-label={`${j.name} eingeschaltet`} onChange={(e) => toggle(j.id, e.target.checked)} className="mt-1 size-4 accent-[var(--accent)]" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{j.name}</div>
                <div className="text-sm text-muted">{describeSchedule(j.schedule)}{j.name !== JOB_KINDS[j.kind].label ? ` · ${JOB_KINDS[j.kind].label}` : ''}</div>
                <div className="text-sm text-muted">Nächster Lauf: {running === j.id ? 'läuft gerade' : next(j)}</div>
                {j.last && (
                  <div className="mt-1 flex items-start gap-1.5 text-sm">
                    <StatusIcon ok={j.lastOk} />
                    <span className={j.lastOk ? 'text-muted' : 'text-danger'}>{stampOf(j.last)}: {j.lastText}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button disabled={!!running} onClick={() => run(j.id)} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-hover disabled:opacity-50"><Play size={14} /> Jetzt ausführen</button>
                <button aria-label={`${j.name} bearbeiten`} title="Bearbeiten" onClick={() => setEditing(j)} className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-text"><PencilSimple size={15} /></button>
                <ConfirmButton compact onConfirm={() => remove(j.id)} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-muted">Noch keine Aufgabe. „Neue Aufgabe“ legt zum Beispiel eine Terminübersicht an, die jeden Morgen neu geschrieben wird.</p>
      )}

      {runs.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 font-semibold">Letzte Läufe</h2>
          <ul className="space-y-2 text-sm">
            {runs.slice(0, 30).map((r) => (
              <li key={r.id} className="flex items-start gap-1.5">
                <StatusIcon ok={r.ok} />
                <div className="min-w-0">
                  <span className="tabular-nums text-faint">{stampOf(r.at)}</span> <span className="font-medium">{r.name}</span>: <span className={r.ok ? 'text-muted' : 'text-danger'}>{r.text}</span>
                  {r.lines.length > 0 && <ul className="mt-0.5 list-disc pl-5 text-muted marker:text-faint">{r.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && (
        <JobForm
          job={editing === 'neu' ? null : editing}
          notebooks={notebooks}
          oneNoteBooks={oneNoteBooks}
          alive={alive}
          onClose={() => setEditing(null)}
          onSave={(j) => {
            save(j)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
