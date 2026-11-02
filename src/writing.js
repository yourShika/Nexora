// Schreibhilfen im Editor: rote Linie, Autokorrektur beim Leerzeichen, Typografie, grauer Vorschlag mit Tab.
// Die Regeln stehen in autotext.js; hier nur Editor, Wörterbücher (Rust) und Einstellungen.
import { Extension, InputRule } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { adminLinks } from './adminlinks.js'
import { buildModel, complete, learn, newCounts, partsToCheck, planFix, rankSuggestions, seenInPages, startsSentence, tokens } from './autotext.js'
import * as db from './db.js'

export const WRITING_DEFAULTS = { mark: true, fix: true, caps: true, typo: true, words: true, phrases: true }
const KNOWN_FROM_PAGES = 3 // so oft in den eigenen Seiten: keine rote Linie mehr (Namen von Servern, Kunden, Programmen)
const MODEL_MAX_AGE = 10 * 60e3

// Gemeinsamer Stand aller Editoren eines Fensters
const store = { opts: WRITING_DEFAULTS, own: new Set(), never: new Set(), model: null, area: null, builtAt: 0, failed: '' }
const known = new Map() // Wort → steht im Wörterbuch; die Antworten ändern sich nicht
const listeners = new Set()
const notify = () => listeners.forEach((f) => f())
export const onWritingChange = (f) => (listeners.add(f), () => listeners.delete(f))
export const writingState = () => store

const readList = async (key) => {
  try {
    return new Set(JSON.parse((await db.getSetting(key)) ?? '[]'))
  } catch {
    return new Set()
  }
}

export async function loadWriting() {
  let saved = null
  try {
    saved = JSON.parse((await db.getSetting('schreiben')) ?? 'null')
  } catch {
    // kaputte Einstellung: Standard
  }
  store.opts = { ...WRITING_DEFAULTS, ...saved }
  store.own = await readList('woerterbuch')
  store.never = await readList('autokorrektur-nie')
  notify()
}

let started = false
function start() {
  if (started) return
  started = true
  loadWriting().catch(() => {})
  // Änderungen aus einem anderen Fenster; die eigenen stehen schon im Speicher und sind womöglich noch nicht geschrieben
  listen('schreiben-changed', (e) => e.payload?.from !== getCurrentWindow().label && loadWriting().catch(() => {})).catch(() => {})
}

const saved = () => emit('schreiben-changed', { from: getCurrentWindow().label }).catch(() => {})

// Der Reihe nach schreiben: gleichzeitige Schreibvorgänge kommen sonst in beliebiger Folge an, und ein älterer Stand gewinnt
let writes = Promise.resolve()
function persist(key, value) {
  const done = writes.then(() => db.setSetting(key, value))
  writes = done.catch(() => {})
  return done.then(saved)
}

export function setWriting(fields) {
  store.opts = { ...store.opts, ...fields }
  notify()
  return persist('schreiben', JSON.stringify(store.opts))
}

function saveList(key, set) {
  notify()
  return persist(key, JSON.stringify([...set].sort((a, b) => a.localeCompare(b, 'de'))))
}
export const addOwnWord = (word) => (store.own.add(word), saveList('woerterbuch', store.own))
export const removeOwnWord = (word) => (store.own.delete(word), saveList('woerterbuch', store.own))
export const removeNever = (word) => (store.never.delete(word), saveList('autokorrektur-nie', store.never))
const addNever = (word) => (store.never.add(word), saveList('autokorrektur-nie', store.never))

// Wörterbücher fragen; was schon gefragt wurde, kommt aus dem Speicher
async function lookUp(words) {
  const open = [...new Set(words)].filter((w) => !known.has(w))
  if (!open.length) return
  try {
    const answers = await invoke('spell_check', { words: open })
    open.forEach((w, i) => known.set(w, answers[i]))
  } catch (e) {
    // ohne Wörterbuch lieber nichts markieren und nichts ändern
    open.forEach((w) => known.set(w, true))
    if (store.failed !== String(e)) (store.failed = String(e)), notify()
  }
}
const inDictionary = async (word) => (await lookUp([word]), known.get(word))
// Eigene Wörter gelten in jeder Schreibweise, ipconfig auch als Ipconfig am Satzanfang
const inOwn = (word) => {
  const low = word.toLowerCase()
  return store.own.has(word) || [...store.own].some((w) => w.toLowerCase() === low)
}

