import { useEffect, useRef, useState } from 'react'
import { ArrowSquareOut, Check, X } from '@phosphor-icons/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import Menu, { MenuItem } from './Menu.jsx'
import { CHIP_COLORS, REPEATS, dayOf, formatDate, formatNr, isLate, isToday, option, timeOf } from './fields.js'
import { useApp } from './ctx.js'

export function Chip({ color = 'grau', children }) {
  const hex = CHIP_COLORS[color] ?? CHIP_COLORS.grau
  return (
    <span
      style={{ background: `color-mix(in srgb, ${hex} 17%, transparent)`, color: `color-mix(in srgb, ${hex} 78%, var(--text))` }}
      className="inline-flex h-5 max-w-full items-center truncate rounded px-1.5 text-xs font-medium"
    >
      {children}
    </span>
  )
}

export function DateText({ value, done, size = 'text-xs' }) {
  if (!value) return null
  const late = !done && isLate(value)
  const now = isToday(value)
  return <span className={`${size} ${late ? 'font-medium text-danger' : now ? 'font-medium text-accent' : 'text-muted'}`}>{formatDate(value)}</span>
}

// Kompakte Anzeige (Listen, Karten)
const REPEAT_OPTIONS = Object.entries(REPEATS).map(([id, name]) => ({ id, name, color: 'petrol' }))

// Andere Punkte derselben Liste als Auswahl für "Abhängig von"
function depOptions(app, db, rowId) {
  return (db ? app?.rowsOf(db.id) ?? [] : [])
    .filter((r) => r.id !== rowId)
    .map((r) => ({ id: r.id, name: `${formatNr(db, r.props?.nr)} ${r.title || 'Ohne Titel'}`.trim(), color: 'grau' }))
}

export function FieldValue({ field, value, db, done }) {
  const app = useApp()
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null
  switch (field.type) {
    case 'repeat':
      return <Chip color="petrol">↻ {REPEATS[value] ?? value}</Chip>
    case 'deps':
      return value.map((id) => {
        const r = app?.alive.get(id)
        return r ? <Chip key={id}>nach {formatNr(db, r.props?.nr) || r.title}</Chip> : null
      })
    case 'status':
    case 'select': {
      const o = option(field, value)
      return <Chip color={o.color}>{o.name}</Chip>
    }
    case 'multi':
      return value.map((v) => {
        const o = option(field, v)
        return <Chip key={v} color={o.color}>#{o.name}</Chip>
      })
    case 'date':
      return <DateText value={value} done={done} />
    case 'person':
      return <span className="text-xs text-muted">@{value}</span>
    case 'checkbox':
      return value ? <Check size={14} className="text-muted" aria-label={field.name} /> : null
    case 'nr':
      return <span className="font-mono text-xs text-faint">{formatNr(db, value)}</span>
    default:
      return <span className="truncate text-xs text-muted">{String(value)}</span>
  }
}

const inputCls = 'w-full min-w-0 rounded bg-transparent px-1.5 py-1 outline-none hover:bg-hover focus:bg-raised focus:ring-1 focus:ring-accent'

// Bearbeiten in Tabelle und Eigenschaftenfeld; onChange(wert) speichert sofort
export function FieldEditor({ field, value, db, onChange, onAddOption, withTime, rowId }) {
  const [menu, setMenu] = useState(null)
  const app = useApp()
  const open = (e) => setMenu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4 })

  // Wiederholung und Abhängigkeit nutzen die Auswahl-Bedienung mit eigenen Optionen
  if (field.type === 'repeat') return <FieldEditor field={{ ...field, type: 'select', options: REPEAT_OPTIONS }} value={value} db={db} onChange={onChange} />
  if (field.type === 'deps') return <FieldEditor field={{ ...field, type: 'multi', plain: true, options: depOptions(app, db, rowId) }} value={value} db={db} onChange={onChange} />

  switch (field.type) {
    case 'nr':
      return <span className="whitespace-nowrap px-1.5 font-mono text-xs text-faint">{formatNr(db, value) || '–'}</span>
    case 'checkbox':
      return (
        <span className="px-1.5">
          <input type="checkbox" aria-label={field.name} checked={!!value} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        </span>
      )
    case 'date':
      return <DateEditor field={field} value={value} onChange={onChange} withTime={withTime} />
    case 'status':
    case 'select':
    case 'multi': {
      const multi = field.type === 'multi'
      const values = multi ? value ?? [] : value ? [value] : []
      const pick = (id) => {
        if (!multi) return onChange(id === value ? null : id), setMenu(null)
        onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id])
      }
      return (
        <>
          <button onClick={open} aria-label={field.name} className="flex min-h-7 w-full flex-wrap items-center gap-1 rounded px-1.5 py-1 text-left hover:bg-hover">
            {values.length ? values.map((v) => {
              const o = option(field, v)
              return <Chip key={v} color={o.color}>{multi && !field.plain ? `#${o.name}` : o.name}</Chip>
            }) : <span className="text-faint">–</span>}
          </button>
          {menu && (
            <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
              {(field.options ?? []).map((o) => (
                <MenuItem key={o.id} onClick={() => pick(o.id)}>
                  <span className="flex flex-1 items-center justify-between gap-3">
                    <Chip color={o.color}>{multi && !field.plain ? `#${o.name}` : o.name}</Chip>
                    {values.includes(o.id) && <Check size={14} />}
                  </span>
                </MenuItem>
              ))}
              {multi && onAddOption && <NewOption onAdd={(name) => { onAddOption(name); onChange([...values, name]) }} />}
              {!multi && value && (
                <>
                  <div className="my-1 border-t border-line" />
                  <MenuItem onClick={() => (onChange(null), setMenu(null))}>Leeren</MenuItem>
                </>
              )}
            </Menu>
          )}
        </>
      )
    }
    default:
      return <TextInput field={field} value={value} onChange={onChange} />
  }
}

