// Rechtschreibung: Hunspell-Wörterbücher, die als eigene Dateien neben dem Programm liegen (Ordner dict).
// WebView2 markiert in Nexora von sich aus nichts, und Windows hat oft nur die Systemsprache.
use spellbook::Dictionary;
use std::sync::OnceLock;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

const LANGUAGES: [&str; 2] = ["de", "en"];
// Sehr lange „Wörter“ sind kein Text, und Vorschläge dafür würden lange rechnen
const MAX_WORD: usize = 60;

static DICTIONARIES: OnceLock<Result<Vec<Dictionary>, String>> = OnceLock::new();

fn load(app: &AppHandle) -> Result<Vec<Dictionary>, String> {
    let read = |file: String| {
        let path = app
            .path()
            .resolve(format!("dict/{file}"), BaseDirectory::Resource)
            .map_err(|e| e.to_string())?;
        std::fs::read_to_string(&path).map_err(|e| format!("{file}: {e}"))
    };
    LANGUAGES
        .iter()
        .map(|lang| {
            let (aff, dic) = (read(format!("{lang}.aff"))?, read(format!("{lang}.dic"))?);
            Dictionary::new(&aff, &dic).map_err(|e| format!("{lang}: {e}"))
        })
        .collect()
}

// Beim ersten Gebrauch laden, das dauert nur Millisekunden
fn dictionaries(app: &AppHandle) -> Result<&'static [Dictionary], String> {
    match DICTIONARIES.get_or_init(|| load(app)) {
        Ok(list) => Ok(list),
        Err(e) => Err(format!("Wörterbücher nicht geladen: {e}")),
    }
}

fn known(list: &[Dictionary], word: &str) -> bool {
    word.len() > MAX_WORD || list.iter().any(|d| d.check(word))
}

fn suggestions(list: &[Dictionary], word: &str) -> Vec<String> {
    let mut all = Vec::new();
    if word.len() <= MAX_WORD {
        for d in list {
            let mut found = Vec::new();
            d.suggest(word, &mut found);
            all.append(&mut found);
        }
    }
    all
}

// Je Wort: steht es in mindestens einem Wörterbuch?
#[tauri::command(async)]
pub fn spell_check(app: AppHandle, words: Vec<String>) -> Result<Vec<bool>, String> {
    let list = dictionaries(&app)?;
    Ok(words.iter().map(|w| known(list, w)).collect())
}

#[tauri::command(async)]
pub fn spell_suggest(app: AppHandle, word: String) -> Result<Vec<String>, String> {
    Ok(suggestions(dictionaries(&app)?, &word))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn real() -> Vec<Dictionary> {
        vec![
            Dictionary::new(include_str!("../dict/de.aff"), include_str!("../dict/de.dic")).unwrap(),
            Dictionary::new(include_str!("../dict/en.aff"), include_str!("../dict/en.dic")).unwrap(),
        ]
    }

    #[test]
    fn beide_sprachen_zugleich() {
        let list = real();
        for word in ["Fehler", "Straße", "Mäuse", "Druckerwarteschlange", "Benutzerkonto", "server", "sentence", "words"] {
            assert!(known(&list, word), "{word}");
        }
        for word in ["Fehlre", "nochh", "nciht", "sentense", "wrng", "ipconfig"] {
            assert!(!known(&list, word), "{word}");
        }
    }

    #[test]
    fn vorschlaege_aus_beiden() {
        let list = real();
        assert!(suggestions(&list, "nciht").iter().any(|s| s == "nicht"));
        assert!(suggestions(&list, "sentense").iter().any(|s| s == "sentence"));
        assert!(suggestions(&list, &"x".repeat(MAX_WORD + 1)).is_empty());
    }
}
