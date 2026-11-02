// Sprache und Besprechungen: reine Logik, direkt testbar. Aufnahme und Erkennung laufen in Rust (speech.rs, capture.rs).

export const SPEECH_MODELS = [
  { id: 'small', label: 'Schnell', size: '190 MB', hint: 'Für Diktat und Live-Mitschrift empfohlen, läuft auch auf normalen PCs flüssig.' },
  { id: 'turbo', label: 'Genau', size: '574 MB', hint: 'Besser bei Fachwörtern, rechnet aber deutlich länger. Live nur auf starken PCs.' },
]

export const SPEECH_DEFAULTS = { model: 'small', language: 'de', microphone: '', speaker: '', keepAudio: true }

export const SPEECH_LANGUAGES = [['de', 'Deutsch'], ['en', 'Englisch'], ['auto', 'Automatisch erkennen']]

const two = (n) => String(n).padStart(2, '0')

export function clock(ms) {
  const s = Math.floor((ms ?? 0) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`
}

// Abschnitte kommen je Quelle in Reihenfolge, zwischen den Quellen aber versetzt: nach Beginn einsortieren
export function addLine(lines, line) {
  let i = lines.length
  while (i > 0 && lines[i - 1].startMs > line.startMs) i--
  return [...lines.slice(0, i), line, ...lines.slice(i)]
}

const SPEAKER = { ich: 'Ich', andere: 'Andere' }

// Aufeinanderfolgende Stücke derselben Quelle werden ein Absatz
export function transcriptParts(lines) {
  const parts = []
  let last = null
  for (const l of lines) {
    if (last && last.source === l.source) {
      last.text += ` ${l.text}`
      continue
    }
    last = { who: SPEAKER[l.source] ?? null, source: l.source, startMs: l.startMs, text: l.text }
    parts.push(last)
  }
  return parts
}

export const transcriptMarkdown = (lines) => transcriptParts(lines).map((p) => `${p.who ? `**${p.who}** ` : ''}(${clock(p.startMs)}) ${p.text}`).join('\n\n')

export function meetingTitle(date, kind = 'Besprechung') {
  return `${kind} ${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`
}

export const audioName = (date) => `Aufnahme ${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}${two(date.getMinutes())}.m4a`

const MITSCHRIFT = '## Mitschrift'
const SUMMARY = '## Zusammenfassung'
const AUDIO = '## Aufnahme'

// Seite aus ihren Teilen; Zusammenfassung oben, die Aufnahme unten
export const meetingBody = ({ summary, transcript, audio }) =>
  [summary ? `${SUMMARY}\n\n${summary.trim()}` : null, `${MITSCHRIFT}\n\n${transcript || 'Noch nichts erkannt.'}`, audio ? `${AUDIO}\n\n${audio}` : null].filter(Boolean).join('\n\n')

export const attachmentLink = (rel, size) => `[[datei:${rel}|${size}]]`

export const SUMMARY_PROMPT = 'Das ist die automatische Mitschrift einer Besprechung, sie kann Hörfehler enthalten. „Ich“ und „Andere“ bezeichnen nur die Tonquelle. Fasse sie zusammen: zuerst die Kernpunkte als Stichpunkte, danach eine Liste „Entscheidungen“, falls es welche gab. Erfinde nichts, was nicht in der Mitschrift steht. Antworte in der Sprache der Mitschrift.'

export const TASKS_PROMPT = 'Das ist die automatische Mitschrift einer Besprechung, sie kann Hörfehler enthalten. Liste die Aufgaben auf, die darin vereinbart wurden. Antworte nur mit einem JSON-Array, jeder Eintrag: {"title": "kurzer Aufgabentext", "person": "Name, falls genannt, sonst leer", "due": "Datum als JJJJ-MM-TT, falls genau genannt, sonst leer"}. Erfinde nichts. Wurde nichts vereinbart, antworte mit [].'

// Modelle verpacken JSON gern in Text oder Code-Zäune
export function parseTasks(answer) {
  const text = answer ?? ''
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let list
  try {
    list = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []
  return list
    .filter((t) => typeof t?.title === 'string' && t.title.trim())
    .slice(0, 50)
    .map((t) => ({
      title: t.title.trim().slice(0, 300),
      person: typeof t.person === 'string' ? t.person.trim() : '',
      due: /^\d{4}-\d{2}-\d{2}$/.test(t.due ?? '') ? t.due : '',
    }))
}

// Felder eines neuen Punkts: nur, was die Liste auch hat
export function taskProps(task, fields) {
  const has = (id, type) => fields.some((f) => f.id === id && f.type === type)
  return { ...(task.person && has('person', 'person') ? { person: task.person } : {}), ...(task.due && has('due', 'date') ? { due: task.due } : {}) }
}
