import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fill, parseTable, placeholders } from './runner.js'

test('Platzhalter finden und füllen', () => {
  const code = 'Test-Connection {{Server}} -Count {{ Anzahl }}; Get-Item {{Server}}; {{vault:Admin}}'
  assert.deepEqual(placeholders(code), ['Server', 'Anzahl'])
  assert.equal(fill(code, { Server: 'srv01', Anzahl: '2' }), 'Test-Connection srv01 -Count 2; Get-Item srv01; {{vault:Admin}}')
})

test('PowerShell-Tabelle in Spalten zerlegen', () => {
  const out = [
    '',
    'Status   Name               DisplayName',
    '------   ----               -----------',
    'Running  Spooler            Druckwarteschlange',
    'Stopped  wuauserv           Windows Update',
    '',
    'danach Text',
  ]
  assert.deepEqual(parseTable(out), {
    headers: ['Status', 'Name', 'DisplayName'],
    rows: [['Running', 'Spooler', 'Druckwarteschlange'], ['Stopped', 'wuauserv', 'Windows Update']],
  })
})

test('rechtsbündige Spalten (Wert breiter als die Striche)', () => {
  const out = [' Status Name   ', ' ------ ----   ', 'Running Spooler', 'Stopped W32Time']
  assert.deepEqual(parseTable(out).rows, [['Running', 'Spooler'], ['Stopped', 'W32Time']])
  const num = ['Name      Handles', '----      -------', 'explorer     2731', 'svchost        12']
  assert.deepEqual(parseTable(num).rows, [['explorer', '2731'], ['svchost', '12']])
})

test('normaler Text ist keine Tabelle', () => {
  assert.equal(parseTable(['Hallo', 'Welt']), null)
  assert.equal(parseTable(['Titel', '-----', 'nur eine Spalte']), null)
})
