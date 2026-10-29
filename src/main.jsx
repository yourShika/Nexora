import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import { applyTheme } from './theme.js'

applyTheme()
// Das Schnellerfassungs-Fenster lädt nur sein Eingabefeld, nicht Editor und Baum
// Snippet-Picker ebenso nur seine Liste
const label = getCurrentWindow().label
const { default: Root } = await (label === 'capture' ? import('./Capture.jsx') : label === 'picker' ? import('./Picker.jsx') : import('./App.jsx'))
createRoot(document.getElementById('root')).render(<Root />)