// Zeigt "Fr., 30. Okt." statt TT.MM.JJJJ; Klick öffnet den Kalender des Systems.
// Eine vorhandene Uhrzeit bleibt beim Datumswechsel erhalten; withTime zeigt ein Uhrzeitfeld daneben.
function DateEditor({ field, value, onChange, withTime }) {
  const ref = useRef(null)
  const time = timeOf(value)
  return (
    <span className="group/date relative flex items-center gap-1">
      <button
        aria-label={`${field.name}: ${value ? formatDate(value) : 'leer'}`}
        onClick={() => ref.current?.showPicker()}
        className="flex-1 whitespace-nowrap rounded px-1.5 py-1 text-left hover:bg-hover"
      >
        {value ? <DateText value={withTime ? dayOf(value) : value} size="" /> : <span className="text-faint">–</span>}
      </button>
      {value && (
        <button aria-label={`${field.name} leeren`} onClick={() => onChange(null)} className="invisible shrink-0 rounded p-0.5 text-faint hover:text-text focus:visible group-hover/date:visible">
          <X size={12} />
        </button>
      )}
      {withTime && value && (
        <input
          type="time"
          aria-label={`${field.name}: Uhrzeit`}
          value={time ?? ''}
          onChange={(e) => onChange(e.target.value ? `${dayOf(value)}T${e.target.value}` : dayOf(value))}
          className={`w-24 shrink-0 rounded bg-transparent px-1 py-0.5 hover:bg-hover focus:bg-raised focus:outline-none focus:ring-1 focus:ring-accent ${time ? '' : 'text-faint'}`}
        />
      )}
      <input
        ref={ref}
        type="date"
        tabIndex={-1}
        aria-hidden
        value={dayOf(value) ?? ''}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}${time ? `T${time}` : ''}` : null)}
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
      />
    </span>
  )
}

function TextInput({ field, value, onChange }) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => setText(value ?? ''), [value])
  const commit = () => {
    const v = field.type === 'number' ? (text === '' ? null : Number(text.replace(',', '.'))) : text.trim() || null
    if (v !== (value ?? null) && !Number.isNaN(v)) onChange(v)
  }
  return (
    <span className="flex items-center">
      <input
        aria-label={field.name}
        value={text}
        inputMode={field.type === 'number' ? 'decimal' : undefined}
        placeholder="–"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className={`${inputCls} placeholder:text-faint ${field.type === 'number' ? 'text-right tabular-nums' : ''}`}
      />
      {field.type === 'link' && /^https?:\/\//i.test(value ?? '') && (
        <button aria-label="Link öffnen" title="Link öffnen" onClick={() => openUrl(value)} className="ml-1 text-muted hover:text-text">
          <ArrowSquareOut size={14} />
        </button>
      )}
    </span>
  )
}

function NewOption({ onAdd }) {
  const [name, setName] = useState('')
  return (
    <div className="border-t border-line p-1 pt-2">
      <input
        value={name}
        placeholder="Neuer Tag, Enter"
        aria-label="Neuer Tag"
        onChange={(e) => setName(e.target.value.replace(/\s+/g, '-'))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name) onAdd(name.replace(/^#/, '')), setName('')
        }}
        className="w-full rounded border border-line bg-bg px-2 py-1 outline-none focus:border-accent"
      />
    </div>
  )
}

// Eigenschaften eines Punkts über dem Seiteninhalt
export function PropsPanel({ fields, row, db, onProps, onAddOption }) {
  return (
    <dl className="mb-8 grid grid-cols-[9rem_1fr] items-center gap-x-3 gap-y-0.5 border-b border-line pb-5">
      {fields.map((f) => (
        <div key={f.id} className="contents">
          <dt className="truncate text-muted">{f.name}</dt>
          <dd className="min-w-0">
            <FieldEditor
              field={f}
              value={row.props?.[f.id]}
              db={db}
              onChange={(v) => onProps({ ...row.props, [f.id]: v })}
              onAddOption={onAddOption && ((name) => onAddOption(f.id, name))}
              rowId={row.id}
              withTime
            />
          </dd>
        </div>
      ))}
    </dl>
  )
}
