import { useId, useState } from 'react'
import { PencilSimple, Plus, Warning, X } from '@phosphor-icons/react'
import Select from './Select.jsx'
import { ConfirmButton } from './Overview.jsx'
import { useApp } from './ctx.js'
import { REPEATS, newId } from './fields.js'
import { DUE_AT, ME, THEN_TYPES, WHEN_TYPES, clearFields, copyRules, describeRule, ruleProblem, ruleTemplates, setFields, tagFields, whenFields, withRuleTags } from './rules.js'

const field = 'w-full rounded-md border border-line bg-bg px-2 py-1 outline-none focus:border-accent'
const check = 'size-4 shrink-0 accent-[var(--accent)]'
const quiet = 'rounded-md px-2 py-1 text-sm text-muted hover:bg-hover hover:text-text'

// Art einer Aktion im Formular; „Tag entfernen“ ist intern ein Tag mit remove
const kindOf = (a) => (a.type === 'tag' ? (a.remove ? 'untag' : 'tag') : a.type)

function newAction(kind, fields) {
  if (kind === 'notify') return { type: 'notify', text: '' }
  if (kind === 'tag' || kind === 'untag') return { type: 'tag', field: tagFields(fields)[0]?.id, tag: '', remove: kind === 'untag' }
  if (kind === 'clear') return { type: 'clear', field: clearFields(fields)[0]?.id }
  const f = setFields(fields)[0]
  return { type: 'set', field: f?.id, ...(f?.type === 'date' ? { rel: 'now' } : {}) }
}

// Felder, die eine Aktion dieser Art nehmen kann
const fieldsFor = (kind, fields) => (kind === 'set' ? setFields(fields) : kind === 'clear' ? clearFields(fields) : tagFields(fields))

function FieldSelect({ value, options, label, onChange }) {
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label} className={field}>
      {options.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </Select>
  )
}

// Wert eines Felds, passend zu seinem Typ
function ValueInput({ f, value, label, onChange }) {
  const app = useApp()
  const list = useId()
  if (f.type === 'person') {
    return (
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label} className={field}>
        <option value="">Person wählen …</option>
        <option value={ME}>Ich selbst</option>
        {(app?.people ?? []).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
      </Select>
    )
  }
  if (f.type === 'checkbox') {
    return (
      <Select value={value ? '1' : '0'} onChange={(e) => onChange(e.target.value === '1')} aria-label={label} className={field}>
        <option value="1">Angehakt</option>
        <option value="0">Nicht angehakt</option>
      </Select>
    )
  }
  if (f.type === 'repeat' || (f.options && f.type !== 'multi')) {
    const options = f.type === 'repeat' ? Object.entries(REPEATS).map(([id, name]) => ({ id, name })) : f.options
    return (
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label} className={field}>
        <option value="">Wert wählen …</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
    )
  }
  if (f.type === 'multi') {
    return (
      <>
        <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} list={list} aria-label={label} placeholder="Tag" className={field} />
        <datalist id={list}>{f.options?.map((o) => <option key={o.id} value={o.name} />)}</datalist>
      </>
    )
  }
  return <input type={f.type === 'number' ? 'number' : 'text'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder="Wert" className={field} />
}

function DateValue({ action, onChange }) {
  const rel = action.rel ?? 'now'
  return (
    <div className="flex items-center gap-2">
      <Select value={rel} onChange={(e) => onChange({ rel: e.target.value })} aria-label="Datum" className={field}>
        <option value="now">Jetzt (mit Uhrzeit)</option>
        <option value="today">Heute</option>
        <option value="days">Heute plus Tage</option>
      </Select>
      {rel === 'days' && <input type="number" min="0" value={action.days ?? 7} onChange={(e) => onChange({ days: Number(e.target.value) })} aria-label="Tage" className={`${field} !w-20`} />}
    </div>
  )
}

