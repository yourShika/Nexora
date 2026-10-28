# Nexora – Plan

Eine schlanke Desktop-App: Notion + Notepad + Code + OneNote, ohne Ballast.
Name: Nexora.

Stand: 2026-10-27.

## Rahmen

- Selbst gebaut, Desktop-App mit **Tauri 2** (Oberfläche React 19 + Vite + Tailwind 4 + Phosphor-Icons + Geist)
- Erstmal nur ein Nutzer, Team-Funktionen später (Stufe 5)
- Speicher: **SQLite**, Seiteninhalt als **Markdown**; Bilder als Dateien im Datenordner
- Editor: **Block-Editor wie Notion** (TipTap), speichert Markdown
- Code: Snippets mit Farben **und Ausführen** (PowerShell 5.1/7, CMD, Python – nur was installiert ist)
- Repo: **öffentlich auf GitHub**, Updates über GitHub-Releases (signiert); keine Firmendaten im Code
- Jede Zeile bekommt eine UUID und `updated_at`, damit der spätere Server-Abgleich ohne Umbau geht

## Grundentscheidungen

- **Datenbanken sind die Grundlage.** Die LOP ist eine fertige Vorlage einer Datenbank, eigene Felder sind überall möglich.
  - Feldtypen: Text, Zahl, Auswahl, Mehrfachauswahl, Datum/Zeitraum, Person, Checkbox, Link, Verweis
  - Ansichten: Liste, Tabelle, Kanban, Kalender, Zeitleiste (Gantt)
  - Jeder Punkt ist auch eine Seite
- **Zwei Seitenarten:** *Fluss* (wie Notion) und *Frei* (wie OneNote, Kästen überall; jeder Kasten kann alles). Zeichnungen liegen auf derselben Fläche; der Zeichnungs-Block ist eine kleine freie Fläche.
- **Sicherung:** Nutzer stellt ein, wann, wohin, wie viele Stände. Online-Modus später: Server hält alles, lokale Kopie für offline.
- **OneNote-Brücke über installiertes OneNote (COM)**, beide Richtungen, nur für verbundene Notizbücher. Unbekanntes bleibt unangetastet, Konflikt = beide Fassungen, nie automatisch löschen. Erst mit Testnotizbuch.
- **Outlook-Kalender:** Fälligkeiten → eigener Kalender, Outlook-Termine → Heute/Kalender/Zeitleiste. Weg (COM oder Graph) noch offen.
- **Vaultwarden** über Bitwarden-CLI: Verweis auf Eintrag, Passwort kopieren (Zwischenablage leert sich nach 30 s), Runbook-Platzhalter `{{vault:Name}}`. Kein Geheimnis wird gespeichert.
- Stift erstmal nur Maus, Druckstärke später.
- Nicht drin: KI, Konto/Abo, Telemetrie, Echtzeit-Zusammenarbeit (vor Stufe 5), Plugin-Store, Notion-Formeln, Web-Clipper, Mobile App, LOP-Export.

## Features (Nummern wie im Gespräch)

**Gedächtnis & LOP:** 1 Schnellerfassung per Hotkey (Strg+Alt+Leertaste) · 2 Kurzsyntax (`#tag @person !hoch fr`) · 3 Eingang · 4 Felder · 5 Status mit Farben · 6 Liste/Tabelle/Kanban · 7 Heute · 8 Windows-Erinnerungen · 10 LOP in Seite einbetten (deckt 9 mit ab) · 11 Verlauf je Punkt · 13 wiederkehrende Punkte

**Seiten:** 14 Notizbuch → Abschnitt → Seite → Unterseite · 15 Block-Editor · 16 Autosave · 17 Favoriten/Zuletzt · 18 Papierkorb + Versionsverlauf · 19 Seitenlinks `[[` · 20 Vorlagen · 21 eigenes Fenster (Einstellung: nie/immer/Strg+Klick) · 22 Datenbanken

**Notepad:** 23 Schmierzettel · 24 Tray + Sofortstart · 25 Einfügen ohne Formatierung · 26 .txt/.md/.log importieren

