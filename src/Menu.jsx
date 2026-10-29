import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// Kontextmenü an fester Position; schließt bei Klick daneben oder Escape.
// Direkt am <body>: in Elementen mit backdrop-filter (Kopfzeile der Seite) rechnete "fixed" sonst vom Element statt vom Fenster
export default function Menu({ x, y, onClose, children, role = 'menu', label }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    el.style.left = `${Math.min(x, innerWidth - el.offsetWidth - 8)}px`
    el.style.top = `${Math.min(y, innerHeight - el.offsetHeight - 8)}px`
    const first = el.querySelector('[data-autofocus]') ?? el.querySelector('button')
    first?.focus()
    const away = (e) => !el.contains(e.target) && onClose()
    const key = (e) => e.key === 'Escape' && onClose()
    addEventListener('mousedown', away)
    addEventListener('keydown', key)
    return () => {
      removeEventListener('mousedown', away)
      removeEventListener('keydown', key)
    }
  }, [x, y, onClose])

  return createPortal(
    <div ref={ref} role={role} aria-label={label} className="anim-pop fixed z-40 min-w-48 rounded-lg border border-line bg-raised p-1 shadow-[var(--shadow)]">
      {children}
    </div>,
    document.body,
  )
}

export function MenuItem({ icon: Icon, danger, onClick, children }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-hover focus:bg-hover focus:outline-none ${danger ? 'text-danger' : ''}`}
    >
      {Icon && <Icon size={16} className={danger ? '' : 'text-muted'} />}
      {children}
    </button>
  )
}
