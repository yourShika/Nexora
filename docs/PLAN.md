# Nexora – Plan

Eine schlanke Desktop-App: Notion + Notepad + Code + OneNote, ohne Ballast.
Name: Nexora.

Stand: 2026-10-29.

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
- **0.11.0 (Stufe 3, Teil freie Seite):** Freie Seite wie OneNote (31): Klick auf leere Fläche legt einen Kasten an, jeder Kasten ist ein vollwertiger Editor (Code ausführen, Bilder, Anhänge, Links, LOP), Kästen verschieben und Breite ziehen, Fläche wächst nach rechts und unten mit, leere Kästen verschwinden; „Neue freie Seite“ im Rechtsklick-Menü, Umwandeln in beide Richtungen im „…“-Menü (vorher wird eine Version gesichert). Gespeichert als Markdown mit unsichtbaren Positionszeilen (`<!-- box x= y= w= -->`), daher laufen Suche, Verlauf, Links, Vorlagen und Export unverändert
- **0.12.0 (Stufe 3, Teil Zeichnen):** Zeichnen auf der freien Seite (30): Stift, Textmarker, Linie, Pfeil, Rechteck, Ellipse, Radierer für ganze Striche, 6 Farben (Textfarbe passt sich Hell/Dunkel an), 3 Stärken, Strg+Z, Esc zurück zum Schreiben; Zoom 50–200 % mit Strg+Mausrad oder Leiste, der Punkt unter der Maus bleibt stehen. Striche stehen als `<!-- ink … -->`-Zeilen am Ende des Inhalts (Verlauf, Vorlagen, Sicherung nehmen sie mit), die Suche ignoriert sie (Migration 007), im Verlauf erscheinen sie als „✎ Stift“ usw., im Markdown-Export sind sie unsichtbar
- Später: Zeichnungs-Block in normalen Seiten, Lasso, Druckstärke, Zeichnung im Export als SVG
- **0.13.0 (Stufe 3, Teil Fenster):** Eigene Fenster für Seiten und Punkte (21): Strg+Klick (einstellbar: nie, Strg+Klick, immer), Rechtsklick und „…“-Menü; das Seitenfenster zeigt nur die Seite, Links und Suche darin öffnen im Hauptfenster; das Hauptfenster zeigt für die Seite „Fenster zeigen“/„Hierher holen“, damit dieselbe Seite nie doppelt bearbeitet wird; Titel und Listen gleichen sich zwischen den Fenstern ab; Pin „Immer im Vordergrund“; offene Fenster kommen nach dem Neustart mit Position, Größe und Pin wieder (Position nur, wenn der Bildschirm noch da ist)
- **0.14.0 (Stufe 3 fertig):** Texterkennung in Bildern (29) mit der in Windows eingebauten OCR (offline, Sprachen wie in Windows installiert): neue Bilder sofort im Hintergrund, vorhandene einmalig nach dem Start; Strg+K findet Text in Bildern („Im Bild: …“); Rechtsklick auf ein Bild: „Text aus dem Bild kopieren“ und „Text unter dem Bild einfügen“. Erkannter Text in eigener Suchtabelle (Migration 008)
- **0.15.0 (Stufe 4, OneNote-Brücke Teil 1, nur lesen):** OneNote-Notizbuch über das installierte OneNote (COM, festes PowerShell-Skript, nur Lesebefehle) verbinden; Abschnitte, Abschnittsgruppen („Gruppe / Abschnitt“) und Unterseiten; Seiten werden freie Seiten mit Kästen an der OneNote-Position; übernommen: Überschriften, Fett/Kursiv/Durchgestrichen, Links, Listen, Aufgaben als Checklisten, Tabellen, Bilder (danach durchsuchbar); Freihand, Audio und eingebettete Dateien als Hinweis. Abgleich per Knopf: Änderungen am Inhalt erkennt Nexora über eine Prüfsumme (OneNote setzt den Zeitstempel der Seite nicht verlässlich); in Nexora unverändert → ersetzen (alte Fassung im Verlauf), in beiden geändert → OneNote-Fassung als eigene Seite daneben; in OneNote gelöschte Seiten bleiben; verbundene Seiten sind gesperrt
- **0.16.0 (Stufe 4, Vaultwarden):** Tresor über die Bitwarden-CLI (bw, per winget): Anmelden einmal im Terminal, Nexora entsperrt mit dem Master-Passwort (nur per Umgebungsvariable an bw), Sitzung nur im Speicher, sperrt sich nach 15 Minuten (einstellbar) und beim Beenden; „/Tresor-Eintrag“ fügt einen Verweis `[[vault:id|Name]]` ein (nur ID und Name gespeichert) mit Knöpfen Benutzer/Passwort kopieren; Passwort in der Zwischenablage nach 30 s gelöscht und vom Windows-Verlauf und Cloud-Abgleich ausgenommen; Runbooks: `{{vault:Name}}` (Passwort) und `{{vault:Name:benutzer}}`, eingesetzt in Rust, Passwörter in Ausgabe und Protokoll als ••••••; Passwörter erreichen die Oberfläche nie
- **0.17.0 (Stufe 4, Outlook):** über das installierte klassische Outlook (COM, festes PowerShell-Skript), in den Einstellungen einzuschalten: offene Punkte mit Fälligkeit als Termine im eigenen Kalender „Nexora“ (ohne Uhrzeit ganztägig, mit Uhrzeit 30 Minuten, ohne Erinnerung, als frei, Kategorie „Nexora“); Änderungen und Erledigt werden nachgezogen, andere Kalender fasst Nexora nicht an; Outlook-Termine (eine Woche zurück bis zwei Monate voraus) in Heute und im Gesamtkalender, nur angezeigt, nicht gespeichert; Abgleich alle 15 Minuten, 10 s nach Änderungen und per Knopf. Testversion arbeitet nur mit „Nexora-Test“
- **0.18.0 (Stufe 5, Schritt 1):** Nexora-Server im Ordner `server/` (ein Container ohne npm-Abhängigkeiten: Gesundheitsseite, Anmeldeangaben, Prüfung der Entra-Token mit Signatur, Aussteller, Zielgruppe, Zeit und Berechtigung; merkt sich angemeldete Personen), Dockerfile, `compose.yaml` für Arcane (Bau aus GitHub) und Einrichtungsanleitung `server/README.md`; in Nexora Einstellungen → Team-Server: Anmelden im Browser mit PKCE über `http://localhost`, Erneuerungs-Token mit DPAPI verschlüsselt im Datenordner, „Angemeldet als …“, Abmelden
- Stufe 5 ruht auf Wunsch (2026-10-29), erst die lokale App weiter: Pakete 1 LOP und Gedächtnis, 2 Eingabe und Sicherheit, 3 Seiten, 4 PDF-Anhänge durchsuchbar, 5 Zeichnen ausbauen, 6 OneNote zurückschreiben
- **0.19.0 (Paket 1, LOP und Gedächtnis):** Unterpunkte mit Fortschritt (52) = Checkliste im Text eines Punkts, Balken und „3/5“ in Liste, Tabelle, Kanban und Heute; Arbeitstagebuch (56) schreibt Erledigt, Angelegt, Bearbeitet (einmal je Tag und Seite), Ausgeführt (Runbooks mit Sprache und Exit) und Nachgehakt automatisch mit, dazu eigene Notizen, Ansicht „Tagebuch“ in der Seitenleiste (Migration 009); Wochenrückblick (57) als Reiter „Woche“ mit Kalenderwoche, Zahlen, Listen und „Als Seite speichern“ (mit Seitenlinks); Nachhaken (55) bei Status „Wartet“ im „…“-Menü und in Heute öffnet einen Outlook-Entwurf (Anrede aus „Zuständig“, Empfänger trägt man selbst ein, Nexora sendet nie). Behoben: Umlaute kamen über stdin falsch in Outlook an (betraf auch die Fälligkeitstermine aus 0.17), vorhandene Termine werden beim nächsten Abgleich einmal neu geschrieben
- **0.20.0 (Paket 2, Eingabe und Sicherheit):** drei einstellbare Tastenkürzel (Schnellerfassung, Zwischenablage → Eingang Strg+Alt+V, Snippet einfügen Strg+Alt+S); Zwischenablage → Eingang (59) per Kürzel oder Tray: Text wird ein Punkt (erste Zeile Titel), Bild ein Punkt mit Bild (danach durchsuchbar); Snippet-Picker überall (60): kleines Fenster über jedem Programm, sucht alle Codeblöcke, fragt Platzhalter ab, setzt {{vault:…}} ein und fügt ins vorher aktive Fenster ein, alte Zwischenablage kommt zurück, ist das Fenster nicht mehr vorn, wird nichts getippt; Passwort-Warnung (61) beim Einfügen im Editor und bei Zwischenablage → Eingang: „Als •••••• einfügen“, „Trotzdem einfügen“, „Abbrechen“; Admin-Links (62) `\\server\freigabe`, `C:\Pfad` (auch in Anführungszeichen), `rdp://`, `ssh://` gepunktet unterstrichen, Strg+Klick öffnet: Ordner im Explorer, Dateien nur markiert (nie ausgeführt), Remotedesktop, ssh im Terminal
- **0.21.0 (Paket 3, Seiten):** Mermaid-Diagramme (65): Codeblock mit Sprache „Mermaid“ (oder `/Diagramm`) zeigt das Diagramm, „Code“ blendet den Text darüber ein, Vorschau beim Tippen, Hell/Dunkel, Fehler als Hinweis; Bibliothek wird erst bei Bedarf geladen, `securityLevel: strict`; Diagramme zählen nicht als Snippets. Statistik (58) als eigene Ansicht: Kennzahlen (offen, überfällig, abgeschlossen, Median-Durchlaufzeit), neu/abgeschlossen je Woche und offen/überfällig am Wochenende über 12 Wochen (Tooltip je Woche), offen nach Status, Liste, Person, Priorität, Durchlaufzeit in Stufen; Abschlusszeit aus dem Verlauf, sonst Tagebuch, sonst letzte Änderung. Fokus-Modus (69): Strg+Umschalt+F blendet Seitenleiste und Kopf aus, größere Schrift, Esc beendet. Drucken/PDF (70) im „…“-Menü: immer hell, ohne Bedienknöpfe, mit Pfad und Datum, LOP-Punkte mit Feldern, Unterseiten auf Nachfrage, freie Seiten aufs Blatt verkleinert; PDF über „Microsoft Print to PDF“. Bereiche Arbeit/Privat (71): Umschalter in der Seitenleiste, Bereich hängt am Notizbuch bzw. am Punkt im Eingang (Migration 010, auch im Tagebuch), Notizbuch per Rechtsklick verschieben; Heute, Eingang, Kalender, Suche, Tagebuch, Statistik, Snippets und Favoriten zeigen nur den aktiven Bereich, Erinnerungen kommen aus beiden, Schnellerfassung landet im aktiven Bereich; Privates geht nicht nach Outlook, Outlook-Termine nur in „Arbeit“
- **0.22.0 (Paket 4, Anhänge durchsuchbar):** PDF-Anhänge Seite für Seite (alle Seiten) über Windows.Data.Pdf rendern und mit der eingebauten Texterkennung lesen (etwa 0,2 s je Seite); Word (.docx), Excel (.xlsx, Texte der Zellen), PowerPoint (.pptx, je Folie) und Textdateien (.txt, .log, .csv, .ps1, .json, .xml … auch UTF-16) direkt auslesen; neue Anhänge sofort, vorhandene beim Start im Hintergrund; Index wie bei Bildern in der Tabelle `ocr`, je Seite ein Eintrag `datei:<uuid>/<Name>|<Seite>` (keine Migration); Suchtreffer „Im Anhang Wartung.pdf, S. 3: …“ bzw. „Folie 2“, Klick öffnet die Notizseite; Knopf „Text“ am Anhang kopiert den Text; Text aus Bildern und Anhängen wird in der Trefferanzeige nicht mehr um Markdown-Zeichen gekürzt
- **0.23.0 (Paket 5, Zeichnen ausbauen):** Zeichnungs-Block in normalen Seiten (`/Zeichnung`): eigene Fläche mit denselben Werkzeugen, Höhe ziehbar, steht als unsichtbare Zeile `<!-- nexora:zeichnung h=… | Strich | … -->` im Seitentext (Verlauf, Drucken; Export unsichtbar), Strg+Z über den Editor; Suche: beim Speichern eine Fassung ohne Strich-Zeilen in `plain` (Migration 011), damit Text unter einem Block findbar bleibt; Lasso (freie Seite und Block): umfahren wählt Striche und auf freien Seiten auch Textkästen, verschieben, Größe am Eckpunkt, Farbe und Stärke, Duplizieren (Strg+D), Löschen (Entf), Kopieren/Einfügen (Strg+C/X/V, auch zwischen Seiten und Fenstern, aus einer anderen Zeichnung oben links), Rückgängig; Druckstärke bei Stift-Eingabe nur für den Stift (Punkte `x,y,druck`, als gefüllte Fläche gezeichnet). Zeichnen-Bedienung liegt jetzt gemeinsam in Ink.jsx
- Offen in Stufe 4: OneNote zurückschreiben (nach Test des Lesens durch den Nutzer); Outlook-Termine in der Zeitleiste; bei Umstieg auf das neue Outlook auf Graph wechseln

