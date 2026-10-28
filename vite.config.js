import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Port 1420 fest, weil Tauri im Dev-Modus genau dort lädt
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  // Lädt von der Platte, nicht übers Netz: die Paketgröße ist hier kein Thema
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
