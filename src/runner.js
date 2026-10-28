import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// Sprache des Codeblocks -> Shell; 'powershell' nutzt je nach Einstellung 5.1 oder 7
export const RUNNABLE = { powershell: 'PowerShell', dos: 'CMD', python: 'Python' }

let available = null
export const shells = () => (available ??= invoke('shells').catch(() => ['powershell', 'cmd']))

// Startet einen Lauf; Rückgabe: Funktion zum Abbrechen
export async function runCode({ lang, code, admin, pwsh, onLine, onExit }) {
  const id = crypto.randomUUID()
  const offLine = await listen('run-line', (e) => e.payload.id === id && onLine(e.payload))
  const offExit = await listen('run-exit', (e) => {
    if (e.payload.id !== id) return
    offLine()
    offExit()
    onExit(e.payload)
  })
  const shell = lang === 'dos' ? 'cmd' : lang === 'python' ? 'python' : pwsh ? 'pwsh' : 'powershell'
  try {
    await invoke('run_script', { id, shell, code, admin })
  } catch (e) {
    offLine()
    offExit()
    onExit({ id, code: null, ms: 0, error: String(e) })
  }
  return () => invoke('cancel_run', { id }).catch(() => {})
}

// {{Name}} im Code; {{vault:…}} bleibt für die Vaultwarden-Anbindung reserviert
export const placeholders = (code) => [...new Set([...code.matchAll(/\{\{\s*([^{}:]+?)\s*\}\}/g)].map((m) => m[1]))]

export const fill = (code, values) => code.replace(/\{\{\s*([^{}:]+?)\s*\}\}/g, (all, name) => values[name] ?? all)

// Tabellen-Ausgabe von PowerShell (Kopfzeile, darunter "---- ----") in Spalten zerlegen
export function parseTable(lines) {
  const sep = lines.findIndex((l, i) => i > 0 && /^\s*-+( +-+)*\s*$/.test(l) && lines[i - 1].trim())
  if (sep < 1) return null
  const groups = [...lines[sep].matchAll(/-+/g)].map((m) => [m.index, m.index + m[0].length])
  const body = []
  for (const line of lines.slice(sep + 1)) {
    if (!line.trim()) {
      if (body.length) break
      continue
    }
    body.push(line)
  }
  if (groups.length < 2 || !body.length) return null
  // Grenze zwischen zwei Spalten: eine Stelle in der Lücke, die in allen Zeilen leer ist.
  // Linksbündige Werte ragen rechts über ihre Striche, rechtsbündige links darüber hinaus.
  const all = [lines[sep - 1], ...body]
  const free = (p) => all.every((l) => (l[p] ?? ' ') === ' ')
  const cuts = groups.slice(1).map(([start], i) => {
    for (let p = start - 1; p >= groups[i][1]; p--) if (free(p)) return p
    return start
  })
  const cut = (line) => [0, ...cuts].map((from, i) => line.slice(from, cuts[i]).trim())
  return { headers: cut(lines[sep - 1]), rows: body.map(cut) }
}
