-- Titelbild einer Seite ("bilder/<uuid>.png", wie im Markdown)
ALTER TABLE nodes ADD COLUMN cover TEXT;

-- Versionsverlauf: vor einer Änderung wird der alte Stand gesichert, höchstens alle 10 Minuten je Seite
CREATE TABLE versions (
  id         INTEGER PRIMARY KEY,
  node_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX versions_node ON versions(node_id, created_at);

CREATE TRIGGER versions_snapshot AFTER UPDATE OF body ON nodes
WHEN old.body <> new.body AND NOT EXISTS (
  SELECT 1 FROM versions WHERE node_id = old.id AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes')
)
BEGIN
  INSERT INTO versions (node_id, title, body) VALUES (old.id, old.title, old.body);
END;
