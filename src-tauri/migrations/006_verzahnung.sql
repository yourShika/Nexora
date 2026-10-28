-- Seiten, die als Vorlage dienen
ALTER TABLE nodes ADD COLUMN template INTEGER NOT NULL DEFAULT 0;

-- Verlauf je Punkt: Feldänderungen und Kommentare
CREATE TABLE activity (
  id         INTEGER PRIMARY KEY,
  node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('change', 'comment')),
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX activity_node ON activity(node_id, created_at);
