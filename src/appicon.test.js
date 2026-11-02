import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PETROL, iconColors, iconSvg, icoFile } from './appicon.js'

test('Icon: Farben aus dem Schema, kleine Fassung ohne Punkt', () => {
  const petrol = iconColors({ theme: 'petrol' })
  assert.match(petrol.from, /^#[0-9a-f]{6}$/)
  assert.deepEqual(iconColors({}), petrol) // ohne Aussehen: Petrol
  // Verlaufsschema: vom ersten zum letzten Farbton, anders als Petrol
  const sunset = iconColors({ theme: 'sonnenuntergang' })
  assert.notEqual(sunset.from, petrol.from)
  assert.notEqual(sunset.from, sunset.to)
  // eigene Akzentfarbe zählt vor dem Schema
  assert.notDeepEqual(iconColors({ theme: 'petrol', accent: '#c4508f' }), petrol)
  // eigener Verlauf: die gewählten Farben
  assert.deepEqual(iconColors({ theme: 'custom', gradient: { colors: ['#112233', '#445566'] } }), { from: '#112233', to: '#445566', tint: '#ffffff' })
  const big = iconSvg(PETROL)
  const small = iconSvg(PETROL, true)
  assert.match(big, /<circle /)
  assert.doesNotMatch(small, /<circle /)
  assert.match(small, /stroke-width="150"/)
})

test('ICO-Datei aus PNG-Bildern', () => {
  const a = new Uint8Array([1, 2, 3])
  const b = new Uint8Array([9, 8])
  const ico = icoFile([{ size: 16, bytes: a }, { size: 256, bytes: b }])
  const v = new DataView(ico.buffer)
  assert.deepEqual([...ico.slice(0, 6)], [0, 0, 1, 0, 2, 0]) // Kopf: Typ Icon, zwei Bilder
  assert.equal(ico.length, 6 + 2 * 16 + 5)
  // erster Eintrag: Größe, Länge, Stelle der Daten
  assert.equal(ico[6], 16)
  assert.equal(v.getUint16(10, true), 1) // Ebenen
  assert.equal(v.getUint16(12, true), 32) // Bit je Pixel
  assert.equal(v.getUint32(14, true), 3)
  assert.equal(v.getUint32(18, true), 38)
  assert.deepEqual([...ico.slice(38, 41)], [1, 2, 3])
  // 256 Pixel steht als 0 im Kopf
  assert.equal(ico[22], 0)
  assert.equal(v.getUint32(34, true), 41)
  assert.deepEqual([...ico.slice(41)], [9, 8])
})
