import Database from '@tauri-apps/plugin-sql'
import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { taskCount, today } from './fields.js'
import { searchText } from './free.js'

let conn
const db = async () => (conn ??= await Database.load('sqlite:nexora.db'))
const now = () => new Date().toISOString()
// Andere Fenster laden den Baum neu; reiner Seiteninhalt betrifft nur das Fenster, das ihn bearbeitet
const changed = () => emit('nodes-changed', { from: getCurrentWindow().label }).catch(() => {})

// Nur diese Spalten dürfen über update() geschrieben werden
const FIELDS = new Set(['title', 'icon', 'color', 'cover', 'locked', 'template', 'body', 'props', 'config', 'favorite', 'parent_id', 'sort', 'deleted_at', 'area', 'plain'])
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
    // Text nur bei Punkten, für den Fortschritt ihrer Checkliste; danach wieder weg
    "SELECT id, parent_id, kind, title, icon, color, cover, locked, template, props, config, sort, favorite, area, created_at, opened_at, updated_at, deleted_at, CASE WHEN kind = 'row' THEN body END AS row_body FROM nodes ORDER BY sort",
  )
  return rows.map((row) => {
    if (row.kind === 'row') row.tasks = taskCount(row.row_body)
    delete row.row_body
    return parse(row)
  })
}

export async function loadBody(id) {
  const [row] = await (await db()).select('SELECT body FROM nodes WHERE id = $1', [id])
  return row?.body ?? ''
}

export async function create(kind, parentId, title = '', extra = {}) {
  const stamp = now()
  const node = {
    id: crypto.randomUUID(), parent_id: parentId, kind, title, sort: Date.now(), favorite: 0,
    props: null, config: null, area: null, ...extra, created_at: stamp, updated_at: stamp, opened_at: null, deleted_at: null,
  }
  await (await db()).execute(
    'INSERT INTO nodes (id, parent_id, kind, title, props, config, sort, area, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)',
    [node.id, node.parent_id, node.kind, node.title, encode('props', node.props), encode('config', node.config), node.sort, node.area, stamp],
  )
  changed()
  return node
}

