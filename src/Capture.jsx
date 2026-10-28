import { useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { emit } from '@tauri-apps/api/event'
import { Lightning } from '@phosphor-icons/react'
import * as db from './db.js'
import { parseQuick } from './quick.js'
import { ParsedPreview } from './Rows.jsx'

const win = getCurrentWindow()

// Eigenes kleines Fenster für Strg+Alt+Leertaste; speichert in den Eingang
export default function Capture() {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const input = useRef(null)
  const parsed = parseQuick(text)

  useEffect(() => {
    const off = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        setError('')
        input.current?.focus()
        input.current?.select()
      } else {
        win.hide()
      }
    })
    return () => {
      off.then((f) => f())
    }
  }, [])

  async function save() {
    if (!parsed.title || saving) return
    setSaving(true)
    try {
      await db.create('row', null, parsed.title, { props: { status: 'offen', ...parsed.props } })
      await emit('nodes-changed')
      setText('')
      await win.hide()
    } catch (e) {
      setError(`Nicht gespeichert: ${e}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col justify-center border border-line bg-raised px-4">
      <div className="flex items-center gap-3">
        <Lightning size={22} className="shrink-0 text-accent" />
        <input
          ref={input}
          autoFocus
          value={text}
          aria-label="Schnellerfassung"
          placeholder="Was soll ins Gedächtnis?"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') win.hide()
          }}
          className="min-w-0 flex-1 bg-transparent text-[18px] outline-none placeholder:text-faint focus-visible:outline-none"
        />
      </div>
      <div className="pl-[34px]">
        {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : <ParsedPreview props={parsed.props} />}
      </div>
    </div>
  )
}