## Stufe 5 – Team (Plan, abgestimmt am 2026-10-29)

### Entscheidungen

- **Nutzerkreis:** erst das IT-Team; mehr Abteilungen später ohne Umbau
- **Daten auf dem Server:** nur ausdrücklich geteilte Team-Notizbücher. Alles Private bleibt nur auf dem eigenen PC
- **Bearbeiten:** gleichzeitig wie Google Docs (Cursor der anderen sichtbar) für normale Seiten, Codeblöcke und eingebettete Listen. Freie Seiten und Zeichnungen erst nacheinander („wird bearbeitet von X“), gleichzeitig später
- **Offline:** Team-Bereiche auch offline lesen und bearbeiten. Text führt Yjs beim nächsten Kontakt automatisch zusammen (keine Konflikt-Kopien); bei LOP-Feldern gewinnt die letzte Änderung, der Verlauf zeigt wer
- **Zuweisen:** Personenfeld = echte Kollegen aus Entra. Hinweis per Windows-Meldung von Nexora (sonst beim nächsten Start im Eingang); keine Mail, kein Teams
- **Fremder Code:** wurde ein Codeblock seit deinem letzten Lauf von jemand anderem geändert, zeigt Nexora vor dem Ausführen wer und den Unterschied und fragt nach
- **Server-Code:** Ordner `server/` im Nexora-Repo auf GitHub (keine Firmendaten, alles über `.env`); Arcane baut direkt von GitHub

