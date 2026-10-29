import { invoke } from '@tauri-apps/api/core'
import * as db from './db.js'

// Welche Bilder brauchen noch Texterkennung, welche Einträge gehören zu gelöschten Bildern
export function ocrPlan(images, indexed) {
  const files = new Set(images.map((name) => `bilder/${name}`))
  const have = new Set(indexed.filter((f) => f.startsWith('bilder/')))
  return { todo: [...files].filter((f) => !have.has(f)), gone: [...have].filter((f) => !files.has(f)) }
}

// Dasselbe für Anhänge ("<uuid>/<Name>"); im Index stehen sie als "datei:<uuid>/<Name>|<Seite>"
export function docPlan(rels, indexed) {
  const have = new Set(indexed.filter((f) => f.startsWith('datei:')).map((f) => f.slice(6, f.lastIndexOf('|'))))
  const files = new Set(rels)
  return { todo: rels.filter((r) => !have.has(r)), gone: [...have].filter((r) => !files.has(r)) }
}

// Woher ein Suchtreffer stammt: "Im Bild" oder "Im Anhang Rechnung.pdf, S. 3"
export function hitLabel(file) {
  if (!file.startsWith('datei:')) return 'Im Bild'
  const rel = file.slice(6, file.lastIndexOf('|'))
  const page = Number(file.slice(file.lastIndexOf('|') + 1))
  const name = rel.slice(rel.indexOf('/') + 1)
  const unit = /\.pdf$/i.test(name) ? 'S.' : /\.pptx$/i.test(name) ? 'Folie' : ''
  return `Im Anhang ${name}${unit && page > 0 ? `, ${unit} ${page}` : ''}`
}

// Anhänge, aus denen Nexora Text liest (wie READABLE in doctext.rs)
export const TEXT_FILES = /\.(pdf|docx|xlsx|pptx|txt|log|csv|tsv|md|ps1|psm1|psd1|json|xml|yml|yaml|ini|cfg|conf|sql|bat|cmd|sh|py|html|reg)$/i

// Erkennt und speichert; auch leeren Text, damit ein Bild ohne Text nicht jedes Mal neu dran ist.
// shortcut: fehlt die OCR-Sprache in Windows, gilt das Bild als "ohne Text"; erst ändern, wenn das vorkommt
async function recognize(file) {
  const text = await invoke('ocr_image', { name: file.slice('bilder/'.length) }).catch(() => '')
  await db.setOcr(file, text)
  return text
}

// PDF Seite für Seite erkennen bzw. Office/Text lesen und speichern; Fehler zählen als "ohne Text" (wie bei Bildern)
async function readDoc(rel) {
  const pages = await invoke('attachment_text', { rel }).catch(() => [])
  await db.setDocText(rel, pages)
  return pages
}

let running = false
let again = false
// Alle noch nicht erfassten Bilder und Anhänge nacheinander im Hintergrund; ein Aufruf während des Laufs löst eine weitere Runde aus.
// Bilder zuerst: ein langes PDF braucht Minuten, ein eben eingefügter Screenshot soll trotzdem gleich findbar sein
export async function indexText() {
  if (running) return void (again = true)
  running = true
  try {
    do {
      again = false
      const images = (await invoke('list_images')).map(([name]) => name)
      const { todo, gone } = ocrPlan(images, await db.ocrFiles())
      await db.dropOcr(gone)
      for (const file of todo) await recognize(file)
      const docs = docPlan(await invoke('list_text_attachments'), await db.ocrFiles())
      await db.dropDocs(docs.gone)
      for (const rel of docs.todo) {
        await readDoc(rel)
        if (again) break
      }
    } while (again)
  } catch {
    // Datenbank oder Ordner gerade nicht erreichbar: beim nächsten Start wieder
  } finally {
    running = false
  }
}

// Text eines Bilds für Kopieren/Einfügen; noch nicht erfasst, dann jetzt
export async function imageText(file) {
  return (await db.ocrText(file)) ?? recognize(file)
}

// Text eines Anhangs (Seiten durch Leerzeile getrennt); noch nicht erfasst, dann jetzt
export async function attachmentText(rel) {
  return (await db.docText(rel)) ?? (await readDoc(rel)).join('\n\n')
}
