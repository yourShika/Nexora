import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addLine, attachmentLink, audioName, clock, meetingBody, meetingTitle, parseTasks, taskProps, transcriptMarkdown } from './speech.js'

test('Uhrzeit der Mitschrift', () => {
  assert.equal(clock(0), '00:00')
  assert.equal(clock(65_000), '01:05')
  assert.equal(clock(3_725_000), '1:02:05')
  assert.equal(clock(undefined), '00:00')
})

test('Abschnitte beider Quellen sortieren sich nach Beginn', () => {
  let lines = []
  lines = addLine(lines, { source: 'ich', startMs: 10_000, text: 'B' })
  lines = addLine(lines, { source: 'andere', startMs: 0, text: 'A' })
  lines = addLine(lines, { source: 'ich', startMs: 20_000, text: 'C' })
  lines = addLine(lines, { source: 'andere', startMs: 10_000, text: 'B2' })
  assert.deepEqual(lines.map((l) => l.text), ['A', 'B', 'B2', 'C'])
})

test('Mitschrift als Markdown', () => {
  const md = transcriptMarkdown([
    { source: 'ich', startMs: 0, text: 'Guten Morgen.' },
    { source: 'ich', startMs: 10_000, text: 'Wir beginnen.' },
    { source: 'andere', startMs: 20_000, text: 'Einverstanden.' },
    { source: 'ich', startMs: 65_000, text: 'Gut.' },
  ])
  assert.equal(md, '**Ich** (00:00) Guten Morgen. Wir beginnen.\n\n**Andere** (00:20) Einverstanden.\n\n**Ich** (01:05) Gut.')
  // Aus einer Datei: ohne Sprecher
  assert.equal(transcriptMarkdown([{ source: 'datei', startMs: 0, text: 'Text' }]), '(00:00) Text')
  assert.equal(transcriptMarkdown([]), '')
})

test('Seite aus ihren Teilen', () => {
  assert.equal(meetingBody({ transcript: 'T' }), '## Mitschrift\n\nT')
  assert.equal(meetingBody({ transcript: '' }), '## Mitschrift\n\nNoch nichts erkannt.')
  assert.equal(meetingBody({ summary: ' S ', transcript: 'T', audio: attachmentLink('u/a.m4a', 12) }), '## Zusammenfassung\n\nS\n\n## Mitschrift\n\nT\n\n## Aufnahme\n\n[[datei:u/a.m4a|12]]')
})

test('Titel und Dateiname', () => {
  const d = new Date(2026, 10, 2, 13, 5)
  assert.equal(meetingTitle(d), 'Besprechung 02.11.2026 13:05')
  assert.equal(meetingTitle(d, 'Audiodatei'), 'Audiodatei 02.11.2026 13:05')
  assert.equal(audioName(d), 'Aufnahme 2026-11-02 1305.m4a')
})

test('Aufgaben aus der Antwort lesen', () => {
  assert.deepEqual(parseTasks('[{"title":"Switch tauschen","person":"Kim","due":"2026-11-05"}]'), [{ title: 'Switch tauschen', person: 'Kim', due: '2026-11-05' }])
  assert.deepEqual(parseTasks('Hier sind sie:\n```json\n[{"title":" A "}]\n```'), [{ title: 'A', person: '', due: '' }])
  // Unbrauchbares fällt weg, ungenaues Datum auch
  assert.deepEqual(parseTasks('[{"title":""},{"x":1},null,{"title":"B","due":"nächste Woche","person":3}]'), [{ title: 'B', person: '', due: '' }])
  for (const bad of ['', 'keine', '[kaputt', '{"a":1}', null]) assert.deepEqual(parseTasks(bad), [], String(bad))
  assert.deepEqual(parseTasks('[]'), [])
  assert.equal(parseTasks(JSON.stringify(Array.from({ length: 90 }, () => ({ title: 'x' })))).length, 50)
})

test('Felder nur, wenn die Liste sie hat', () => {
  const t = { title: 'A', person: 'Kim', due: '2026-11-05' }
  assert.deepEqual(taskProps(t, [{ id: 'person', type: 'person' }, { id: 'due', type: 'date' }]), { person: 'Kim', due: '2026-11-05' })
  assert.deepEqual(taskProps(t, [{ id: 'status', type: 'status' }]), {})
  assert.deepEqual(taskProps({ title: 'B', person: '', due: '' }, [{ id: 'person', type: 'person' }]), {})
})