### Aufbau

- **Nexora-Server:** ein Container wie das Intranet (Node 24, eingebautes SQLite, Express), Yjs-Abgleich über Hocuspocus (WebSocket), Daten im Volume `/data` (Datenbank, Yjs-Dokumente, Bilder, Anhänge), tägliche Sicherung. Hinter dem Nginx Proxy Manager, z. B. `https://nexora.firma.local`
- **Anmeldung:** eigene Entra-App „Nexora“ (Desktop-App, Anmeldung einmal im Browser mit PKCE über `http://localhost`), Token im Windows-Anmeldespeicher; der Server prüft jedes Entra-Token und die Gruppen
- **Rechte:** je Team-Notizbuch Lesen, Bearbeiten, Verwalten für Personen oder Entra-Gruppen (z. B. die IT-Gruppe); geprüft auf dem Server bei jedem Zugriff
- **Abgleich:** Baum, Titel, Symbole und LOP-Felder über die Server-API mit Versionsnummer je Eintrag (UUID und `updated_at` gibt es seit Stufe 1); live über dieselbe Verbindung. Seiteninhalt als Yjs-Dokument; Nexora schreibt daneben weiter Markdown, damit Suche, Verlauf, Export, Sicherung und Texterkennung unverändert laufen
- **Lokale Kopie:** Team-Notizbücher liegen zusätzlich in der lokalen Datenbank (Yjs-Stand je Seite), Änderungen ohne Verbindung warten in einer Warteschlange