// Autofüllen lernt je Bereich getrennt, damit Privates nicht bei der Arbeit auftaucht
let building = 0
export function learnArea(area) {
  start()
  if (!area || (store.area === area && Date.now() - store.builtAt < MODEL_MAX_AGE)) return
  if (store.area !== area) store.model = null
  store.area = area
  store.builtAt = Date.now()
  const run = ++building
  setTimeout(async () => {
    try {
      const rows = await db.textsOfArea(area)
      const counts = newCounts()
      for (let i = 0; i < rows.length; i++) {
        if (run !== building) return
        learn(counts, rows[i].title, { pairs: false })
        learn(counts, rows[i].body)
        if (i % 25 === 24) await new Promise((r) => setTimeout(r)) // große Bestände nicht am Stück, das Tippen geht vor
      }
      if (run !== building) return
      store.model = buildModel(counts)
      notify()
    } catch {
      store.builtAt = 0 // beim nächsten Editor nochmal
    }
  }, 1500)
}

// Wörter eines Absatzes mit Stelle im Dokument, ohne Inline-Code, Links und Admin-Links (\\server\freigabe)
const SKIP_MARKS = ['code', 'link']
function wordsInBlock(node, start) {
  const text = node.textBetween(0, node.content.size, undefined, '￼')
  const skip = adminLinks(text)
  node.forEach((child, offset) => {
    if (child.marks.some((m) => SKIP_MARKS.includes(m.type.name))) skip.push({ from: offset, to: offset + child.nodeSize })
  })
  return tokens(text)
    .filter((t) => !skip.some((s) => t.from < s.to && s.from < t.to))
    .map((t) => ({ word: t.word, dot: t.dot, from: start + t.from, to: start + t.to }))
}
function wordsIn(doc) {
  const found = []
  doc.descendants((node, pos) => {
    if (node.type.spec.code) return false
    if (!node.isTextblock) return true
    found.push(...wordsInBlock(node, pos + 1))
    return false
  })
  return found
}

// Abkürzungen stehen mit Punkt im Wörterbuch (ggf., bzw.)
const toLookUp = (w) => (w.dot ? [...partsToCheck(w.word), `${w.word}.`] : partsToCheck(w.word))
const isWrong = (w) => !(w.dot && known.get(`${w.word}.`)) && partsToCheck(w.word).some((p) => known.get(p) === false) && !inOwn(w.word) && !seenInPages(store.model, w.word, KNOWN_FROM_PAGES)

const key = new PluginKey('autoText')

export function misspelledAt(view, pos) {
  const [hit] = key.getState(view.state).decos.find(pos, pos)
  return hit ? { from: hit.from, to: hit.to, word: view.state.doc.textBetween(hit.from, hit.to) } : null
}

export async function suggestionsFor(word) {
  try {
    return rankSuggestions(word, await invoke('spell_suggest', { word }))
  } catch {
    return []
  }
}

