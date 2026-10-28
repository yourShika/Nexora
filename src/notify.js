import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import * as db from './db.js'
import { iso } from './fields.js'
import { digestMessage, plan, timedMessage } from './reminders.js'

let busy = false

// Läuft alle 30 s im Hauptfenster (auch versteckt im Tray) und schickt fällige Windows-Meldungen
export async function checkReminders(rows, dbOf, now = new Date()) {
  if (busy) return
  busy = true
  try {
    const [saved, lastDigest, digestTime] = await Promise.all(['notified', 'lastDigest', 'digestTime'].map(db.getSetting))
    let notified
    try {
      notified = new Set(JSON.parse(saved || '[]'))
    } catch {
      notified = new Set()
    }
    const { timed, digest } = plan(rows, dbOf, { notified, lastDigest, digestTime: digestTime || '08:00' }, now)
    if (!timed.length && !digest) return

    // Ohne Erlaubnis trotzdem als erledigt merken, sonst fragt jede Runde neu
    const allowed = (await isPermissionGranted()) || (await requestPermission()) === 'granted'
    for (const x of timed) {
      if (allowed) sendNotification(timedMessage(x, dbOf(x.row)))
      notified.add(x.key)
    }
    if (timed.length) {
      const keep = iso(new Date(now - 3 * 864e5))
      await db.setSetting('notified', JSON.stringify([...notified].filter((k) => k.split('|')[2] >= keep)))
    }
    if (digest) {
      const msg = digestMessage(digest)
      if (msg && allowed) sendNotification(msg)
      await db.setSetting('lastDigest', iso(now))
    }
  } finally {
    busy = false
  }
}
