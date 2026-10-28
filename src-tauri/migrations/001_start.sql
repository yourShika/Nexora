-- Ein Baum für alles: Notizbuch > Abschnitt > Seite > Unterseite.
-- UUIDs und updated_at/deleted_at, damit ein späterer Server-Abgleich ohne Umbau geht.
CREATE TABLE nodes (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT REFERENCES nodes(id),
  kind       TEXT NOT NULL CHECK (kind IN ('notebook', 'section', 'page')),
  title      TEXT NOT NULL DEFAULT '',
  icon       TEXT,
  color      TEXT,
  body       TEXT NOT NULL DEFAULT '',
  sort       REAL NOT NULL DEFAULT 0,
  favorite   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  opened_at  TEXT,
  deleted_at TEXT
);
CREATE INDEX nodes_parent ON nodes(parent_id, sort);

INSERT INTO nodes (id, parent_id, kind, title, color, sort) VALUES
  ('7d1f3c2a-0b6e-4c55-9a1e-3f0d2b8c4e01', NULL, 'notebook', 'Mein Notizbuch', 'petrol', 1);
INSERT INTO nodes (id, parent_id, kind, title, sort) VALUES
  ('7d1f3c2a-0b6e-4c55-9a1e-3f0d2b8c4e02', '7d1f3c2a-0b6e-4c55-9a1e-3f0d2b8c4e01', 'section', 'Erste Schritte', 1);
INSERT INTO nodes (id, parent_id, kind, title, body, sort) VALUES
  ('7d1f3c2a-0b6e-4c55-9a1e-3f0d2b8c4e03', '7d1f3c2a-0b6e-4c55-9a1e-3f0d2b8c4e02', 'page', 'Willkommen',
   '## So funktioniert der Editor

Tippe `/` am Anfang einer Zeile, um einen Block einzufügen: Überschrift, Liste, Checkliste, Code, Tabelle.

- [ ] Eine Seite anlegen
- [ ] Mit `/` eine Checkliste einfügen
- [ ] Einen Codeblock ausprobieren

```powershell
Get-Service | Where-Object Status -eq Running
```

Gespeichert wird automatisch bei jeder Änderung.', 1);
