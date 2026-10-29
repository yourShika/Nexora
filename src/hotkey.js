import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut'

// Globale Tastenkürzel; Einstellung je Kürzel, Ersatzwert wenn nichts gespeichert ist
export const HOTKEYS = [
  { id: 'capture', setting: 'hotkey', fallback: 'Control+Alt+Space', label: 'Schnellerfassung' },
  { id: 'clipboard', setting: 'hotkey-clipboard', fallback: 'Control+Alt+V', label: 'Zwischenablage in den Eingang' },
  { id: 'snippets', setting: 'hotkey-snippets', fallback: 'Control+Alt+S', label: 'Snippet einfügen' },
]
export const DEFAULT_HOTKEY = HOTKEYS[0].fallback

const NAMES = { Control: 'Strg', Alt: 'Alt', Shift: 'Umschalt', Super: 'Win', Space: 'Leertaste' }
export const hotkeyLabel = (accel) => (accel ?? '').split('+').map((p) => NAMES[p] ?? p).join('+')

// Bindet alle Kürzel neu; liefert die IDs, die ein anderes Programm schon belegt
export async function bindHotkeys(keys, run) {
  await unregisterAll()
  const busy = []
  for (const [id, accel] of Object.entries(keys)) {
    try {
      await register(accel, (e) => e.state === 'Pressed' && run(id))
    } catch {
      busy.push(id)
    }
  }
  return busy
}

// Tastendruck -> "Control+Alt+N"; null, solange nur Umschalttasten gedrückt sind
export function accelFromEvent(e) {
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
  const key = e.code === 'Space' ? 'Space'
    : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3)
    : /^Digit\d$/.test(e.code) ? e.code.slice(5)
    : /^F\d{1,2}$/.test(e.code) ? e.code
    : null
  return key && mods.length ? [...mods, key].join('+') : null
}
