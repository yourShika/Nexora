import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ME, applyCreated, applyRules, copyRules, describeRule, dueChanges, pruneSeen, ruleProblem, ruleTemplates, withRuleTags } from './rules.js'
import { lopConfig } from './fields.js'

const fields = [...lopConfig().fields, { id: 'doneAt', name: 'Erledigt am', type: 'date' }, { id: 'n', name: 'Notiz', type: 'text' }, { id: 'ok', name: 'Geprüft', type: 'checkbox' }, { id: 'menge', name: 'Menge', type: 'number' }]
const now = new Date(2026, 10, 2, 9, 30) // Mo, 2.11.2026
const ctx = { now, me: 'Kim' }
const rule = (when, then, extra = {}) => ({ id: 'r', enabled: true, when, then, ...extra })
const done = { type: 'value', field: 'status', value: 'erledigt' }
const stampIt = { type: 'set', field: 'doneAt', rel: 'now' }
const run = (rules, before, after) => applyRules(rules, fields, before, after, ctx)

test('Feld bekommt einen Wert: greift beim Übergang, nicht danach', () => {
  const r = [rule(done, [stampIt])]
  const a = run(r, { status: 'offen' }, { status: 'erledigt' })
  assert.equal(a.props.doneAt, '2026-11-02T09:30')
  assert.equal(a.fired.length, 1)
  // war schon erledigt: anderes Feld ändert sich, Regel greift nicht noch einmal
  const b = run(r, { status: 'erledigt', doneAt: '2026-10-01' }, { status: 'erledigt', doneAt: '2026-10-01', prio: 'hoch' })
  assert.equal(b.props.doneAt, '2026-10-01')
  assert.equal(b.fired.length, 0)
  // andere Option: nichts
  assert.equal(run(r, { status: 'offen' }, { status: 'wartet' }).fired.length, 0)
  // ausgeschaltet: nichts
  assert.equal(run([rule(done, [stampIt], { enabled: false })], { status: 'offen' }, { status: 'erledigt' }).fired.length, 0)
})

test('Überschreiben und Zurücknehmen je Regel', () => {
  const before = { status: 'offen', doneAt: '2026-01-01' }
  const after = { status: 'erledigt', doneAt: '2026-01-01' }
  assert.equal(run([rule(done, [stampIt])], before, after).props.doneAt, '2026-01-01', 'ohne Überschreiben bleibt der Wert')
  assert.equal(run([rule(done, [stampIt], { overwrite: true })], before, after).props.doneAt, '2026-11-02T09:30')
  // zurück auf Offen
  const back = (extra) => run([rule(done, [stampIt, { type: 'tag', field: 'tags', tag: 'fertig' }, { type: 'tag', field: 'tags', tag: 'x', remove: true }, { type: 'clear', field: 'followup' }], extra)], { status: 'erledigt', doneAt: '2026-11-01', tags: ['fertig', 'a'], followup: '2026-12-01' }, { status: 'offen', doneAt: '2026-11-01', tags: ['fertig', 'a'], followup: '2026-12-01' })
  const off = back({})
  assert.equal(off.props.doneAt, '2026-11-01', 'ohne Zurücknehmen bleibt alles')
  assert.equal(off.fired.length, 0)
  const on = back({ revert: true })
  assert.equal(on.props.doneAt, null)
  assert.deepEqual(on.props.tags, ['a'], 'nur der hinzugefügte Tag geht wieder')
  assert.equal(on.props.followup, '2026-12-01', 'Geleertes lässt sich nicht wiederherstellen und bleibt')
  assert.equal(on.fired[0].reverted, true)
})

test('Alle Feldarten als Bedingung', () => {
  const fire = (when, before, after) => run([rule(when, [{ type: 'notify', text: 'x' }])], before, after).fired.length
  assert.equal(fire({ type: 'value', field: 'tags', value: 'a' }, { tags: ['b'] }, { tags: ['b', 'a'] }), 1)
  assert.equal(fire({ type: 'value', field: 'tags', value: 'a' }, { tags: ['a'] }, { tags: ['a', 'c'] }), 0)
  assert.equal(fire({ type: 'value', field: 'person', value: 'kim' }, {}, { person: ['Kim', 'Lou'] }), 1, 'Name ohne Groß/klein')
  assert.equal(fire({ type: 'value', field: 'person', value: ME }, { person: ['Lou'] }, { person: ['Kim'] }), 1, 'ich')
  assert.equal(fire({ type: 'value', field: 'person', value: 'Kim' }, {}, { person: 'Kim' }), 1, 'alter Wert als Text')
  assert.equal(fire({ type: 'value', field: 'ok', value: true }, { ok: false }, { ok: true }), 1)
  assert.equal(fire({ type: 'value', field: 'ok', value: false }, { ok: true }, { ok: false }), 1)
  assert.equal(fire({ type: 'value', field: 'menge', value: '5' }, { menge: 4 }, { menge: 5 }), 1)
  assert.equal(fire({ type: 'value', field: 'n', value: 'x' }, { n: 'y' }, { n: 'x' }), 1)
  assert.equal(fire({ type: 'filled', field: 'due' }, {}, { due: '2026-11-03' }), 1)
  assert.equal(fire({ type: 'filled', field: 'due' }, { due: '2026-11-03' }, { due: '2026-11-04' }), 0, 'nur vom Leeren zum Gefüllten')
  assert.equal(fire({ type: 'emptied', field: 'person' }, { person: ['Kim'] }, { person: [] }), 1)
  assert.equal(fire({ type: 'emptied', field: 'person' }, {}, { person: [] }), 0)
})

