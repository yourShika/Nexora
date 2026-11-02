import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildModel, complete, editKind, learn, newCounts, partsToCheck, pickFix, plainLines, planFix, rankSuggestions, seenInPages, startsSentence, tokens } from './autotext.js'

const words = (t) => tokens(t).map((x) => x.word)

test('Wörter im Text: Pfade, Befehle und Dateien zählen nicht', () => {
  assert.deepEqual(words('Das (Wort), „hier“ und E-Mail.'), ['Das', 'Wort', 'hier', 'und', 'E-Mail'])
  assert.deepEqual(words('server01 konfig.txt C:\\Temp \\\\srv\\f --force #tag a/b user@x.de foo_bar geht\'s https://x.de'), [])
  assert.deepEqual(words('A\ufffcB Wort'), ['Wort'])
  const [t] = tokens('  („Wort“)')
  assert.deepEqual([t.from, t.to, t.dot], [4, 8, false])
  assert.deepEqual(tokens('ggf. Ende, und („Satz.“)').map((x) => x.dot), [true, false, false, true])
})

test('Was ins Wörterbuch geht', () => {
  assert.deepEqual(partsToCheck('Fehler'), ['Fehler'])
  assert.deepEqual(partsToCheck('IT-Abteilung'), ['Abteilung'])
  assert.deepEqual(partsToCheck('E-Mail'), ['Mail'])
  for (const w of ['VPN', 'PowerShell', 'IPsec', 'iPhone', 'a']) assert.deepEqual(partsToCheck(w), [], w)
})

test('Art der Abweichung', () => {
  assert.equal(editKind('fehler', 'Fehler'), 'case')
  assert.equal(editKind('nciht', 'nicht'), 'swap')
  assert.equal(editKind('Fehlre', 'Fehler'), 'swap')
  assert.equal(editKind('nochh', 'noch'), 'double')
  assert.equal(editKind('Fehlrr', 'Fehler'), 'edit')
  assert.equal(editKind('fur', 'für'), 'edit')
  assert.equal(editKind('nach', 'nachh'), 'edit')
  assert.equal(editKind('Gruess', 'Regress'), null)
  assert.equal(editKind('ipconfig', 'Konfiguration'), null)
})

test('Ersetzt wird nur Eindeutiges, mit echten Vorschlägen der Wörterbücher', () => {
  assert.equal(pickFix('Fehlre', ['Fehlreh', 'Fehler', 'Fehlire', 'Fehle', 'Fehlte']), 'Fehler')
  assert.equal(pickFix('nochh', ['noch', 'noch h']), 'noch')
  assert.equal(pickFix('nciht', ['nicht']), 'nicht')
  assert.equal(pickFix('sentense', ['sentence', 'sen tense', 'sen-tense', 'intense']), 'sentence')
  assert.equal(pickFix('recieve', ['receive', 'relieve', 'reverie']), 'receive')
  assert.equal(pickFix('teh', ['the', 'eh', 'tech', 'tee']), 'the')
  // mehrere gleich nahe: bleibt stehen
  assert.equal(pickFix('wrng', ['wring', 'wrong', 'wrung', 'wing']), null)
  assert.equal(pickFix('Druckrwarteschlange', ['Druckwarteschlange', 'Druckerwarteschlange', 'Druckerwartschlange']), null)
  // zu weit weg
  assert.equal(pickFix('ipconfig', ['Konfiguration', 'configure']), null)
  assert.equal(pickFix('Gruess', ['Regress', 'Grues', 'Guess']), null)
  assert.equal(pickFix('', []), null)
  // Großgeschrieben kann ein Name sein: kein ersetzter Buchstabe, Dreher schon
  assert.equal(pickFix('Fehlrr', ['Fehler', 'Fehl']), null)
  assert.equal(pickFix('Prxoess', ['Prozess', 'Process']), null)
  assert.equal(pickFix('Sevrer', ['Server']), 'Server')
  // kurze Wörter nur bei Drehern
  assert.equal(pickFix('fur', ['für']), null)
})

test('Vorschläge fürs Menü', () => {
  assert.deepEqual(rankSuggestions('Fehlre', ['Fehlreh', 'Fehler', 'Fehle']), ['Fehler', 'Fehlreh', 'Fehle'])
  assert.deepEqual(rankSuggestions('dei', ['die', 'de i', '-ei', 'die']), ['die'])
})

test('Satzanfang', () => {
  assert.equal(startsSentence(''), true)
  assert.equal(startsSentence('Das ist gut. '), true)
  assert.equal(startsSentence('Wirklich? '), true)
  assert.equal(startsSentence('Das „Ende.“ '), true)
  assert.equal(startsSentence('Das ist '), false)
  assert.equal(startsSentence('Siehe z.B. '), false)
  assert.equal(startsSentence('am 1. '), false)
  assert.equal(startsSentence('Herr Dr. '), false)
  assert.equal(startsSentence('Datei a. '), false)
  assert.equal(startsSentence('Wort.'), false)
  assert.equal(startsSentence('und … '), false)
  assert.equal(startsSentence('und ... '), false)
})

