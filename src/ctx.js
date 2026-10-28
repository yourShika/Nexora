import { createContext, useContext } from 'react'

// Daten und Aktionen der App für Editor-Bausteine (Seitenlinks, eingebettete Listen).
// TipTap rendert Node-Views als Portale im Editor, darum kommt der Kontext dort an.
export const AppContext = createContext(null)
export const useApp = () => useContext(AppContext)
