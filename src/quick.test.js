import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseQuick, quickName, tokenAt } from './quick.js'

// Dienstag, 27.10.2026
const now = new Date(2026, 9, 27, 9, 30)
const q = (text) => parseQuick(text, now)

test('Beispiel aus dem Plan', () => {
  assert.deepEqual(q('Switch 2.OG tauschen #netzwerk @Müller !hoch fr'), {
    title: 'Switch 2.OG tauschen',
    props: { tags: ['netzwerk'], person: 'Müller', prio: 'hoch', due: '2026-10-30' },
  })
})

test('relative Tage', () => {
  assert.equal(q('a heute').props.due, '2026-10-27')
  assert.equal(q('a morgen').props.due, '2026-10-28')
  assert.equal(q('a übermorgen').props.due, '2026-10-29')
  assert.equal(q('a +10').props.due, '2026-11-06')
  assert.equal(q('a nächste Woche').props.due, '2026-11-02')
})

test('Wochentage: heute zählt, sonst der nächste', () => {
  assert.equal(q('a di').props.due, '2026-10-27')
  assert.equal(q('a Montag').props.due, '2026-11-02')
  assert.equal(q('a sa').props.due, '2026-10-31')
})

test('Datum mit und ohne Jahr', () => {
  assert.equal(q('a 3.11.').props.due, '2026-11-03')
  assert.equal(q('a 1.1.').props.due, '2027-01-01')
  assert.equal(q('a 05.03.27').props.due, '2027-03-05')
  assert.equal(q('a 31.2.').props.due, undefined)
})

test('normale Wörter bleiben im Titel', () => {
  assert.deepEqual(q('Guten Morgen so geht das'), { title: 'Guten Morgen so geht das', props: {} })
  assert.deepEqual(q('Version 2.1 prüfen !x'), { title: 'Version 2.1 prüfen !x', props: {} })
})

test('Uhrzeit mit und ohne Datum', () => {
  assert.equal(q('Anruf fr 14:00').props.due, '2026-10-30T14:00')
  assert.equal(q('Anruf 14 Uhr').props.due, '2026-10-27T14:00')
  assert.equal(q('Anruf 9uhr').props.due, '2026-10-28T09:00') // 9:00 ist um 9:30 schon vorbei
  assert.equal(q('Anruf 3.11. 8:15').title, 'Anruf')
  assert.equal(q('Anruf 3.11. 8:15').props.due, '2026-11-03T08:15')
  assert.deepEqual(q('Version 2.1 und 25:00'), { title: 'Version 2.1 und 25:00', props: {} })
})

test('Checklisten-Vorlage: Tage relativ zum Stichtag', () => {
  const start = new Date(2026, 10, 2) // Mo, 2.11.2026
  assert.deepEqual(parseQuick('Konto anlegen @IT -3 #onboarding', start), {
    title: 'Konto anlegen',
    props: { person: 'IT', due: '2026-10-30', tags: ['onboarding'] },
  })
  assert.equal(parseQuick('Laptop übergeben heute', start).props.due, '2026-11-02')
})

test('Priorität kurz, mehrere Tags ohne Doppel', () => {
  assert.deepEqual(q('Backup #srv #srv #nas !1'), { title: 'Backup', props: { prio: 'hoch', tags: ['srv', 'nas'] } })
})

test('Namen in Anführungszeichen, Wort an der Schreibmarke', () => {
  const p = parseQuick('Angebot prüfen @"Kim B." @sam #"Listen & Struktur" #neu')
  assert.equal(p.title, 'Angebot prüfen')
  assert.deepEqual(p.props.person, ['Kim B.', 'sam'])
  assert.deepEqual(p.props.tags, ['Listen & Struktur', 'neu'])
  assert.equal(parseQuick('x @kim').props.person, 'kim') // eine Person bleibt ein Name
  assert.deepEqual(tokenAt('Server #net', 11), { start: 7, sign: '#', query: 'net' })
  assert.deepEqual(tokenAt('Server @"Kim', 12), { start: 7, sign: '@', query: 'Kim' })
  assert.equal(tokenAt('Server neu', 10), null)
  assert.equal(tokenAt('a @"Kim B."', 11), null) // fertig geschrieben
  assert.equal(quickName('@', 'kim'), '@kim')
  assert.equal(quickName('@', 'Kim B.'), '@"Kim B."')
})