function ActionEditor({ action, fields, tagsToo, onChange, onRemove }) {
  const kind = kindOf(action)
  const f = fields.find((x) => x.id === action.field)
  const kinds = Object.entries(THEN_TYPES).filter(([k]) => tagsToo || (k !== 'tag' && k !== 'untag'))
  return (
    <div className="space-y-1.5 rounded-md border border-line bg-raised p-2">
      <div className="flex items-center gap-1">
        <Select value={kind} onChange={(e) => onChange(newAction(e.target.value, fields))} aria-label="Aktion" className={field}>
          {kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </Select>
        <button aria-label="Aktion entfernen" title="Aktion entfernen" onClick={onRemove} className="shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-text"><X size={14} /></button>
      </div>
      {kind !== 'notify' && (
        <FieldSelect
          value={action.field}
          options={fieldsFor(kind === 'untag' ? 'tag' : kind, fields)}
          label="Feld der Aktion"
          onChange={(id) => {
            const next = fields.find((x) => x.id === id)
            onChange({ ...action, field: id, value: undefined, ...(next?.type === 'date' ? { rel: 'now' } : {}) })
          }}
        />
      )}
      {kind === 'set' && f && (f.type === 'date' ? <DateValue action={action} onChange={(p) => onChange({ ...action, ...p })} /> : <ValueInput f={f} value={action.value} label={`Wert für ${f.name}`} onChange={(value) => onChange({ ...action, value })} />)}
      {(kind === 'tag' || kind === 'untag') && f && <ValueInput f={f} value={action.tag} label="Tag" onChange={(tag) => onChange({ ...action, tag })} />}
      {kind === 'notify' && <input value={action.text ?? ''} onChange={(e) => onChange({ ...action, text: e.target.value })} aria-label="Text der Meldung" placeholder="Text (leer: Titel des Punkts)" className={field} />}
    </div>
  )
}

function RuleEditor({ rule, fields, onSave, onCancel }) {
  const [draft, setDraft] = useState(rule)
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const { when, then } = draft
  const f = fields.find((x) => x.id === when.field)
  const setWhen = (patch) => set({ when: { ...when, ...patch } })
  const problem = ruleProblem(draft, fields)
  const hasTags = tagFields(fields).length > 0
  const canRevert = ['value', 'filled', 'emptied'].includes(when.type) && then.some((a) => a.type === 'set' || (a.type === 'tag' && !a.remove))
  const canOverwrite = then.some((a) => a.type === 'set')
  const whenTypes = Object.entries(WHEN_TYPES).filter(([t]) => t === 'created' || whenFields(fields, t).length)

  function changeType(type) {
    const first = whenFields(fields, type)[0]?.id
    set({ when: type === 'created' ? { type } : type === 'due' ? { type, field: first, at: 'due', days: 3 } : type === 'value' ? { type, field: first, value: '' } : { type, field: first } })
  }

  return (
    <div className="space-y-3">
      <section>
        <h3 className="mb-1.5 font-medium">Wenn</h3>
        <div className="space-y-1.5">
          <Select value={when.type} onChange={(e) => changeType(e.target.value)} aria-label="Auslöser" className={field}>
            {whenTypes.map(([t, label]) => <option key={t} value={t}>{label}</option>)}
          </Select>
          {when.type !== 'created' && <FieldSelect value={when.field} options={whenFields(fields, when.type)} label="Feld der Bedingung" onChange={(id) => setWhen({ field: id, ...(when.type === 'value' ? { value: '' } : {}) })} />}
          {when.type === 'value' && f && <ValueInput f={f} value={when.value} label={`Wert von ${f.name}`} onChange={(value) => setWhen({ value })} />}
          {when.type === 'due' && (
            <div className="flex items-center gap-2">
              <Select value={when.at ?? 'due'} onChange={(e) => setWhen({ at: e.target.value })} aria-label="Zeitpunkt" className={field}>
                {Object.entries(DUE_AT).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </Select>
              {when.at === 'before' && <input type="number" min="0" value={when.days ?? 3} onChange={(e) => setWhen({ days: Number(e.target.value) })} aria-label="Tage vorher" className={`${field} !w-20`} />}
            </div>
          )}
          {when.type === 'due' && <p className="text-xs text-muted">Läuft von selbst, solange Nexora läuft: je Punkt und Datum einmal, auch für Termine, die schon erreicht sind. Erledigte Punkte bleiben außen vor.</p>}
        </div>
      </section>

      <section>
        <h3 className="mb-1.5 font-medium">Dann</h3>
        <div className="space-y-1.5">
          {then.map((a, i) => (
            <ActionEditor
              key={i}
              action={a}
              fields={fields}
              tagsToo={hasTags}
              onChange={(next) => set({ then: then.map((x, j) => (j === i ? next : x)) })}
              onRemove={() => set({ then: then.filter((_, j) => j !== i) })}
            />
          ))}
          <button onClick={() => set({ then: [...then, newAction('set', fields)] })} className={`flex items-center gap-1 ${quiet}`}><Plus size={14} /> Weitere Aktion</button>
        </div>
      </section>

      {(canOverwrite || canRevert) && (
        <section className="space-y-1.5">
          {canOverwrite && (
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={!!draft.overwrite} onChange={(e) => set({ overwrite: e.target.checked })} className={`${check} mt-0.5`} />
              <span>Vorhandenen Wert überschreiben <span className="block text-xs text-muted">Sonst füllt die Regel nur leere Felder.</span></span>
            </label>
          )}
          {canRevert && (
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={!!draft.revert} onChange={(e) => set({ revert: e.target.checked })} className={`${check} mt-0.5`} />
              <span>Wieder wegnehmen, wenn die Bedingung nicht mehr gilt <span className="block text-xs text-muted">Leert gesetzte Felder und entfernt hinzugefügte Tags, z. B. wenn ein Punkt doch nicht erledigt ist.</span></span>
            </label>
          )}
        </section>
      )}

      <label className="block">
        <span className="mb-1 block text-sm text-muted">Name (optional)</span>
        <input value={draft.name ?? ''} onChange={(e) => set({ name: e.target.value })} className={field} />
      </label>

      <div aria-live="polite" className="rounded-md bg-accent-soft px-2.5 py-2 text-sm">
        {problem ? <span role="alert" className="text-danger">{problem}</span> : describeRule(draft, fields)}
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-md px-3 py-1.5 hover:bg-hover">Abbrechen</button>
        <button disabled={!!problem} onClick={() => onSave(draft)} className="rounded-md bg-accent px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:text-bg">Speichern</button>
      </div>
    </div>
  )
}

// Regeln einer Liste: anlegen, ändern, Vorlagen, von anderer Liste übernehmen
export default function RulesPanel({ db, config, onConfig, onClose }) {
  const app = useApp()
  const fields = config.fields
  const rules = config.rules ?? []
  const [editing, setEditing] = useState(null)
  const [note, setNote] = useState('')
  const [source, setSource] = useState('')
  const setRules = (next, nextFields = fields) => onConfig({ ...config, rules: next, fields: nextFields })
  const others = (app?.databases ?? []).filter((d) => d.id !== db.id && d.config?.rules?.length)
  const used = new Set(rules.map((r) => r.template))
  const templates = ruleTemplates(fields).filter((t) => !used.has(t.id))

  function fresh() {
    const first = whenFields(fields, 'value')[0]
    return { id: newId(), name: '', enabled: true, overwrite: false, revert: false, when: first ? { type: 'value', field: first.id, value: '' } : { type: 'created' }, then: [newAction('set', fields)] }
  }
  function save(rule) {
    const known = rules.some((r) => r.id === rule.id)
    setRules(known ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule], withRuleTags(fields, rule))
    setEditing(null)
    setNote('')
  }
  function addTemplate(t) {
    setRules([...rules, { ...t.rule, template: t.id }], t.addField ? [...fields, t.addField] : fields)
    setNote(`Regel „${t.label}“ ist aktiv.`)
  }
  function take() {
    const from = others.find((d) => d.id === source)
    if (!from) return
    const { rules: copied, skipped } = copyRules(from.config.rules, from.config.fields, fields)
    const tagged = copied.reduce(withRuleTags, fields)
    setRules([...rules, ...copied], tagged)
    setNote(`${copied.length} ${copied.length === 1 ? 'Regel' : 'Regeln'} übernommen${skipped ? `, ${skipped} ${skipped === 1 ? 'passte' : 'passten'} nicht zu den Feldern dieser Liste` : ''}.`)
    setSource('')
  }

  return (
    <aside aria-label="Regeln" className="anim-panel flex w-96 shrink-0 flex-col border-l border-line bg-side">
      <div className="flex h-12 items-center justify-between px-4">
        <h2 className="font-semibold">{editing ? (rules.some((r) => r.id === editing.id) ? 'Regel ändern' : 'Neue Regel') : 'Regeln'}</h2>
        <button aria-label="Schließen" onClick={onClose} className="rounded p-1 text-muted hover:bg-hover hover:text-text"><X size={16} /></button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-6">
        {editing ? (
          <RuleEditor key={editing.id} rule={editing} fields={fields} onSave={save} onCancel={() => setEditing(null)} />
        ) : (
          <>
            <p className="text-sm text-muted">Regeln füllen Felder von selbst, wenn sich etwas ändert. Sie reagieren auf deine Änderungen, nicht aufeinander. Strg+Z nimmt deine Änderung mitsamt der Regel zurück, im Verlauf des Punkts steht, was passiert ist.</p>
            {note && <p role="status" className="rounded-md bg-accent-soft px-2.5 py-2 text-sm">{note}</p>}
            {rules.length > 0 && (
              <ul className="space-y-2">
                {rules.map((r) => {
                  const problem = ruleProblem(r, fields)
                  return (
                    <li key={r.id} className="rounded-lg border border-line bg-raised p-2.5">
                      <div className="flex items-start gap-2">
                        <input type="checkbox" checked={r.enabled} aria-label={`Regel ${r.name || describeRule(r, fields)} eingeschaltet`} onChange={(e) => setRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))} className={`${check} mt-0.5`} />
                        <div className="min-w-0 flex-1 text-sm">
                          {r.name && <div className="font-medium">{r.name}</div>}
                          <div className={r.enabled ? '' : 'text-muted'}>{describeRule(r, fields)}</div>
                          {problem && <div className="mt-1 flex items-start gap-1 text-danger"><Warning size={14} className="mt-0.5 shrink-0" /> {problem} Die Regel läuft nicht.</div>}
                        </div>
                        <button aria-label="Regel ändern" title="Ändern" onClick={() => (setEditing(r), setNote(''))} className="shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-text"><PencilSimple size={14} /></button>
                        <ConfirmButton compact onConfirm={() => setRules(rules.filter((x) => x.id !== r.id))} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            <button onClick={() => (setEditing(fresh()), setNote(''))} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-white dark:text-bg"><Plus size={14} weight="bold" /> Neue Regel</button>

            {templates.length > 0 && (
              <section>
                <h3 className="mb-1.5 font-medium">Vorlagen</h3>
                <ul className="space-y-1.5">
                  {templates.map((t) => (
                    <li key={t.id}>
                      <button onClick={() => addTemplate(t)} className="w-full rounded-md border border-line bg-raised px-2.5 py-2 text-left hover:border-faint">
                        <span className="block font-medium">{t.label}</span>
                        <span className="block text-xs text-muted">{t.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {others.length > 0 && (
              <section>
                <h3 className="mb-1.5 font-medium">Von anderer Liste übernehmen</h3>
                <div className="flex items-center gap-2">
                  <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Liste mit Regeln" className={field}>
                    <option value="">Liste wählen …</option>
                    {others.map((d) => <option key={d.id} value={d.id}>{d.title || 'Ohne Titel'} ({d.config.rules.length})</option>)}
                  </Select>
                  <button disabled={!source} onClick={take} className="shrink-0 rounded-md border border-line px-2.5 py-1 hover:bg-hover disabled:opacity-50">Übernehmen</button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
