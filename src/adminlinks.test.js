import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adminLinks } from './adminlinks.js'

const targets = (t) => adminLinks(t).map((l) => l.target)

test('Admin-Links im Text', () => {
  assert.deepEqual(targets('Ablage auf \\\\fs01\\daten$\\IT\\Lizenzen, dort nachsehen.'), ['\\\\fs01\\daten$\\IT\\Lizenzen'])
  assert.deepEqual(targets('Logs unter C:\\ProgramData\\Agent\\logs.'), ['C:\\ProgramData\\Agent\\logs'])
  assert.deepEqual(targets('Installiert in "C:\\Program Files\\Tool X" laut Doku'), ['C:\\Program Files\\Tool X'])
  assert.deepEqual(targets('Server: rdp://srv-app01:3390 oder ssh://admin@10.0.3.1:2222.'), ['rdp://srv-app01:3390', 'ssh://admin@10.0.3.1:2222'])
  assert.deepEqual(targets('Webseite https://example.com und Text a\\b'), [])
  const [link] = adminLinks('x \\\\srv\\f y')
  assert.deepEqual([link.from, link.to], [2, 9])
})
