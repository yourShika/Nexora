// Passwort-Warnung beim Einfügen: findet Passwort-artige Stellen in Text und maskiert sie.
// Bewusst vorsichtig: lieber einmal zu oft fragen; "Trotzdem einfügen" bleibt immer möglich.

const BLOCKS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, // privater Schlüssel
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, // JWT
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, // GitHub
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g, // Slack
]

// Wert hinter einem verräterischen Namen: Passwort=…, "password": "…", AccountKey=…
const KEYED = /\b(pass(?:wor[dt])?|pwd|kennwort|secret|token|api[-_]?key|client[-_]?secret|account[-_]?key|shared[-_]?access[-_]?key)\b["']?\s*[:=]\s*["']?([^\s"';,]{4,})/gi

// Ein einzelnes Wort, das nach Passwort aussieht: 10–64 Zeichen, mit Ziffer, mindestens drei Zeichenarten,
// und keine Adresse, kein Pfad, keine Mail, keine GUID/Prüfsumme, kein Name mit Zahl
function looksLikePassword(word) {
  if (!/^\S{10,64}$/.test(word) || !/\d/.test(word)) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(word) || /^[a-z]:\\|^\\\\/i.test(word) || /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(word)) return false
  if (/^[0-9a-f{}-]+$/i.test(word)) return false
  // Namen mit Zahl wie Server2019, Windows11, SRV-DC01-Backup2: typisch für Rechner und Produkte
  if (/^[A-Za-z]+\d*(?:[-_.][A-Za-z]+\d*)*$/.test(word)) return false
  return [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(word)).length >= 3
}

function merge(spans) {
  const out = []
  for (const s of spans.sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1)
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
    else out.push([...s])
  }
  return out
}

// Bereiche [von, bis) mit vermutlich geheimem Inhalt
export function secretSpans(text) {
  const spans = []
  for (const re of BLOCKS) for (const m of text.matchAll(re)) spans.push([m.index, m.index + m[0].length])
  for (const m of text.matchAll(KEYED)) {
    const end = m.index + m[0].length
    spans.push([end - m[2].length, end])
  }
  const word = text.trim()
  if (!spans.length && looksLikePassword(word)) {
    const start = text.indexOf(word)
    spans.push([start, start + word.length])
  }
  return merge(spans)
}

export const maskSecrets = (text, spans) => spans.reduceRight((t, [a, b]) => t.slice(0, a) + '••••••' + t.slice(b), text)
