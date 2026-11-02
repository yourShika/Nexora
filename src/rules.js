// Regeln einer Liste (config.rules): „wenn das passiert, dann tu das“. Reine Logik, ohne Tauri (testbar).
// Regel: { id, name, enabled, when, then: [Aktion], overwrite, revert }
//   when: { type: 'value', field, value } | { type: 'filled' | 'emptied', field } | { type: 'created' }
//         | { type: 'due', field, at: 'due' | 'late' | 'before', days }
//   Aktion: { type: 'set', field, value, rel, days } | { type: 'clear', field } | { type: 'tag', field, tag, remove } | { type: 'notify', text }
// Regeln reagieren nur auf die Änderung selbst, nicht aufeinander: So kann keine Schleife entstehen.
import { REPEATS, addDays, dayOf, isDone, isLate, iso, newId, option, stamp } from './fields.js'
import { personsOf } from './people.js'

export const ME = '@ich' // Wert „ich selbst“ in Personenfeldern
export const WHEN_TYPES = { value: 'Feld bekommt einen Wert', filled: 'Feld wird gefüllt', emptied: 'Feld wird geleert', created: 'Neuer Punkt', due: 'Termin erreicht' }
export const THEN_TYPES = { set: 'Feld setzen', clear: 'Feld leeren', tag: 'Tag hinzufügen', untag: 'Tag entfernen', notify: 'Windows-Meldung' }
export const DUE_AT = { due: 'Termin ist erreicht', late: 'Termin ist überschritten', before: 'Tage vor dem Termin' }

// Felder, die Regeln lesen und setzen können; Nummer und Abhängigkeit verwaltet Nexora selbst
const USABLE = new Set(['text', 'number', 'status', 'select', 'multi', 'date', 'person', 'checkbox', 'link', 'repeat'])
export const whenFields = (fields, type) => fields.filter((f) => USABLE.has(f.type) && (type === 'due' ? f.type === 'date' : type === 'value' ? f.type !== 'date' : true))
export const setFields = (fields) => fields.filter((f) => USABLE.has(f.type) && f.type !== 'multi')
export const clearFields = (fields) => fields.filter((f) => USABLE.has(f.type) && f.type !== 'status')
export const tagFields = (fields) => fields.filter((f) => f.type === 'multi')

const emptyValue = (v) => v == null || v === '' || v === false || (Array.isArray(v) && !v.length)
const byId = (fields, id) => fields.find((f) => f.id === id)

function hasValue(f, props, value, me) {
  const v = props[f.id]
  if (f.type === 'multi') return (v ?? []).includes(value)
  if (f.type === 'person') {
    const want = (value === ME ? me : value)?.toLowerCase()
    return !!want && personsOf(v).some((n) => n.toLowerCase() === want)
  }
  if (f.type === 'checkbox') return !!v === !!value
  if (f.type === 'number') return v != null && v !== '' && Number(v) === Number(value)
  return v === value
}

function holds(when, f, props, me) {
  if (when.type === 'value') return hasValue(f, props, when.value, me)
  if (when.type === 'filled') return !emptyValue(props[f.id])
  if (when.type === 'emptied') return emptyValue(props[f.id])
  return false
}

// Wert für „Feld setzen“; undefined: geht gerade nicht (z. B. „ich“ ohne Namen)
function valueOf(f, a, { now, me }) {
  if (f.type === 'date') return a.rel === 'now' ? stamp(now) : a.rel === 'days' ? addDays(iso(now), Number(a.days) || 0) : iso(now)
  if (f.type === 'person') {
    const name = a.value === ME ? me : a.value
    return name ? [name] : undefined
  }
  if (f.type === 'checkbox') return !!a.value
  if (f.type === 'number') return Number(a.value)
  return a.value ?? undefined
}

// Aktionen auf props; meldet die Texte der Windows-Meldungen
function act(rule, fields, props, ctx) {
  const next = { ...props }
  const messages = []
  for (const a of rule.then) {
    if (a.type === 'notify') {
      messages.push(a.text ?? '')
      continue
    }
    const f = byId(fields, a.field)
    if (!f) continue
    if (a.type === 'clear') next[f.id] = f.type === 'multi' ? [] : null
    else if (a.type === 'tag') {
      const tags = next[f.id] ?? []
      next[f.id] = a.remove ? tags.filter((t) => t !== a.tag) : [...new Set([...tags, a.tag])]
    } else if (a.type === 'set' && (rule.overwrite || emptyValue(next[f.id]))) {
      const v = valueOf(f, a, ctx)
      if (v !== undefined) next[f.id] = v
    }
  }
  return { props: next, messages }
}

