-- Volltextsuche über Titel, Inhalt und Feldwerte.
-- trigram findet auch Wortteile ("chang" in "Exchange"), remove_diacritics: "muller" findet "Müller".
CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED, title, body, extra, tokenize = 'trigram remove_diacritics 1');

INSERT INTO search (id, title, body, extra)
  SELECT id, title, body, CASE WHEN json_valid(props) THEN (SELECT group_concat(value, ' ') FROM json_each(props)) END FROM nodes;

CREATE TRIGGER search_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO search (id, title, body, extra)
  VALUES (new.id, new.title, new.body, CASE WHEN json_valid(new.props) THEN (SELECT group_concat(value, ' ') FROM json_each(new.props)) END);
END;

CREATE TRIGGER search_au AFTER UPDATE OF title, body, props ON nodes BEGIN
  DELETE FROM search WHERE id = old.id;
  INSERT INTO search (id, title, body, extra)
  VALUES (new.id, new.title, new.body, CASE WHEN json_valid(new.props) THEN (SELECT group_concat(value, ' ') FROM json_each(new.props)) END);
END;

CREATE TRIGGER search_ad AFTER DELETE ON nodes BEGIN
  DELETE FROM search WHERE id = old.id;
END;
