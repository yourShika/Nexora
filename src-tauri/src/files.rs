// Dateizugriffe mit festem Rahmen: Bilder nur in <Daten>\bilder, Sicherung nur aus <Daten>.
// Das Frontend bekommt so keine allgemeinen Dateirechte.
use std::fs;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};

const IMAGE_TYPES: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];
const MAX_IMAGE: usize = 50 * 1024 * 1024;

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

// Name kommt vom Frontend (UUID + Endung); nur dieses Muster ist erlaubt, kein Pfad
fn valid_image_name(name: &str) -> bool {
    match name.rsplit_once('.') {
        Some((stem, ext)) => {
            stem.len() == 36
                && stem.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
                && IMAGE_TYPES.contains(&ext)
        }
        None => false,
    }
}

// Bytes kommen roh im Body, der Dateiname im Header x-name
#[tauri::command]
pub fn save_image(app: AppHandle, request: Request) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Keine Bilddaten erhalten".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !valid_image_name(&name) {
        return Err(format!("Ungültiger Bildname: {name}"));
    }
    if bytes.len() > MAX_IMAGE {
        return Err("Bild ist größer als 50 MB".into());
    }
    let dir = data_dir(&app)?.join("bilder");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join(&name), bytes).map_err(|e| format!("Bild nicht gespeichert: {e}"))?;
    Ok(name)
}

// Bilddatei vom Datenträger übernehmen (Titelbild aus dem Dateidialog); name wie bei save_image
#[tauri::command]
pub fn import_image(app: AppHandle, source: String, name: String) -> Result<String, String> {
    if !valid_image_name(&name) {
        return Err(format!("Ungültiger Bildname: {name}"));
    }
    let src = Path::new(&source);
    let ext = src.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if !IMAGE_TYPES.contains(&ext.as_str()) {
        return Err("Nur PNG, JPG, GIF oder WebP".into());
    }
    if fs::metadata(src).map_err(|e| e.to_string())?.len() > MAX_IMAGE as u64 {
        return Err("Bild ist größer als 50 MB".into());
    }
    let dir = data_dir(&app)?.join("bilder");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::copy(src, dir.join(&name)).map_err(|e| format!("Bild nicht übernommen: {e}"))?;
    Ok(name)
}

// Alle Bilddateien im Datenordner (Name, Größe in Bytes)
#[tauri::command]
pub fn list_images(app: AppHandle) -> Result<Vec<(String, u64)>, String> {
    let dir = data_dir(&app)?.join("bilder");
    if !dir.is_dir() {
        return Ok(vec![]);
    }
    Ok(fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| Some((e.file_name().into_string().ok()?, e.metadata().ok()?.len())))
        .filter(|(n, _)| valid_image_name(n))
        .collect())
}

// Löscht nur gültige Bildnamen im Bilderordner, sonst nichts
#[tauri::command]
pub fn delete_images(app: AppHandle, names: Vec<String>) -> Result<usize, String> {
    let dir = data_dir(&app)?.join("bilder");
    let mut count = 0;
    for name in names.iter().filter(|n| valid_image_name(n)) {
        if fs::remove_file(dir.join(name)).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

// snapshot: per VACUUM INTO erzeugte Datei im Datenordner ("sicherung-JJJJ-MM-TT_HHMM.db").
// Kopiert sie als nexora-….db ins Ziel, ergänzt fehlende Bilder, behält die neuesten `keep` Stände.
#[tauri::command]
pub fn finish_backup(app: AppHandle, snapshot: String, target: String, keep: usize) -> Result<String, String> {
    let stamp = snapshot
        .strip_prefix("sicherung-")
        .and_then(|s| s.strip_suffix(".db"))
        .filter(|s| s.chars().all(|c| c.is_ascii_digit() || c == '-' || c == '_'))
        .ok_or("Ungültiger Sicherungsname")?;
    let src_dir = data_dir(&app)?;
    let snap = src_dir.join(&snapshot);
    let result = copy_backup(&src_dir, &snap, Path::new(&target), stamp, keep.max(1));
    let _ = fs::remove_file(&snap);
    result
}

fn copy_backup(src_dir: &Path, snap: &Path, target: &Path, stamp: &str, keep: usize) -> Result<String, String> {
    fs::create_dir_all(target).map_err(|e| format!("Zielordner nicht erreichbar: {e}"))?;
    let dest = target.join(format!("nexora-{stamp}.db"));
    fs::copy(snap, &dest).map_err(|e| format!("Kopieren fehlgeschlagen: {e}"))?;

    // Bilder und Anhänge ändern sich nie (eindeutige Namen): nur fehlende kopieren
    for folder in ["bilder", "anhaenge"] {
        copy_missing(&src_dir.join(folder), &target.join(folder))?;
    }

    // Alte Stände über `keep` hinaus löschen; nur eigene Dateien anfassen
    let mut old: Vec<PathBuf> = fs::read_dir(target)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("nexora-") && n.ends_with(".db"))
        })
        .collect();
    old.sort();
    let surplus = old.len().saturating_sub(keep);
    for p in old.into_iter().take(surplus) {
        let _ = fs::remove_file(p);
    }
    Ok(dest.display().to_string())
}

// Ordner rekursiv spiegeln, vorhandene Dateien bleiben unangetastet
fn copy_missing(from: &Path, to: &Path) -> Result<(), String> {
    if !from.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let dest = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_missing(&entry.path(), &dest)?;
        } else if !dest.exists() {
            fs::copy(entry.path(), &dest).map_err(|e| format!("{} nicht kopiert: {e}", entry.path().display()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bildnamen() {
        assert!(valid_image_name("0b6e7d1f-3c2a-4c55-9a1e-3f0d2b8c4e01.png"));
        assert!(!valid_image_name("../../evil.png"));
        assert!(!valid_image_name("0b6e7d1f-3c2a-4c55-9a1e-3f0d2b8c4e01.exe"));
        assert!(!valid_image_name("0b6e7d1f-3c2a-4c55-9a1e-3f0d2b8c4e0\\.png"));
    }

    #[test]
    fn sicherung_behaelt_neueste() {
        let base = std::env::temp_dir().join(format!("nexora-test-{}", std::process::id()));
        let (src, target) = (base.join("daten"), base.join("ziel"));
        fs::create_dir_all(src.join("bilder")).unwrap();
        fs::write(src.join("bilder").join("a.png"), b"x").unwrap();
        fs::create_dir_all(src.join("anhaenge").join("id1")).unwrap();
        fs::write(src.join("anhaenge").join("id1").join("Bericht.pdf"), b"pdf").unwrap();
        for (i, stamp) in ["2026-10-01_0800", "2026-10-02_0800", "2026-10-03_0800"].iter().enumerate() {
            let snap = src.join(format!("sicherung-{stamp}.db"));
            fs::write(&snap, format!("db{i}")).unwrap();
            copy_backup(&src, &snap, &target, stamp, 2).unwrap();
        }
        let mut names: Vec<String> = fs::read_dir(&target).unwrap().flatten().map(|e| e.file_name().into_string().unwrap()).collect();
        names.sort();
        assert_eq!(names, ["anhaenge", "bilder", "nexora-2026-10-02_0800.db", "nexora-2026-10-03_0800.db"]);
        assert!(target.join("bilder").join("a.png").exists());
        assert!(target.join("anhaenge").join("id1").join("Bericht.pdf").exists());
        fs::remove_dir_all(base).unwrap();
    }
}
