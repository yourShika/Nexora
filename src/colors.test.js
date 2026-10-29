import { test } from 'node:test'
import assert from 'node:assert/strict'
import { THEMES, contrast, hexToHsv, hexToOklch, hsvToHex, lookCss, oklch, over, palette } from './colors.js'

test('Umrechnung Hex und OKLCH hin und zurück', () => {
  for (const hex of ['#0e6f78', '#e5484d', '#ffffff', '#16191a', '#3e8bd6']) {
    const [L, C, H] = hexToOklch(hex)
    assert.equal(oklch(L, C, H), hex)
  }
  assert.equal(over('#00000080', '#ffffff'), '#7f7f7f')
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 0.01)
})

// Jedes Schema muss lesbar sein: Text, gedämpfter Text, Akzent als Text und Knopf; mit Verlauf über jeder Farbe des Verlaufs
test('Alle Schemata hell und dunkel lesbar', () => {
  const looks = [
    ...THEMES.map((t) => ({ theme: t.id })),
    { theme: 'petrol', accent: '#ffe100' }, // grelles Gelb als eigene Akzentfarbe
    { theme: 'custom', gradient: { colors: ['#ff0000', '#00ff00', '#0000ff'], angle: 90 } },
    { theme: 'custom', gradient: { colors: ['#000000', '#ffffff'] }, accent: '#111111' },
  ]
  for (const look of looks) {
    for (const dark of [false, true]) {
      const p = palette(look, dark)
      const grounds = p.gradient ?? ['#808080'] // ohne Verlauf sind die Flächen deckend
      for (const ground of grounds) {
        const bg = over(p.bg, ground)
        const side = over(p.side, ground)
        const name = `${look.theme}${look.accent ? `+${look.accent}` : ''} ${dark ? 'dunkel' : 'hell'} über ${ground}`
        assert.ok(contrast(p.text, bg) >= 7, `Text ${name}: ${contrast(p.text, bg).toFixed(2)}`)
        assert.ok(contrast(p.muted, bg) >= 4.5, `Gedämpft ${name}: ${contrast(p.muted, bg).toFixed(2)}`)
        assert.ok(contrast(p.text, side) >= 7, `Seitenleiste ${name}: ${contrast(p.text, side).toFixed(2)}`)
        assert.ok(contrast(p.faint, bg) >= 3, `Blass ${name}: ${contrast(p.faint, bg).toFixed(2)}`)
        assert.ok(contrast(p.accent, bg) >= 3, `Akzent ${name}: ${contrast(p.accent, bg).toFixed(2)}`)
      }
      // Knöpfe: hell weiße Schrift auf Akzent, dunkel Hintergrundfarbe auf Akzent
      const label = dark ? over(p.bg, p.gradient?.[0] ?? '#000000') : '#ffffff'
      assert.ok(contrast(label, p.accent) >= 4.5, `Knopf ${look.theme} ${dark ? 'dunkel' : 'hell'}: ${contrast(label, p.accent).toFixed(2)}`)
    }
  }
})

test('Standard ohne Abweichung erzeugt kein CSS, Verlauf setzt den Hintergrund', () => {
  assert.equal(lookCss({ theme: 'petrol' }), '')
  const css = lookCss({ theme: 'meer' })
  assert.match(css, /:root:not\(\[data-print\]\)\[data-theme="dark"\] \{ --bg: #[0-9a-f]{8};/)
  assert.match(css, /--app-bg: linear-gradient\(135deg, #[0-9a-f]{6}, #[0-9a-f]{6}, #[0-9a-f]{6}\)/)
  assert.match(lookCss({ theme: 'custom', gradient: { colors: ['#ff8800', '#0088ff'], angle: 90 } }), /linear-gradient\(90deg/)
})

test('Farbwähler: Hex und HSV hin und zurück', () => {
  for (const hex of ['#000000', '#ffffff', '#1b8a94', '#c8434b', '#3a6fc4', '#b88a12']) assert.equal(hsvToHex(hexToHsv(hex)), hex)
  assert.deepEqual(hexToHsv('#f00'), { h: 0, s: 1, v: 1 })
  assert.equal(hexToHsv('rot'), null)
})
