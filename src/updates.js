import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

// Fragt latest.json im GitHub-Release ab; null = aktuell. Die Signatur prüft das Plugin selbst.
export const findUpdate = () => check()

// Lädt, installiert (Installer im Hintergrund) und startet neu
export async function installUpdate(update) {
  await update.downloadAndInstall()
  await relaunch()
}
