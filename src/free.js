// Freie Seite: Markdown mit unsichtbaren Positionszeilen, damit Suche, Verlauf, Links und Export unverändert laufen.
// shortcut: eine Zeile "<!-- box … -->" mitten in einem Codeblock würde den Kasten teilen; erst ändern, wenn das vorkommt
export const CANVAS = '<!-- nexora:canvas -->'
const BOX = /^<!-- box x=(\d+) y=(\d+) w=(\d+) -->$/
// Ein Strich je Zeile, immer hinter den Kästen; die Suche schneidet ab dem ersten Strich ab (Migration 007).
// Punkte "x,y" oder mit Stiftdruck "x,y,druck" (1–100)
const STROKE = 't=(pen|marker|line|arrow|rect|ellipse) c=(text|#[0-9a-f]{6}) w=(\\d+) p=(-?\\d+,-?\\d+(?:,\\d+)?(?: -?\\d+,-?\\d+(?:,\\d+)?)*)'
const INK = new RegExp(`^<!-- ink ${STROKE} -->$`)
const ONE = new RegExp(`^${STROKE}$`)
const toStroke = ([, t, c, w, p]) => ({ t, c, w: +w, p: p.split(' ').map((xy) => xy.split(',').map(Number)) })
const strokeText = (s) => `t=${s.t} c=${s.c} w=${s.w} p=${s.p.map(([x, y, pr]) => `${Math.round(x)},${Math.round(y)}${pr ? `,${Math.round(pr)}` : ''}`).join(' ')}`
const reading = (a, b) => a.y - b.y || a.x - b.x

export const isFree = (body) => (body ?? '').startsWith(CANVAS)
export const hasInk = (body) => (body ?? '').includes('\n<!-- ink ')

export function parseBoxes(body) {
  const boxes = []
  let box = null
  for (const line of body.slice(CANVAS.length).split('\n')) {
    if (INK.test(line.trim())) continue
    const m = BOX.exec(line.trim())
    if (m) boxes.push((box = { x: +m[1], y: +m[2], w: +m[3], lines: [] }))
    else if (box) box.lines.push(line)
    // Text vor dem ersten Kasten (von Hand bearbeitet) wird ein eigener Kasten
    else if (line.trim()) boxes.push((box = { x: 0, y: 20, w: 480, lines: [line] }))
  }
  return boxes.map(({ lines, ...b }) => ({ ...b, md: lines.join('\n').replace(/^\n+|\s+$/g, '') }))
}

export function parseInk(body) {
  return body
    .split('\n')
    .map((line) => INK.exec(line.trim()))
    .filter(Boolean)
    .map(toStroke)
}

const inkLine = (s) => `<!-- ink ${strokeText(s)} -->`

// Zeichnungs-Block in normalen Seiten: eine unsichtbare Zeile "<!-- nexora:zeichnung h=240 | Strich | Strich -->"
export const DRAWING = /^<!-- nexora:zeichnung h=(\d+)((?: \| [^|\n]+)*) -->$/
export function parseDrawing(line) {
  const m = DRAWING.exec(line.trim())
  if (!m) return null
  return { h: +m[1], ink: m[2].split(' | ').slice(1).map((t) => ONE.exec(t.trim())).filter(Boolean).map(toStroke) }
}
export const drawingLine = ({ h, ink }) => `<!-- nexora:zeichnung h=${Math.round(h)}${ink.map((s) => ` | ${strokeText(s)}`).join('')} -->`

// Für die Suche: Text ohne Strich-Zeilen; null, wenn es keine gibt (dann gilt der Text selbst, Migration 011)
const INK_LINE = /^\s*<!-- (ink |nexora:zeichnung )/
export function searchText(body) {
  const lines = (body ?? '').split('\n')
  return lines.some((l) => INK_LINE.test(l)) ? lines.filter((l) => !INK_LINE.test(l)).join('\n') : null
}

// Leere Kästen fallen weg; Reihenfolge von oben nach unten, damit der Export lesbar bleibt
export function serializeBoxes(boxes, ink = []) {
  const kept = boxes.filter((b) => b.md.trim()).sort(reading)
  return [CANVAS, ...kept.map((b) => `<!-- box x=${Math.round(b.x)} y=${Math.round(b.y)} w=${Math.round(b.w)} -->\n${b.md}\n`), ...ink.map(inkLine)].join('\n')
}

const INK_NAMES = { pen: 'Stift', marker: 'Textmarker', line: 'Linie', arrow: 'Pfeil', rect: 'Rechteck', ellipse: 'Ellipse' }
// Für den Versionsvergleich: ein Strich als kurze Zeile statt einer Zahlenkolonne
export const readable = (body) =>
  body
    .replace(/^<!-- ink t=(\w+).*$/gm, (_, t) => `✎ ${INK_NAMES[t]}`)
    .replace(/^<!-- nexora:zeichnung .*$/gm, (line) => `✎ Zeichnung (${parseDrawing(line)?.ink.length ?? 0} Striche)`)

export const toFlow =(body) => parseBoxes(body).sort(reading).map((b) => b.md).filter(Boolean).join('\n\n')
export const toFree = (md) => serializeBoxes([{ x: 0, y: 20, w: 640, md }])
