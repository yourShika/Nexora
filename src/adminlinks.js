// Admin-Links im Text: Freigaben (\\server\freigabe), lokale Pfade (C:\…), rdp:// und ssh://.
// Pfade mit Leerzeichen erkennt Nexora, wenn sie in Anführungszeichen stehen.
const PATTERN = /"((?:\\\\|[A-Za-z]:\\)[^"\n]+)"|(\\\\[\w.$-]+(?:\\[^\s"'<>|*?\\]+)*\\?)|(\b[A-Za-z]:\\[^\s"'<>|*?]*)|(\b(?:rdp|ssh):\/\/[\w.@:-]+)/g

// [{ from, to, target }] relativ zum Text; Satzzeichen am Ende gehören nicht dazu
export function adminLinks(text) {
  const out = []
  for (const m of text.matchAll(PATTERN)) {
    const quoted = m[1] !== undefined
    let target = m[1] ?? m[2] ?? m[3] ?? m[4]
    if (!quoted) target = target.replace(/[.,;:!?)\]]+$/, '')
    const from = m.index + (quoted ? 1 : 0)
    out.push({ from, to: from + target.length, target })
  }
  return out
}
