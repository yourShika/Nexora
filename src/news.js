// Neuigkeiten je Version für das Fenster „Neu in Nexora“ (nach jedem Update einmal, sonst über die Benutzer-Anzeige).
// Neueste zuerst; **fett** wird hervorgehoben. Bei jedem Release oben ergänzen.
export const NEWS = [
  {
    version: '0.31.0',
    date: '2026-10-30',
    title: 'OneNote',
    items: [
      'OneNote wird **im Hintergrund** abgeglichen: von Hand zeigt ein kleines Fenster unten rechts den **Fortschritt** mit Abbrechen, Nexora bleibt bedienbar.',
      '**Automatisch** kurz nach dem Start und dann alle 30 Minuten, still; einstellbar unter Einstellungen → OneNote.',
      'Abschnittsgruppen werden **Ordner in Ordnern**. Früher flach übernommene Notizbücher („Gruppe / Abschnitt“) baut der erste Abgleich um, vorher legt Nexora eine **Sicherung** im Datenordner an.',
      'Seiten **näher am Original**: Schriftfarbe, Hervorhebung, Schriftart und -größe, **eingefügte Dateien** als Anhang, **Freihand** als Zeichnung. Alle Seiten werden dafür einmal neu übernommen.',
      '**Lesemodus** je Seite: „…“ → „Als fließende Seite lesen“ stellt die Kästen untereinander.',
      'In der Seitenleiste: **Abschnittsfarben** wie in OneNote, Stand des Abgleichs am Notizbuch, Schloss bei kennwortgeschützten Abschnitten.',
    ],
  },
  {
    version: '0.30.0',
    date: '2026-10-29',
    title: 'Bedienung & Verlauf',
    items: [
      '**Strg+Z** macht jetzt auch Änderungen außerhalb des Textes rückgängig: Löschen, Verschieben, Umbenennen, neue Seiten und Punkte, Status und Felder. **Strg+Y** stellt sie wieder her.',
      'Nach dem Löschen erscheint unten ein Hinweis mit **„Rückgängig“**.',
      '**Mehrere Zuständige** je Punkt: im Feld „Zuständig“ mehrere Personen ankreuzen oder in der Kurzsyntax mehrere **@Namen** tippen.',
      'Seiten und LOP-Listen können jetzt **direkt im Notizbuch** liegen, ohne Abschnitt (Rechtsklick auf das Notizbuch).',
      'Unten in der Seitenleiste steht dein **Name**. Klick oder Rechtsklick darauf: Neuigkeiten, Papierkorb, Einstellungen, Nach Updates suchen. Name und Farbe unter Einstellungen → Allgemein.',
      'Der **Verlauf** einer Seite (Uhr oben rechts) zeigt jetzt auch Umbenennen, Verschieben, Sperren, Löschen und geänderte Felder, und je Fassung, wie viele Zeilen dazukamen oder wegfielen.',
    ],
  },
  {
    version: '0.29.0',
    date: '2026-10-29',
    title: 'Reiter & Statistik',
    items: [
      'Alle offenen Seiten stehen oben als **Reiter wie im Browser**. Mittelklick oder „+“ öffnet einen neuen Reiter, Strg+W schließt, Strg+Tab wechselt.',
      'Reiter **anpinnen** (Rechtsklick), aus dem Fenster **herausziehen** öffnet die Seite in einem eigenen Fenster. Nach dem Neustart sind alle Reiter wieder da.',
      'Die **Statistik** lässt sich auf einzelne LOP-Listen und einen Zeitraum beschränken.',
      'Unter „Anpassen“ Bausteine **ein- und ausblenden**, **umordnen** und **eigene Diagramme** hinzufügen.',
    ],
  },
  {
    version: '0.28.0',
    date: '2026-10-29',
    title: 'Oberfläche',
    items: [
      '**Eigene Titelleiste** mit den Reitern darin; kurz auf „Maximieren“ zeigen öffnet die Snap-Layouts.',
      'Der **Kalender** zeigt Outlook-Termine wie Outlook (Anzeigen als, Kategorien) und LOP-Punkte nach Priorität.',
      'Eigene Auswahl für **Datum, Uhrzeit, Emojis** (/Emoji), Aufklapplisten und Farben.',
      'Weiche **Übergänge** beim Seitenwechsel; falls Windows die Animationen abschaltet: Einstellungen → Aussehen → Bewegung → Immer.',
      '**Personen** für „Zuständig“ als Liste mit Farben (Einstellungen → Personen).',
    ],
  },
  {
    version: '0.27.0',
    date: '2026-10-29',
    title: 'Bugs & Kleinigkeiten',
    items: [
      'Seiten als **Reiter oben anpinnen**.',
      'Listen **sortieren** mit mehreren Ebenen, je Ansicht gemerkt.',
      'Nach einem Update erscheint das Fenster wieder; Änderungen von außen werden beim Zurückkehren ins Fenster nachgeladen.',
      'Behoben: „…“-Menü außerhalb des Fensters, leerer Bereich am Ende der Statistik.',
    ],
  },
  {
    version: '0.26.0',
    date: '2026-10-29',
    title: 'Inhalte',
    items: [
      '**Bilder bearbeiten** wie mit Greenshot (Rechtsklick auf ein Bild).',
      '**Diagramme** in Notizen mit /Diagramm.',
      '**Vorschau** von PDF, Word, Excel und PowerPoint als Seiten in der Notiz.',
    ],
  },
  {
    version: '0.25.0',
    date: '2026-10-29',
    title: 'Aussehen',
    items: ['**Farbschemata** mit und ohne Verlauf, eigene Farben, Schriftgröße und -art, Dichte, Breite, Ecken.', 'Einstellungen nach **Kategorien mit Suche**; Seitenleiste in der Breite ziehbar und einklappbar.'],
  },
  {
    version: '0.24.0',
    date: '2026-10-29',
    title: 'Listen & Struktur',
    items: ['Zeilen in Listen **ziehen**, Spaltenbreiten ändern.', '**Abschnitte in Abschnitten**.', 'Notizbücher als **Nexora-Datei** speichern und importieren.', 'Updates still beim Start.'],
  },
]