test('Aktionen: setzen, leeren, Tags, Meldung; keine Kettenreaktion', () => {
  const set = (a, before = {}) => run([rule({ type: 'filled', field: 'n' }, a)], before, { ...before, n: 'x' }).props
  assert.equal(set([{ type: 'set', field: 'due', rel: 'today' }]).due, '2026-11-02')
  assert.equal(set([{ type: 'set', field: 'due', rel: 'days', days: 7 }]).due, '2026-11-09')
  assert.equal(set([{ type: 'set', field: 'prio', value: 'hoch' }]).prio, 'hoch')
  assert.deepEqual(set([{ type: 'set', field: 'person', value: ME }]).person, ['Kim'])
  assert.deepEqual(set([{ type: 'set', field: 'person', value: 'Lou' }]).person, ['Lou'])
  assert.equal(set([{ type: 'set', field: 'ok', value: true }]).ok, true)
  assert.equal(set([{ type: 'set', field: 'menge', value: '3' }]).menge, 3)
  assert.equal(set([{ type: 'clear', field: 'prio' }], { prio: 'hoch' }).prio, null)
  assert.deepEqual(set([{ type: 'clear', field: 'tags' }], { tags: ['a'] }).tags, [])
  assert.deepEqual(set([{ type: 'tag', field: 'tags', tag: 'a' }], { tags: ['a', 'b'] }).tags, ['a', 'b'], 'kein doppelter Tag')
  assert.deepEqual(set([{ type: 'tag', field: 'tags', tag: 'c' }], { tags: ['a'] }).tags, ['a', 'c'])
  assert.deepEqual(set([{ type: 'tag', field: 'tags', tag: 'a', remove: true }], { tags: ['a', 'b'] }).tags, ['b'])
  assert.deepEqual(run([rule({ type: 'filled', field: 'n' }, [{ type: 'notify', text: 'Hallo' }])], {}, { n: 'x' }).fired[0].messages, ['Hallo'])
  // „ich“ ohne Namen: nichts setzen statt Unsinn
  assert.equal(applyRules([rule({ type: 'filled', field: 'n' }, [{ type: 'set', field: 'person', value: ME }])], fields, {}, { n: 'x' }, { now, me: '' }).props.person, undefined)
  // Regel A setzt Status Erledigt, Regel B hängt an Erledigt: B greift nicht, weil nur die Änderung selbst zählt
  const chain = run([rule({ type: 'filled', field: 'n' }, [{ type: 'set', field: 'status', value: 'erledigt' }], { overwrite: true }), rule(done, [stampIt])], { status: 'offen' }, { status: 'offen', n: 'x' })
  assert.equal(chain.props.status, 'erledigt')
  assert.equal(chain.props.doneAt, undefined)
  assert.equal(chain.fired.length, 1)
})

test('Neuer Punkt: füllt nur, was fehlt', () => {
  const rules = [rule({ type: 'created' }, [{ type: 'set', field: 'person', value: ME }, { type: 'set', field: 'due', rel: 'days', days: 7 }, { type: 'tag', field: 'tags', tag: 'neu' }])]
  const a = applyCreated(rules, fields, { nr: 3 }, ctx)
  assert.deepEqual(a.props, { nr: 3, person: ['Kim'], due: '2026-11-09', tags: ['neu'] })
  // Kurzsyntax hat schon Werte gesetzt
  const b = applyCreated(rules, fields, { person: ['Lou'], due: '2026-12-24' }, ctx)
  assert.deepEqual(b.props.person, ['Lou'])
  assert.equal(b.props.due, '2026-12-24')
  // Feldregeln greifen beim Anlegen nicht
  assert.equal(applyCreated([rule(done, [stampIt])], fields, { status: 'erledigt' }, ctx).fired.length, 0)
})

