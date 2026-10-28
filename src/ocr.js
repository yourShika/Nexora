import { invoke } from '@tauri-apps/api/core'
import * as db from './db.js'

// Welche Bilder brauchen noch Texterkennung, welche Einträge gehören zu gelöschten Bildern
export function ocrPlan(images, indexed) {
  const files = new Set(images.map((name) => `bilder/${name}`))
  const have = new Set(indexed)
  return { todo: [...files].filter((f) => !have.has(f)), gone: [...have].filter((f) => !files.has(f)) }
}

// Erkennt und speichert; auch leeren Text, damit ein Bild ohne Text nicht jedes Mal neu dran ist.
// shortcut: fehlt die OCR-Sprache in Windows, gilt das Bild als "ohne Text"; erst ändern, wenn das vorkommt
async function recognize(file) {
  const text = await invoke('ocr_image', { name: file.slice('bilder/'.length) }).catch(() => '')
  await db.setOcr(file, text)
  return text
}

let running = false
let again = false
// Alle noch nicht erfassten Bilder nacheinander im Hintergrund; ein Aufruf während des Laufs löst eine weitere Runde aus
export async function indexImages() {
  if (running) return void (again = true)
  running = true
  try {
    do {
      again = false
      const images = (await invoke('list_images')).map(([name]) => name)
      const { todo, gone } = ocrPlan(images, await db.ocrFiles())
      await db.dropOcr(gone)
      for (const file of todo) await recognize(file)
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
