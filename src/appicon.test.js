import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PETROL, iconColors, iconSvg } from './appicon.js'

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
