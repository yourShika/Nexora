// Nexora-Server. Schritt 1: Gesundheit, Anmeldeangaben für die Desktop-App, Entra-Prüfung.
// Ohne npm-Abhängigkeiten: node:http, node:sqlite, node:crypto
import http from 'node:http'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { keyStore, verifyToken } from './auth.js'

export function openDb(dir) {
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'nexora-server.db'))
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, groups TEXT NOT NULL DEFAULT '[]',
      first_seen TEXT NOT NULL, last_seen TEXT NOT NULL)`)
  return db
}

// cfg: tenant, clientId, authority, version, keyFor (Tests), db
export function createServer(cfg) {
  const keyFor = cfg.keyFor ?? keyStore(`${cfg.authority}/discovery/v2.0/keys`)
  const seen = cfg.db.prepare(`INSERT INTO users (id, name, email, groups, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email, groups = excluded.groups, last_seen = excluded.last_seen`)

  const send = (res, status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      // Anmeldung nur über Bearer-Token, keine Cookies: jede Herkunft darf fragen
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }

  async function user(req) {
    const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1]
    const u = await verifyToken(token, { keyFor, tenant: cfg.tenant, clientId: cfg.clientId })
    const stamp = new Date().toISOString()
    seen.run(u.id, u.name, u.email, JSON.stringify(u.groups), stamp, stamp)
    return u
  }

  return http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname
    try {
      if (req.method === 'OPTIONS') return send(res, 204, null)
      if (path === '/health') return send(res, 200, { ok: true, version: cfg.version })
      // Was die Desktop-App für die Anmeldung braucht; so steht in der App kein Mandant fest
      if (path === '/api/config') return send(res, 200, { tenant: cfg.tenant, clientId: cfg.clientId, authority: cfg.authority, scope: `api://${cfg.clientId}/access_as_user` })
      if (path === '/api/me') {
        try {
          return send(res, 200, await user(req))
        } catch (e) {
          return send(res, 401, { error: `Nicht angemeldet: ${e.message}` })
        }
      }
      send(res, 404, { error: 'Gibt es nicht' })
    } catch (e) {
      send(res, 500, { error: e.message })
    }
  })
}
