// Nexora-Datei (.nexora): ein Notizbuch als ZIP mit nexora.json und den Bildern/Anhängen, die es braucht.
// Was im JSON steht, bauen und lesen io.js (packNotebook/unpackNotebook); hier nur Datei und Ordner.
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};

const JSON: &str = "nexora.json";
const MAX_ENTRY: u64 = 200 * 1024 * 1024; // wie bei Anhängen
const MAX_TOTAL: u64 = 2 * 1024 * 1024 * 1024; // Schutz vor Zip-Bomben

// Nur "bilder/…" und "anhaenge/<uuid>/…", ohne Laufwerk und ohne ".."
fn data_rel(rel: &str) -> Option<PathBuf> {
    let p = Path::new(rel);
    let ok = p.components().all(|c| matches!(c, Component::Normal(_)))
        && (rel.starts_with("bilder/") || rel.starts_with("anhaenge/"))
        && p.components().count() >= 2;
    ok.then(|| p.to_path_buf())
}

fn pack(data: &Path, target: &Path, json: &str, files: &[String]) -> Result<usize, String> {
    let file = fs::File::create(target).map_err(|e| format!("Datei nicht angelegt: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file(JSON, opts).map_err(|e| e.to_string())?;
    zip.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    let mut count = 0;
    for rel in files {
        let Some(path) = data_rel(rel) else { continue };
        // Fehlt eine Datei (schon gelöscht), bleibt sie draußen; der Text verweist dann ins Leere wie vorher
        let Ok(bytes) = fs::read(data.join(&path)) else { continue };
        zip.start_file(rel.as_str(), opts).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
        count += 1;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(count)
}

fn unpack(data: &Path, source: &Path) -> Result<String, String> {
    let file = fs::File::open(source).map_err(|e| format!("Datei nicht lesbar: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "Keine Nexora-Datei".to_string())?;
    let mut json = String::new();
    zip.by_name(JSON).map_err(|_| "Keine Nexora-Datei (nexora.json fehlt)".to_string())?.take(MAX_ENTRY).read_to_string(&mut json).map_err(|e| e.to_string())?;
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() || entry.name() == JSON {
            continue;
        }
        let Some(rel) = entry.enclosed_name().and_then(|p| data_rel(&p.to_string_lossy().replace('\\', "/"))) else { continue };
        let dest = data.join(&rel);
        // Bilder und Anhänge tragen eine UUID im Namen: gibt es die Datei schon, ist es dieselbe
        if dest.exists() {
            continue;
        }
        total += entry.size();
        if entry.size() > MAX_ENTRY || total > MAX_TOTAL {
            return Err("Die Datei enthält zu große Anhänge".into());
        }
        fs::create_dir_all(dest.parent().unwrap_or(data)).map_err(|e| e.to_string())?;
        let mut out = fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut (&mut entry).take(MAX_ENTRY), &mut out).map_err(|e| e.to_string())?;
    }
    Ok(json)
}

// Schreibt die Nexora-Datei; Ergebnis: Zahl der mitgenommenen Bilder und Anhänge
#[tauri::command]
pub fn export_nexora(app: AppHandle, target: String, json: String, files: Vec<String>) -> Result<usize, String> {
    let data = app.path().app_config_dir().map_err(|e| e.to_string())?;
    pack(&data, Path::new(&target), &json, &files)
}

// Legt Bilder und Anhänge in den Datenordner und gibt nexora.json zurück
#[tauri::command]
pub fn import_nexora(app: AppHandle, source: String) -> Result<String, String> {
    let data = app.path().app_config_dir().map_err(|e| e.to_string())?;
    unpack(&data, Path::new(&source))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nur_bilder_und_anhaenge() {
        assert!(data_rel("bilder/a.png").is_some());
        assert!(data_rel("anhaenge/0b6e7d1f-3c2a-4c55-9a1e-3f0d2b8c4e01/Rechnung.pdf").is_some());
        assert!(data_rel("bilder/../nexora.db").is_none());
        assert!(data_rel("nexora.db").is_none());
        assert!(data_rel("C:/Windows/x").is_none());
        assert!(data_rel("bilder").is_none());
    }

    #[test]
    fn hin_und_zurueck() {
        let base = std::env::temp_dir().join(format!("nexora-pack-{}", std::process::id()));
        let (from, to) = (base.join("von"), base.join("nach"));
        fs::create_dir_all(from.join("bilder")).unwrap();
        fs::create_dir_all(from.join("anhaenge/u1")).unwrap();
        fs::write(from.join("bilder/a.png"), b"PNG").unwrap();
        fs::write(from.join("anhaenge/u1/Plan.pdf"), b"PDF").unwrap();
        fs::write(from.join("nexora.db"), b"geheim").unwrap();
        let file = base.join("buch.nexora");
        let files = ["bilder/a.png", "anhaenge/u1/Plan.pdf", "bilder/fehlt.png", "nexora.db"].map(String::from);
        assert_eq!(pack(&from, &file, "{\"format\":1}", &files).unwrap(), 2);
        fs::create_dir_all(&to).unwrap();
        assert_eq!(unpack(&to, &file).unwrap(), "{\"format\":1}");
        assert_eq!(fs::read(to.join("bilder/a.png")).unwrap(), b"PNG");
        assert_eq!(fs::read(to.join("anhaenge/u1/Plan.pdf")).unwrap(), b"PDF");
        assert!(!to.join("nexora.db").exists());
        let _ = fs::remove_dir_all(&base);
    }
}
