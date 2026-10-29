import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window'
import * as db from './db.js'

// Seitenfenster heißen "seite-<id>". Solange eines offen ist, stehen Position, Größe und Pin in der Einstellung
// "fenster:<id>". Schließt man es, verschwindet sie; beim Beenden über das Tray bleibt sie, so kommt es beim Start wieder.
export const label = getCurrentWindow().label
export const windowPage = label.startsWith('seite-') ? label.slice(6) : null
export const windowKey = (id) => `fenster:${id}`

// Liegt die gemerkte Position noch auf einem Bildschirm? Sonst (Laptop abgedockt) setzt Windows das Fenster selbst hin
async function onScreen({ x, y }) {
  const screens = await availableMonitors().catch(() => [])
  return screens.some((m) => {
    const pos = m.position.toLogical(m.scaleFactor)
    const size = m.size.toLogical(m.scaleFactor)
    return x + 40 >= pos.x && x + 40 < pos.x + size.width && y + 10 >= pos.y && y + 10 < pos.y + size.height
  })
}

export async function openWindow(id, saved = {}) {
  const existing = await WebviewWindow.getByLabel(`seite-${id}`)
  if (existing) {
    await existing.unminimize()
    await existing.show()
    await existing.setFocus()
    return
  }
  const place = saved.x != null && (await onScreen(saved)) ? { x: saved.x, y: saved.y } : {}
  const win = new WebviewWindow(`seite-${id}`, {
    title: 'Nexora',
    width: saved.w ?? 760,
    height: saved.h ?? 820,
    minWidth: 360,
    minHeight: 260,
    alwaysOnTop: !!saved.pin,
    decorations: false, // eigene Titelleiste (TitleBar.jsx)
    dragDropEnabled: false,
    ...place,
  })
  await new Promise((ok, fail) => {
    win.once('tauri://created', ok)
    win.once('tauri://error', (e) => fail(e.payload))
  })
}

export async function closeWindow(id) {
  await (await WebviewWindow.getByLabel(`seite-${id}`))?.close()
}

// Beim Start des Hauptfensters: offene Fenster vom letzten Mal; gelöschte Seiten fallen weg
export async function restoreWindows(isAlive) {
  const opened = []
  for (const { key, value } of await db.settingsLike('fenster:')) {
    const id = key.slice('fenster:'.length)
    if (!isAlive(id)) {
      await db.deleteSetting(key)
      continue
    }
    try {
      await openWindow(id, JSON.parse(value))
      opened.push(id)
    } catch {}
  }
  return opened
}
