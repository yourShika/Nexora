import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown, Check } from '@phosphor-icons/react'

// Text eines Kindes (für Tippen-zum-Springen), auch aus Arrays wie ['nach ', name]
const textOf = (c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : Array.isArray(c) ? c.map(textOf).join('') : isValidElement(c) ? textOf(c.props.children) : '')
const flat = (c) => (isValidElement(c) && c.type === Fragment ? Children.toArray(c.props.children).flatMap(flat) : [c])

// Aufklappliste im Nexora-Stil statt des grauen Windows-Dropdowns. Nimmt <option>-Kinder wie <select>
// und ruft onChange({ target: { value } }) mit Text auf, so bleiben die Aufrufer wie bei <select>.
// Bedienung wie ein natives Auswahlfeld: Pfeile, Enter/Leertaste, Esc, Pos1/Ende, Buchstaben springen
export default function Select({ value, onChange, children, disabled, className = '', ...aria }) {
  const options = Children.toArray(children).flatMap(flat).filter(isValidElement)
    .map((o) => ({ value: String(o.props.value ?? textOf(o.props.children)), label: o.props.children, disabled: !!o.props.disabled }))
  const current = Math.max(0, options.findIndex((o) => o.value === String(value ?? '')))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(current)
  const [place, setPlace] = useState(null)
  const button = useRef(null)
  const list = useRef(null)
  const typed = useRef({ text: '', at: 0 })
  const id = useId()

  const show = () => {
    if (disabled) return
    setActive(current)
    setOpen(true)
  }
  const choose = (i) => {
    const o = options[i]
    setOpen(false)
    if (o && !o.disabled && o.value !== String(value ?? '')) onChange?.({ target: { value: o.value } })
  }
  const move = (i) => setActive(Math.min(options.length - 1, Math.max(0, i)))

  // unter dem Knopf, bei zu wenig Platz darüber
  useLayoutEffect(() => {
    if (!open) return
    const r = button.current.getBoundingClientRect()
    const h = Math.min(list.current.scrollHeight, 288)
    const up = r.bottom + h + 8 > innerHeight && r.top > innerHeight - r.bottom
    setPlace({ left: Math.min(r.left, innerWidth - Math.max(r.width, list.current.offsetWidth) - 8), top: up ? r.top - h - 4 : r.bottom + 4, minWidth: r.width })
  }, [open])
  useEffect(() => {
    if (!open) return
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, place])
  useEffect(() => {
    if (!open) return
    const away = (e) => !button.current.contains(e.target) && !list.current?.contains(e.target) && setOpen(false)
    const close = () => setOpen(false)
    addEventListener('mousedown', away)
    addEventListener('resize', close)
    return () => (removeEventListener('mousedown', away), removeEventListener('resize', close))
  }, [open])

  function key(e) {
    const stop = () => (e.preventDefault(), e.stopPropagation())
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) (stop(), show())
      return
    }
    if (e.key === 'ArrowDown') (stop(), move(active + 1))
    else if (e.key === 'ArrowUp') (stop(), move(active - 1))
    else if (e.key === 'Home') (stop(), move(0))
    else if (e.key === 'End') (stop(), move(options.length - 1))
    else if (e.key === 'PageDown') (stop(), move(active + 8))
    else if (e.key === 'PageUp') (stop(), move(active - 8))
    else if (e.key === 'Enter' || e.key === ' ') (stop(), choose(active))
    else if (e.key === 'Escape') (stop(), setOpen(false))
    else if (e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1) {
      const t = typed.current
      t.text = (Date.now() - t.at < 600 ? t.text : '') + e.key.toLowerCase()
      t.at = Date.now()
      const hit = options.findIndex((o) => textOf(o.label).toLowerCase().startsWith(t.text))
      if (hit >= 0) move(hit)
    }
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={key}
        onBlur={() => setOpen(false)}
        {...aria}
        className={`inline-flex min-w-0 items-center justify-between gap-1.5 text-left disabled:opacity-60 ${className}`}
      >
        <span className="truncate">{options[current]?.label}</span>
        <CaretDown size={12} className="shrink-0 text-faint" />
      </button>
      {open &&
        createPortal(
          <ul
            ref={list}
            id={id}
            role="listbox"
            // Fokus bleibt am Knopf; Klicks hier schließen kein umgebendes Menü
            onMouseDown={(e) => (e.preventDefault(), e.stopPropagation())}
            style={place ?? { visibility: 'hidden' }}
            className="anim-pop fixed z-50 max-h-72 overflow-y-auto rounded-lg border border-line bg-raised p-1 text-sm text-text shadow-[var(--shadow)]"
          >
            {options.map((o, i) => (
              <li
                key={o.value + i}
                id={`${id}-${i}`}
                data-i={i}
                role="option"
                aria-selected={i === current}
                aria-disabled={o.disabled || undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={`flex cursor-default items-center gap-2 rounded-md py-1.5 pl-2 pr-3 ${o.disabled ? 'text-faint' : ''} ${i === active ? 'bg-hover' : ''}`}
              >
                <Check size={13} weight="bold" className={i === current ? 'text-accent' : 'invisible'} />
                <span className="whitespace-nowrap">{o.label}</span>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  )
}
