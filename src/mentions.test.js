import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findMentions, personHits, textParts } from './mentions.js'
import { parseSearch } from './searchquery.js'

const names = ['Kim', 'Kim Bura', 'Müller', 'Bura']

test('Erwähnungen: längster bekannter Name, Grenzen', () => {
  assert.deepEqual(findMentions('Hallo @Kim Bura, und @kim.', names), [
    { from: 6, to: 15, name: 'Kim Bura' },
    { from: 21, to: 25, name: 'Kim' },
  ])
  assert.deepEqual(findMentions('(@Müller) „@Bura“', names).map((m) => m.name), ['Müller', 'Bura'])
  assert.deepEqual(findMentions('k.bura@firma.de @Buras @Unbekannt @', names), [])
  assert.deepEqual(findMentions('@Bura', []), [])
})

test('Vorschläge: Anfang zuerst, neue Person', () => {
  assert.deepEqual(personHits(names, 'bu'), [{ name: 'Bura' }, { name: 'Kim Bura' }, { name: 'bu', isNew: true }])
  assert.deepEqual(personHits(names, 'Kim').map((h) => h.name), ['Kim', 'Kim Bura'])
  assert.equal(personHits(names, '').length, 4)
  assert.deepEqual(personHits(names, 'Neu'), [{ name: 'Neu', isNew: true }])
})

test('Textstücke: Links und Personen', () => {
  assert.deepEqual(textParts('Siehe https://example.com/a?b=1. @Kim Bura fragen', names), [
    { text: 'Siehe ' },
    { text: 'https://example.com/a?b=1', url: 'https://example.com/a?b=1' },
    { text: '. ' },
    { text: '@Kim Bura', person: 'Kim Bura' },
    { text: ' fragen' },
  ])
  assert.deepEqual(textParts('(http://x.de)'), [{ text: '(' }, { text: 'http://x.de', url: 'http://x.de' }, { text: ')' }])
  assert.deepEqual(textParts('ohne'), [{ text: 'ohne' }])
  assert.deepEqual(textParts(''), [])
})

test('Suche: @"Name mit Leerzeichen" und #"Tag"', () => {
  const f = parseSearch('@"Kim Bura" #"Listen & Struktur" drucker')
  assert.equal(f.person, 'kim bura')
  assert.deepEqual(f.tags, ['listen & struktur'])
  assert.deepEqual(f.text, ['drucker'])
  assert.equal(parseSearch('@Müller').person, 'muller')
})
