import { test } from 'node:test'
import assert from 'node:assert/strict'
import { css, inkSvg } from './onenote.js'

test('OneNote-Format: nur Abweichungen vom Absatzformat bleiben', () => {
  const base = { font: 'Calibri', size: 11 }
  assert.equal(css("font-family:Calibri;font-size:11.0pt;color:#C00000", base), 'color:#C00000')
  assert.equal(css("font-family:'Segoe UI';font-size:14.0pt", base), 'font-family:Segoe UI;font-size:14.0pt')
  assert.equal(css('background:yellow;mso-highlight:yellow', base), 'background-color:yellow')
  assert.equal(css('color:automatic;background:white;lang:de-DE', base), '')
  assert.equal(css('font-weight:bold;text-decoration:underline', base), 'font-weight:bold;text-decoration:underline')
  assert.equal(css(null, base), '')
})

test('Freihand als SVG: Rand, Größe, Textmarker', () => {
  const strokes = [
    { color: '#000000', width: 2, marker: false, points: [[100, 50], [140, 60], [180, 52]] },
    { color: '#ffff00', width: 12, marker: true, points: [[110, 70]] },
  ]
  const { svg, width } = inkSvg(strokes)
  assert.equal(width, 88) // 180 − 100 + 2 × 4 Rand
  assert.match(svg, /viewBox="0 0 88 28"/)
  assert.match(svg, /<path d="M4 4L44 14L84 6" stroke="#000000" stroke-width="2"\/>/)
  assert.match(svg, /stroke-opacity="0.4"/) // Textmarker halb durchsichtig
  assert.match(svg, /M14 24l0.1 0/) // einzelner Punkt bleibt sichtbar
  assert.equal(inkSvg([]), null)
})
