// Geometrie der Striche: SVG-Pfad zum Zeichnen, Umriss zum Radieren
const mid = ([ax, ay], [bx, by]) => [(ax + bx) / 2, (ay + by) / 2]

export function inkPath({ t, p, w }) {
  const [[x1, y1], [x2, y2] = p[0]] = p
  if (t === 'rect') return `M${x1} ${y1}H${x2}V${y2}H${x1}Z`
  if (t === 'ellipse') {
    const rx = Math.abs(x2 - x1) / 2
    const ry = Math.abs(y2 - y1) / 2
    const cy = (y1 + y2) / 2
    return `M${Math.min(x1, x2)} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`
  }
  if (t === 'line') return `M${x1} ${y1}L${x2} ${y2}`
  if (t === 'arrow') {
    const a = Math.atan2(y2 - y1, x2 - x1)
    const len = Math.max(10, w * 4)
    const head = (s) => `${x2 - len * Math.cos(a + s)} ${y2 - len * Math.sin(a + s)}`
    return `M${x1} ${y1}L${x2} ${y2}M${head(0.45)}L${x2} ${y2}L${head(-0.45)}`
  }
  // Stift und Textmarker: über die Mittelpunkte geglättet; ein einzelner Punkt wird ein Tupfer
  if (p.length === 1) return `M${x1} ${y1}l0.01 0`
  let d = `M${x1} ${y1}`
  for (let i = 1; i < p.length - 1; i++) {
    const [mx, my] = mid(p[i], p[i + 1])
    d += `Q${p[i][0]} ${p[i][1]} ${mx} ${my}`
  }
  const [lx, ly] = p[p.length - 1]
  return `${d}L${lx} ${ly}`
}

function outline({ t, p }) {
  const [[x1, y1], [x2, y2] = p[0]] = p
  if (t === 'rect') return [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]
  if (t === 'ellipse') {
    const [cx, cy, rx, ry] = [(x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2]
    return Array.from({ length: 33 }, (_, i) => [cx + rx * Math.cos((i / 32) * 2 * Math.PI), cy + ry * Math.sin((i / 32) * 2 * Math.PI)])
  }
  return t === 'line' || t === 'arrow' ? [[x1, y1], [x2, y2]] : p
}

function segmentDistance(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const k = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  return Math.hypot(px - ax - k * dx, py - ay - k * dy)
}

// Trifft der Radierer (Kreis mit Radius r) den Strich? Rechteck und Ellipse nur am Rand, wie gezeichnet
export function hits(stroke, x, y, r) {
  const o = outline(stroke)
  const reach = r + stroke.w / 2
  if (o.length === 1) return Math.hypot(x - o[0][0], y - o[0][1]) <= reach
  for (let i = 1; i < o.length; i++) if (segmentDistance(x, y, o[i - 1], o[i]) <= reach) return true
  return false
}

// Äußerste Ecke aller Striche, damit die Fläche mitwächst
export const inkExtent = (ink) =>
  ink.reduce(([mx, my], s) => s.p.reduce(([ax, ay], [x, y]) => [Math.max(ax, x + s.w), Math.max(ay, y + s.w)], [mx, my]), [0, 0])

// Druckstärke: Punkte mit drittem Wert (1–100, nur Stift-Eingabe) bekommen eine wechselnde Breite
export const hasPressure = (s) => s.t === 'pen' && s.p.length > 1 && s.p[0].length > 2
const radius = (w, pressure) => (w / 2) * (0.25 + (1.5 * pressure) / 100)

// Umriss als gefüllte Fläche: links an den Punkten entlang, runde Kappe, rechts zurück
export function pressurePath({ p, w }) {
  const n = p.length
  const left = []
  const right = []
  for (let i = 0; i < n; i++) {
    const [ax, ay] = p[Math.max(0, i - 1)]
    const [bx, by] = p[Math.min(n - 1, i + 1)]
    const len = Math.hypot(bx - ax, by - ay) || 1
    const r = radius(w, p[i][2])
    const nx = (-(by - ay) / len) * r
    const ny = ((bx - ax) / len) * r
    left.push(`${(p[i][0] + nx).toFixed(1)} ${(p[i][1] + ny).toFixed(1)}`)
    right.unshift(`${(p[i][0] - nx).toFixed(1)} ${(p[i][1] - ny).toFixed(1)}`)
  }
  const cap = (i) => radius(w, p[i][2]).toFixed(1)
  return `M${left.join('L')}A${cap(n - 1)} ${cap(n - 1)} 0 0 1 ${right[0]}L${right.slice(1).join('L')}A${cap(0)} ${cap(0)} 0 0 1 ${left[0]}Z`
}

// Lasso: Punkt im Vieleck (Strahlverfahren)
export function inside([x, y], poly) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

// Gewählt ist ein Strich, wenn mindestens die Hälfte seiner Punkte im Lasso liegt
export function lassoPick(ink, poly) {
  return ink.flatMap((s, i) => {
    const o = outline(s)
    return o.filter((pt) => inside(pt, poly)).length * 2 >= o.length ? [i] : []
  })
}

// Rahmen um Striche (mit halber Breite) und Rechtecke {x, y, w, h}: [links, oben, rechts, unten]
export function bounds(strokes, rects = []) {
  let b = [Infinity, Infinity, -Infinity, -Infinity]
  for (const s of strokes) for (const [x, y] of outline(s)) b = [Math.min(b[0], x - s.w / 2), Math.min(b[1], y - s.w / 2), Math.max(b[2], x + s.w / 2), Math.max(b[3], y + s.w / 2)]
  for (const r of rects) b = [Math.min(b[0], r.x), Math.min(b[1], r.y), Math.max(b[2], r.x + r.w), Math.max(b[3], r.y + r.h)]
  return b[0] === Infinity ? null : b
}

// Verschieben und Größe ändern (um den Punkt ox, oy); Druckwerte bleiben
export const moveStroke = (s, dx, dy) => ({ ...s, p: s.p.map(([x, y, ...r]) => [Math.round(x + dx), Math.round(y + dy), ...r]) })
export const scaleStroke = (s, ox, oy, k) => ({ ...s, p: s.p.map(([x, y, ...r]) => [Math.round(ox + (x - ox) * k), Math.round(oy + (y - oy) * k), ...r]) })