### Teilschritte (je ein Release)

1. ✓ (0.18.0) **Server und Anmeldung:** Server-Grundgerüst mit Gesundheitsseite, Entra-Prüfung, Dockerfile und `compose.yaml`, Anleitung für Arcane; in Nexora „Mit Team-Server verbinden“ (Anmelden, angemeldet als …, Abmelden)
2. **Team-Notizbücher:** neues Team-Notizbuch anlegen oder vorhandenes teilen, Rechte vergeben; Baum und LOP-Punkte abgleichen, live und offline mit Warteschlange
3. **Gemeinsam schreiben:** normale Seiten gleichzeitig (Yjs, Cursor mit Namen und Farben), offline zusammenführen, Versionsverlauf mit Namen; freie Seiten „wird bearbeitet von X“
4. **Bilder und Anhänge** in Team-Notizbüchern über den Server, lokal zwischengespeichert
5. **Zuweisen:** Kollegen aus Entra im Personenfeld, zugewiesene Punkte in Heute und Eingang des Kollegen, Windows-Meldung, Verlauf mit Namen
6. **Runbooks im Team:** Nachfrage mit Unterschied bei fremd geändertem Code
7. Später: freie Seiten und Zeichnungen gleichzeitig; weitere Abteilungen

### Was du einrichten musst (Anleitung kommt mit Schritt 1)

