import { useCallback, useRef, useState } from 'react'
import Menu from './Menu.jsx'
import { hexToHsv, hsvToHex } from './colors.js'
import { CHIP_COLORS } from './fields.js'

const PRESETS = [...Object.values(CHIP_COLORS), '#5bc0be', '#7a5cc4', '#2f4858', '#e8a33d']

// Farbfeld als Knopf; Klick öffnet den eigenen Farbwähler statt des Windows-Dialogs. onChange bekommt "#rrggbb"
export function ColorInput({ value, onChange, ...aria }) {
  const [at, setAt] = useState(null)
  const close = useCallback(() => setAt(null), [])
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setAt({ x: r.left, y: r.bottom + 4 })
        }}
        {...aria}
        style={{ background: value }}
        className="h-7 w-9 shrink-0 rounded border border-line shadow-inner"
      />
      {at && (
        <Menu x={at.x} y={at.y} onClose={close} role="dialog" label={aria['aria-label'] ?? 'Farbe wählen'}>
          <ColorPicker value={value} onPick={onChange} />
        </Menu>
      )}
    </>
  )
}

// Fläche für Sättigung/Helligkeit, Leiste für den Farbton, Vorschläge und Hex-Feld.
// Beim Ziehen nur Vorschau; übernommen wird beim Loslassen (sonst speichert jede Mausbewegung das Aussehen)
function ColorPicker({ value, onPick }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value) ?? { h: 180, s: 0.6, v: 0.6 })
  const [text, setText] = useState(value)
  const hex = hsvToHex(hsv)
  const live = useRef(hsv)
  const set = (next, commit) => {
    live.current = next
    setHsv(next)
    setText(hsvToHex(next))
    if (commit) onPick(hsvToHex(next))
  }

  // Ziehen auf Fläche oder Leiste: Position → Wert, Loslassen übernimmt
  const drag = (toValue) => (e) => {
    const el = e.currentTarget
    const at = (ev) => {
      const r = el.getBoundingClientRect()
      set(toValue(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))))
    }
    el.setPointerCapture(e.pointerId)
    at(e)
    el.onpointermove = at
    el.onpointerup = () => ((el.onpointermove = el.onpointerup = null), onPick(hsvToHex(live.current)))
  }
  const keys = (step) => (e) => {
    const next = step(e.key)
    if (!next) return
    e.preventDefault()
    set(next, true)
  }
  const clamp = (n) => Math.min(1, Math.max(0, n))

  return (
    <div className="w-60 p-1.5">
      <div
        role="slider"
        tabIndex={0}
        data-autofocus
        aria-label="Sättigung und Helligkeit"
        aria-valuetext={`Sättigung ${Math.round(hsv.s * 100)} %, Helligkeit ${Math.round(hsv.v * 100)} %`}
        onPointerDown={drag((x, y) => ({ ...live.current, s: x, v: 1 - y }))}
        onKeyDown={keys((k) => ({ ArrowLeft: { ...hsv, s: clamp(hsv.s - 0.02) }, ArrowRight: { ...hsv, s: clamp(hsv.s + 0.02) }, ArrowUp: { ...hsv, v: clamp(hsv.v + 0.02) }, ArrowDown: { ...hsv, v: clamp(hsv.v - 0.02) } })[k])}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvToHex({ h: hsv.h, s: 1, v: 1 })})` }}
        className="relative h-36 touch-none rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Farbton"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={drag((x) => ({ ...live.current, h: x * 360 }))}
        onKeyDown={keys((k) => ({ ArrowLeft: { ...hsv, h: (hsv.h + 355) % 360 }, ArrowRight: { ...hsv, h: (hsv.h + 5) % 360 } })[k])}
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
        className="relative mt-2.5 h-3 touch-none rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${(hsv.h / 360) * 100}%`, background: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }} />
      </div>
      <div className="mt-2.5 grid grid-cols-6 gap-1.5" role="group" aria-label="Vorschläge">
        {PRESETS.map((c) => (
          <button key={c} aria-label={c} title={c} onClick={() => set(hexToHsv(c), true)} style={{ background: c }} className={`h-6 rounded border ${c === hex ? 'border-text ring-1 ring-text' : 'border-line'}`} />
        ))}
      </div>
      <label className="mt-2.5 flex items-center gap-2 text-xs text-muted">
        Hex
        <input
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => (hexToHsv(text) ? set(hexToHsv(text), true) : setText(hex))}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="w-24 rounded-md border border-line bg-bg px-2 py-1 font-mono text-text focus:border-accent focus:outline-none"
        />
        <span aria-hidden className="ml-auto h-6 w-10 rounded border border-line" style={{ background: hex }} />
      </label>
    </div>
  )
}
