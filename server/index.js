// Start im Container: Einstellungen aus der Umgebung (.env), Daten in DATA_DIR
import { readFileSync } from 'node:fs'
import { createServer, openDb } from './app.js'

const { NEXORA_TENANT_ID: tenant, NEXORA_CLIENT_ID: clientId } = process.env
if (!tenant || !clientId) {
  console.error('NEXORA_TENANT_ID und NEXORA_CLIENT_ID fehlen (siehe server/README.md)')
  process.exit(1)
}
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version
const authority = process.env.NEXORA_AUTHORITY || `https://login.microsoftonline.com/${tenant}`
const port = Number(process.env.PORT || 8080)

createServer({ tenant, clientId, authority, version, db: openDb(process.env.DATA_DIR || './data') }).listen(port, () =>
  console.log(`Nexora-Server ${version} auf Port ${port}`),
)