// Bedingung gilt nicht mehr: was die Regel gesetzt oder hinzugefügt hat, wieder wegnehmen
function undo(rule, fields, props) {
  const next = { ...props }
  for (const a of rule.then) {
    const f = byId(fields, a.field)
    if (!f) continue
    if (a.type === 'set') next[f.id] = null
    else if (a.type === 'tag' && !a.remove) next[f.id] = (next[f.id] ?? []).filter((t) => t !== a.tag)
  }
  return next
}

// Hat sich etwas geändert? Leer bleibt leer, egal ob fehlend, null oder []
const same = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => (emptyValue(a[k]) && emptyValue(b[k])) || JSON.stringify(a[k]) === JSON.stringify(b[k]))

// Änderung an einem Punkt: props nach den Regeln, und welche Regeln etwas getan haben (nur die stehen im Verlauf)
export function applyRules(rules, fields, before, after, ctx) {
  let props = after
  const fired = []
  for (const rule of rules ?? []) {
    if (!rule.enabled || !['value', 'filled', 'emptied'].includes(rule.when.type) || ruleProblem(rule, fields)) continue
    const f = byId(fields, rule.when.field)
    const was = holds(rule.when, f, before, ctx.me)
    const is = holds(rule.when, f, after, ctx.me)
    if (!was && is) {
      const r = act(rule, fields, props, ctx)
      if (r.messages.length || !same(r.props, props)) fired.push({ rule, messages: r.messages })
      props = r.props
    } else if (was && !is && rule.revert) {
      const next = undo(rule, fields, props)
      if (!same(next, props)) fired.push({ rule, messages: [], reverted: true })
      props = next
    }
  }
  return { props, fired }
}

// Neuer Punkt: Regeln „Neuer Punkt“; ohne Überschreiben bleibt, was beim Anlegen schon angegeben wurde
export function applyCreated(rules, fields, props, ctx) {
  let next = props
  const fired = []
  for (const rule of rules ?? []) {
    if (!rule.enabled || rule.when.type !== 'created' || ruleProblem(rule, fields)) continue
    const r = act(rule, fields, next, ctx)
    if (r.messages.length || !same(r.props, next)) fired.push({ rule, messages: r.messages })
    next = r.props
  }
  return { props: next, fired }
}

function reached(when, v, now) {
  if (when.at === 'late') return isLate(v, now)
  if (when.at === 'before') return addDays(dayOf(v), -(Number(when.days) || 0)) <= iso(now)
  return v.length > 10 ? v <= stamp(now) : v <= iso(now)
}

/*
 * Termine: Was ist jetzt fällig? Je Regel, Punkt und Datum genau einmal (seen: Set von Schlüsseln); ändert man das Datum, greift
 * die Regel wieder. Erledigte Punkte bleiben außen vor. Eine neue Regel greift auch bei Terminen, die schon erreicht sind.
 * Ergebnis: [{ row, props, fired: [{ rule, messages }], keys }]
 */
export function dueChanges(rules, fields, rows, seen, ctx) {
  const out = []
  const active = (rules ?? []).filter((r) => r.enabled && r.when.type === 'due' && !ruleProblem(r, fields))
  if (!active.length) return out
  for (const row of rows) {
    if (isDone(row, fields)) continue
    let props = row.props ?? {}
    const fired = []
    const keys = []
    for (const rule of active) {
      const v = props[rule.when.field] ?? row.props?.[rule.when.field]
      if (!v) continue
      const key = `${rule.id}|${row.id}|${v}`
      if (seen.has(key) || !reached(rule.when, v, ctx.now)) continue
      const r = act(rule, fields, props, ctx)
      if (r.messages.length || !same(r.props, props)) fired.push({ rule, messages: r.messages })
      props = r.props
      keys.push(key) // auch ohne Wirkung gemerkt: Der Termin ist für diese Regel erledigt
    }
    if (keys.length) out.push({ row, props, fired, keys })
  }
  return out
}

// Gemerkte Läufe: was lange vorbei ist, kann weg
export const pruneSeen = (keys, now) => {
  const limit = addDays(iso(now), -180)
  return keys.filter((k) => (k.split('|')[2] ?? '').slice(0, 10) >= limit)
}

