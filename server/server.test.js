import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyToken } from './auth.js'
import { createServer, openDb } from './app.js'

const TENANT = '11111111-2222-3333-4444-555555555555'
const CLIENT = '99999999-8888-7777-6666-555555555555'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
const keyFor = async (kid) => (kid === 'k1' ? publicKey : undefined)

function token(claims = {}, { key = privateKey, kid = 'k1' } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const body = { iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, tid: TENANT, aud: CLIENT, exp: now + 600, nbf: now - 10, scp: 'access_as_user', oid: 'u-1', name: 'Test Person', preferred_username: 'test@example.test', groups: ['IT'], ...claims }
  const data = `${enc({ alg: 'RS256', kid })}.${enc(body)}`
  return `${data}.${createSign('RSA-SHA256').update(data).sign(key).toString('base64url')}`
}
const check = (t) => verifyToken(t, { keyFor, tenant: TENANT, clientId: CLIENT })

test('gültige Token: v2 und v1 (api://)', async () => {
  assert.deepEqual(await check(token()), { id: 'u-1', name: 'Test Person', email: 'test@example.test', groups: ['IT'] })
  const v1 = await check(token({ iss: `https://sts.windows.net/${TENANT}/`, aud: `api://${CLIENT}`, preferred_username: undefined, upn: 'v1@example.test' }))
  assert.equal(v1.email, 'v1@example.test')
})

test('abgewiesen', async () => {
  const no = async (t, msg) => assert.rejects(check(t), new RegExp(msg))
  await no(token({}, { key: other }), 'Signatur')
  await no(token({}, { kid: 'fremd' }), 'Schlüssel')
  await no(token({ tid: 'anderer' }), 'Aussteller')
  await no(token({ iss: 'https://evil.example/v2.0' }), 'Aussteller')
  await no(token({ aud: 'jemand-anders' }), 'Zielgruppe')
  await no(token({ exp: Math.floor(Date.now() / 1000) - 600 }), 'abgelaufen')
  await no(token({ scp: 'User.Read' }), 'Berechtigung')
  await no('kaputt', 'kein Token')
  // Signatur gilt für den Kopf: alg "none" darf nicht durchrutschen
  const [, body, sig] = token().split('.')
  await no(`${Buffer.from('{"alg":"none","kid":"k1"}').toString('base64url')}.${body}.${sig}`, 'Verfahren')
})

test('HTTP: Gesundheit, Anmeldeangaben, /api/me', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'nexora-server-'))
  const db = openDb(dir)
  const server = createServer({ tenant: TENANT, clientId: CLIENT, authority: `https://login.microsoftonline.com/${TENANT}`, version: '0.0.0-test', keyFor, db })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  t.after(() => (server.close(), db.close(), rmSync(dir, { recursive: true, force: true })))
  const base = `http://127.0.0.1:${server.address().port}`
  const get = (path, headers) => fetch(base + path, { headers }).then(async (r) => [r.status, await r.json()])

  assert.deepEqual(await get('/health'), [200, { ok: true, version: '0.0.0-test' }])
  const [, config] = await get('/api/config')
  assert.equal(config.scope, `api://${CLIENT}/access_as_user`)
  assert.equal((await get('/api/me'))[0], 401)
  const [status, me] = await get('/api/me', { authorization: `Bearer ${token()}` })
  assert.equal(status, 200)
  assert.equal(me.name, 'Test Person')
  assert.equal(db.prepare('SELECT name FROM users WHERE id = ?').get('u-1').name, 'Test Person')
})
