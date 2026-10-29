// Bild bearbeiten (wie Greenshot): Markierungen als Liste von Schritten über dem Original, reine Rechnungen.
// Koordinaten in Bildpixeln des gedrehten Bilds. Arten: rect, ellipse, line, arrow, pen, marker (wie beim Zeichnen),
// fill (halbtransparente Fläche), black (schwärzen), pixel (verpixeln), text, number (nummerierter Kreis)
import { hits } from './ink.js'

export const TEXT_SIZE = { 2: 18, 4: 24, 8: 34 }
export const NUMBER_RADIUS = { 2: 14, 4: 18, 8: 26 }
const LINES = new Set(['line', 'arrow', 'pen', 'marker'])

// Rechteck [links, oben, rechts, unten] einer Markierung
export function opBounds(op) {
  if (op.t === 'text') {
    const size = TEXT_SIZE[op.w] ?? 24
    const [x, y] = op.p[0]
    return [x, y, x + Math.max(1, op.text.length) * size * 0.58 + size * 0.6, y + size * 1.4]
  }
  if (op.t === 'number') {
    const r = NUMBER_RADIUS[op.w] ?? 18
    const [x, y] = op.p[0]
    return [x - r, y - r, x + r, y + r]
  }
  const xs = op.p.map((p) => p[0])
  const ys = op.p.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

// Oberste Markierung unter dem Punkt (Linien und Striche am Strich, alles andere in der Fläche); -1 = keine
export function hitOp(ops, x, y, tolerance = 6) {
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]
    if (LINES.has(op.t)) {
      if (hits(op, x, y, tolerance)) return i
      continue
    }
    const [l, t, r, b] = opBounds(op)
    if (x >= l - tolerance && x <= r + tolerance && y >= t - tolerance && y <= b + tolerance) return i
  }
  return -1
}

export const moveOp = (op, dx, dy) => ({ ...op, p: op.p.map(([x, y, ...rest]) => [Math.round(x + dx), Math.round(y + dy), ...rest]) })

// 90° im Uhrzeigersinn: Bild w×h wird h×w, Punkt (x, y) wird (h - y, x); Ausschnitt dreht mit
const turn = ([x, y, ...rest], h) => [h - y, x, ...rest]
export function rotateState({ ops, crop }, w, h) {
  const box = crop && [turn([crop[0], crop[1] + crop[3]], h), turn([crop[0] + crop[2], crop[1]], h)]
  return {
    // Text und Nummern hängen an ihrem Punkt und bleiben waagerecht lesbar
    ops: ops.map((op) => ({ ...op, p: op.p.map((pt) => turn(pt, h)) })),
    crop: box ? [box[0][0], box[0][1], box[1][0] - box[0][0], box[1][1] - box[0][1]] : null,
  }
}

// Ausschnitt aus zwei Ecken, auf das Bild begrenzt; zu klein = keiner
export function cropFrom([ax, ay], [bx, by], w, h) {
  const l = Math.max(0, Math.min(ax, bx))
  const t = Math.max(0, Math.min(ay, by))
  const r = Math.min(w, Math.max(ax, bx))
  const b = Math.min(h, Math.max(ay, by))
  return r - l < 8 || b - t < 8 ? null : [Math.round(l), Math.round(t), Math.round(r - l), Math.round(b - t)]
}

// Nächste Nummer für den Nummern-Stempel
export const nextNumber = (ops) => Math.max(0, ...ops.filter((o) => o.t === 'number').map((o) => o.n)) + 1
