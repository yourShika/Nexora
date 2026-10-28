import { invoke } from '@tauri-apps/api/core'
import { appConfigDir, join } from '@tauri-apps/api/path'
import * as db from './db.js'
import { iso } from './fields.js'

export const BACKUP_DEFAULTS = { dir: '', hours: 24, keep: 14 }

export async function loadBackupSettings() {
  const [dir, hours, keep, last] = await Promise.all(['backupDir', 'backupHours', 'backupKeep', 'lastBackup'].map(db.getSetting))
  return { dir: dir ?? '', hours: Number(hours) || BACKUP_DEFAULTS.hours, keep: Number(keep) || BACKUP_DEFAULTS.keep, last }
}

let running = false

// Stand per VACUUM INTO (in sich stimmig, auch während die App schreibt), Rest erledigt Rust
export async function runBackup({ dir, keep }) {
  if (running) return null
  running = true
  try {
    const d = new Date()
    const name = `sicherung-${iso(d)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}.db`
    await db.vacuumInto(await join(await appConfigDir(), name))
    const dest = await invoke('finish_backup', { snapshot: name, target: dir, keep })
    await db.setSetting('lastBackup', d.toISOString())
    return dest
  } finally {
    running = false
  }
}

// Fällig, wenn ein Ziel gewählt ist und die letzte Sicherung länger als das Intervall her ist
export async function maybeBackup(now = Date.now()) {
  const s = await loadBackupSettings()
  if (!s.dir || (s.last && now - Date.parse(s.last) < s.hours * 3600e3)) return null
  return runBackup(s)
}
