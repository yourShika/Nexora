// Import aus anderen Programmen: Obsidian-Ordner auflisten, Notion-Export (Zip, auch mit Teil-Zips darin) entpacken.
// Gelesen wird danach mit read_text_file, Bilder und Anhänge kommen über import_image/import_attachment.
// Verbundener Obsidian-Ordner: schreiben, umbenennen, hineinkopieren, nur unter root und nie löschen.
use crate::attach::safe_rel;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};

const MAX_FILES: usize = 50_000;
const PREFIX: &str = "nexora-import-";

#[derive(Serialize)]
pub struct Entry {
    rel: String,
    size: u64,
    mtime: u64, // Millisekunden seit 1970, damit der Abgleich unveränderte Dateien nicht liest
}

#[derive(Serialize)]
pub struct Stat {
    size: u64,
    mtime: u64,
}

fn stat(path: &Path) -> Result<Stat, String> {
    let m = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(Stat { size: m.len(), mtime: mtime(&m) })
}

fn mtime(m: &fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// Alle Dateien unter root, Pfade relativ mit "/"; versteckte Ordner (.obsidian, .trash, .git) bleiben draußen
fn walk(root: &Path, dir: &Path, out: &mut Vec<Entry>) -> Result<(), String> {
    for e in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = e.path();
        let kind = e.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() {
            walk(root, &path, out)?;
        } else if kind.is_file() {
            if out.len() >= MAX_FILES {
                return Err(format!("Mehr als {MAX_FILES} Dateien, bitte einen kleineren Ordner wählen"));
            }
            let rel = path.strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
            let meta = e.metadata().ok();
            out.push(Entry { rel, size: meta.as_ref().map(|m| m.len()).unwrap_or(0), mtime: meta.as_ref().map(mtime).unwrap_or(0) });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_folder(root: String) -> Result<Vec<Entry>, String> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err("Ordner nicht gefunden".into());
    }
    let mut out = Vec::new();
    walk(&root, &root, &mut out)?;
    Ok(out)
}

// Zip in einen eigenen Ordner im Temp entpacken; Notion packt große Exporte als Zip in Zips
fn unzip(file: &Path, dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(fs::File::open(file).map_err(|e| e.to_string())?).map_err(|e| format!("Kein gültiges Zip: {e}"))?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        // enclosed_name schützt vor "../" im Zip (zip slip)
        let Some(rel) = f.enclosed_name() else { continue };
        let out = dest.join(rel);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        fs::create_dir_all(out.parent().unwrap_or(dest)).map_err(|e| e.to_string())?;
        let mut w = fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut f, &mut w).map_err(|e| e.to_string())?;
        drop(w);
        if out.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip")) {
            unzip(&out, out.parent().unwrap_or(dest))?;
            let _ = fs::remove_file(&out);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn unzip_import(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let dest = std::env::temp_dir().join(format!("{PREFIX}{}-{stamp}", std::process::id()));
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        unzip(Path::new(&path), &dest).inspect_err(|_| {
            let _ = fs::remove_dir_all(&dest);
        })?;
        Ok(dest.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// Nach dem Import aufräumen; nur unsere eigenen Ordner im Temp
#[tauri::command]
pub fn drop_import(dir: String) -> Result<(), String> {
    let p = PathBuf::from(&dir);
    let ok = p.parent() == Some(std::env::temp_dir().as_path()) && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(PREFIX));
    if !ok {
        return Err("Kein Import-Ordner".into());
    }
    fs::remove_dir_all(p).map_err(|e| e.to_string())
}

fn vault_path(root: &str, rel: &str) -> Result<PathBuf, String> {
    let root = Path::new(root);
    if !root.is_dir() {
        return Err("Obsidian-Ordner nicht gefunden".into());
    }
    Ok(root.join(safe_rel(rel)?))
}

// Seite als .md-Datei schreiben (Ordner werden angelegt)
#[tauri::command]
pub fn obsidian_write(root: String, rel: String, content: String) -> Result<Stat, String> {
    if !rel.to_lowercase().ends_with(".md") {
        return Err("Nur .md-Dateien".into());
    }
    let path = vault_path(&root, &rel)?;
    fs::create_dir_all(path.parent().unwrap_or(Path::new(&root))).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| format!("{rel}: {e}"))?;
    stat(&path)
}

// In Nexora umbenannt oder verschoben; ein vorhandenes Ziel wird nie überschrieben
#[tauri::command]
pub fn obsidian_rename(root: String, from: String, to: String) -> Result<Stat, String> {
    let (src, dest) = (vault_path(&root, &from)?, vault_path(&root, &to)?);
    if dest.exists() {
        return Err(format!("{to} gibt es schon"));
    }
    fs::create_dir_all(dest.parent().unwrap_or(Path::new(&root))).map_err(|e| e.to_string())?;
    fs::rename(&src, &dest).map_err(|e| format!("{from}: {e}"))?;
    stat(&dest)
}

// Bild oder Anhang aus dem Datenordner in den Obsidian-Ordner kopieren (nie überschreiben)
#[tauri::command]
pub fn obsidian_copy(app: AppHandle, root: String, src: String, rel: String) -> Result<Stat, String> {
    if !(src.starts_with("bilder/") || src.starts_with("anhaenge/")) {
        return Err(format!("Nicht erlaubte Quelle: {src}"));
    }
    let from = app.path().app_config_dir().map_err(|e| e.to_string())?.join(safe_rel(&src)?);
    let dest = vault_path(&root, &rel)?;
    if dest.exists() {
        return Err(format!("{rel} gibt es schon"));
    }
    fs::create_dir_all(dest.parent().unwrap_or(Path::new(&root))).map_err(|e| e.to_string())?;
    fs::copy(&from, &dest).map_err(|e| format!("{src}: {e}"))?;
    stat(&dest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // Zip mit einem Teil-Zip darin (wie Notion) und einem Pfad mit "../" (wird übersprungen)
    #[test]
    fn entpackt_auch_teil_zips() {
        let base = std::env::temp_dir().join(format!("nexora-zip-test-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let inner = base.join("Part-1.zip");
        let mut z = zip::ZipWriter::new(fs::File::create(&inner).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        z.start_file("Seite 0123456789abcdef0123456789abcdef.md", o).unwrap();
        z.write_all(b"# Seite").unwrap();
        z.finish().unwrap();
        let outer = base.join("Export.zip");
        let mut z = zip::ZipWriter::new(fs::File::create(&outer).unwrap());
        z.start_file("Part-1.zip", o).unwrap();
        z.write_all(&fs::read(&inner).unwrap()).unwrap();
        z.start_file("../boese.txt", o).unwrap();
        z.write_all(b"x").unwrap();
        z.finish().unwrap();

        let dest = base.join("aus");
        fs::create_dir_all(&dest).unwrap();
        unzip(&outer, &dest).unwrap();
        let mut files = Vec::new();
        walk(&dest, &dest, &mut files).unwrap();
        let names: Vec<_> = files.iter().map(|f| f.rel.as_str()).collect();
        assert_eq!(names, ["Seite 0123456789abcdef0123456789abcdef.md"]);
        assert!(!base.join("boese.txt").exists());
        let _ = fs::remove_dir_all(&base);
    }

    // Schreiben und Umbenennen nur unter root, kein Überschreiben, keine Pfade nach draußen
    #[test]
    fn obsidian_ordner_sicher() {
        let base = std::env::temp_dir().join(format!("nexora-vault-test-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let root = base.to_string_lossy().into_owned();
        let s = obsidian_write(root.clone(), "A/Seite.md".into(), "hallo".into()).unwrap();
        assert_eq!(s.size, 5);
        assert!(s.mtime > 0);
        assert!(obsidian_write(root.clone(), "../draussen.md".into(), "x".into()).is_err());
        assert!(obsidian_write(root.clone(), "C:/Windows/x.md".into(), "x".into()).is_err());
        assert!(obsidian_write(root.clone(), "bild.png".into(), "x".into()).is_err());
        obsidian_write(root.clone(), "B.md".into(), "b".into()).unwrap();
        assert!(obsidian_rename(root.clone(), "A/Seite.md".into(), "B.md".into()).is_err(), "Ziel bleibt");
        obsidian_rename(root.clone(), "A/Seite.md".into(), "C/Neu.md".into()).unwrap();
        assert_eq!(fs::read_to_string(base.join("C/Neu.md")).unwrap(), "hallo");
        assert_eq!(fs::read_to_string(base.join("B.md")).unwrap(), "b");
        let mut files = Vec::new();
        walk(&base, &base, &mut files).unwrap();
        assert!(files.iter().all(|f| f.mtime > 0));
        let _ = fs::remove_dir_all(&base);
    }
}
