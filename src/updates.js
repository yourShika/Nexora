import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

// Fragt latest.json im GitHub-Release ab; null = aktuell. Die Signatur prüft das Plugin selbst.
export const findUpdate = () => check()

// Lädt, installiert (Installer im Hintergrund) und startet neu. Vorher speichern offene Seiten
// (Page.jsx sichert bei "blur"), denn der Installer beendet Nexora
export async function installUpdate(update) {
  dispatchEvent(new Event('blur'))
  await new Promise((r) => setTimeout(r, 800))
  await update.downloadAndInstall()
  await relaunch()
}
