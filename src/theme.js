import { useSyncExternalStore } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { lookCss } from './colors.js'

// Aussehen: steht in der Datenbank (Einstellung "look"), mit Kopie im localStorage, damit jedes Fenster ohne Flackern startet
// und andere Fenster eine Änderung sofort übernehmen (storage-Ereignis).
export const DEFAULT_LOOK = {
  mode: 'system', // 'system' | 'light' | 'dark'
  theme: 'petrol', // Schema aus colors.js oder 'custom' (eigener Verlauf)
  accent: null, // eigene Akzentfarbe (#rrggbb)
  gradient: null, // { colors: [#rrggbb …], angle }
  size: 'normal', // klein | normal | gross | sehrgross
  density: 'normal', // kompakt | normal | luftig
  width: 'schmal', // schmal | breit | voll
  radius: 'normal', // eckig | normal | rund
  font: 'geist', // geist | segoe | arial | georgia
  sidebar: 256, // Breite der Seitenleiste in px
  sidebarHidden: false,
}
const ZOOM = { klein: 0.9, normal: 1, gross: 1.12, sehrgross: 1.25 }
const media = matchMedia('(prefers-color-scheme: dark)')
const label = getCurrentWindow().label

function cached() {
  try {
    const saved = JSON.parse(localStorage.getItem('look') || 'null')
    if (saved) return { ...DEFAULT_LOOK, ...saved }
    // Hell/Dunkel aus älteren Versionen übernehmen
    const mode = localStorage.getItem('theme')
    return { ...DEFAULT_LOOK, ...(mode ? { mode } : {}) }
  } catch {
    return { ...DEFAULT_LOOK }
  }
}

let look = cached()
let printing = false
let zoom = 1
const listeners = new Set()
export const getLook = () => look
export const useLook = () => useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), getLook)

function styleElement() {
  let el = document.getElementById('look')
  if (!el) {
    el = document.createElement('style')
    el.id = 'look'
    document.head.append(el)
  }
  return el
}

export function applyLook(next = look) {
  look = next
  const root = document.documentElement
  if (!printing) root.dataset.theme = next.mode === 'dark' || (next.mode === 'system' && media.matches) ? 'dark' : 'light'
  Object.assign(root.dataset, { density: next.density, width: next.width, radius: next.radius, font: next.font })
  styleElement().textContent = lookCss(next)
  // Schriftgröße als Zoom des Fensters (wie Strg+Mausrad im Browser); kleine Fenster bleiben, wie sie sind
  const factor = ZOOM[next.size] ?? 1
  if (factor !== zoom && label !== 'capture' && label !== 'picker') {
    zoom = factor
    getCurrentWebview().setZoom(factor).catch(() => {})
  }
  listeners.forEach((l) => l())
}

const remember = (next) => {
  try {
    localStorage.setItem('look', JSON.stringify(next))
  } catch {}
}

// Ändern: sofort anwenden, für die anderen Fenster merken und in der Datenbank ablegen
export function setLook(patch) {
  const next = { ...look, ...patch }
  remember(next)
  applyLook(next)
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => import('./db.js').then((db) => db.setSetting('look', JSON.stringify(look))).catch(() => {}), 400)
}
let saveTimer

// Beim Start im Hauptfenster: Die Datenbank gilt (sie kommt mit Sicherungen mit); ist dort noch nichts, wird der jetzige Stand gespeichert
export async function loadLook() {
  const db = await import('./db.js')
  const saved = await db.getSetting('look')
  if (!saved) return db.setSetting('look', JSON.stringify(look))
  const next = { ...DEFAULT_LOOK, ...JSON.parse(saved) }
  if (JSON.stringify(next) === JSON.stringify(look)) return
  remember(next)
  applyLook(next)
}

// Beim Drucken immer hell und im Standard-Schema, auch wenn Windows zwischendurch ein Farbschema meldet
export function printTheme(on) {
  printing = on
  if (on) {
    document.documentElement.dataset.print = '1'
    document.documentElement.dataset.theme = 'light'
  } else {
    delete document.documentElement.dataset.print
    applyLook()
  }
}

media.addEventListener('change', () => applyLook())
addEventListener('storage', (e) => {
  if (e.key !== 'look' || !e.newValue) return
  try {
    applyLook({ ...DEFAULT_LOOK, ...JSON.parse(e.newValue) })
  } catch {}
})

// Für Darstellungen mit eigenen Farben (Mermaid): neu zeichnen, wenn das Thema wechselt
export const isDark = () => document.documentElement.dataset.theme === 'dark'
function onThemeChange(cb) {
  const o = new MutationObserver(cb)
  o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => o.disconnect()
}
export const useDark = () => useSyncExternalStore(onThemeChange, isDark)