test('Im Verlauf steht eine Regel nur, wenn sie etwas getan hat', () => {
  const setDue = [rule({ type: 'created' }, [{ type: 'set', field: 'due', rel: 'days', days: 7 }])]
  assert.equal(applyCreated(setDue, fields, { due: '2026-12-24' }, ctx).fired.length, 0, 'Wert war schon da')
  assert.equal(applyCreated(setDue, fields, {}, ctx).fired.length, 1)
  // Bedingung trifft, aber alles ist schon so: keine Spur im Verlauf
  assert.equal(run([rule(done, [stampIt])], { status: 'offen', doneAt: 'x' }, { status: 'erledigt', doneAt: 'x' }).fired.length, 0)
  assert.equal(run([rule(done, [{ type: 'clear', field: 'prio' }])], { status: 'offen' }, { status: 'erledigt' }).fired.length, 0, 'leer bleibt leer')
  // Zurücknehmen, obwohl nichts gesetzt ist: ebenso
  assert.equal(run([rule(done, [stampIt], { revert: true })], { status: 'erledigt' }, { status: 'offen' }).fired.length, 0)
  // Meldung zählt immer
  assert.equal(run([rule(done, [{ type: 'notify', text: '' }])], { status: 'offen' }, { status: 'erledigt' }).fired.length, 1)
  // Termin: ohne Wirkung nicht im Verlauf, aber gemerkt, damit die Regel nicht ständig neu prüft
  const r = [rule({ type: 'due', field: 'due', at: 'late' }, [{ type: 'set', field: 'prio', value: 'hoch' }])]
  const [c] = dueChanges(r, fields, [{ id: 'a', props: { status: 'offen', due: '2026-11-01', prio: 'niedrig' } }], new Set(), ctx)
  assert.equal(c.fired.length, 0)
  assert.equal(c.props.prio, 'niedrig', 'ohne Überschreiben bleibt der Wert')
  assert.deepEqual(c.keys, ['r|a|2026-11-01'])
})

test('Termin erreicht: je Datum einmal, Erledigte nicht', () => {
  const row = (id, props) => ({ id, props: { status: 'offen', ...props } })
  const at = (a, days) => [rule({ type: 'due', field: 'due', at: a, days }, [{ type: 'set', field: 'prio', value: 'hoch' }, { type: 'notify', text: '' }], { overwrite: true })]
  const hits = (rules, rows, seen = new Set()) => dueChanges(rules, fields, rows, seen, ctx).map((c) => c.row.id)
  const rows = [row('gestern', { due: '2026-11-01' }), row('heute', { due: '2026-11-02' }), row('morgen', { due: '2026-11-03' }), row('in3', { due: '2026-11-05' }), row('ohne', {}), row('fertig', { due: '2026-10-01', status: 'erledigt' })]
  assert.deepEqual(hits(at('late'), rows), ['gestern'])
  assert.deepEqual(hits(at('due'), rows), ['gestern', 'heute'])
  assert.deepEqual(hits(at('before', 3), rows), ['gestern', 'heute', 'morgen', 'in3'])
  // mit Uhrzeit: erst ab der Uhrzeit
  assert.deepEqual(hits(at('due'), [row('spaeter', { due: '2026-11-02T10:00' }), row('frueher', { due: '2026-11-02T09:00' })]), ['frueher'])
  assert.deepEqual(hits(at('late'), [row('spaeter', { due: '2026-11-02T10:00' }), row('frueher', { due: '2026-11-02T09:00' })]), ['frueher'])
  // einmal je Datum: nach dem Lauf nichts mehr, mit neuem Datum wieder
  const [c] = dueChanges(at('late'), fields, [row('a', { due: '2026-11-01' })], new Set(), ctx)
  assert.equal(c.props.prio, 'hoch')
  assert.deepEqual(c.keys, ['r|a|2026-11-01'])
  const seen = new Set(c.keys)
  assert.deepEqual(hits(at('late'), [row('a', { due: '2026-11-01' })], seen), [])
  assert.deepEqual(hits(at('late'), [row('a', { due: '2026-10-31' })], seen), ['a'])
  assert.deepEqual(pruneSeen(['r|a|2026-11-01', 'r|a|2026-01-01', 'r|a|2026-05-20T10:00'], now), ['r|a|2026-11-01', 'r|a|2026-05-20T10:00'])
})