**OneNote:** 27 Bilder per Strg+V · 28 Anhänge (+ OneNote-Brücke) · 29 Texterkennung in Bildern · 30 Zeichnung · 31 Freie Seite

**Code:** 33 Codeblöcke mit Farben · 34 Snippet-Übersicht · 35 Ausführen · 36 Platzhalter · 37 Ausgabe-Protokoll · 38 Als Admin

**Suche & Bedienung:** 39 Strg+K · 40 Volltext mit Filtern · 41 Tastenkürzel · 42 Hell/Dunkel/System · 43 Tags

**Daten:** 44 eine Datei + Bilderordner · 45 Sicherung (frei einstellbar) · 46 Markdown-Export · 47 Import/Bestand · 48 Updates über GitHub

**Team (später):** 49 Server per Arcane + Entra · 50 Teilen, Kollegen zuweisen

**Wieder drin:** Zeitleiste/Gantt · Outlook-Kalender · Vaultwarden · Cover-Bilder und Emojis

**Neu gewählt:** 52 Unterpunkte mit Fortschritt · 53 Checklisten-Vorlagen erzeugen mehrere Punkte · 54 Abhängigkeiten · 55 „Wartet auf“-Nachhaken per Mail-Entwurf · 56 Arbeitstagebuch · 57 Wochenrückblick · 58 Statistik als Diagramme · 59 Zwischenablage → Eingang · 60 Snippet-Picker überall · 61 Passwort-Warnung beim Einfügen · 62 klickbare Admin-Links (UNC, Pfad, rdp, ssh) · 65 Mermaid-Diagramme · 66 Runbook-Ausgabe als Tabelle · 67 Versionen vergleichen · 68 Seite sperren · 69 Fokus-Modus · 70 Seite drucken/PDF · 71 getrennte Bereiche (Arbeit/Privat)

## Ausbaustufen

| Stufe | Inhalt | Nummern |
|---|---|---|
| 1 – Gedächtnis | Tray, Hotkey, Schnellerfassung, Eingang, Datenbanken mit LOP-Vorlage, Liste/Tabelle/Kanban, Heute, Erinnerungen, Seitenbaum, Block-Editor, Schmierzettel, Bilder, Code-Farben, Suche, Sicherung, Updates, Emojis/Cover | 1–8, 14–18, 22–25, 27, 33, 39–45, 48 |
| 2 – Runbooks & Verzahnung | Ausführen, Platzhalter, Admin, Protokoll, Snippet-Übersicht, eingebettete Listen, Verlauf, Seitenlinks, Vorlagen, Anhänge, Import/Export | 10, 11, 19, 20, 26, 28, 34–38, 46 |
| 3 – Freie Seiten & Planung | Freie Seite, Zeichnen, Texterkennung, eigene Fenster, Kalender, Zeitleiste, Wiederholungen | 13, 21, 29–31 |
| 4 – Brücken | OneNote, Outlook, Vaultwarden | 47 + Brücken |
| 5 – Team | Server, Entra, Teilen, Zuweisen | 49, 50 |

Die neuen Nummern 52–71 werden beim Bau der passenden Stufe eingeordnet.

## Stand

