-- Arbeitstagebuch: was an welchem Tag passiert ist (automatisch) und eigene Zeilen
CREATE TABLE journal (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  day     TEXT NOT NULL,               -- JJJJ-MM-TT, Ortszeit
  at      TEXT NOT NULL,               -- Zeitpunkt (ISO)
  kind    TEXT NOT NULL,               -- erledigt | angelegt | bearbeitet | ausgefuehrt | nachgehakt | notiz
  node_id TEXT,
  text    TEXT NOT NULL DEFAULT ''     -- Titel zum Zeitpunkt (bleibt lesbar, wenn die Seite gelöscht wird)
);
CREATE INDEX journal_day ON journal(day);
