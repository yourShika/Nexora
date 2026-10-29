import { useSyncExternalStore } from 'react'

const media = matchMedia('(prefers-color-scheme: dark)')

export function getTheme() {
  try {
    return localStorage.getItem('theme') || 'system'
  } catch {
    return 'system'
  }
}

// Beim Drucken bleibt es hell, auch wenn Windows zwischendurch ein Farbschema meldet
let printing = false
export function printTheme(on) {
  printing = on
  if (on) document.documentElement.dataset.theme = 'light'
  else applyTheme()
}

// choice: 'system' | 'light' | 'dark'; setzt data-theme auf <html>
export function applyTheme(choice = getTheme()) {
  if (printing) return
  try {
    localStorage.setItem('theme', choice)
  } catch {}
  const dark = choice === 'dark' || (choice === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

media.addEventListener('change', () => applyTheme())
// Umschalten im Hauptfenster gilt sofort auch in der Schnellerfassung
addEventListener('storage', (e) => e.key === 'theme' && e.newValue && applyTheme(e.newValue))

// Für Darstellungen mit eigenen Farben (Mermaid): neu zeichnen, wenn das Thema wechselt
export const isDark = () => document.documentElement.dataset.theme === 'dark'
function onThemeChange(cb) {
  const o = new MutationObserver(cb)
  o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => o.disconnect()
}
export const useDark = () => useSyncExternalStore(onThemeChange, isDark)