// Was an einer Regel nicht (mehr) passt; leer, wenn sie laufen kann
export function ruleProblem(rule, fields) {
  const { when } = rule
  if (when.type !== 'created') {
    const f = byId(fields, when.field)
    if (!f) return 'Das Feld der Bedingung gibt es nicht mehr.'
    if (when.type === 'value') {
      if (when.value == null || when.value === '') return 'Bitte einen Wert für die Bedingung wählen.'
      if (f.options && f.type !== 'multi' && !f.options.some((o) => o.id === when.value)) return `„${f.name}“ hat diesen Wert nicht mehr.`
    }
    if (when.type === 'due' && f.type !== 'date') return 'Die Bedingung braucht ein Datumsfeld.'
  }
  if (!rule.then.length) return 'Bitte mindestens eine Aktion wählen.'
  for (const a of rule.then) {
    if (a.type === 'notify') continue
    const f = byId(fields, a.field)
    if (!f) return 'Das Feld einer Aktion gibt es nicht mehr.'
    if (a.type === 'tag' && !a.tag?.trim()) return 'Bitte den Tag angeben.'
    if (a.type === 'set' && f.type !== 'date' && f.type !== 'checkbox' && (a.value == null || a.value === '')) return `Bitte einen Wert für „${f.name}“ wählen.`
    if (a.type === 'set' && f.options && !f.options.some((o) => o.id === a.value)) return `„${f.name}“ hat diesen Wert nicht mehr.`
  }
  return ''
}

function valueName(f, value) {
  if (f.type === 'person') return value === ME ? 'mich' : value
  if (f.type === 'checkbox') return value ? 'angehakt' : 'nicht angehakt'
  if (f.type === 'repeat') return REPEATS[value] ?? value
  return f.options ? option(f, value)?.name ?? value : value
}

function whenText(when, fields) {
  if (when.type === 'created') return 'Neuer Punkt'
  const f = byId(fields, when.field)
  const name = f?.name ?? 'Feld fehlt'
  if (when.type === 'filled') return `Wenn ${name} gefüllt wird`
  if (when.type === 'emptied') return `Wenn ${name} geleert wird`
  if (when.type === 'due') return when.at === 'late' ? `Wenn ${name} überschritten ist` : when.at === 'before' ? `${Number(when.days) || 0} Tage vor ${name}` : `Wenn ${name} erreicht ist`
  if (!f) return name
  if (f.type === 'multi' || f.type === 'person') return `Wenn ${name} „${valueName(f, when.value)}“ enthält`
  return `Wenn ${name} „${valueName(f, when.value)}“ wird`
}

function thenText(a, fields) {
  if (a.type === 'notify') return a.text ? `Windows-Meldung „${a.text}“` : 'Windows-Meldung'
  const f = byId(fields, a.field)
  const name = f?.name ?? 'Feld fehlt'
  if (a.type === 'clear') return `${name} leeren`
  if (a.type === 'tag') return `Tag „${a.tag}“ ${a.remove ? 'entfernen' : 'hinzufügen'}`
  if (f?.type === 'date') return `${name} auf ${a.rel === 'now' ? 'jetzt' : a.rel === 'days' ? `heute + ${Number(a.days) || 0} Tage` : 'heute'} setzen`
  return `${name} auf „${f ? valueName(f, a.value) : a.value}“ setzen`
}

// Regel in Klartext
export const describeRule = (rule, fields) => `${whenText(rule.when, fields)}: ${rule.then.map((a) => thenText(a, fields)).join(', ') || 'noch nichts'}`
export const ruleTitle = (rule, fields) => rule.name?.trim() || describeRule(rule, fields)

// Beim Speichern: neue Tags aus der Regel als Auswahl im Feld ergänzen
export function withRuleTags(fields, rule) {
  const wanted = new Map()
  const note = (id, tag) => tag?.trim() && wanted.set(id, [...(wanted.get(id) ?? []), tag.trim()])
  if (rule.when.type === 'value' && byId(fields, rule.when.field)?.type === 'multi') note(rule.when.field, rule.when.value)
  for (const a of rule.then) if (a.type === 'tag') note(a.field, a.tag)
  return fields.map((f) => {
    const add = (wanted.get(f.id) ?? []).filter((t) => !f.options?.some((o) => o.id === t))
    return add.length ? { ...f, options: [...(f.options ?? []), ...[...new Set(add)].map((t) => ({ id: t, name: t, color: 'grau' }))] } : f
  })
}

