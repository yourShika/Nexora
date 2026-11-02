// KI in Nexora: Einstellungen und Aufrufe an Rust. Der Schlüssel kommt nie hierher zurück, es gibt nur „vorhanden“ oder „nicht“.
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { activeProvider, MCP_DEFAULTS, normalizeSettings } from './ai.js'
import * as db from './db.js'

let store = normalizeSettings(null)
let loaded = false
const listeners = new Set()
const notify = () => listeners.forEach((f) => f())
export const onAiChange = (f) => (listeners.add(f), () => listeners.delete(f))
export const aiSettings = () => store

export async function loadAi() {
  let saved = null
  try {
    saved = JSON.parse((await db.getSetting('ki')) ?? 'null')
  } catch {
    // kaputte Einstellung: wie neu
  }
  store = normalizeSettings(saved)
  loaded = true
  notify()
  return store
}

let listening = false
export function watchAi() {
  if (!loaded) loadAi().catch(() => {})
  if (listening) return
  listening = true
  listen('ki-changed', (e) => e.payload?.from !== getCurrentWindow().label && loadAi().catch(() => {})).catch(() => {})
}

// Der Reihe nach, damit kein älterer Stand zuletzt ankommt
let writes = Promise.resolve()
function persist(key, value) {
  const done = writes.then(() => db.setSetting(key, value))
  writes = done.catch(() => {})
  return done
}

export function saveAi(next) {
  store = next
  notify()
  return persist('ki', JSON.stringify(next)).then(() => emit('ki-changed', { from: getCurrentWindow().label }).catch(() => {}))
}

export const providerRequest = (p) => ({ id: p.id, kind: p.kind, base: p.base.trim(), model: (p.model ?? '').trim() })
export const hasKey = (id) => invoke('ai_key_has', { id })
export const setKey = (id, key) => invoke('ai_key_set', { id, key })
export const listModels = (p) => invoke('ai_models', { provider: providerRequest(p) })
export const complete = (p, system, text) => invoke('ai_complete', { provider: providerRequest(p), system, text })
export const currentProvider = () => activeProvider(store)

export async function loadMcp() {
  try {
    return { ...MCP_DEFAULTS, ...JSON.parse((await db.getSetting('mcp')) ?? 'null') }
  } catch {
    return { ...MCP_DEFAULTS }
  }
}
export const saveMcp = (rights) => persist('mcp', JSON.stringify(rights))
export const mcpCommand = () => invoke('mcp_command')
