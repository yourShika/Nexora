// Import aus anderen Programmen: Obsidian-Ordner auflisten, Notion-Export (Zip, auch mit Teil-Zips darin) entpacken.
// Gelesen wird danach mit read_text_file, Bilder und Anhänge kommen über import_image/import_attachment.
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_FILES: usize = 50_000;
const PREFIX: &str = "nexora-import-";

#[derive(Serialize)]
pub struct Entry {
    rel: String,
    size: u64,
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
            out.push(Entry { rel, size: e.metadata().map(|m| m.len()).unwrap_or(0) });
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
}