- **0.1.0:** Seitenbaum, Block-Editor mit `/`-Menü, Codeblöcke, Autosave, Favoriten, Papierkorb, Tray, Hell/Dunkel
- **0.2.0:** LOP-Listen als Datenbanken (Tabelle, Liste, Kanban, eigene Felder, Nummern), Punkt als Seite mit Eigenschaften, Eingang mit Zuteilen, Heute, Schnellerfassung per Hotkey mit Kurzsyntax, Einstellungen (Hotkey, Darstellung)
- Hotkey ist einstellbar: Strg+Alt+Leertaste war auf dem Dev-PC schon von einem anderen Programm belegt
- **0.3.0:** Suche mit Strg+K (Titel, Seiteninhalt inkl. Code, Feldwerte; Wortteile, Umlaute egal; Filter `#tag @person status: in:`; Befehle; zuletzt geöffnet), Uhrzeiten in Kurzsyntax und Datumsfeldern (`fr 14:00`, `14 Uhr`), Windows-Erinnerungen (Sammelmeldung morgens, Uhrzeit-Meldungen), Autostart versteckt im Tray (im fertigen Programm beim ersten Start an)
- **0.4.0:** Bilder per Strg+V oder Ziehen (Datei in `bilder\`, im Markdown `![|400](bilder/<uuid>.png)` wie in Obsidian), Größe an Griffen ändern, Doppelklick zeigt groß; Sicherung mit Zielordner, Intervall (1 h, 4 h, täglich, wöchentlich) und Anzahl Stände, „Jetzt sichern“, Wiederherstellen siehe README
- **0.5.0:** Umbenannt in Nexora; Installer (NSIS, ohne Admin) und Updates über GitHub-Releases (48), signiert, Hinweis in der Seitenleiste, „Nach Updates suchen“ in den Einstellungen
- **0.6.0 (Stufe 1 fertig):** Symbol (Emoji) und Titelbild für Seiten, Listen, Abschnitte, Notizbücher; Versionsverlauf je Seite (höchstens alle 10 Minuten, 90 Tage) mit farbigem Vergleich (67) und Wiederherstellen; Blöcke per Griff ziehen; Seitenbaum per Ziehen umsortieren und verschieben; ungenutzte Bilder aufräumen; behoben: Bilder beim allerersten Start nicht sichtbar; Testversion mit eigenem Datenordner (`npm run app`)
- **0.7.0 (Stufe 2, Teil Runbooks):** Ausführen von PowerShell 5.1/7, CMD und Python direkt per Klick (35), Live-Ausgabe mit Abbrechen, Platzhalter `{{Name}}` mit gemerkten Werten (36), „Ins Protokoll“ hängt Ausgabe mit Datum und Exit-Code an die Seite (37), Als Admin über UAC (38), Ausgabe als sortier-/filterbare Tabelle (66), Snippet-Übersicht (34), Seite sperren (68)
- **0.8.0 (Stufe 2, Teil Verzahnung):** Seitenlinks mit `[[` (`[[Titel|id]]`, zeigt immer den aktuellen Titel) und Rückverweise unter dem Titel (19); LOP-Liste in Seite einbetten `[[lop:id]]` mit Anlegen und Abhaken (10, deckt 9 ab); Verlauf je Punkt mit Feldänderungen und Kommentaren (11); Vorlagen mit `{{Datum}}` (20); Checkliste als LOP-Punkte mit Stichtag und `-3`/`+2` (53); flüssigere Animationen
- **0.8.1:** zusätzlich MSI-Installer (GPO/Intune), getrennte Update-Kanäle für exe und msi
- **0.9.0 (Stufe 2 fertig):** Anhänge per Ziehen, Einfügen oder `/` „Datei anhängen“ (`[[datei:uuid/Name|Bytes]]`, ausführbare Dateien nur „im Ordner zeigen“) (28); .txt/.md/.log importieren per Rechtsklick oder Ziehen auf den Baum, alte ANSI-Dateien werden erkannt (26); Markdown-Export eines Zweigs oder von allem, mit Bildern, Anhängen und relativen Links (46); Sicherung nimmt Anhänge mit
- **0.10.0 (Stufe 3, Teil Planung):** Kalender als Ansicht jeder Liste und über alle Listen (Seitenleiste), Ziehen verschiebt Termine, „+“ legt am Tag an; Zeitleiste (Gantt) mit Beginn bis Fällig, Ziehen und Ränder ziehen, Zoom Tage/Wochen/Monate; Abhängigkeiten (54) mit Pfeilen, rot bei Konflikt; wiederkehrende Punkte (13) mit `*monatlich` usw., beim Abhaken entsteht der nächste Termin
- Rest von Stufe 3: Freie Seite (31), Zeichnen (30), Texterkennung (29), eigene Fenster (21)

## Offen

- Outlook über installiertes Outlook (COM) oder Microsoft 365 (Graph)?
- Bestand außer OneNote (Textdateien, Word, Notion, Wiki)?
- GitHub-Konto/Repo-Name für das öffentliche Repo
