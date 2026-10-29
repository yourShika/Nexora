-- Zeichnungs-Blöcke stehen mitten im Text normaler Seiten. Damit der Text dahinter durchsuchbar bleibt,
-- schreibt Nexora beim Speichern eine Fassung ohne Strich-Zeilen mit (plain, nur wenn es Striche gibt).
-- Ohne plain gilt wie bisher der Text bis zum ersten Strich (Migration 007).
ALTER TABLE nodes ADD COLUMN plain TEXT;
DROP TRIGGER search_ai;
DROP TRIGGER search_au;

CREATE TRIGGER search_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO search (id, title, body, extra)
  VALUES (new.id, new.title,
    COALESCE(new.plain, CASE WHEN instr(new.body, char(10) || '<!-- ink ') > 0 THEN substr(new.body, 1, instr(new.body, char(10) || '<!-- ink ') - 1) ELSE new.body END),
    CASE WHEN json_valid(new.props) THEN (SELECT group_concat(value, ' ') FROM json_each(new.props)) END);
END;

CREATE TRIGGER search_au AFTER UPDATE OF title, body, props, plain ON nodes BEGIN
  DELETE FROM search WHERE id = old.id;
  INSERT INTO search (id, title, body, extra)
  VALUES (new.id, new.title,
    COALESCE(new.plain, CASE WHEN instr(new.body, char(10) || '<!-- ink ') > 0 THEN substr(new.body, 1, instr(new.body, char(10) || '<!-- ink ') - 1) ELSE new.body END),
    CASE WHEN json_valid(new.props) THEN (SELECT group_concat(value, ' ') FROM json_each(new.props)) END);
END;
