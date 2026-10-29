// Farbschemata: aus wenigen Werten (Farbton für Grautöne und Akzent) entstehen alle Farben der App, hell und dunkel.
// Gerechnet wird in OKLCH (gleichmäßige Helligkeit), ausgegeben als Hex, damit Kontraste prüfbar sind.

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function hexToOklch(hex) {
  const n = parseInt(hex.slice(1, 7), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360]
}

// Außerhalb des darstellbaren Bereichs wird die Buntheit verringert, bis die Farbe passt
export function oklch(L, C, H, alpha = 1) {
  for (let c = C; ; c -= 0.005) {
    const a = Math.max(c, 0) * Math.cos((H * Math.PI) / 180)
    const b = Math.max(c, 0) * Math.sin((H * Math.PI) / 180)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    if (c > 0 && rgb.some((v) => v < -0.001 || v > 1.001)) continue
    const hex = rgb.map((v) => Math.round(clamp(gam(clamp(v, 0, 1)), 0, 1) * 255).toString(16).padStart(2, '0')).join('')
    return `#${hex}${alpha < 1 ? Math.round(alpha * 255).toString(16).padStart(2, '0') : ''}`
  }
}

// Relative Helligkeit und Kontrast nach WCAG; Farben mit Alpha werden auf `under` gelegt
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
export function over(hex, under) {
  if (hex.length < 9) return hex
  const a = parseInt(hex.slice(7, 9), 16) / 255
  const mix = rgbOf(hex).map((v, i) => v * a + rgbOf(under)[i] * (1 - a))
  return `#${mix.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
}
const luminance = (hex) => {
  const [r, g, b] = rgbOf(hex).map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// n: Farbton der Grautöne, t: wie stark sie getönt sind, a/c: Farbton und Buntheit des Akzents; stops: Verlauf
export const THEMES = [
  { id: 'petrol', name: 'Petrol', n: 205, t: 0.006, a: 205, c: 0.085 },
  { id: 'nachtblau', name: 'Nachtblau', n: 255, t: 0.012, a: 258, c: 0.14 },
  { id: 'graphit', name: 'Graphit', n: 260, t: 0.003, a: 255, c: 0.035 },
  { id: 'wald', name: 'Wald', n: 150, t: 0.01, a: 152, c: 0.11 },
  { id: 'sand', name: 'Sand', n: 75, t: 0.012, a: 55, c: 0.12 },
  { id: 'lila', name: 'Lila', n: 300, t: 0.012, a: 300, c: 0.15 },
  { id: 'rubin', name: 'Rubin', n: 10, t: 0.01, a: 15, c: 0.15 },
  { id: 'sonnenuntergang', name: 'Sonnenuntergang', n: 20, t: 0.01, a: 10, c: 0.15, stops: [55, 15, 320] },
  { id: 'meer', name: 'Meer', n: 230, t: 0.012, a: 240, c: 0.13, stops: [195, 225, 265] },
  { id: 'polarlicht', name: 'Polarlicht', n: 190, t: 0.012, a: 175, c: 0.11, stops: [150, 195, 290] },
  { id: 'lavendel', name: 'Lavendel', n: 290, t: 0.012, a: 295, c: 0.14, stops: [265, 305, 345] },
]

// Eigene Akzentfarbe: Farbton und Buntheit bleiben, die Helligkeit wird so gesetzt, dass Text darauf lesbar bleibt
function accentOf(theme, custom, dark) {
  const [L0, C0, H] = custom ? hexToOklch(custom) : [null, theme.c, theme.a]
  const C = Math.min(C0, 0.17)
  const L = dark ? clamp(L0 ?? 0.76, 0.74, 0.86) : clamp(L0 ?? 0.5, 0.36, 0.5)
  return { accent: oklch(L, C, H), soft: dark ? oklch(0.31, Math.min(C, 0.1) * 0.5, H) : oklch(0.94, Math.min(C, 0.1) * 0.35, H), hue: H }
}

// Alle Farben eines Schemas für hell oder dunkel; mit Verlauf sind die Flächen durchscheinend
export function palette(look, dark) {
  const custom = look.theme === 'custom' && look.gradient?.colors?.length
  const base = THEMES.find((x) => x.id === look.theme) ?? THEMES[0]
  const stops = custom
    ? look.gradient.colors.map((hex) => hexToOklch(hex))
    : base.stops?.map((h) => [null, 0.1, h])
  const n = custom ? stops[0][2] : base.n
  const t = custom ? 0.012 : base.t
  const glass = stops ? (alpha) => alpha : () => 1
  const g = (L, k, alpha = 1) => oklch(L, t * k, n, glass(alpha))
  const { accent, soft } = accentOf(custom ? { a: stops[1]?.[2] ?? n, c: 0.13 } : base, look.accent, dark)
  const colors = dark
    ? { bg: g(0.19, 2, 0.78), side: g(0.21, 2.5, 0.66), raised: g(0.235, 2.5, 0.96), line: g(0.3, 3), hover: g(0.27, 3, 0.85), text: g(0.94, 1), muted: g(0.76, 2), faint: g(0.67, 2) }
    : { bg: g(0.985, 1, 0.8), side: g(0.962, 2, 0.66), raised: g(1, 0, 0.94), line: g(0.905, 2), hover: g(0.935, 2.5, 0.85), text: g(0.2, 2), muted: g(0.45, 3), faint: g(0.53, 3) }
  const gradient = stops?.map(([L, C, H]) => (dark ? oklch(clamp(L ?? 0.3, 0.24, 0.34), Math.min(C, 0.09), H) : oklch(clamp(L ?? 0.86, 0.82, 0.9), Math.min(C, 0.1), H)))
  return { ...colors, accent, soft, gradient: gradient ?? null }
}

// Was vom Standard (Petrol, ohne eigene Farben) abweicht, als CSS; beim Drucken (data-print) gilt immer der Standard
export function lookCss(look) {
  if ((look.theme ?? 'petrol') === 'petrol' && !look.accent) return ''
  const block = (dark) => {
    const p = palette(look, dark)
    const vars = [
      ['--bg', p.bg], ['--side', p.side], ['--raised', p.raised], ['--line', p.line], ['--hover', p.hover],
      ['--text', p.text], ['--muted', p.muted], ['--faint', p.faint], ['--accent', p.accent], ['--accent-soft', p.soft],
    ]
    const angle = look.theme === 'custom' ? look.gradient?.angle ?? 135 : 135
    const bg = p.gradient ? `linear-gradient(${angle}deg, ${p.gradient.join(', ')})` : p.bg
    return `:root:not([data-print])[data-theme="${dark ? 'dark' : 'light'}"] { ${vars.map(([k, v]) => `${k}: ${v};`).join(' ')} --app-bg: ${bg}; }`
  }
  return `${block(false)}\n${block(true)}`
}

// Für den Farbwähler: Hex ↔ HSV (h 0–360, s und v 0–1); "#abc" geht auch, Ungültiges ergibt null
export function hexToHsv(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex?.trim() ?? '')
  if (!m) return null
  const full = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  const h = !d ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
}

export function hsvToHex({ h, s, v }) {
  const f = (n) => {
    const k = (n + h / 60) % 6
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0')
  }
  return `#${f(5)}${f(3)}${f(1)}`
}
