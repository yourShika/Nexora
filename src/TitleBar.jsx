import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import AppIcon from './AppIcon.jsx'

// Eigene Titelleiste statt der von Windows. Leere Fläche zieht das Fenster, Doppelklick maximiert
// (data-tauri-drag-region wirkt nur auf das Element selbst, nicht auf Kinder).
// Verweilen auf "Maximieren" öffnet die Snap-Layouts von Windows 11, wie es die echte Titelleiste tut
export default function TitleBar({ children }) {
  const win = getCurrentWindow()
  const [max, setMax] = useState(false)
  const snap = useRef(null)
  useEffect(() => {
    const check = () => win.isMaximized().then(setMax).catch(() => {})
    check()
    const off = win.onResized(check)
    return () => off.then((f) => f())
  }, [])
  const leave = () => clearTimeout(snap.current)
  const hover = () => (leave(), (snap.current = setTimeout(() => invoke('snap_layouts').catch(() => {}), 700)))

  return (
    <header data-tauri-drag-region className="titlebar flex h-10 shrink-0 select-none items-stretch bg-side">
      <AppIcon size={16} className="pointer-events-none mx-3 self-center" />
      {children}
      <div data-tauri-drag-region className="min-w-10 flex-1" />
      <WinButton label="Minimieren" glyph={''} onClick={() => win.minimize()} />
      <WinButton label={max ? 'Verkleinern' : 'Maximieren'} glyph={max ? '' : ''} onClick={() => (leave(), win.toggleMaximize())} onMouseEnter={hover} onMouseLeave={leave} />
      <WinButton label="Schließen" glyph={''} danger onClick={() => win.close()} />
    </header>
  )
}

// Zeichen aus der Windows-Symbolschrift, damit die Knöpfe aussehen wie bei anderen Programmen
function WinButton({ label, glyph, danger, ...props }) {
  return (
    <button
      aria-label={label}
      title={label}
      tabIndex={-1}
      {...props}
      style={{ fontFamily: "'Segoe Fluent Icons', 'Segoe MDL2 Assets'" }}
      className={`w-11 shrink-0 text-[10px] text-muted transition-colors ${danger ? 'hover:bg-[#c42b1c] hover:text-white' : 'hover:bg-hover hover:text-text'}`}
    >
      {glyph}
    </button>
  )
}
