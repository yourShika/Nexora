// Freie Seite: Markdown mit unsichtbaren Positionszeilen, damit Suche, Verlauf, Links und Export unverändert laufen.
// shortcut: eine Zeile "<!-- box … -->" mitten in einem Codeblock würde den Kasten teilen; erst ändern, wenn das vorkommt
export const CANVAS = '<!-- nexora:canvas -->'
const BOX = /^<!-- box x=(\d+) y=(\d+) w=(\d+) -->$/
const reading = (a, b) => a.y - b.y || a.x - b.x

export const isFree = (body) => (body ?? '').startsWith(CANVAS)

export function parseBoxes(body) {
  const boxes = []
  let box = null
  for (const line of body.slice(CANVAS.length).split('\n')) {
    const m = BOX.exec(line.trim())
    if (m) boxes.push((box = { x: +m[1], y: +m[2], w: +m[3], lines: [] }))
    else if (box) box.lines.push(line)
    // Text vor dem ersten Kasten (von Hand bearbeitet) wird ein eigener Kasten
    else if (line.trim()) boxes.push((box = { x: 0, y: 20, w: 480, lines: [line] }))
  }
  return boxes.map(({ lines, ...b }) => ({ ...b, md: lines.join('\n').replace(/^\n+|\s+$/g, '') }))
}

// Leere Kästen fallen weg; Reihenfolge von oben nach unten, damit der Export lesbar bleibt
export function serializeBoxes(boxes) {
  const kept = boxes.filter((b) => b.md.trim()).sort(reading)
  return [CANVAS, ...kept.map((b) => `<!-- box x=${Math.round(b.x)} y=${Math.round(b.y)} w=${Math.round(b.w)} -->\n${b.md}\n`)].join('\n')
}

export const toFlow = (body) => parseBoxes(body).sort(reading).map((b) => b.md).filter(Boolean).join('\n\n')
export const toFree = (md) => serializeBoxes([{ x: 0, y: 20, w: 640, md }])