- Entra: App-Registrierung „Nexora“ (Plattform „Mobile und Desktop“, Umleitung `http://localhost`), eine API-Berechtigung für den Server, Gruppenansprüche im Token; Schritt für Schritt in `server/README.md`. Der Erneuerungs-Token liegt mit DPAPI verschlüsselt in einer Datei statt in der Windows-Anmeldeverwaltung (die erlaubt nur 2,5 KB je Eintrag)
- Server: DNS-Eintrag für den Server (z. B. `nexora.firma.local`), Proxy-Host im Nginx Proxy Manager mit WebSocket-Unterstützung, freier Port (vorher prüfen), Arcane-Projekt mit `compose.yaml` und `.env`
- Prüfen, ob Arcane github.com erreicht (Firewall); sonst Spiegel im eigenen Git-Server

### Risiken und Hinweise

- Yjs ist ein zweites Speicherformat: beim Teilen wird eine vorhandene Seite einmalig aus Markdown umgewandelt. Eigene Bausteine (Seitenlinks, LOP-Einbettung, Tresor-Verweis, Anhang, Bild, Codeblock) sind ProseMirror-Knoten und gehen mit
- Tresor-Verweise zeigen auf den persönlichen Tresor: Kollegen sehen den Eintrag nur, wenn er in einer gemeinsamen Vaultwarden-Sammlung liegt
- Outlook: aus Team-Listen gehen nur Punkte in den eigenen Kalender, die einem selbst zugewiesen sind (Vorschlag, noch zu bestätigen)
- Der Server ist nur im Firmennetz erreichbar; unterwegs ohne VPN arbeitet Nexora offline weiter
- Auf dem Dev-PC gibt es kein Docker: den Container-Build sehe ich erst auf eurem Server

## Offen

- Bestand außer OneNote (Textdateien, Word, Notion, Wiki)?
