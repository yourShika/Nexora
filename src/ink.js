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
