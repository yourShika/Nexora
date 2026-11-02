# whisper.cpp

Lokale Spracherkennung (`src-tauri/src/speech.rs`). Unverändert aus `whisper-bin-x64.zip` des offiziellen Builds [b5454](https://github.com/ggml-org/whisper.cpp/releases/tag/b5454) von ggml-org, MIT-Lizenz, siehe `LICENSE.txt`. Dieselbe Fassung wie v1.9.5.

Davon nur, was der Server braucht: `whisper-server.exe`, `whisper.dll`, `ggml.dll`, `ggml-base.dll`, `ggml-cpu-*.dll` (wählt beim Start, was der Prozessor kann).

Dazu die Laufzeit von Microsoft aus den Visual-Studio-Build-Tools (`VC\Redist\MSVC\14.51.36231\x64`), weil sie nicht auf jedem PC installiert ist: `msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll`, `vcomp140.dll`. Sie gehören zu den von Microsoft zur Weitergabe freigegebenen Dateien.

Die Sprachmodelle gehören nicht hierher, sie lädt jeder selbst über Einstellungen → Sprache von https://huggingface.co/ggerganov/whisper.cpp (MIT, Prüfsummen in `speech.rs`).
