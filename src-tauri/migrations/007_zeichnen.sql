-- Striche auf freien Seiten stehen als "<!-- ink … -->"-Zeilen am Ende des Inhalts.
-- Die Suche nimmt nur den Text davor, sonst träfen Zahlen wie "123" jede Zeichnung.
DROP TRIGGER search_ai;
DROP TRIGGER search_au;

CREATE TRIGGER search_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO search (id, title, body, extra)
  VALUES (new.id, new.title,
    CASE WHEN instr(new.body, char(10) || '<!-- ink ') > 0 THEN substr(new.body, 1, instr(new.body, char(10) || '<!-- ink ') - 1) ELSE new.body END,
    CASE WHEN json_valid(new.props) THEN (SELECT group_concat(value, ' ') FROM json_each(new.props)) END);
END;

CREATE TRIGGER search_au AFTER UPDATE OF title, body, props ON nodes BEGIN
  DELETE FROM search WHERE id = old.id;
  INSERT INTO search (id, title, body, extra)
  VALUES (new.id, new.title,
    CASE WHEN instr(new.body, char(10) || '<!-- ink ') > 0 THEN substr(new.body, 1, instr(new.body, char(10) || '<!-- ink ') - 1) ELSE new.body END,
    CASE WHEN json_valid(new.props) THEN (SELECT group_concat(value, ' ') FROM json_each(new.props)) END);
END;
