import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import { applyTheme } from './theme.js'

applyTheme()
// Das Schnellerfassungs-Fenster lädt nur sein Eingabefeld, nicht Editor und Baum
const { default: Root } = await (getCurrentWindow().label === 'capture' ? import('./Capture.jsx') : import('./App.jsx'))
createRoot(document.getElementById('root')).render(<Root />)
