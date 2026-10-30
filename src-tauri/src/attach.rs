// Anhänge (<Daten>\anhaenge\<uuid>\<Dateiname>), Textdateien für den Import lesen,
// Markdown-Export schreiben. Pfade vom Frontend werden streng geprüft.
use serde::Deserialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const MAX_ATTACHMENT: u64 = 200 * 1024 * 1024;
const MAX_TEXT: u64 = 20 * 1024 * 1024;
// Öffnen per Klick würde diese Dateien ausführen; dafür gibt es nur "Im Ordner zeigen"
const RUNNABLE: [&str; 14] = ["exe", "msi", "bat", "cmd", "com", "ps1", "vbs", "js", "jse", "wsf", "scr", "lnk", "reg", "hta"];

pub(crate) fn attachments(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("anhaenge"))
}

// Dateiname ohne Pfad und ohne Zeichen, die Windows oder unser Markdown stören
pub fn clean_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*[]".contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches(['.', ' ']).to_string();
    if cleaned.is_empty() { "Datei".into() } else { cleaned }
}

fn valid_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

// "uuid/Dateiname" -> voller Pfad im Anhang-Ordner, sonst Fehler
pub(crate) fn resolve(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    let (id, name) = rel.split_once('/').ok_or("Ungültiger Anhang")?;
    if !valid_uuid(id) || name != clean_name(name) {
        return Err("Ungültiger Anhang".into());
    }
    Ok(attachments(app)?.join(id).join(name))
}

fn store(app: &AppHandle, id: &str, name: &str, write: impl FnOnce(&Path) -> std::io::Result<()>) -> Result<String, String> {
    if !valid_uuid(id) {
        return Err("Ungültige ID".into());
    }
    let name = clean_name(name);
    let dir = attachments(app)?.join(id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write(&dir.join(&name)).map_err(|e| format!("Anhang nicht gespeichert: {e}"))?;
    Ok(format!("{id}/{name}"))
}

// Abgelegte Datei: Bytes im Body, ID und (URL-kodierter) Name in den Headern
#[tauri::command]
pub fn save_attachment(app: AppHandle, request: Request) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Keine Dateidaten erhalten".into());
    };
    if bytes.len() as u64 > MAX_ATTACHMENT {
        return Err("Datei ist größer als 200 MB".into());
    }
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
    let name = percent_decode(&header("x-file"));
    store(&app, &header("x-id"), &name, |p| fs::write(p, bytes))
}

// Datei aus dem Dateidialog übernehmen; name: anderer Dateiname (OneNote legt Dateien als .bin im Zwischenspeicher ab)
#[tauri::command]
pub fn import_attachment(app: AppHandle, source: String, id: String, name: Option<String>) -> Result<(String, u64), String> {
    let size = fs::metadata(&source).map_err(|e| e.to_string())?.len();
    if size > MAX_ATTACHMENT {
        return Err("Datei ist größer als 200 MB".into());
    }
    let rel = store(&app, &id, name.as_deref().unwrap_or(&source), |p| fs::copy(&source, p).map(|_| ()))?;
    Ok((rel, size))
}