test('Plan beim Leerzeichen', async () => {
  const dict = new Set(['nicht', 'Nicht', 'Zwei', 'zwei', 'Hallo', 'hallo', 'ping', 'Ping'])
  const base = {
    opts: { fix: true, caps: true },
    sentenceStart: false,
    known: async (w) => dict.has(w),
    suggest: async (w) => ({ nciht: ['nicht'], ipconfig: ['Konfiguration'] })[w] ?? [],
    isOwn: () => false,
    isNever: () => false,
  }
  assert.equal(await planFix('nciht', base), 'nicht')
  assert.equal(await planFix('nicht', base), null)
  assert.equal(await planFix('ipconfig', base), null)
  assert.equal(await planFix('nciht', { ...base, opts: { caps: true } }), null)
  // Zwei Großbuchstaben nur, wenn es danach ein Wort ist (VMware, IPsec bleiben)
  assert.equal(await planFix('ZWei', base), 'Zwei')
  assert.equal(await planFix('VMware', base), null)
  assert.equal(await planFix('ZWei', { ...base, opts: { fix: true } }), null)
  // Satzanfang: nur bekannte Wörter, Befehle bleiben klein
  assert.equal(await planFix('hallo', { ...base, sentenceStart: true }), 'Hallo')
  assert.equal(await planFix('ipconfig', { ...base, sentenceStart: true }), null)
  assert.equal(await planFix('nciht', { ...base, sentenceStart: true }), 'Nicht')
  assert.equal(await planFix('hallo', { ...base, sentenceStart: true, opts: { fix: true } }), null)
  // Eigenes wird nicht verbessert, Bindestrich-Wörter auch nicht
  assert.equal(await planFix('nciht', { ...base, isOwn: (w) => w === 'nciht' }), null)
  assert.equal(await planFix('nciht-Test', base), null)
  // was auch in den Seiten steht, wird am Satzanfang trotzdem groß, sofern es ein Wort ist
  assert.equal(await planFix('hallo', { ...base, sentenceStart: true, isOwn: () => true }), 'Hallo')
  assert.equal(await planFix('ipconfig', { ...base, sentenceStart: true, isOwn: () => true }), null)
  // zurückgenommene Korrektur: gar nichts mehr
  assert.equal(await planFix('hallo', { ...base, sentenceStart: true, isNever: (w) => w === 'hallo' }), null)
})

test('Lernen: nur Fließtext, keine Geheimnisse', () => {
  const lines = plainLines('Text `code wort`\n```\ngeheim im Block\n```\n![bild](x.png) [Linktext](https://a.de) https://b.de/c **fett**\n[[Seite Eins|id-1]] [[datei:u/x.pdf|12]]\nPasswort: Sommerfest\n<span style="color: red">rot</span>')
  const all = words(lines.join('\n'))
  for (const w of ['Text', 'Linktext', 'fett', 'Seite', 'Eins', 'rot', 'Passwort']) assert.ok(all.includes(w), w)
  for (const w of ['code', 'wort', 'geheim', 'Block', 'bild', 'style', 'Sommerfest']) assert.ok(!all.includes(w), w)
})

const model = (() => {
  const c = newCounts()
  for (let i = 0; i < 4; i++) learn(c, 'Mit freundlichen Grüßen\nDer Server läuft. Server neu starten')
  learn(c, 'Serverraum Serverraum Einmalwort freundlichen Kollegen')
  learn(c, 'Dachboden Dachboden', { pairs: false })
  return buildModel(c)
})()
const on = { words: true, phrases: true }

test('Autofüllen: Wörter', () => {
  assert.deepEqual(complete(model, 'Der Serv', { words: true }), { typed: 'Serv', full: 'Server', ghost: 'er' })
  // klein Getipptes folgt dem gelernten Nomen, groß Getipptes bleibt
  assert.equal(complete(model, 'der serv', { words: true }).full, 'Server')
  assert.equal(complete(model, 'Dach', { words: true }).full, 'Dachboden')
  // zu kurz, nur einmal gesehen, schon fertig, nichts Passendes, Slash-Befehl, Pfad
  for (const t of ['Se', 'Einmal', 'Serverraum', 'Xyz', '/Serv', '[[Serv', 'C:\\Serv', 'x-Serv ']) assert.equal(complete(model, t, { words: true }), null, t)
  assert.equal(complete(model, 'Der Serv', {}), null)
  assert.equal(complete(null, 'Der Serv', on), null)
})

test('Autofüllen: Wortfolgen', () => {
  assert.deepEqual(complete(model, 'Mit freundl', on), { typed: 'freundl', full: 'freundlichen Grüßen', ghost: 'ichen Grüßen' })
  assert.deepEqual(complete(model, 'Mit freundlichen ', on), { typed: '', full: 'Grüßen', ghost: 'Grüßen' })
  // ohne Wortfolgen nur das Wort
  assert.equal(complete(model, 'Mit freundl', { words: true }).full, 'freundlichen')
  assert.equal(complete(model, 'Mit freundlichen ', { words: true }), null)
  // „Server“ geht auf verschiedene Arten weiter: nichts raten; nach Satzzeichen auch nicht
  assert.equal(complete(model, 'Der Server ', on), null)
  assert.equal(complete(model, 'Mit freundlichen, ', on), null)
  // nur bei Absatzbeginn ohne Vorwort kommt nichts
  assert.equal(complete(model, '', on), null)
})

test('Schon in den Seiten', () => {
  assert.ok(seenInPages(model, 'Einmalwort'))
  assert.ok(!seenInPages(model, 'Einmalwort', 3))
  assert.ok(seenInPages(model, 'Server', 3))
  assert.ok(!seenInPages(null, 'Server'))
  // genau so geschrieben: „server“ zählt nicht, nur weil „Server“ dasteht; andersherum am Satzanfang schon
  assert.ok(!seenInPages(model, 'server'))
  assert.ok(seenInPages(model, 'Freundlichen', 3))
})
