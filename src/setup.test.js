import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeTip, tourStations } from './setup.js'

const tip = { w: 320, h: 180 }
const win = { w: 1280, h: 800 }

test('Rundgang: Stationen ohne passenden Eintrag fallen weg', () => {
  const all = tourStations({ page: 'p1', list: 'l1' })
  assert.deepEqual(all.map((s) => s.id), ['baum', 'suche', 'ansichten', 'reiter', 'seite', 'liste', 'benutzer'])
  assert.equal(all.find((s) => s.id === 'seite').view, 'p1')
  assert.equal(all.find((s) => s.id === 'liste').view, 'l1')
  assert.equal(all.find((s) => s.id === 'suche').view, undefined)
  assert.deepEqual(tourStations({}).map((s) => s.id), ['baum', 'suche', 'ansichten', 'reiter', 'benutzer'])
})

test('Erklärung: daneben, wo Platz ist, sonst mittig', () => {
  // Seitenleiste links: rechts daneben
  assert.deepEqual(placeTip({ left: 10, top: 100, width: 300, height: 400 }, tip, win), { x: 322, y: 100 })
  // ganz rechts: links daneben
  assert.deepEqual(placeTip({ left: 1000, top: 100, width: 270, height: 100 }, tip, win), { x: 668, y: 100 })
  // Reiterleiste über die ganze Breite: darunter
  assert.deepEqual(placeTip({ left: 0, top: 0, width: 1280, height: 40 }, tip, win), { x: 8, y: 52 })
  // ganz unten über die ganze Breite: darüber
  assert.deepEqual(placeTip({ left: 0, top: 700, width: 1280, height: 100 }, tip, win), { x: 8, y: 508 })
  // Inhalt füllt das Fenster: mittig
  assert.deepEqual(placeTip({ left: 0, top: 0, width: 1280, height: 800 }, tip, win), { x: 480, y: 310 })
  // kein Bereich gefunden: mittig
  assert.deepEqual(placeTip(null, tip, win), { x: 480, y: 310 })
  // unten am Fenster bleibt die Erklärung im Fenster
  assert.deepEqual(placeTip({ left: 10, top: 760, width: 300, height: 36 }, tip, win), { x: 322, y: 612 })
})
