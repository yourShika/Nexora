// Zeilenvergleich über die längste gemeinsame Teilfolge.
// 'del' = nur im alten Text, 'add' = nur im neuen, 'same' = in beiden.
export function diffLines(oldText, newText) {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  // shortcut: sehr lange Seiten (über 4 Mio. Zellen) nur als Ganzes gegenüberstellen
  if (a.length * b.length > 4e6) return [...a.map((text) => ({ type: 'del', text })), ...b.map((text) => ({ type: 'add', text }))]

  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) out.push({ type: 'same', text: a[i++] }), j++
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ type: 'del', text: a[i++] })
    else out.push({ type: 'add', text: b[j++] })
  }
  while (i < a.length) out.push({ type: 'del', text: a[i++] })
  while (j < b.length) out.push({ type: 'add', text: b[j++] })
  return out
}

// Lange unveränderte Strecken einklappen, `context` Zeilen um jede Änderung bleiben stehen
export function collapse(diff, context = 2) {
  const keep = diff.map((d, i) => d.type !== 'same' || diff.slice(Math.max(0, i - context), i + context + 1).some((x) => x.type !== 'same'))
  const out = []
  for (let i = 0; i < diff.length; i++) {
    if (keep[i]) out.push(diff[i])
    else if (out.at(-1)?.type !== 'gap') out.push({ type: 'gap', count: 1 })
    else out.at(-1).count++
  }
  return out
}
