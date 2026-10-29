import { test } from 'node:test'
import assert from 'node:assert/strict'
import { maskSecrets, secretSpans } from './secrets.js'

const masked = (t) => maskSecrets(t, secretSpans(t))

test('Passwort-artiges wird erkannt und maskiert', () => {
  assert.equal(masked('Passwort: Sommer2026!'), 'Passwort: ••••••')
  assert.equal(masked('$cred = "user"; password="Xy7#kL9mQ"'), '$cred = "user"; password="••••••"')
  assert.equal(masked('{"client_secret": "abc123DEF456"}'), '{"client_secret": "••••••"}')
  assert.equal(masked('Endpoint=sb://x.servicebus.windows.net/;SharedAccessKey=AbCdEf123456+/='), 'Endpoint=sb://x.servicebus.windows.net/;SharedAccessKey=••••••')
  assert.equal(masked('-----BEGIN OPENSSH PRIVATE KEY-----\nabc\ndef\n-----END OPENSSH PRIVATE KEY-----\nRest'), '••••••\nRest')
  assert.equal(masked('Token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c ok'), 'Token •••••• ok')
  assert.equal(masked('  Xk9!mP2#qL7z  '), '  ••••••  ')
  assert.equal(masked('Sommer2026!x'), '••••••')
})

test('Normales bleibt unangetastet', () => {
  for (const t of [
    'Get-Service',
    'Get-ADUser -Filter * -Properties PasswordLastSet',
    'C:\\Windows\\System32\\drivers',
    '\\\\server01\\freigabe$\\Projekte',
    'https://portal.example.com/login?x=1',
    'k.mustermann@example.com',
    '3f2b8c4e-0b6e-4c55-9a1e-7d1f3c2a0b6e',
    'Das Passwort ist abgelaufen, bitte neu setzen.',
    'Kennwort: abc',
    'Server2019',
    'SRV-DC01-Backup2',
  ]) assert.deepEqual(secretSpans(t), [], t)
})
