import { THEMES, hexToOklch, oklch } from './colors.js'

// Nexora-Icon (N aus einem Zug, rechts oben ein Punkt) in den Farben des Farbschemas.
// colors: { from, to, tint } als CSS-Farben; small: für 16 bis 32 Pixel dickerer Strich und ohne Punkt, damit nichts verschwimmt
export function iconSvg({ from, to, tint }, small = false) {
  const [top, bottom] = small ? [254, 770] : [280, 744]
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="1024" height="1024" rx="${small ? 200 : 232}" fill="url(#g)"/>` +
    `<path d="M318 ${bottom}V${top}L706 ${bottom}V${top}" fill="none" stroke="#fff" stroke-width="${small ? 150 : 118}" stroke-linecap="round" stroke-linejoin="round"/>` +
    (small ? '' : `<circle cx="790" cy="236" r="62" fill="${tint}"/>`) +
    `</svg>`
  )
}

// Farben aus dem Aussehen: Verlauf des Schemas oder Akzentfarbton, kräftiger als in der Oberfläche
export function iconColors(look = {}) {
  if (look.theme === 'custom' && look.gradient?.colors?.length) {
    const c = look.gradient.colors
    return { from: c[0], to: c.at(-1), tint: '#ffffff' }
  }
  const theme = THEMES.find((t) => t.id === look.theme) ?? THEMES[0]
  if (theme.stops && !look.accent) return { from: oklch(0.66, 0.15, theme.stops[0]), to: oklch(0.46, 0.16, theme.stops.at(-1)), tint: oklch(0.93, 0.04, theme.stops[1]) }
  const [, c0, h] = look.accent ? hexToOklch(look.accent) : [null, theme.c, theme.a]
  const c = Math.max(0.06, Math.min(c0, 0.17))
  return { from: oklch(0.62, c, h), to: oklch(0.42, c, h), tint: oklch(0.9, c * 0.4, h) }
}

// feste Farben für die Icon-Dateien des Installers (Petrol)
export const PETROL = { from: '#1e96a1', to: '#0a5a62', tint: '#bfe3e6' }
