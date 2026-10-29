import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getCurrentWindow } from '@tauri-apps/api/window'

// Fragt latest.json im GitHub-Release ab; null = aktuell. Die Signatur prüft das Plugin selbst.
export const findUpdate = () => check()

// Lädt, installiert (Installer im Hintergrund) und startet neu. Vorher speichern offene Seiten
// (Page.jsx sichert bei "blur"), denn der Installer beendet Nexora.
// Der Installer startet mit den alten Parametern neu, nach dem Autostart also mit --hidden: merken, ob das Fenster offen war
export async function installUpdate(update) {
  const show = await getCurrentWindow().isVisible().catch(() => true)
  localStorage.setItem('nach-update', JSON.stringify({ version: update.version, show }))
  dispatchEvent(new Event('blur'))
  await new Promise((r) => setTimeout(r, 800))
  await update.downloadAndInstall()
  await relaunch()
}