// Wort vor der Stelle pos prüfen, sobald Leerzeichen oder Enter es abgeschlossen haben. Die Antwort kommt verzögert,
// bis dahin ist womöglich schon weitergetippt; darum vor dem Ersetzen prüfen, ob das Wort noch dasteht
async function correct(view, pos) {
  const { opts } = store
  if (view.isDestroyed || !view.editable || !(opts.fix || opts.caps)) return
  const $pos = view.state.doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.isTextblock || parent.type.spec.code) return
  const before = parent.textBetween(0, $pos.parentOffset, undefined, '￼')
  const t = tokens(before).at(-1)
  if (!t || /\s/.test(before.slice(t.to))) return
  const from = $pos.start() + t.from
  const to = $pos.start() + t.to
  if (!wordsInBlock(parent, $pos.start()).some((w) => w.from === from && w.to === to)) return
  let inTable = false
  for (let d = $pos.depth; d > 0; d--) if (/^table(Cell|Header)$/.test($pos.node(d).type.name)) inTable = true
  const next = await planFix(t.word, {
    // mit Punkt dahinter kann es eine Abkürzung sein (freundl.), nur rot markieren
    opts: before.startsWith('.', t.to) ? { ...opts, fix: false } : opts,
    // in Tabellen stehen oft einzelne Werte, die kein Satz sind
    sentenceStart: !inTable && startsSentence(before.slice(0, t.from)),
    known: inDictionary,
    suggest: (w) => invoke('spell_suggest', { word: w }).catch(() => []),
    isOwn: (w) => inOwn(w) || seenInPages(store.model, w),
    isNever: (w) => store.never.has(w),
  })
  if (!next || view.isDestroyed) return
  const { doc, tr } = view.state
  if (to > doc.content.size || doc.textBetween(from, to) !== t.word) return
  tr.insertText(next, from, to)
  // Eigener Schritt für Strg+Z. Die Rücktaste nimmt die Korrektur nur zurück, solange direkt hinter dem Wort nichts als
  // Satzzeichen und das Leerzeichen stehen; ist schon weitergetippt, löscht sie wie immer das letzte Zeichen
  const end = from + next.length
  const close = tr.selection.empty && /^\S*[  ]$/.test(tr.doc.textBetween(end, Math.max(end, tr.selection.from), '\n'))
  tr.setMeta(key, { fixed: true, last: close ? { from, to: end, original: t.word, caret: tr.selection.from } : null })
  view.dispatch(closeHistory(tr))
}

function ghostFor(tr) {
  const { selection } = tr
  if (!selection.empty || !selection.$from.parent.isTextblock) return null
  const { $from } = selection
  const parent = $from.parent
  if (parent.type.spec.code || $from.marks().some((m) => SKIP_MARKS.includes(m.type.name))) return null
  // mitten im Wort nichts vorschlagen
  if (/[\p{L}\p{N}]/u.test(parent.textBetween($from.parentOffset, Math.min($from.parentOffset + 1, parent.content.size), undefined, '￼'))) return null
  const hit = complete(store.model, parent.textBetween(0, $from.parentOffset, undefined, '￼'), store.opts)
  return hit && { ...hit, pos: $from.pos }
}

function ghostDom(text) {
  const el = document.createElement('span')
  el.className = 'ghost-text'
  el.textContent = text
  el.setAttribute('aria-hidden', 'true')
  return el
}