export async function update(id, fields) {
  // Suchfassung ohne Striche gleich mitschreiben (Migration 011)
  if ('body' in fields) fields = { ...fields, plain: searchText(fields.body) }
  const keys = Object.keys(fields).filter((k) => FIELDS.has(k))
  if (!keys.length) return
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ')
  await (await db()).execute(
    `UPDATE nodes SET ${sets}, updated_at = $${keys.length + 1} WHERE id = $${keys.length + 2}`,
    [...keys.map((k) => encode(k, fields[k])), now(), id],
  )
  if (keys.some((k) => k !== 'body' && k !== 'plain')) changed()
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

// Papierkorb nach 30 Tagen leeren, Versionen nach 90 Tagen
export async function purgeOld() {
  const conn = await db()
  await conn.execute(deleteSubtree('deleted_at IS NOT NULL AND deleted_at < $1'), [new Date(Date.now() - 30 * 864e5).toISOString()])
  await conn.execute('DELETE FROM versions WHERE created_at < $1', [new Date(Date.now() - 90 * 864e5).toISOString()])
}

// Frühere Fassungen einer Seite, neueste zuerst (die Datenbank legt sie beim Speichern an)
export async function versions(id) {
  return (await db()).select('SELECT id, title, body, created_at FROM versions WHERE node_id = $1 ORDER BY created_at DESC LIMIT 200', [id])
}

// Aktuellen Stand ausdrücklich sichern, z. B. bevor eine alte Fassung zurückgeholt wird
export async function snapshot(id) {
  await (await db()).execute('INSERT INTO versions (node_id, title, body) SELECT id, title, body FROM nodes WHERE id = $1', [id])
}

// Alle Texte, die auf Bilder verweisen können: Seiten (auch im Papierkorb), Titelbilder, alte Fassungen
export async function imageReferences() {
  // bild:<Name> merkt sich Original und Schritte eines bearbeiteten Bilds (ImageEditor.jsx); das Original bleibt so erhalten
  const rows = await (await db()).select("SELECT body, cover FROM nodes UNION ALL SELECT body, NULL FROM versions UNION ALL SELECT value, NULL FROM settings WHERE substr(key, 1, 5) = 'bild:'")
  return rows.map((r) => `${r.body ?? ''}\n${r.cover ?? ''}`).join('\n')
}

// Volltext (FTS5, trigram); match ist ein fertiger FTS-Ausdruck. Treffer markiert mit \u0001 … \u0002
export async function search(match, limit = 40) {
  const c = await db()
  const text = await c.select(
    // trigram zählt Zeichen statt Wörter: 48 ergibt etwa eine halbe Zeile Kontext
    // Ausschnitt nur aus dem Seiteninhalt (Spalte 2), Treffer in Feldwerten brauchen keinen
    `SELECT id, snippet(search, 2, char(1), char(2), '…', 48) AS snip FROM search WHERE search MATCH $1 ORDER BY rank LIMIT $2`,
    [match, limit],
  )
  // Text in Bildern und Anhängen zählt für jede Seite, in der sie stecken. Anhänge stehen im Index als
  // "datei:<uuid>/<Name>|<Seite>", im Seitentext als [[datei:<uuid>/<Name>|<Bytes>]].
  // Mehr Zeilen holen, weil ein langes PDF sonst mit vielen Seiten alle Plätze belegt
  const files = await c.select(
    `SELECT n.id, ocr.file, snippet(ocr, 1, char(1), char(2), '…', 32) AS snip FROM ocr
     JOIN nodes n ON n.deleted_at IS NULL AND instr(n.body, CASE WHEN substr(ocr.file, 1, 6) = 'datei:'
       THEN '[[' || substr(ocr.file, 1, instr(ocr.file, '|')) ELSE ocr.file END) > 0
     WHERE ocr MATCH $1 ORDER BY rank LIMIT $2`,
    [match, limit * 10],
  )
  const seen = new Set(text.map((r) => r.id))
  return [...text, ...files.filter((r) => !seen.has(r.id) && seen.add(r.id))]
}

export async function ocrFiles() {
  return (await (await db()).select('SELECT file FROM ocr')).map((r) => r.file)
}

export async function ocrText(file) {
  const [row] = await (await db()).select('SELECT text FROM ocr WHERE file = $1', [file])
  return row?.text ?? null
}

export async function setOcr(file, text) {
  const c = await db()
  await c.execute('DELETE FROM ocr WHERE file = $1', [file])
  await c.execute('INSERT INTO ocr (file, text) VALUES ($1, $2)', [file, text])
}

export async function dropOcr(files) {
  const c = await db()
  for (const file of files) await c.execute('DELETE FROM ocr WHERE file = $1', [file])
}

// Text eines Anhangs, eine Zeile je Seite; ohne Seiten ein leerer Platzhalter "|0", damit er nicht wieder dran ist
const docKey = (rel) => `datei:${rel}|`
export async function setDocText(rel, pages) {
  const c = await db()
  await c.execute('DELETE FROM ocr WHERE substr(file, 1, length($1)) = $1', [docKey(rel)])
  if (!pages.length) return c.execute('INSERT INTO ocr (file, text) VALUES ($1, $2)', [`${docKey(rel)}0`, ''])
  for (const [i, text] of pages.entries()) await c.execute('INSERT INTO ocr (file, text) VALUES ($1, $2)', [`${docKey(rel)}${i + 1}`, text])
}

export async function docText(rel) {
  const rows = await (await db()).select('SELECT file, text FROM ocr WHERE substr(file, 1, length($1)) = $1', [docKey(rel)])
  if (!rows.length) return null
  const page = (r) => Number(r.file.slice(r.file.lastIndexOf('|') + 1))
  return rows.sort((a, b) => page(a) - page(b)).map((r) => r.text).join('\n\n')
}

export async function dropDocs(rels) {
  const c = await db()
  for (const rel of rels) await c.execute('DELETE FROM ocr WHERE substr(file, 1, length($1)) = $1', [docKey(rel)])
}

// Vollständige, in sich stimmige Kopie der Datenbank in eine neue Datei
export async function vacuumInto(path) {
  await (await db()).execute('VACUUM INTO $1', [path])
}

// Verlauf eines Punkts, neueste zuerst
export async function activity(id) {
  return (await db()).select('SELECT id, kind, text, created_at FROM activity WHERE node_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200', [id])
}

// Änderung für den Verlauf einer Seite. merge { key, join(alterText) }: Folgeänderungen derselben Art binnen
// 10 Minuten werden ein Eintrag (Titel tippen, Spaltenbreite ziehen) statt vieler
export async function addChange(id, text, merge) {
  const c = await db()
  if (merge) {
    const [last] = await c.select("SELECT id, text, created_at FROM activity WHERE node_id = $1 AND kind = 'change' ORDER BY id DESC LIMIT 1", [id])
    if (last?.text.startsWith(merge.key) && Date.now() - Date.parse(last.created_at) < 10 * 60e3) {
      const text = merge.join(last.text)
      // null: unterm Strich nichts geändert (z. B. umbenannt und wieder zurück), Eintrag fällt weg
      if (text === null) await c.execute('DELETE FROM activity WHERE id = $1', [last.id])
      else await c.execute('UPDATE activity SET text = $1, created_at = $2 WHERE id = $3', [text, now(), last.id])
      return
    }
  }
  await c.execute("INSERT INTO activity (node_id, kind, text) VALUES ($1, 'change', $2)", [id, text])
}

// Umbenennen als ein Eintrag „alt“ → „neu“, auch wenn in mehreren Schritten getippt
export const renamed = (id, from, to) => {
  const t = (x) => `„${x || 'Ohne Titel'}“`
  return addChange(id, `Umbenannt: ${t(from)} → ${t(to)}`, { key: 'Umbenannt:', join: (last) => (last.startsWith(`Umbenannt: ${t(to)} →`) ? null : last.replace(/→ „[^]*“$/, `→ ${t(to)}`)) })
}

export async function addActivity(id, kind, text) {
  await (await db()).execute('INSERT INTO activity (node_id, kind, text) VALUES ($1, $2, $3)', [id, kind, text])
}

// Seiten, die per [[Titel|id]] auf diese Seite verweisen
export async function backlinks(id) {
  const rows = await (await db()).select("SELECT id FROM nodes WHERE deleted_at IS NULL AND id <> $1 AND body LIKE '%|' || $1 || ']]%'", [id])
  return rows.map((r) => r.id)
}

// Seiten mit Codeblöcken (für die Snippet-Übersicht)
export async function pagesWithCode() {
  return (await db()).select("SELECT id, body FROM nodes WHERE deleted_at IS NULL AND body LIKE '%```%'")
}

export async function getSetting(key) {
  const [row] = await (await db()).select('SELECT value FROM settings WHERE key = $1', [key])
  return row?.value ?? null
}

// Arbeitstagebuch: erledigt | angelegt | bearbeitet (einmal je Tag und Seite) | ausgefuehrt | nachgehakt | notiz
// area: nur für Notizen ohne Seite; sonst gilt der Bereich des obersten Knotens der Seite
export async function journal(kind, nodeId, text = '', area = null) {
  const c = await db()
  const day = today()
  if (kind === 'bearbeitet' && (await c.select('SELECT 1 FROM journal WHERE day = $1 AND kind = $2 AND node_id = $3', [day, kind, nodeId])).length) return
  await c.execute(
    `INSERT INTO journal (day, at, kind, node_id, text, area) VALUES ($1, $2, $3, $4, $5, COALESCE((
       WITH RECURSIVE up(id, parent_id, area) AS (
         SELECT id, parent_id, area FROM nodes WHERE id = $4
         UNION ALL SELECT n.id, n.parent_id, n.area FROM nodes n JOIN up ON n.id = up.parent_id)
       SELECT area FROM up WHERE parent_id IS NULL), $6))`,
    [day, now(), kind, nodeId, text, area],
  )
}

export async function journalBetween(from, to) {
  return (await db()).select('SELECT id, day, at, kind, node_id, text, area FROM journal WHERE day BETWEEN $1 AND $2 ORDER BY at', [from, to])
}

export async function deleteJournal(id) {
  await (await db()).execute("DELETE FROM journal WHERE id = $1 AND kind = 'notiz'", [id])
}

export async function settingsLike(prefix) {
  return (await db()).select('SELECT key, value FROM settings WHERE substr(key, 1, length($1)) = $1', [prefix])
}

export async function deleteSetting(key) {
  await (await db()).execute('DELETE FROM settings WHERE key = $1', [key])
}

export async function setSetting(key, value) {
  await (await db()).execute(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  )
}

// Für die Statistik: Feldwechsel aus dem Verlauf und Erledigt-Einträge aus dem Tagebuch
export async function doneEvents() {
  const c = await db()
  return {
    changes: await c.select("SELECT node_id, text, created_at FROM activity WHERE kind = 'change' AND text LIKE '%→%'"),
    journal: await c.select("SELECT node_id, at FROM journal WHERE kind = 'erledigt'"),
  }
}

// Ganzer Knoten mit fester ID (Import einer Nexora-Datei); andere Fenster laden danach neu
export async function insertNode(n) {
  await (await db()).execute(
    `INSERT INTO nodes (id, parent_id, kind, title, icon, color, cover, locked, template, body, plain, props, config, sort, favorite, area, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      n.id, n.parent_id, n.kind, n.title ?? '', n.icon ?? null, n.color ?? null, n.cover ?? null, n.locked ? 1 : 0, n.template ? 1 : 0,
      n.body ?? '', searchText(n.body), encode('props', n.props), encode('config', n.config), Number(n.sort) || 0, n.favorite ? 1 : 0,
      n.area ?? null, n.created_at ?? now(), now(),
    ],
  )
}

export async function insertActivity(a) {
  await (await db()).execute('INSERT INTO activity (node_id, kind, text, created_at) VALUES ($1, $2, $3, $4)', [a.node_id, a.kind, String(a.text ?? ''), a.created_at ?? now()])
}

export const nodesChanged = () => changed()
