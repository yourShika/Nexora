# Nexora

Notizen, LOP-Listen und Runbooks in einer schlanken Desktop-App für Windows.
Notizbücher wie in OneNote, ein Block-Editor wie in Notion, Codeblöcke mit Farben, alles lokal in einer SQLite-Datei.

Der Plan mit allen Ausbaustufen steht in [docs/PLAN.md](docs/PLAN.md).

## Entwickeln

Voraussetzungen: Node 24, Rust (stable, MSVC), Visual Studio Build Tools mit C++ und Windows SDK, WebView2 (in Windows 11 enthalten).

```bash
npm install
npm run app
```

`npm run app` startet die Testversion „Nexora Test“ mit eigenem Datenordner (`%APPDATA%\de.nexora.notizen.dev`), damit Tests nie die Daten eines installierten Nexora berühren.

Installer bauen (landet unter `src-tauri/target/release/bundle/nsis`):

```bash
npm run tauri build
```

## Neue Version veröffentlichen

1. Version in `package.json`, `src-tauri/Cargo.toml` und `src-tauri/tauri.conf.json` gleich hochsetzen.
2. Einmalig `gh auth login` ausführen, falls die GitHub-Kommandozeile noch nicht angemeldet ist.
3. Bauen und veröffentlichen:

```bash
npm run release -- --publish "Was neu ist"
```

Das Skript baut den Installer, signiert ihn mit `%USERPROFILE%\.nexora\updater.key` und legt ihn zusammen mit `latest.json` als GitHub-Release ab. Eine Kopie der aktuellen Installer liegt danach im Projekt unter `installer\` (nicht im Repo).

Es gibt zwei Installer:
- `Nexora_<Version>_x64-setup.exe`: für den eigenen PC, ohne Adminrechte, nur für den angemeldeten Benutzer.
- `Nexora_<Version>_x64_de-DE.msi`: für die Verteilung per GPO oder Intune, für alle Benutzer unter „Programme“. Installation und Updates brauchen Adminrechte.

Jede Installation holt ihre Updates im eigenen Format. Beide nutzen denselben Datenordner pro Benutzer, sollten aber nicht gleichzeitig auf einem PC installiert sein. Laufende Installationen finden das Update innerhalb von 6 Stunden oder sofort über „Nach Updates suchen“.

**Den Schlüssel `updater.key` sicher aufbewahren** (zum Beispiel im Passworttresor). Ohne ihn lassen sich keine Updates mehr signieren, und vorhandene Installationen müssten von Hand neu installiert werden.

## Daten

Alles liegt in `%APPDATA%\de.nexora.notizen\nexora.db`, eingefügte Bilder daneben im Ordner `bilder`. Seiteninhalte sind Markdown, damit sie auch ohne die App lesbar bleiben.
Schließen versteckt das Fenster ins Tray, beenden geht über das Tray-Menü.

## Sicherung wiederherstellen

Die Sicherung (Einstellungen, Abschnitt Sicherung) legt im Zielordner `nexora-JJJJ-MM-TT_HHMMSS.db` und einen Ordner `bilder` ab.

1. Nexora über das Tray-Menü beenden.
2. Im Datenordner `nexora.db` umbenennen (zum Beispiel in `nexora-alt.db`), ebenso `nexora.db-wal` und `nexora.db-shm`, falls vorhanden (`nexora-alt.db-wal` usw.). Bleiben die beiden unter altem Namen liegen, würde SQLite sie auf die zurückgeholte Datei anwenden.
3. Die gewünschte Sicherung als `nexora.db` in den Datenordner kopieren.
4. Fehlende Bilder aus dem Sicherungsordner `bilder` in den Datenordner `bilder` kopieren.
5. Nexora starten.
