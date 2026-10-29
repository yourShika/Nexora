import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monday, weekMarkdown, weekNumber } from './journal.js'

test('Kalenderwoche und Wochenanfang', () => {
  assert.equal(weekNumber('2026-10-28'), 44)
  assert.equal(weekNumber('2026-01-01'), 1) // Donnerstag
  assert.equal(weekNumber('2027-01-01'), 53) // Freitag, gehört noch zu 2026
  assert.equal(weekNumber('2024-12-30'), 1) // Montag, gehört schon zu 2025
  assert.equal(monday('2026-10-28'), '2026-10-26')
  assert.equal(monday('2026-11-01'), '2026-10-26') // Sonntag
  assert.equal(monday('2026-10-26'), '2026-10-26')
})

test('Wochenrückblick als Markdown', () => {
  const alive = new Map([['p1', { id: 'p1', title: 'Zertifikat [neu]|x' }]])
  const md = weekMarkdown({
    week: '2026-10-26',
    entries: [
      { kind: 'erledigt', node_id: 'p1', text: 'alt' },
      { kind: 'erledigt', node_id: 'weg', text: 'Gelöschter Punkt' },
      { kind: 'notiz', node_id: null, text: 'Telefonat mit Lieferant' },
      { kind: 'ausgefuehrt', node_id: 'p1', text: 'PowerShell, Exit 0' },
    ],
    overdue: [],
    waiting: [],
    alive,
  })
  assert.match(md, /^Woche vom /)
  assert.match(md, /## Erledigt \(2\)\n\n- \[\[Zertifikat \[neu  x\|p1\]\]\n- Gelöschter Punkt/)
  assert.match(md, /## Notizen \(1\)\n\n- Telefonat mit Lieferant/)
  assert.match(md, /- \[\[Zertifikat \[neu  x\|p1\]\]: PowerShell, Exit 0/)
  assert.doesNotMatch(md, /Überfällig/)
})
