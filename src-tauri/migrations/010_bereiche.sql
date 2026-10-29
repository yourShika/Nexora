-- Bereiche Arbeit/Privat. Der Bereich hängt am obersten Knoten (Notizbuch oder Punkt im Eingang),
-- alles darunter erbt ihn. NULL = Arbeit.
ALTER TABLE nodes ADD COLUMN area TEXT;
-- Tagebuch merkt sich den Bereich beim Eintragen, damit Einträge gelöschter Seiten und Notizen richtig bleiben
ALTER TABLE journal ADD COLUMN area TEXT;
