import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { appConfigDir, join } from '@tauri-apps/api/path'
import { indexImages } from './ocr.js'

// Im Markdown steht "bilder/<uuid>.png" (relativ, damit der Datenordner umziehen kann);
// angezeigt wird über das asset-Protokoll von Tauri.
let imageDir = null
export async function initImages() {
  imageDir = await join(await appConfigDir(), 'bilder')
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

export function assetUrl(src) {
  const name = /^bilder\/([\w-]+\.\w+)$/.exec(src ?? '')?.[1]
  return name && imageDir ? convertFileSrc(`${imageDir}\\${name}`) : src
}

// Umkehrung beim Einlesen von HTML (Kopieren innerhalb der App)
export function relativeSrc(src) {
  const name = /asset\.localhost\/.*?bilder(?:%5C|%2F|\/|\\)([\w-]+\.\w+)$/i.exec(src ?? '')?.[1]
  return name ? `bilder/${name}` : src
}

export const isImage = (file) => file.type in EXT

// Bild aus dem Dateidialog in den Datenordner kopieren (Titelbild)
export async function importImage(path) {
  const ext = path.split('.').pop().toLowerCase().replace('jpeg', 'jpg')
  const name = `${crypto.randomUUID()}.${ext}`
  await invoke('import_image', { source: path, name })
  return `bilder/${name}`
}

// Bilddateien, auf die nichts mehr verweist (auch nicht Papierkorb oder alte Fassungen)
export async function unusedImages(references) {
  const files = await invoke('list_images')
  return files.filter(([name]) => !references.includes(`bilder/${name}`)).map(([name, size]) => ({ name, size }))
}

export const deleteImages = (names) => invoke('delete_images', { names })

// Speichert eine Bilddatei im Datenordner und gibt den Markdown-Pfad zurück
export async function saveImage(file) {
  const name = `${crypto.randomUUID()}.${EXT[file.type]}`
  await invoke('save_image', new Uint8Array(await file.arrayBuffer()), { headers: { 'x-name': name } })
  indexImages()
  return `bilder/${name}`
}
