import { useEffect, useState } from 'react'
import { BookOpenText, CaretLeft, CaretRight, CheckCircle, EnvelopeSimple, FilePlus, NotePencil, PencilSimple, Play, Trash } from '@phosphor-icons/react'
import * as db from './db.js'
import { addDays, fieldsOf, formatDate, isDone, isLate, today } from './fields.js'
import { KIND_ORDER, monday, weekMarkdown, weekNumber } from './journal.js'
import { View } from './Rows.jsx'

const KINDS = {
  notiz: { label: 'Notiz', icon: NotePencil },
  erledigt: { label: 'Erledigt', icon: CheckCircle },
  angelegt: { label: 'Angelegt', icon: FilePlus },
  nachgehakt: { label: 'Nachgehakt', icon: EnvelopeSimple },
  ausgefuehrt: { label: 'Ausgeführt', icon: Play },
  bearbeitet: { label: 'Bearbeitet', icon: PencilSimple },
}
const time = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
const longDay = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })
const byKind = (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.at.localeCompare(b.at)

function Entry({ e, alive, onOpen, onDelete }) {
  const K = KINDS[e.kind] ?? KINDS.notiz
  const node = e.node_id && alive.get(e.node_id)
  const title = node?.title || (e.kind === 'ausgefuehrt' ? '' : e.text) || 'Ohne Titel'
  return (
    <li className="group flex items-center gap-3 py-1.5">
      <time className="w-11 shrink-0 text-xs tabular-nums text-faint">{time(e.at)}</time>
      <K.icon size={15} weight={e.kind === 'erledigt' ? 'fill' : 'regular'} className={`shrink-0 ${e.kind === 'erledigt' ? 'text-accent' : 'text-muted'}`} />
      <span className="w-20 shrink-0 text-xs text-muted">{K.label}</span>
      {e.kind === 'notiz' ? (
        <span className="min-w-0 flex-1">{e.text}</span>
      ) : node ? (
        <button onClick={() => onOpen(node.id)} className="min-w-0 flex-1 truncate text-left hover:text-accent">{title}</button>
      ) : (
        <span className="min-w-0 flex-1 truncate text-muted">{title}</span>
      )}
      {e.kind === 'ausgefuehrt' && <span className="shrink-0 text-xs text-faint">{e.text}</span>}
      {e.kind === 'notiz' && (
        <button aria-label="Notiz löschen" onClick={() => onDelete(e.id)} className="invisible rounded p-0.5 text-faint hover:text-danger group-hover:visible">
          <Trash size={13} />
        </button>
      )}
    </li>
  )
}

// Arbeitstagebuch (Tage) und Wochenrückblick (Woche); Einträge schreibt Nexora selbst mit, Notizen kommen dazu
export default function Journal({ alive, rows, dbOf, sections, onOpen, onSavePage }) {
  const [tab, setTab] = useState('tage')
  const [span, setSpan] = useState(14)
  const [week, setWeek] = useState(() => monday(today()))
  const [entries, setEntries] = useState(null)
  const [note, setNote] = useState('')
  const [target, setTarget] = useState(sections[0]?.id ?? '')
  const t = today()
  const from = tab === 'tage' ? addDays(t, -(span - 1)) : week
  const to = tab === 'tage' ? t : addDays(week, 6)
  const load = () => db.journalBetween(from, to).then(setEntries, () => setEntries([]))
  useEffect(() => {
    load()
  }, [from, to])

  async function addNote(e) {
    e.preventDefault()
    if (!note.trim()) return
    await db.journal('notiz', null, note.trim())
    setNote('')
    load()
  }
  const remove = (id) => db.deleteJournal(id).then(load)
  const list = entries ?? []
  const open = rows.filter((r) => !isDone(r, fieldsOf(dbOf(r))))
  const overdue = open.filter((r) => isLate(r.props?.due)).sort((a, b) => a.props.due.localeCompare(b.props.due))
  const waiting = open.filter((r) => r.props?.status === 'wartet')
  const count = (kind) => list.filter((e) => e.kind === kind).length
  const tabButton = (id, label) => (
    <button role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-md px-3 py-1 ${tab === id ? 'bg-accent-soft text-text' : 'text-muted hover:bg-hover hover:text-text'}`}>
      {label}
    </button>
  )

  return (
    <View title="Tagebuch" icon={BookOpenText} sub="Was du erledigt, angelegt, bearbeitet und ausgeführt hast, dazu eigene Notizen">
      <div role="tablist" className="mb-6 flex gap-1">
        {tabButton('tage', 'Tage')}
        {tabButton('woche', 'Woche')}
      </div>

      {tab === 'tage' ? (
        <>
          <form onSubmit={addNote} className="mb-8">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Notiz für heute, z. B. Telefonat mit Lieferant, Enter speichert"
              aria-label="Notiz für heute"
              className="w-full rounded-md border border-line bg-raised px-3 py-2 outline-none placeholder:text-faint focus:border-accent"
            />
          </form>
          {[...new Set(list.map((e) => e.day))]
            .sort()
            .reverse()
            .map((day) => (
              <section key={day} className="anim-row mb-6">
                <h2 className="mb-1 font-semibold">{day === t ? `Heute, ${longDay(day)}` : longDay(day)}</h2>
                <ul className="divide-y divide-line border-y border-line">
                  {list.filter((e) => e.day === day).sort(byKind).map((e) => <Entry key={e.id} e={e} alive={alive} onOpen={onOpen} onDelete={remove} />)}
                </ul>
              </section>
            ))}
          {entries && !list.length && <p className="text-muted">In den letzten {span} Tagen ist noch nichts eingetragen. Ab jetzt schreibt Nexora mit.</p>}
          {entries && <button onClick={() => setSpan(span + 14)} className="text-sm text-muted hover:text-text">Ältere Tage zeigen</button>}
        </>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <button aria-label="Vorige Woche" onClick={() => setWeek(addDays(week, -7))} className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-text"><CaretLeft size={16} /></button>
            <h2 className="min-w-56 text-lg font-semibold">KW {weekNumber(week)}: {formatDate(week)} – {formatDate(addDays(week, 6))}</h2>
            <button aria-label="Nächste Woche" onClick={() => setWeek(addDays(week, 7))} className="rounded-md p-1.5 text-muted hover:bg-hover hover:text-text"><CaretRight size={16} /></button>
            <button onClick={() => setWeek(monday(t))} className="rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-text">Diese Woche</button>
          </div>
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Erledigt', count('erledigt')],
              ['Neu angelegt', count('angelegt')],
              ['Nachgehakt', count('nachgehakt')],
              ['Runbooks', count('ausgefuehrt')],
              ['Überfällig jetzt', overdue.length],
              ['Wartet jetzt', waiting.length],
            ].map(([label, n]) => (
              <div key={label} className="rounded-lg border border-line bg-raised px-3 py-2">
                <div className="text-2xl font-semibold tabular-nums">{n}</div>
                <div className="text-xs text-muted">{label}</div>
              </div>
            ))}
          </div>
          {['erledigt', 'angelegt', 'nachgehakt', 'notiz', 'ausgefuehrt'].map((kind) => {
            const items = list.filter((e) => e.kind === kind)
            return items.length ? (
              <section key={kind} className="mb-6">
                <h3 className="mb-1 font-semibold">{KINDS[kind].label} <span className="text-sm font-normal text-faint">{items.length}</span></h3>
                <ul className="divide-y divide-line border-y border-line">
                  {items.map((e) => <Entry key={e.id} e={e} alive={alive} onOpen={onOpen} onDelete={remove} />)}
                </ul>
              </section>
            ) : null
          })}
          {[['Überfällig (Stand jetzt)', overdue], ['Wartet (Stand jetzt)', waiting]].map(([title, items]) =>
            items.length ? (
              <section key={title} className="mb-6">
                <h3 className="mb-1 font-semibold">{title} <span className="text-sm font-normal text-faint">{items.length}</span></h3>
                <ul className="divide-y divide-line border-y border-line">
                  {items.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 py-1.5">
                      <button onClick={() => onOpen(r.id)} className="min-w-0 flex-1 truncate text-left hover:text-accent">{r.title || 'Ohne Titel'}</button>
                      {r.props?.due && <span className="text-xs text-danger">fällig {formatDate(r.props.due)}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
          {sections.length > 0 && (
            <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <button
                onClick={() => onSavePage(target, `Wochenrückblick KW ${weekNumber(week)}`, weekMarkdown({ week, entries: list, overdue, waiting, alive }))}
                className="rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-bg"
              >
                Als Seite speichern
              </button>
              <span className="text-muted">in</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Abschnitt" className="rounded-md border border-line bg-raised px-2 py-1.5">
                {sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </div>
          )}
        </>
      )}
    </View>
  )
}
