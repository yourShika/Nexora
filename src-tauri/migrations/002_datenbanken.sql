-- Datenbanken (LOP-Listen) und ihre Punkte leben im selben Baum.
-- props: Feldwerte eines Punkts (JSON), config: Felder und Ansicht einer Datenbank (JSON).
-- SQLite kann CHECK nicht ändern, darum Neuaufbau der Tabelle.
CREATE TABLE nodes_new (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT REFERENCES nodes_new(id),
  kind       TEXT NOT NULL CHECK (kind IN ('notebook', 'section', 'page', 'database', 'row')),
  title      TEXT NOT NULL DEFAULT '',
  icon       TEXT,
  color      TEXT,
  body       TEXT NOT NULL DEFAULT '',
  props      TEXT,
  config     TEXT,
  sort       REAL NOT NULL DEFAULT 0,
  favorite   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  opened_at  TEXT,
  deleted_at TEXT
);
INSERT INTO nodes_new (id, parent_id, kind, title, icon, color, body, sort, favorite, created_at, updated_at, opened_at, deleted_at)
  SELECT id, parent_id, kind, title, icon, color, body, sort, favorite, created_at, updated_at, opened_at, deleted_at FROM nodes;
DROP TABLE nodes;
ALTER TABLE nodes_new RENAME TO nodes;
CREATE INDEX nodes_parent ON nodes(parent_id, sort);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