const QUOTE_OPENS = /[\s([{–—/-]/
const whenTypo = (find, replace) =>
  new InputRule({
    find,
    handler: ({ state, range, match }) => {
      if (!store.opts.typo) return null
      state.tr.insertText(replace(match, state, range), range.from, range.to)
    },
  })

export const AutoText = Extension.create({
  name: 'autoText',
  priority: 1000, // Tab und Rücktaste gehen zuerst hierher, solange ein Vorschlag oder eine Korrektur offen ist

  addInputRules() {
    return [
      whenTypo(/\.\.\.$/, () => '…'),
      whenTypo(/(?<!-)->$/, () => '→'),
      // nur mit Leerzeichen rundherum, damit --force so bleibt
      whenTypo(/(^|\s)--\s$/, (m) => `${m[1]}– `),
      whenTypo(/"$/, (_, state, range) => {
        const $from = state.doc.resolve(range.from)
        const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, '￼')
        return !before || QUOTE_OPENS.test(before) ? '„' : '“'
      }),
    ]
  },

  addProseMirrorPlugins() {
    let typing = false
    let caretWord = false // ein unbekanntes Wort an der Schreibmarke ist noch nicht fertig: später nochmal schauen
    return [
      new Plugin({
        key,
        state: {
          init: () => ({ decos: DecorationSet.empty, ghost: null, last: null }),
          apply(tr, old) {
            const meta = tr.getMeta(key) ?? {}
            const decos = meta.marks
              ? DecorationSet.create(tr.doc, meta.marks.map((m) => Decoration.inline(m.from, m.to, { class: 'spell-error' }, { inclusiveStart: false, inclusiveEnd: false })))
              : old.decos.map(tr.mapping, tr.doc)
            let ghost = old.ghost
            if ('ghost' in meta) ghost = meta.ghost
            // eine Korrektur weiter vorn kommt verzögert; der Vorschlag an der Schreibmarke bleibt und rückt mit
            else if (meta.fixed) ghost = ghost && { ...ghost, pos: tr.mapping.map(ghost.pos) }
            else if (tr.docChanged) ghost = typing ? ghostFor(tr) : null
            else if (tr.selectionSet) ghost = null
            if (tr.docChanged && !meta.fixed) typing = false
            return { decos, ghost, last: meta.fixed ? meta.last : tr.docChanged || tr.selectionSet ? null : old.last }
          },
        },
        props: {
          decorations(state) {
            const { decos, ghost } = key.getState(state)
            if (!ghost) return decos
            return decos.add(state.doc, [Decoration.widget(ghost.pos, () => ghostDom(ghost.ghost), { side: 1, key: `ghost:${ghost.ghost}`, ignoreSelection: true })])
          },
          handleTextInput(view, from, to, text) {
            typing = true
            // erst wenn der Text im Dokument steht; schnelles Tippen kann mehrere Zeichen auf einmal bringen
            if (/\s$/.test(text)) setTimeout(() => correct(view, from + text.length - 1).catch(() => {}))
            return false
          },
          handleKeyDown(view, event) {
            const { ghost, last } = key.getState(view.state)
            const plain = !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
            if (ghost && event.key === 'Tab' && plain) {
              event.preventDefault()
              const from = ghost.pos - ghost.typed.length
              const tr = view.state.tr.insertText(ghost.full, from, ghost.pos)
              view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + ghost.full.length)))
              return true
            }
            if (ghost && event.key === 'Escape') {
              view.dispatch(view.state.tr.setMeta(key, { ghost: null }))
              return true
            }
            if (last && event.key === 'Backspace' && plain && view.state.selection.empty && view.state.selection.from === last.caret) {
              event.preventDefault()
              view.dispatch(closeHistory(view.state.tr.insertText(last.original, last.from, last.to)))
              addNever(last.original).catch(() => {})
              return true
            }
            if (event.key === 'Enter' && !event.ctrlKey && !event.altKey && !event.metaKey) correct(view, view.state.selection.from).catch(() => {})
            return false
          },
        },
        view(view) {
          start()
          let timer
          let alive = true
          let shown = '[]'
          const scan = async () => {
            if (!alive) return
            const { doc } = view.state
            const marks = []
            caretWord = false
            if (view.editable && store.opts.mark) {
              const found = wordsIn(doc).filter((w) => partsToCheck(w.word).length)
              await lookUp(found.flatMap(toLookUp))
              if (!alive || view.state.doc !== doc) return // neues Tippen plant schon den nächsten Lauf
              const { selection } = view.state
              for (const w of found) {
                if (!isWrong(w)) continue
                if (selection.empty && w.from < selection.from && selection.from <= w.to) caretWord = true
                else marks.push({ from: w.from, to: w.to })
              }
            }
            const sign = JSON.stringify(marks)
            if (sign === shown) return
            shown = sign
            view.dispatch(view.state.tr.setMeta(key, { marks }))
          }
          const plan = (ms) => {
            clearTimeout(timer)
            timer = setTimeout(() => scan().catch(() => {}), ms)
          }
          const off = onWritingChange(() => plan(0))
          plan(0)
          return {
            update(v, prev) {
              if (v.state.doc !== prev.doc) {
                // Stellen haben sich verschoben; die Linien wandern mit und werden beim nächsten Lauf neu bestimmt
                shown = ''
                plan(350)
              } else if (caretWord && !v.state.selection.eq(prev.selection)) plan(50)
            },
            destroy() {
              alive = false
              clearTimeout(timer)
              off()
            },
          }
        },
      }),
    ]
  },
})
