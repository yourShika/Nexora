import Database from '@tauri-apps/plugin-sql'

let conn
const db = async () => (conn ??= await Database.load('sqlite:nexora.db'))
const now = () => new Date().toISOString()

// Nur diese Spalten dürfen über update() geschrieben werden
const FIELDS = new Set(['title', 'icon', 'color', 'body', 'props', 'config', 'favorite', 'parent_id', 'sort', 'deleted_at'])
const JSON_FIELDS = new Set(['props', 'config'])
const encode = (k, v) => (JSON_FIELDS.has(k) && v != null ? JSON.stringify(v) : v)

function parse(row) {
  for (const k of JSON_FIELDS) {
    try {
      row[k] = row[k] ? JSON.parse(row[k]) : null
    } catch {
      row[k] = null
    }
  }
  return row
}

export async function allNodes() {
  const rows = await (await db()).select(
    'SELECT id, parent_id, kind, title, icon, color, props, config, sort, favorite, created_at, opened_at, updated_at, deleted_at FROM nodes ORDER BY sort',
  )
  return rows.map(parse)
}

export async function loadBody(id) {
  const [row] = await (await db()).select('SELECT body FROM nodes WHERE id = $1', [id])
  return row?.body ?? ''
}

export async function create(kind, parentId, title = '', extra = {}) {
  const stamp = now()
  const node = {
    id: crypto.randomUUID(), parent_id: parentId, kind, title, sort: Date.now(), favorite: 0,
    props: null, config: null, ...extra, created_at: stamp, updated_at: stamp, opened_at: null, deleted_at: null,
  }
  await (await db()).execute(
    'INSERT INTO nodes (id, parent_id, kind, title, props, config, sort, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)',
    [node.id, node.parent_id, node.kind, node.title, encode('props', node.props), encode('config', node.config), node.sort, stamp],
  )
  return node
}

export async function update(id, fields) {
  const keys = Object.keys(fields).filter((k) => FIELDS.has(k))
  if (!keys.length) return
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')
  await (await db()).execute(
    `UPDATE nodes SET ${sets}, updated_at = $${keys.length + 1} WHERE id = $${keys.length + 2}`,
    [...keys.map((k) => encode(k, fields[k])), now(), id],
  )
}

// Öffnen zählt nicht als Änderung, darum ohne updated_at
export async function touch(id) {
  await (await db()).execute('UPDATE nodes SET opened_at = $1 WHERE id = $2', [now(), id])
}

export const trash = (id) => update(id, { deleted_at: now() })
export const restore = (id) => update(id, { deleted_at: null })

// Löscht die Treffer von `seed` samt allen Unterseiten
const deleteSubtree = (seed) =>
  `WITH RECURSIVE t(id) AS (SELECT id FROM nodes WHERE ${seed} UNION ALL SELECT n.id FROM nodes n JOIN t ON n.parent_id = t.id)
   DELETE FROM nodes WHERE id IN (SELECT id FROM t)`

export async function purge(id) {
  await (await db()).execute(deleteSubtree('id = $1'), [id])
}

// Papierkorb nach 30 Tagen leeren
export async function purgeOld() {
  const limit = new Date(Date.now() - 30 * 864e5).toISOString()
  await (await db()).execute(deleteSubtree('deleted_at IS NOT NULL AND deleted_at < $1'), [limit])
}

// Volltext (FTS5, trigram); match ist ein fertiger FTS-Ausdruck. Treffer markiert mit \u0001 … \u0002
export async function search(match, limit = 40) {
  return (await db()).select(
    // trigram zählt Zeichen statt Wörter: 48 ergibt etwa eine halbe Zeile Kontext
    // Ausschnitt nur aus dem Seiteninhalt (Spalte 2), Treffer in Feldwerten brauchen keinen
    `SELECT id, snippet(search, 2, char(1), char(2), '…', 48) AS snip FROM search WHERE search MATCH $1 ORDER BY rank LIMIT $2`,
    [match, limit],
  )
}

// Vollständige, in sich stimmige Kopie der Datenbank in eine neue Datei
export async function vacuumInto(path) {
  await (await db()).execute('VACUUM INTO $1', [path])
}

export async function getSetting(key) {
  const [row] = await (await db()).select('SELECT value FROM settings WHERE key = $1', [key])
  return row?.value ?? null
}

export async function setSetting(key, value) {
  await (await db()).execute(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  )
}
