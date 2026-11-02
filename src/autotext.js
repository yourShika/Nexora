// Autokorrektur und Autofüllen: reine Logik ohne Editor und ohne Tauri, darum direkt testbar.
import { maskSecrets, secretSpans } from './secrets.js'

const LEAD = /^[("„“”‚‘’'[{«»]+/u
const TAIL = /[)"“”‘’'\]}.,;:!?…«»]+$/u
const PLAIN = /^\p{L}+(?:-\p{L}+)*$/u

// Wörter im Text: an Leerraum getrennt, außen ohne Satzzeichen. Was Ziffern, Pfadzeichen oder einen Punkt im
// Wort hat (server01, konfig.txt, C:\Temp, --force, #tag), ist kein Wort und bleibt damit überall außen vor
export function tokens(text) {
  const out = []
  for (const m of text.matchAll(/\S+/gu)) {
    const lead = m[0].match(LEAD)?.[0].length ?? 0
    const core = m[0].slice(lead).replace(TAIL, '')
    // dot: Punkt direkt dahinter, das kann eine Abkürzung sein (ggf.)
    if (PLAIN.test(core)) out.push({ word: core, from: m.index + lead, to: m.index + lead + core.length, dot: m[0][lead + core.length] === '.' })
  }
  return out
}

// Teile, die ins Wörterbuch müssen: ohne Abkürzungen (IT, VPN) und gemischte Schreibung (PowerShell, IPsec)
export const partsToCheck = (word) => word.split('-').filter((p) => p.length >= 2 && !/\p{Lu}{2}|\p{Ll}\p{Lu}/u.test(p))

// Wie sich ein Vorschlag vom Wort unterscheidet: nur Groß/klein, zwei Buchstaben vertauscht, ein Buchstabe doppelt,
// ein Buchstabe anders/zu viel/fehlt; null, wenn es weiter weg ist
export function editKind(word, candidate) {
  const a = [...word.toLowerCase()]
  const b = [...candidate.toLowerCase()]
  if (a.join('') === b.join('')) return 'case'
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let endA = a.length
  let endB = b.length
  while (endA > i && endB > i && a[endA - 1] === b[endB - 1]) (endA--, endB--)
  const restA = endA - i
  const restB = endB - i
  if (restA === 2 && restB === 2 && a[i] === b[i + 1] && a[i + 1] === b[i]) return 'swap'
  // ss zählt nicht: das ist meist ein ß (Gruess, nicht Grues)
  if (restA === 1 && restB === 0 && a[i] !== 's' && (a[i] === a[i - 1] || a[i] === a[i + 1])) return 'double'
  return restA <= 1 && restB <= 1 ? 'edit' : null
}

// Der eine Vorschlag, den Nexora ohne Rückfrage einsetzen darf; im Zweifel keiner. Der erste Vorschlag der
// Wörterbücher taugt dafür nicht (ipconfig → Konfiguration), darum zählt nur, was ganz nah dran und allein ist.
// Großgeschriebenes ist oft ein Name: dort nur Dreher und doppelte Buchstaben, kein ersetzter Buchstabe
export function pickFix(word, suggestions) {
  const seen = { case: new Map(), swap: new Map(), double: new Map(), edit: new Map() }
  for (const s of suggestions) {
    if (/[\s-]/.test(s)) continue
    const kind = editKind(word, s)
    const low = s.toLowerCase()
    if (kind && !seen[kind].has(low)) seen[kind].set(low, s)
  }
  const only = (m) => (m.size === 1 ? [...m.values()][0] : null)
  if (seen.case.size) return only(seen.case)
  if (seen.swap.size) return only(seen.swap)
  if ([...word].length < 4) return null
  if (seen.double.size) return only(seen.double)
  return /^\p{Lu}/u.test(word) ? null : only(seen.edit)
}

// Fürs Kontextmenü: Nächstes zuerst, ohne Doppelte und ohne Trennungen wie „noch h“
export function rankSuggestions(word, suggestions, limit = 6) {
  const order = ['case', 'swap', 'double', 'edit']
  const rank = (s) => {
    const i = order.indexOf(editKind(word, s))
    return i < 0 ? order.length : i
  }
  const clean = [...new Set(suggestions)].filter((s) => !/\s|^-/.test(s) && s !== word)
  return clean.map((s, i) => [rank(s), i, s]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, limit).map((x) => x[2])
}

const ABBREVIATIONS = new Set(['z.b', 'zb', 'd.h', 'dh', 'u.a', 'bzw', 'ca', 'etc', 'ggf', 'vgl', 'usw', 'nr', 'dr', 'hr', 'fr', 'inkl', 'evtl', 'max', 'min', 'tel', 's.o', 's.u', 'u.u', 'o.ä', 'e.g', 'i.e', 'vs', 'mio', 'mrd', 'str', 'abs', 'kap', 'bsp', 'sog', 'zzgl', 'exkl', 'prof', 'mr', 'mrs'])

// Beginnt hier ein Satz? before: Text des Absatzes vor dem Wort. Aufzählung „1.“, Abkürzungen und Auslassungspunkte zählen nicht
export function startsSentence(before) {
  const text = before.trimEnd()
  if (!text) return true
  if (text.length === before.length) return false
  const m = text.match(/(\S*?)([.!?]+)["“”’)\]]*$/u)
  if (!m || /^\.{2,}$/.test(m[2])) return false
  if (m[2] !== '.') return true
  return !!m[1] && !/\d$/.test(m[1]) && !/^\p{L}$/u.test(m[1]) && !ABBREVIATIONS.has(m[1].toLowerCase())
}

// Was beim Leerzeichen aus einem Wort wird; null: es bleibt. known und suggest fragen die Wörterbücher.
// isNever: hier wurde eine Korrektur zurückgenommen, nichts mehr anfassen. isOwn: eigene Wörter und was in den
// Seiten steht, das gilt als richtig geschrieben; am Satzanfang groß wird es trotzdem, wenn das Wörterbuch es kennt
export async function planFix(word, { opts, sentenceStart, known, suggest, isOwn, isNever }) {
  if (word.includes('-') || isNever(word)) return null
  let next = word
  if (opts.caps && /^\p{Lu}{2}\p{Ll}{2,}$/u.test(word)) {
    const lowered = word[0] + word.slice(1).toLowerCase()
    if (await known(lowered)) next = lowered
  }
  if (opts.fix && !isOwn(next) && partsToCheck(next).length && !(await known(next))) next = pickFix(next, await suggest(next)) ?? next
  if (opts.caps && sentenceStart && /^\p{Ll}+$/u.test(next) && (await known(next))) next = next[0].toUpperCase() + next.slice(1)
  return next === word ? null : next
}

// ---- Autofüllen: was in den eigenen Seiten steht, nur im Speicher ----

export const newCounts = () => ({ forms: new Map(), pairs: new Map() })

// Markdown auf Fließtext; Code, Adressen und Bilder werden zu „|“, das trennt auch Wortfolgen
export function plainLines(markdown) {
  const text = (markdown ?? '')
    .replace(/```[\s\S]*?(?:```|$)/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
    .replace(/`[^`\n]*`/g, ' | ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' | ')
    .replace(/\[\[(?:datei|lop|tresor|vault)[^\]]*\]\]/gi, ' | ')
    .replace(/\[\[([^\]|]*)\|[^\]]*\]\]/g, ' $1 ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\S+:\/\/\S+/g, ' | ')
    .replace(/\*+|~~/g, '')
  return text.split('\n').map((line) => {
    const spans = secretSpans(line)
    return spans.length ? maskSecrets(line, spans) : line
  })
}

// Zählt Wörter und, außer bei Titeln, welches Wort auf welches folgt (nur ohne Satzzeichen dazwischen)
export function learn(counts, markdown, { pairs = true } = {}) {
  for (const line of plainLines(markdown)) {
    let last = null
    for (const t of tokens(line)) {
      counts.forms.set(t.word, (counts.forms.get(t.word) ?? 0) + 1)
      if (pairs && last && /^\s+$/.test(line.slice(last.to, t.from))) {
        const key = `${last.word.toLowerCase()} ${t.word.toLowerCase()}`
        counts.pairs.set(key, (counts.pairs.get(key) ?? 0) + 1)
      }
      last = t
    }
  }
  return counts
}

const WORD_MIN = 2 // ab so vielen Vorkommen wird ein Wort vorgeschlagen
const PHRASE_MIN = 3 // ab so vielen Vorkommen läuft eine Wortfolge von selbst weiter
const prefixOf = (lower) => [...lower].slice(0, 3).join('')

export function buildModel(counts) {
  const words = new Map()
  const best = new Map()
  for (const [form, c] of counts.forms) {
    const lower = form.toLowerCase()
    const w = words.get(lower) ?? { lower, form, c: 0 }
    w.c += c
    if (c > (best.get(lower) ?? 0)) {
      best.set(lower, c)
      w.form = form
    }
    words.set(lower, w)
  }
  const byCount = (a, b) => b.c - a.c || a.lower.localeCompare(b.lower)
  const buckets = new Map()
  for (const w of words.values()) {
    if (w.c < WORD_MIN || [...w.lower].length < 4) continue
    const key = prefixOf(w.lower)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(w)
  }
  for (const list of buckets.values()) list.sort(byCount)
  const next = new Map()
  for (const [key, c] of counts.pairs) {
    if (c < WORD_MIN) continue
    const [first, second] = key.split(' ')
    const w = words.get(second)
    if (!w) continue
    if (!next.has(first)) next.set(first, [])
    next.get(first).push({ lower: second, form: w.form, c })
  }
  for (const list of next.values()) list.sort(byCount)
  return { forms: counts.forms, words, buckets, next }
}

// Steht das Wort so oft in den Seiten? Genau so geschrieben, am Satzanfang darf es zusätzlich groß sein.
// „fehler“ zählt also nicht, nur weil „Fehler“ dasteht
export function seenInPages(model, word, min = 1) {
  if (!model) return false
  const small = word[0].toLowerCase() + word.slice(1)
  return (model.forms.get(word) ?? 0) + (small === word ? 0 : model.forms.get(small) ?? 0) >= min
}

// Wörter, die sicher folgen: oft genug und meistens genau dieses Wort
function chain(model, lower, max = 4) {
  const out = []
  let at = lower
  while (out.length < max) {
    const total = model.words.get(at)?.c ?? 0
    const top = model.next.get(at)?.[0]
    if (!top || top.c < PHRASE_MIN || top.c / total < 0.6) break
    out.push(top.form)
    at = top.lower
  }
  return out
}

// Vorschlag für den Text vor der Schreibmarke: { typed, full, ghost } oder null.
// typed wird beim Übernehmen durch full ersetzt, so stimmt auch die Groß-/Kleinschreibung; ghost ist der graue Rest
export function complete(model, before, opts) {
  if (!model || !(opts.words || opts.phrases)) return null
  const word = before.match(/(^|[\s("„‚«])(\p{L}[\p{L}-]*)$/u)
  if (word) {
    const typed = word[2]
    if ([...typed].length < 3) return null
    const lower = typed.toLowerCase()
    const prev = opts.phrases ? before.slice(0, word.index + word[1].length).match(/(?:^|[\s("„‚«])(\p{L}[\p{L}-]*)[ \u00a0]$/u)?.[1].toLowerCase() : null
    const fits = (n) => n.lower.startsWith(lower) && n.lower !== lower
    let hit = prev ? model.next.get(prev)?.find(fits) : null
    if (!hit && opts.words) hit = model.buckets.get(prefixOf(lower))?.find(fits)
    if (!hit) return null
    const rest = hit.form.slice(typed.length)
    if ([...rest].length < 2) return null
    const more = opts.phrases ? chain(model, hit.lower) : []
    const ghost = [rest, ...more].join(' ')
    // Selbst groß Getipptes bleibt groß (Satzanfang), klein Getipptes folgt dem gelernten Wort (Nomen)
    const head = /^\p{Lu}/u.test(typed) ? typed : hit.form.slice(0, typed.length)
    return { typed, full: head + ghost, ghost }
  }
  if (!opts.phrases) return null
  const prev = before.match(/(?:^|[\s("„‚«])(\p{L}[\p{L}-]*)[ \u00a0]$/u)
  const more = prev ? chain(model, prev[1].toLowerCase()) : []
  if (!more.length) return null
  const ghost = more.join(' ')
  return { typed: '', full: ghost, ghost }
}
