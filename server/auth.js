// Prüft Entra-Zugriffstoken (RS256) gegen die öffentlichen Schlüssel des Mandanten. Keine Bibliothek nötig.
import { createPublicKey, verify } from 'node:crypto'

const b64json = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

// Schlüssel holen und 1 h merken; unbekannte kid lädt neu (Entra wechselt Schlüssel regelmäßig)
export function keyStore(url, fetchJson = (u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`JWKS ${r.status}`))))) {
  let keys = new Map()
  let loaded = 0
  async function load() {
    const { keys: list } = await fetchJson(url)
    keys = new Map(list.filter((k) => k.kty === 'RSA').map((k) => [k.kid, createPublicKey({ key: k, format: 'jwk' })]))
    loaded = Date.now()
  }
  return async (kid) => {
    if (!keys.has(kid) || Date.now() - loaded > 3600e3) await load()
    return keys.get(kid)
  }
}

// Gültig für dieses Programm: richtige Signatur, Aussteller (v1 oder v2), Zielgruppe, Zeit, Berechtigung
export async function verifyToken(token, { keyFor, tenant, clientId, scope = 'access_as_user', now = Date.now() / 1000 }) {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 3) throw new Error('kein Token')
  const [head, body, sig] = parts
  const header = b64json(head)
  if (header.alg !== 'RS256') throw new Error('falsches Verfahren')
  const key = await keyFor(header.kid)
  if (!key) throw new Error('unbekannter Schlüssel')
  if (!verify('RSA-SHA256', Buffer.from(`${head}.${body}`), key, Buffer.from(sig, 'base64url'))) throw new Error('Signatur falsch')
  const c = b64json(body)
  const issuers = [`https://login.microsoftonline.com/${tenant}/v2.0`, `https://sts.windows.net/${tenant}/`]
  if (!issuers.includes(c.iss) || c.tid !== tenant) throw new Error('falscher Aussteller')
  if (![clientId, `api://${clientId}`].includes(c.aud)) throw new Error('falsche Zielgruppe')
  // 2 Minuten Spielraum für abweichende Uhren
  if (!(c.exp > now - 120) || (c.nbf && c.nbf > now + 120)) throw new Error('abgelaufen')
  if (!String(c.scp ?? '').split(' ').includes(scope)) throw new Error('Berechtigung fehlt')
  return {
    id: c.oid,
    name: c.name ?? c.preferred_username ?? c.upn ?? 'Unbekannt',
    email: c.preferred_username ?? c.upn ?? c.email ?? null,
    groups: Array.isArray(c.groups) ? c.groups : [],
  }
}