const rule = (when, then, extra = {}) => ({ id: newId(), name: '', enabled: true, when, then, overwrite: false, revert: false, ...extra })

// Fertige Vorlagen; nur, was mit den Feldern der Liste geht. addField: wird dafür angelegt
export function ruleTemplates(fields) {
  const status = fields.find((f) => f.type === 'status')
  const done = status?.options.find((o) => o.done)
  const person = fields.find((f) => f.type === 'person')
  const due = byId(fields, 'due') ?? fields.find((f) => f.type === 'date' && /fällig|due|termin/i.test(f.name))
  const followup = byId(fields, 'followup')
  const prio = fields.find((f) => f.type === 'select' && /prio/i.test(f.name))
  const high = prio?.options.find((o) => /hoch|high/i.test(o.name))
  const stamped = fields.find((f) => f.type === 'date' && (f.id === 'doneAt' || /erledigt/i.test(f.name)))
  const list = []
  if (done) {
    const target = stamped ?? { id: 'doneAt', name: 'Erledigt am', type: 'date' }
    list.push({
      id: 'erledigt-datum',
      label: `${done.name}: Datum eintragen`,
      text: `Trägt Datum und Uhrzeit in „${target.name}“ ein${stamped ? '' : ' (Feld wird angelegt)'} und leert es wieder, wenn der Punkt doch nicht ${done.name.toLowerCase()} ist.`,
      addField: stamped ? null : target,
      rule: rule({ type: 'value', field: status.id, value: done.id }, [{ type: 'set', field: target.id, rel: 'now' }], { revert: true }),
    })
  }
  if (done && followup) list.push({ id: 'erledigt-wiedervorlage', label: `${done.name}: Wiedervorlage entfernen`, text: 'Ein erledigter Punkt muss nicht wieder vorgelegt werden.', rule: rule({ type: 'value', field: status.id, value: done.id }, [{ type: 'clear', field: followup.id }]) })
  if (person) list.push({ id: 'neu-mir', label: 'Neuer Punkt: mir zuweisen', text: `Setzt dich als „${person.name}“, wenn niemand angegeben ist.`, rule: rule({ type: 'created' }, [{ type: 'set', field: person.id, value: ME }]) })
  if (due) list.push({ id: 'neu-faellig', label: 'Neuer Punkt: in 7 Tagen fällig', text: `Füllt „${due.name}“, wenn beim Anlegen nichts angegeben ist.`, rule: rule({ type: 'created' }, [{ type: 'set', field: due.id, rel: 'days', days: 7 }]) })
  if (due && high) list.push({ id: 'ueberfaellig-hoch', label: `Überfällig: Priorität ${high.name} und Meldung`, text: 'Setzt die Priorität und meldet sich, sobald der Termin überschritten ist.', rule: rule({ type: 'due', field: due.id, at: 'late' }, [{ type: 'set', field: prio.id, value: high.id }, { type: 'notify', text: '' }], { overwrite: true }) })
  return list
}

// Regeln einer anderen Liste übernehmen: Felder und Auswahlwerte nach ID, sonst nach Name; was nicht passt, fällt weg
export function copyRules(rules, from, to) {
  const field = (id) => {
    const f = byId(from, id)
    return f && (to.find((x) => x.id === f.id && x.type === f.type) ?? to.find((x) => x.name === f.name && x.type === f.type))
  }
  const opt = (id, src, dst) => {
    if (!dst?.options || dst.type === 'multi') return id
    const o = src.options?.find((x) => x.id === id)
    return (dst.options.find((x) => x.id === id) ?? dst.options.find((x) => x.name === o?.name))?.id
  }
  const out = []
  let skipped = 0
  for (const r of rules) {
    const when = { ...r.when }
    if (when.field) {
      const t = field(when.field)
      if (t && when.value != null) when.value = opt(when.value, byId(from, when.field), t)
      when.field = t?.id
    }
    const then = r.then.map((a) => {
      if (!a.field) return a
      const t = field(a.field)
      return { ...a, field: t?.id, ...(a.type === 'set' && a.value != null ? { value: opt(a.value, byId(from, a.field), t) } : {}) }
    })
    const copy = { ...r, id: newId(), when, then }
    if (ruleProblem(copy, to)) skipped++
    else out.push(copy)
  }
  return { rules: out, skipped }
}
