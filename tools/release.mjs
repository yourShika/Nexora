// Baut den signierten Installer und latest.json für den Updater.
//   node tools/release.mjs                      nur bauen
//   node tools/release.mjs --publish "Notizen"  bauen und als GitHub-Release veröffentlichen (gh muss angemeldet sein)
// Der private Schlüssel liegt außerhalb des Repos: %USERPROFILE%\.nexora\updater.key
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const conf = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const cargo = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8')
const version = conf.version
const fail = (msg) => (console.error(`Abbruch: ${msg}`), process.exit(1))

const repo = /github\.com\/([^/]+\/[^/]+)\/releases/.exec(conf.plugins.updater.endpoints[0])?.[1]
if (!repo || repo === 'KONTO/REPO') fail('In tauri.conf.json steht noch kein GitHub-Repo beim Updater-Endpunkt.')
if (pkg.version !== version || !cargo.includes(`version = "${version}"`)) fail(`Versionen in package.json, Cargo.toml und tauri.conf.json stimmen nicht überein (${version}).`)

const keyFile = path.join(os.homedir(), '.nexora', 'updater.key')
if (!fs.existsSync(keyFile)) fail(`Signaturschlüssel fehlt: ${keyFile}`)

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, ...env } })
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} ist fehlgeschlagen.`)
}

run('npm', ['run', 'tauri', 'build'], {
  TAURI_SIGNING_PRIVATE_KEY: fs.readFileSync(keyFile, 'utf8'),
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '',
})

const dir = path.join(root, 'src-tauri/target/release/bundle/nsis')
const exe = `${conf.productName}_${version}_x64-setup.exe`
const sigFile = path.join(dir, `${exe}.sig`)
if (!fs.existsSync(sigFile)) fail(`Signatur fehlt: ${sigFile}`)

const latest = {
  version,
  notes: process.argv[3] ?? '',
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: fs.readFileSync(sigFile, 'utf8').trim(),
      url: `https://github.com/${repo}/releases/download/v${version}/${exe}`,
    },
  },
}
fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(latest, null, 2))

// Aktuellen Installer zusätzlich in <Projekt>\installer ablegen (nicht im Repo), ältere entfernen
const local = path.join(root, 'installer')
fs.mkdirSync(local, { recursive: true })
for (const f of fs.readdirSync(local)) if (/^.+_x64-setup\.exe$/.test(f) && f !== exe) fs.rmSync(path.join(local, f))
fs.copyFileSync(path.join(dir, exe), path.join(local, exe))
console.log(`\nFertig: ${path.join(local, exe)}\n        ${path.join(dir, 'latest.json')}`)

if (process.argv[2] === '--publish') {
  run('gh', ['release', 'create', `v${version}`, `"${path.join(dir, exe)}"`, `"${path.join(dir, 'latest.json')}"`,
    '--repo', repo, '--title', `"Nexora ${version}"`, '--notes', JSON.stringify(latest.notes || `Nexora ${version}`)])
  console.log(`Veröffentlicht: https://github.com/${repo}/releases/tag/v${version}`)
}