test('Prüfung und Klartext', () => {
  assert.equal(ruleProblem(rule(done, [stampIt]), fields), '')
  assert.match(ruleProblem(rule(done, []), fields), /Aktion/)
  assert.match(ruleProblem(rule({ type: 'value', field: 'weg', value: 'x' }, [stampIt]), fields), /gibt es nicht mehr/)
  assert.match(ruleProblem(rule({ type: 'value', field: 'status', value: 'weg' }, [stampIt]), fields), /nicht mehr/)
  assert.match(ruleProblem(rule({ type: 'value', field: 'status', value: '' }, [stampIt]), fields), /Wert/)
  assert.match(ruleProblem(rule(done, [{ type: 'set', field: 'weg' }]), fields), /Aktion/)
  assert.match(ruleProblem(rule(done, [{ type: 'set', field: 'prio', value: '' }]), fields), /Wert/)
  assert.match(ruleProblem(rule(done, [{ type: 'tag', field: 'tags', tag: ' ' }]), fields), /Tag/)
  assert.match(ruleProblem(rule({ type: 'due', field: 'n', at: 'late' }, [stampIt]), fields), /Datumsfeld/)
  // kaputte Regel läuft nicht, statt Falsches zu tun
  assert.equal(run([rule({ type: 'value', field: 'weg', value: 'x' }, [stampIt])], {}, {}).fired.length, 0)
  assert.equal(describeRule(rule(done, [stampIt, { type: 'clear', field: 'followup' }]), fields), 'Wenn Status „Erledigt“ wird: Erledigt am auf jetzt setzen, Wiedervorlage leeren')
  assert.equal(describeRule(rule({ type: 'created' }, [{ type: 'set', field: 'person', value: ME }, { type: 'tag', field: 'tags', tag: 'neu' }]), fields), 'Neuer Punkt: Zuständig auf „mich“ setzen, Tag „neu“ hinzufügen')
  assert.equal(describeRule(rule({ type: 'due', field: 'due', at: 'before', days: 3 }, [{ type: 'notify', text: 'Bald' }]), fields), '3 Tage vor Fällig: Windows-Meldung „Bald“')
  assert.equal(describeRule(rule({ type: 'value', field: 'tags', value: 'a' }, [{ type: 'set', field: 'due', rel: 'days', days: 2 }]), fields), 'Wenn Tags „a“ enthält: Fällig auf heute + 2 Tage setzen')
})

test('Vorlagen passen sich der Liste an', () => {
  const t = ruleTemplates(fields)
  assert.deepEqual(t.map((x) => x.id), ['erledigt-datum', 'erledigt-wiedervorlage', 'neu-mir', 'neu-faellig', 'ueberfaellig-hoch'])
  for (const x of t) assert.equal(ruleProblem(x.rule, fields), '', x.id)
  assert.equal(t[0].addField, null, 'Feld Erledigt am ist schon da')
  assert.equal(t[0].rule.revert, true)
  // ohne das Feld wird es mit angelegt
  const plain = lopConfig().fields
  const first = ruleTemplates(plain)[0]
  assert.equal(first.addField.name, 'Erledigt am')
  assert.equal(ruleProblem(first.rule, [...plain, first.addField]), '')
  // Liste nur mit Text: keine Vorlage, die ins Leere liefe
  assert.deepEqual(ruleTemplates([{ id: 'n', name: 'Notiz', type: 'text' }]), [])
  // eigener Status: Name der Abschluss-Option
  const own = [{ id: 's', name: 'Stand', type: 'status', options: [{ id: 'a', name: 'Neu' }, { id: 'b', name: 'Fertig', done: true }] }, { id: 'd', name: 'Abschluss', type: 'date' }]
  assert.equal(ruleTemplates(own)[0].label, 'Fertig: Datum eintragen')
})

test('Regeln einer anderen Liste übernehmen, neue Tags merken', () => {
  const from = [{ id: 's1', name: 'Status', type: 'status', options: [{ id: 'x1', name: 'Fertig', done: true }] }, { id: 'd1', name: 'Erledigt am', type: 'date' }, { id: 'nur', name: 'Nur dort', type: 'text' }]
  const to = [{ id: 's2', name: 'Status', type: 'status', options: [{ id: 'x2', name: 'Fertig', done: true }] }, { id: 'd2', name: 'Erledigt am', type: 'date' }]
  const rules = [
    rule({ type: 'value', field: 's1', value: 'x1' }, [{ type: 'set', field: 'd1', rel: 'now' }]),
    rule({ type: 'filled', field: 'nur' }, [{ type: 'set', field: 'd1', rel: 'today' }]),
  ]
  const { rules: copied, skipped } = copyRules(rules, from, to)
  assert.equal(skipped, 1)
  assert.equal(copied.length, 1)
  assert.deepEqual(copied[0].when, { type: 'value', field: 's2', value: 'x2' })
  assert.equal(copied[0].then[0].field, 'd2')
  assert.notEqual(copied[0].id, 'r')
  const f = withRuleTags(fields, rule({ type: 'value', field: 'tags', value: 'alt' }, [{ type: 'tag', field: 'tags', tag: ' neu ' }]))
  assert.deepEqual(f.find((x) => x.id === 'tags').options.map((o) => o.id), ['alt', 'neu'])
  assert.equal(withRuleTags(f, rule({ type: 'created' }, [{ type: 'tag', field: 'tags', tag: 'neu' }])).find((x) => x.id === 'tags').options.length, 2, 'nicht doppelt')
})
