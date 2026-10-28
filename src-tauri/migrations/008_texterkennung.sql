-- Erkannter Text aus Bildern ("bilder/<uuid>.png"). Die Suche findet darüber jede Seite, in der das Bild steckt.
-- Leerer Text heißt: schon versucht, nichts gefunden.
CREATE VIRTUAL TABLE ocr USING fts5(file UNINDEXED, text, tokenize = 'trigram remove_diacritics 1');
