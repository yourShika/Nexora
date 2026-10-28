import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut'
import { invoke } from '@tauri-apps/api/core'

export const DEFAULT_HOTKEY = 'Control+Alt+Space'

const NAMES = { Control: 'Strg', Alt: 'Alt', Shift: 'Umschalt', Super: 'Win', Space: 'Leertaste' }
export const hotkeyLabel = (accel) => accel.split('+').map((p) => NAMES[p] ?? p).join('+')

// Wirft, wenn ein anderes Programm die Kombination schon belegt
export async function bindHotkey(accel) {
  await unregisterAll()
  await register(accel, (e) => e.state === 'Pressed' && invoke('toggle_capture'))
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
