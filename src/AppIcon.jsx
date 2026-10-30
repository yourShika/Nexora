import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { TrayIcon } from '@tauri-apps/api/tray'
import { iconColors, iconSvg } from './appicon.js'
import { useLook } from './theme.js'

const url = (look, small) => `data:image/svg+xml;base64,${btoa(iconSvg(iconColors(look), small))}`

// Icon in der Oberfläche (Titelleiste, Seitenleiste); ab 32 Pixel die feine Fassung
export default function AppIcon({ size = 16, className = '' }) {
  const look = useLook()
  return <img src={url(look, size <= 32)} width={size} height={size} alt="" className={className} />
}

// SVG → PNG-Bytes in der gewünschten Größe
async function png(look, size, small = size <= 32) {
  const img = new Image()
  img.src = url(look, small)
  await img.decode()
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size })
  canvas.getContext('2d').drawImage(img, 0, 0, size, size)
  const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

// Fenster (Taskleiste, Alt+Tab) und im Hauptfenster auch der Tray folgen dem Farbschema
export function useWindowIcon(main) {
  const look = useLook()
  const key = JSON.stringify([look.theme, look.accent, look.gradient])
  useEffect(() => {
    let alive = true
    ;(async () => {
      // Taskleiste zeigt 24 bis 32 Pixel: die kräftige Fassung, groß genug für Alt+Tab
      const big = await png(look, 64, true)
      if (!alive) return
      await getCurrentWindow().setIcon(big)
      if (main) await (await TrayIcon.getById('main'))?.setIcon(await png(look, 32))
    })().catch(() => {})
    return () => {
      alive = false
    }
  }, [key])
}
