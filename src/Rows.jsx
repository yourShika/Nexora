import { useState } from 'react'
import { ArrowBendUpRight, CalendarBlank, EnvelopeSimple, Lightning, Tray } from '@phosphor-icons/react'
import { eventDays, eventTime } from './outlook.js'
import Menu, { MenuItem } from './Menu.jsx'
import { Chip, DateText, FieldValue } from './Props.jsx'
import { LOP_FIELDS, dayOf, fieldsOf, formatNr, isDone, isLate, isToday, option, statusField, today } from './fields.js'
import { parseQuick } from './quick.js'

// Eine Zeile mit Erledigt-Haken; für Liste, Eingang und Heute
// Fortschritt der Checkliste im Text eines Punkts: Balken und "3/5"
export function Progress({ tasks }) {
  if (!tasks?.total) return null
  return (
    <span title={`${tasks.done} von ${tasks.total} Unterpunkten erledigt`} className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted">
      <span className="h-1 w-8 overflow-hidden rounded-full bg-line">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((tasks.done / tasks.total) * 100)}%` }} />
      </span>
      {tasks.done}/{tasks.total}
    </span>
  )
}

export function RowItem({ row, db, onOpen, onToggle, showDb, actions, drag, mark = '' }) {
  const fields = fieldsOf(db)
  const done = isDone(row, fields)
  // Status nur zeigen, wenn er vom Ausgangswert (z. B. "Offen") abweicht
  const sf = statusField(fields)
  const plainStatus = (row.props?.[sf?.id] ?? sf?.options[0]?.id) === sf?.options[0]?.id
  const shown = fields.filter((f) => f.type !== 'nr' && f.id !== 'followup' && !(f === sf && plainStatus))
  return (
    <li {...drag} className={`anim-row group flex items-center gap-3 px-2 py-2 hover:bg-hover ${mark}`}>
      <input
        type="checkbox"
        checked={done}
        onChange={() => onToggle(row)}
        aria-label={done ? `Wieder öffnen: ${row.title}` : `Erledigt: ${row.title}`}
        className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
      />
      {row.props?.nr && <span className="shrink-0 font-mono text-xs text-faint">{formatNr(db, row.props.nr)}</span>}
      <button onClick={() => onOpen(row.id)} className={`min-w-0 flex-1 truncate text-left ${done ? 'text-faint line-through' : ''}`}>
        {row.title || 'Ohne Titel'}
      </button>
      <span className="flex shrink-0 items-center gap-1.5">
        <Progress tasks={row.tasks} />
        {showDb && <span className="text-xs text-faint">{db?.title ?? 'Eingang'}</span>}
        {shown.map((f) => <FieldValue key={f.id} field={f} value={row.props?.[f.id]} db={db} done={done} />)}
        {row.props?.followup && !done && <span className="text-xs text-muted">WV <DateText value={row.props.followup} /></span>}
        {actions}
      </span>
    </li>
  )
}

// Eingabezeile mit Kurzsyntax; zeigt vorab, was erkannt wurde
export function QuickAdd({ onAdd, placeholder = 'Neuer Punkt: Text #tag @person !hoch fr' }) {
  const [text, setText] = useState('')
  const parsed = parseQuick(text)
  return (
    <div className="mb-3">
      <input
        value={text}
        placeholder={placeholder}
        aria-label="Neuer Punkt"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && parsed.title) onAdd(parsed.title, parsed.props), setText('')
          if (e.key === 'Escape') setText('')
        }}
        className="w-full rounded-md border border-line bg-raised px-3 py-2 outline-none placeholder:text-faint focus:border-accent"
      />
      {text && <ParsedPreview props={parsed.props} />}
    </div>
  )
}

export function ParsedPreview({ props }) {
  const prio = props.prio && option(LOP_FIELDS.find((f) => f.id === 'prio'), props.prio)
  const any = props.due || prio || props.person || props.tags
  return (
    <div className="mt-1.5 flex min-h-5 flex-wrap items-center gap-1.5 px-1 text-xs text-faint">
      {any ? (
        <>
          {props.due && <span>Fällig <DateText value={props.due} /></span>}
          {prio && <Chip color={prio.color}>{prio.name}</Chip>}
          {props.person && <span className="text-muted">@{props.person}</span>}
          {props.tags?.map((t) => <Chip key={t}>#{t}</Chip>)}
        </>
      ) : (
        <span>Enter speichert. Erkannt werden #tag, @person, !hoch/!mittel/!niedrig und Termine wie heute, morgen, fr, 3.11. oder +7</span>
      )}
    </div>
  )
}

export function Inbox({ rows, databases, onOpen, onToggle, onAdd, onAssign, hotkey }) {
  const [menu, setMenu] = useState(null)
  const open = rows.filter((r) => !isDone(r, fieldsOf(null)))
  return (
    <View title="Eingang" icon={Tray}>
      <QuickAdd onAdd={onAdd} />
      {open.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {open.map((r) => (
            <RowItem
              key={r.id}
              row={r}
              onOpen={onOpen}
              onToggle={onToggle}
              actions={
                <button
                  onClick={(e) => setMenu({ x: e.clientX, y: e.clientY, row: r })}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-raised hover:text-text"
                >
                  <ArrowBendUpRight size={14} /> Zuteilen
                </button>
              }
            />
          ))}
        </ul>
      ) : (
        <p className="text-muted">Alles einsortiert. Mit {hotkey} notierst du von überall etwas, es landet hier.</p>
      )}
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {databases.length ? databases.map((d) => (
            <MenuItem key={d.id} onClick={() => (onAssign(menu.row, d), setMenu(null))}>{d.title || 'Ohne Titel'}</MenuItem>
          )) : <p className="px-2 py-1.5 text-muted">Noch keine LOP-Liste angelegt.</p>}
        </Menu>
      )}
    </View>
  )
}

export function Today({ rows, dbOf, events = [], onOpen, onToggle, onFollowUp }) {
  const t = today()
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
  const open = rows.filter((r) => !isDone(r, fieldsOf(dbOf(r))))
  const byTime = (a, b) => (a.props.due ?? '').localeCompare(b.props.due ?? '')
  const groups = [
    { title: 'Überfällig', items: open.filter((r) => isLate(r.props?.due)).sort(byTime) },
    { title: 'Heute fällig', items: open.filter((r) => isToday(r.props?.due) && !isLate(r.props.due)).sort(byTime) },
    { title: 'Wiedervorlage', items: open.filter((r) => r.props?.followup && dayOf(r.props.followup) <= t) },
    { title: 'Wartet seit über 7 Tagen', items: open.filter((r) => r.props?.status === 'wartet' && r.updated_at < weekAgo), followUp: true },
  ].filter((g) => g.items.length)
  const meetings = events.filter((e) => eventDays(e).includes(t))

  return (
    <View title="Heute" icon={Lightning} sub={new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}>
      {meetings.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            Termine aus Outlook <span className="text-sm font-normal text-faint">{meetings.length}</span>
          </h2>
          <ul className="divide-y divide-line border-y border-line">
            {meetings.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2">
                <CalendarBlank size={16} className="shrink-0 text-faint" />
                <span className="w-24 shrink-0 text-sm tabular-nums text-muted">{eventTime(e)}</span>
                <span className="min-w-0 flex-1 truncate">{e.subject}</span>
                {e.location && <span className="truncate text-sm text-faint">{e.location}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {groups.length ? groups.map((g) => (
        <section key={g.title} className="mb-8">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            {g.title} <span className="text-sm font-normal text-faint">{g.items.length}</span>
          </h2>
          <ul className="divide-y divide-line border-y border-line">
            {g.items.map((r) => (
              <RowItem
                key={r.id}
                row={r}
                db={dbOf(r)}
                onOpen={onOpen}
                onToggle={onToggle}
                showDb
                actions={
                  g.followUp &&
                  onFollowUp && (
                    <button onClick={() => onFollowUp(r)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted hover:bg-raised hover:text-text">
                      <EnvelopeSimple size={14} /> Nachhaken
                    </button>
                  )
                }
              />
            ))}
          </ul>
        </section>
      )) : !meetings.length && (
        <p className="text-muted">Für heute steht nichts an. Nichts überfällig, keine Wiedervorlage.</p>
      )}
    </View>
  )
}

export function View({ title, icon: Icon, sub, children }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[860px] px-6 pb-24 pt-14 md:px-12">
        <h1 className="flex items-center gap-3 text-[32px] font-semibold leading-tight tracking-tight">
          {Icon && <Icon size={28} className="text-accent" />} {title}
        </h1>
        <p className="mb-8 mt-1 min-h-5 text-muted">{sub}</p>
        {children}
      </div>
    </div>
  )
}