#[tauri::command]
pub fn open_attachment(app: AppHandle, rel: String) -> Result<(), String> {
    let path = resolve(&app, &rel)?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    if RUNNABLE.contains(&ext.as_str()) {
        return Err("Ausführbare Dateien werden nicht per Klick geöffnet".into());
    }
    app.opener().open_path(path.display().to_string(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_attachment(app: AppHandle, rel: String) -> Result<(), String> {
    let path = resolve(&app, &rel)?;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

// Textdatei für den Import (.txt/.md/.log); dekodiert wird im Frontend (UTF-8 oder Windows-1252)
#[tauri::command]
pub fn read_text_file(path: String) -> Result<Response, String> {
    let p = Path::new(&path);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    if !["txt", "md", "markdown", "log", "csv"].contains(&ext.as_str()) {
        return Err("Nur .txt, .md, .csv oder .log".into());
    }
    if fs::metadata(p).map_err(|e| e.to_string())?.len() > MAX_TEXT {
        return Err("Datei ist größer als 20 MB".into());
    }
    Ok(Response::new(fs::read(p).map_err(|e| e.to_string())?))
}

#[derive(Deserialize)]
pub struct ExportFile {
    path: String,
    content: String,
}

#[derive(Deserialize)]
pub struct ExportCopy {
    from: String,
    to: String,
}

// Nur einfache relative Pfade: kein Laufwerk, kein "..", kein Wurzelpfad
fn safe_rel(rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.components().all(|c| matches!(c, Component::Normal(_))) && !rel.is_empty() {
        Ok(p.to_path_buf())
    } else {
        Err(format!("Ungültiger Pfad im Export: {rel}"))
    }
}

// Export schreiben: Textdateien und Kopien von Bildern/Anhängen aus dem Datenordner
#[tauri::command]
pub fn export_files(app: AppHandle, target: String, files: Vec<ExportFile>, copies: Vec<ExportCopy>) -> Result<usize, String> {
    let root = Path::new(&target);
    let data = app.path().app_config_dir().map_err(|e| e.to_string())?;
    for f in &files {
        let dest = root.join(safe_rel(&f.path)?);
        fs::create_dir_all(dest.parent().unwrap_or(root)).map_err(|e| e.to_string())?;
        fs::write(&dest, &f.content).map_err(|e| format!("{}: {e}", f.path))?;
    }
    for c in &copies {
        let (from, to) = (data.join(safe_rel(&c.from)?), root.join(safe_rel(&c.to)?));
        if !(c.from.starts_with("bilder/") || c.from.starts_with("anhaenge/")) {
            return Err(format!("Nicht erlaubte Quelle: {}", c.from));
        }
        fs::create_dir_all(to.parent().unwrap_or(root)).map_err(|e| e.to_string())?;
        // fehlende Dateien (z. B. gelöscht) überspringen statt den ganzen Export abzubrechen
        let _ = fs::copy(&from, &to);
    }
    Ok(files.len())
}

// Export als Zip (für Notion): dieselben Dateien und Kopien wie export_files, in eine Datei
#[tauri::command]
pub fn export_zip(app: AppHandle, target: String, files: Vec<ExportFile>, copies: Vec<ExportCopy>) -> Result<usize, String> {
    use std::io::Write;
    let data = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(fs::File::create(&target).map_err(|e| e.to_string())?);
    let opts = zip::write::SimpleFileOptions::default();
    let name = |p: &PathBuf| p.to_string_lossy().replace('\\', "/");
    for f in &files {
        zip.start_file(name(&safe_rel(&f.path)?), opts).map_err(|e| e.to_string())?;
        zip.write_all(f.content.as_bytes()).map_err(|e| e.to_string())?;
    }
    for c in &copies {
        if !(c.from.starts_with("bilder/") || c.from.starts_with("anhaenge/")) {
            return Err(format!("Nicht erlaubte Quelle: {}", c.from));
        }
        // fehlende Dateien überspringen wie beim Ordner-Export
        let Ok(bytes) = fs::read(data.join(safe_rel(&c.from)?)) else { continue };
        zip.start_file(name(&safe_rel(&c.to)?), opts).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(files.len())
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok());
            if let Some(b) = hex {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dateinamen_werden_bereinigt() {
        assert_eq!(clean_name("C:\\Temp\\Bericht Q3.pdf"), "Bericht Q3.pdf");
        assert_eq!(clean_name("../../evil.txt"), "evil.txt");
        assert_eq!(clean_name("a|b]c?.txt"), "a_b_c_.txt");
        assert_eq!(clean_name("name. "), "name");
        assert_eq!(clean_name(""), "Datei");
    }

    #[test]
    fn export_pfade_nur_relativ() {
        assert!(safe_rel("Notizbuch/Seite.md").is_ok());
        assert!(safe_rel("../x.md").is_err());
        assert!(safe_rel("C:\\x.md").is_err());
        assert!(safe_rel("/x.md").is_err());
    }

    #[test]
    fn prozent_kodierte_namen() {
        assert_eq!(percent_decode("Gr%C3%BC%C3%9Fe%20Q3.pdf"), "Grüße Q3.pdf");
        assert_eq!(percent_decode("ohne"), "ohne");
    }
}
