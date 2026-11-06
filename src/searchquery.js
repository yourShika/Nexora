// Suchanfrage zerlegen (ohne React, damit testbar); Search.jsx gibt die Namen weiter
export const norm = (s) => (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

// "#tag @person status:offen in:exchange rest" -> Filter + Suchwörter.
// Namen mit Leerzeichen in Anführungszeichen wie in der Kurzsyntax: @"Kim Bura", #"Listen & Struktur"
export function parseSearch(q) {
  const f = { tags: [], text: [] }
  const rest = q.replace(/([#@])"([^"]+)"/g, (_, sign, name) => ((sign === '#' ? f.tags.push(norm(name.trim())) : (f.person = norm(name.trim()))), ' '))
  for (const tok of rest.trim().split(/\s+/).filter(Boolean)) {
    if (/^#./.test(tok)) f.tags.push(norm(tok.slice(1)))
    else if (/^@./.test(tok)) f.person = norm(tok.slice(1))
    else if (/^status:./i.test(tok)) f.status = norm(tok.slice(7))
    else if (/^in:./i.test(tok)) f.in = norm(tok.slice(3))
    else f.text.push(norm(tok))
  }
  return f
}

// FTS5-Ausdruck: trigram braucht mindestens 3 Zeichen pro Wort
export const ftsQuery = (words) => words.filter((w) => w.length >= 3).map((w) => `"${w.replace(/"/g, '""')}"`).join(' ')
