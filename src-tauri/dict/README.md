# Wörterbücher

Unveränderte Hunspell-Wörterbücher für die Rechtschreibprüfung (`src-tauri/src/spell.rs`). Sie liegen als eigene Dateien neben dem Programm und stehen unter ihren eigenen Lizenzen, nicht unter der von Nexora.

| Datei | Sprache | Herkunft | Lizenz |
|---|---|---|---|
| `de.aff`, `de.dic` | Deutsch | igerman98 von Björn Jacke, https://www.j3e.de/ispell/igerman98/ | GPL 2 oder 3, siehe `de.LICENSE.txt` |
| `en.aff`, `en.dic` | Englisch (USA) | SCOWL, http://wordlist.aspell.net/ | MIT und BSD, siehe `en.LICENSE.txt` |

Bezogen als npm-Pakete `dictionary-de` 3.0.0 und `dictionary-en` 4.0.0 aus https://github.com/wooorm/dictionaries, dort auch die Quellen. Die Dateien heißen im Paket `index.aff` und `index.dic`.
