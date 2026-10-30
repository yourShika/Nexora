// Einrichtung und Rundgang: Inhalte und reine Logik (testbar)

// Beispielinhalt aus Migration 001 (feste IDs)
export const SEED_BOOK = '7d1f3c2a-0b6e-4c55-9a1e-3f0d2b8c4e01'
export const SEED_SECTION = '7d1f3c2a-0b6e-4c55-9a1e-3f0d2b8c4e02'

export const EXAMPLE_ROWS = [
  ['Schnellerfassung ausprobieren (Tasten unter Einstellungen)', { nr: 1, status: 'offen', prio: 'hoch' }, true],
  ['Eigene Felder unter „Felder“ anlegen', { nr: 2, status: 'offen', prio: 'niedrig' }, false],
]

export const WELCOME = `## So funktioniert der Editor

Tippe \`/\` am Anfang einer Zeile, um einen Block einzufügen: Überschrift, Liste, Checkliste, Code, Tabelle.

- [ ] Eine Seite anlegen
- [ ] Mit \`/\` eine Checkliste einfügen
- [ ] Einen Codeblock ausprobieren

\`\`\`powershell
Get-Service | Where-Object Status -eq Running
\`\`\`

Gespeichert wird automatisch bei jeder Änderung.`

export const HELP_TITLE = 'Nexora kennenlernen'
export const HELP_PAGE = `Diese Seite erklärt das Wichtigste zum Nachlesen. Du kannst sie ändern oder löschen. Den Rundgang und die Einrichtung startest du jederzeit neu: Klick auf deinen Namen unten links.

## Aufbau

- **Notizbücher** enthalten Abschnitte, Seiten und Listen. Rechtsklick auf einen Eintrag zeigt alles, was damit geht; Ziehen ordnet um.
- **Arbeit und Privat** oben in der Seitenleiste trennen zwei Bereiche.
- **Reiter** liegen in der Titelleiste. Mittelklick auf einen Eintrag öffnet ihn in einem neuen Reiter, Rechtsklick auf den Reiter pinnt ihn an.

## Schreiben

- \`/\` am Anfang einer Zeile fügt Blöcke ein: Überschriften, Checklisten, Code, Tabellen und mehr.
- Gespeichert wird von selbst. Die Uhr oben rechts zeigt den Verlauf einer Seite.
- \`Strg+K\` sucht in allen Notizen und findet auch Befehle.
- \`Strg+Umschalt+F\` schaltet den Fokus-Modus ein, \`Strg+Umschalt+L\` klappt die Seitenleiste ein und aus.

## Listen

Eine LOP-Liste hält offene Punkte mit Status, Priorität, Fälligkeit und Zuständigen. Im Feld „Neuer Punkt“ geht alles in einer Zeile:

\`\`\`plaintext
Zertifikat erneuern #server @Kim !hoch fr 14:00 *monatlich
\`\`\`

Oben wechselst du zwischen Tabelle, Liste, Kanban, Kalender und Zeitleiste. Spalten verschiebst du in der Tabelle am Kopf.

## Heute, Eingang, Kalender

- **Heute** zeigt, was überfällig und heute fällig ist.
- **Eingang** sammelt Schnellerfasstes, bis es einer Liste zugeteilt ist.
- **Kalender** zeigt Punkte mit Datum und, wenn eingerichtet, Outlook-Termine.
- **Schnellerfassung**: Die Tastenkombination unter Einstellungen → Tastenkürzel funktioniert überall in Windows, solange Nexora läuft.

## Übernehmen und sichern

- Das Pfeil-Symbol neben „Notizbücher“ importiert Nexora-Dateien, Obsidian-Ordner und Notion-Exporte; das Stecker-Symbol verbindet OneNote.
- Rechtsklick auf einen Eintrag exportiert als Markdown, für Obsidian oder für Notion.
- Unter Einstellungen → Sicherung legst du fest, wann und wohin Nexora sichert.`

const STATIONS = [
  { id: 'baum', target: 'baum', title: 'Notizbücher', text: 'Hier liegen deine Notizbücher mit Abschnitten, Seiten und Listen. Rechtsklick auf einen Eintrag zeigt alles, was damit geht; Ziehen ordnet um.' },
  { id: 'suche', target: 'suche', title: 'Suche', text: 'Strg+K sucht in allen Notizen und findet auch Befehle, zum Beispiel „Einstellungen“ oder „Darstellung: Dunkel“.' },
  { id: 'ansichten', target: 'ansichten', title: 'Heute, Eingang, Kalender', text: 'Heute zeigt, was fällig ist. Im Eingang landet die Schnellerfassung. Der Kalender zeigt Punkte mit Datum und, wenn eingerichtet, Outlook-Termine.' },
  { id: 'reiter', target: 'reiter', title: 'Reiter', text: 'Wie im Browser: Mittelklick auf einen Eintrag öffnet ihn in einem neuen Reiter, Rechtsklick auf den Reiter pinnt ihn an.' },
  { id: 'seite', target: 'inhalt', open: 'page', title: 'Seiten', text: 'Hier schreibst du. Ein „/“ am Anfang einer Zeile fügt Blöcke ein: Überschriften, Checklisten, Code, Tabellen. Gespeichert wird von selbst.' },
  { id: 'liste', target: 'neuer-punkt', open: 'list', title: 'Listen', text: 'Punkte schreibst du in einer Zeile: Text #tag @person !hoch fr 14:00. Das „?“ daneben zeigt alle Möglichkeiten; oben wechselst du zwischen Tabelle, Kanban, Kalender und Zeitleiste.' },
  { id: 'benutzer', target: 'benutzer', title: 'Dein Menü', text: 'Ein Klick auf deinen Namen öffnet Einstellungen, Neuigkeiten und Papierkorb. Hier startest du auch die Einrichtung und diesen Rundgang neu.' },
]

// Stationen für den Rundgang: Seite und Liste aus den vorhandenen Einträgen; ohne passenden Eintrag fällt die Station weg
export function tourStations({ page, list }) {
  const views = { page, list }
  return STATIONS.filter((s) => !s.open || views[s.open]).map((s) => ({ ...s, view: s.open ? views[s.open] : undefined }))
}

// Platz für die Erklärung neben dem hervorgehobenen Bereich: rechts, links, darunter, darüber;
// passt sie nirgends daneben (oder gibt es keinen Bereich), steht sie mittig im Fenster
export function placeTip(target, tip, win, gap = 12, margin = 8) {
  const clampX = (x) => Math.max(margin, Math.min(x, win.w - tip.w - margin))
  const clampY = (y) => Math.max(margin, Math.min(y, win.h - tip.h - margin))
  const center = { x: clampX((win.w - tip.w) / 2), y: clampY((win.h - tip.h) / 2) }
  if (!target) return center
  const right = target.left + target.width
  const bottom = target.top + target.height
  if (right + gap + tip.w + margin <= win.w) return { x: right + gap, y: clampY(target.top) }
  if (target.left - gap - tip.w - margin >= 0) return { x: target.left - gap - tip.w, y: clampY(target.top) }
  if (bottom + gap + tip.h + margin <= win.h) return { x: clampX(target.left), y: bottom + gap }
  if (target.top - gap - tip.h - margin >= 0) return { x: clampX(target.left), y: target.top - gap - tip.h }
  return center
}
