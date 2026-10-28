-- Gesperrte Seiten lassen sich lesen und ausführen, aber nicht bearbeiten (z. B. fertige Runbooks)
ALTER TABLE nodes ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
