// Vorschau von Anhängen wie ein OneNote-Dateiausdruck: Seiten als Bilder in <Daten>\vorschau\<uuid>\.
// PDF direkt über Windows.Data.Pdf, Word/Excel/PowerPoint vorher über das installierte Office (office.ps1) als PDF.
// Anhänge ändern sich nie (eigene UUID je Datei), darum bleibt die Vorschau einfach liegen.
use serde::Serialize;
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use windows::core::HSTRING;
use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
use windows::Storage::Streams::{DataReader, InMemoryRandomAccessStream};
use windows::Storage::StorageFile;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

const SCRIPT: &str = include_str!("office.ps1");
const NO_WINDOW: u32 = 0x0800_0000;
const MAX_PAGES: u32 = 50; // mehr zeigt die Notiz nicht; die ganze Datei öffnet "Öffnen"
const WIDTH: u32 = 1400;
pub(crate) const OFFICE: [&str; 13] = ["doc", "docx", "docm", "rtf", "odt", "xls", "xlsx", "xlsm", "ods", "ppt", "pptx", "pptm", "odp"];

#[derive(Serialize, serde::Deserialize)]
pub struct Preview {
    pages: Vec<String>,
    total: u32,
}

pub(crate) fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("vorschau"))
}

// Office-Datei -> PDF; fertig ist es, sobald die Merkdatei steht (Office darf sich danach in Ruhe beenden)
fn convert(src: &Path, pdf: &Path) -> Result<(), String> {
    let done = pdf.with_extension("fertig");
    let pid = pdf.with_extension("pid");
    let utf16: Vec<u8> = SCRIPT.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let mut child = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &crate::onenote::base64(&utf16)])
        .env("NEXORA_SRC", src)
        .env("NEXORA_PDF", pdf)
        .env("NEXORA_DONE", &done)
        .env("NEXORA_PID", &pid)
        .creation_flags(NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("PowerShell nicht gestartet: {e}"))?;
    let start = Instant::now();
    loop {
        if done.exists() {
            let _ = fs::remove_file(&done);
            let _ = fs::remove_file(&pid);
            return Ok(());
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if done.exists() {
                continue;
            }
            let mut err = String::new();
            if let Some(mut e) = child.stderr.take() {
                let _ = std::io::Read::read_to_string(&mut e, &mut err);
            }
            let first = err.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
            return Err(if first.is_empty() { format!("Office hat die Datei nicht umgewandelt ({status})") } else { format!("Office: {first}") });
        }
        // Hängt Office (z. B. an einem unsichtbaren Dialog): nur das Office beenden, das das Skript selbst gestartet hat
        if start.elapsed() > Duration::from_secs(180) {
            let _ = child.kill();
            if let Some(id) = fs::read_to_string(&pid).ok().and_then(|s| s.trim().parse::<u32>().ok()) {
                let _ = Command::new("taskkill").args(["/PID", &id.to_string(), "/F"]).creation_flags(NO_WINDOW).status();
            }
            return Err("Office antwortet nicht".into());
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

// PDF-Seiten als PNG speichern (höchstens MAX_PAGES); Ergebnis: Dateien und Seitenzahl des Dokuments
fn render(pdf: &Path, out: &Path) -> windows::core::Result<(Vec<PathBuf>, u32)> {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(pdf.as_os_str()))?.join()?;
    let doc = PdfDocument::LoadFromFileAsync(&file)?.join()?;
    let total = doc.PageCount()?;
    let mut pages = Vec::new();
    for i in 0..total.min(MAX_PAGES) {
        let options = PdfPageRenderOptions::new()?;
        options.SetDestinationWidth(WIDTH)?;
        let stream = InMemoryRandomAccessStream::new()?;
        doc.GetPage(i)?.RenderWithOptionsToStreamAsync(&stream, &options)?.join()?;
        let size = stream.Size()? as u32;
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.LoadAsync(size)?.join()?;
        let mut bytes = vec![0u8; size as usize];
        reader.ReadBytes(&mut bytes)?;
        let path = out.join(format!("{:03}.png", i + 1));
        fs::write(&path, bytes).map_err(|e| windows::core::Error::new(windows::core::HRESULT(-1), e.to_string()))?;
        pages.push(path);
    }
    Ok((pages, total))
}

fn build(src: &Path, out: &Path) -> Result<Preview, String> {
    let index = out.join("seiten.json");
    if let Ok(saved) = fs::read_to_string(&index) {
        if let Ok(p) = serde_json::from_str::<Preview>(&saved) {
            return Ok(p);
        }
    }
    fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    let (files, total) = if ext == "pdf" {
        render(src, out).map_err(|e| format!("Vorschau: {e}"))?
    } else if OFFICE.contains(&ext.as_str()) {
        // Office öffnet auf manchen PCs nichts aus AppData\Roaming ("Datei nicht gefunden"): Umweg über den Temp-Ordner
        let work = std::env::temp_dir().join(format!("nexora-vorschau-{}-{}", std::process::id(), out.file_name().and_then(|n| n.to_str()).unwrap_or("x")));
        fs::create_dir_all(&work).map_err(|e| e.to_string())?;
        let copy = work.join(format!("datei.{ext}"));
        let result = fs::copy(src, &copy)
            .map_err(|e| e.to_string())
            .and_then(|_| convert(&copy, &work.join("dokument.pdf")))
            .and_then(|_| render(&work.join("dokument.pdf"), out).map_err(|e| format!("Vorschau: {e}")));
        let _ = fs::remove_dir_all(&work);
        result?
    } else {
        return Err("Für diesen Dateityp gibt es keine Vorschau".into());
    };
    let preview = Preview { pages: files.iter().map(|p| p.display().to_string()).collect(), total };
    let _ = fs::write(&index, serde_json::to_string(&preview).unwrap_or_default());
    Ok(preview)
}

// Seiten eines Anhangs ("uuid/Name") als Bilder; beim ersten Mal wird erzeugt, danach nur gelesen
#[tauri::command]
pub async fn attachment_preview(app: AppHandle, rel: String) -> Result<Preview, String> {
    let src = crate::attach::resolve(&app, &rel)?;
    let id = rel.split('/').next().unwrap_or_default().to_string();
    let out = dir(&app)?.join(id);
    tauri::async_runtime::spawn_blocking(move || build(&src, &out)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    // PDF wie in doctext.rs von Hand bauen, als Vorschau rendern und erneut (aus dem Zwischenspeicher) lesen
    #[test]
    fn pdf_seiten_als_bilder() {
        let base = std::env::temp_dir().join(format!("nexora-vorschau-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let pdf = base.join("a.pdf");
        fs::write(&pdf, crate::doctext::tests::sample_pdf(&["Seite eins", "Seite zwei"])).unwrap();
        let out = base.join("cache");
        let p = build(&pdf, &out).expect("Vorschau");
        assert_eq!((p.pages.len(), p.total), (2, 2));
        assert!(fs::read(&p.pages[0]).unwrap().starts_with(b"\x89PNG"));
        let again = build(&pdf, &out).unwrap();
        assert_eq!(again.pages, p.pages);
        let _ = fs::remove_dir_all(&base);
    }

    // Kleinste gültige Word-Datei als Zip (ohne Word zu fernsteuern), dann über das installierte Word umwandeln
    #[test]
    #[ignore] // braucht Word; von Hand: cargo test --lib word_als_vorschau -- --ignored
    fn word_als_vorschau() {
        use std::io::Write;
        let base = std::env::temp_dir().join(format!("nexora-word-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let docx = base.join("brief.docx");
        let mut zip = zip::ZipWriter::new(fs::File::create(&docx).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        let parts = [
            ("[Content_Types].xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#),
            ("_rels/.rels", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#),
            ("word/document.xml", r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hallo aus Word</w:t></w:r></w:p></w:body></w:document>"#),
        ];
        for (name, xml) in parts {
            zip.start_file(name, opts).unwrap();
            zip.write_all(xml.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        let p = build(&docx, &base.join("cache")).expect("Word-Vorschau");
        assert_eq!(p.total, 1);
        let _ = fs::remove_dir_all(&base);
    }
}
