// Text aus Anhängen für die Suche: PDF Seite für Seite über die Windows-Texterkennung,
// Word/Excel/PowerPoint und Textdateien direkt. Ergebnis: eine Zeichenkette je Seite bzw. Folie.
use std::fs;
use std::io::Read;
use std::path::Path;
use tauri::AppHandle;
use windows::core::HSTRING;
use windows::Data::Pdf::{PdfDocument, PdfPageRenderOptions};
use windows::Graphics::Imaging::BitmapDecoder;
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::InMemoryRandomAccessStream;
use windows::Storage::StorageFile;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

const OFFICE: [&str; 3] = ["docx", "xlsx", "pptx"];
const TEXT: [&str; 22] = [
    "txt", "log", "csv", "tsv", "md", "ps1", "psm1", "psd1", "json", "xml", "yml", "yaml", "ini", "cfg", "conf", "sql", "bat", "cmd", "sh", "py", "html", "reg",
];
const MAX_TEXT: usize = 5 * 1024 * 1024; // mehr Text je Datei braucht die Suche nicht
const MAX_PART: u64 = 50 * 1024 * 1024; // Obergrenze je Teil im Office-Zip (Schutz vor Zip-Bomben)

fn ext(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}

pub(crate) fn readable(path: &Path) -> bool {
    let e = ext(path);
    e == "pdf" || OFFICE.contains(&e.as_str()) || TEXT.contains(&e.as_str())
}

// Jede PDF-Seite als Bild rendern (etwa 200 dpi) und erkennen; Seiten durch Einträge im Vec getrennt
fn pdf_pages(path: &Path) -> windows::core::Result<Vec<String>> {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.join()?;
    let doc = PdfDocument::LoadFromFileAsync(&file)?.join()?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
    let max = OcrEngine::MaxImageDimension()? as f32;
    let mut pages = Vec::new();
    for i in 0..doc.PageCount()? {
        let page = doc.GetPage(i)?;
        let size = page.Size()?;
        let scale = 2.0_f32.min(max / size.Width.max(size.Height).max(1.0));
        let options = PdfPageRenderOptions::new()?;
        options.SetDestinationWidth((size.Width * scale) as u32)?;
        let stream = InMemoryRandomAccessStream::new()?;
        page.RenderWithOptionsToStreamAsync(&stream, &options)?.join()?;
        let bitmap = BitmapDecoder::CreateAsync(&stream)?.join()?.GetSoftwareBitmapAsync()?.join()?;
        pages.push(crate::ocr::lines(&engine, &bitmap)?);
    }
    Ok(pages)
}

// XML auf Text reduzieren: Absatzende wird Zeilenumbruch, Tags fallen weg, Entities werden aufgelöst
fn xml_text(xml: &str, para_end: &str) -> String {
    let xml = xml.replace(para_end, "\n");
    let mut out = String::with_capacity(xml.len() / 4);
    let mut in_tag = false;
    for c in xml.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    unescape(&out)
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest[..rest.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..end];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if ent.starts_with("#x") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn part(zip: &mut zip::ZipArchive<fs::File>, name: &str) -> Option<String> {
    let mut s = String::new();
    zip.by_name(name).ok()?.take(MAX_PART).read_to_string(&mut s).ok()?;
    Some(s)
}

fn office_pages(path: &Path, kind: &str) -> Result<Vec<String>, String> {
    let mut zip = zip::ZipArchive::new(fs::File::open(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(match kind {
        "docx" => vec![xml_text(&part(&mut zip, "word/document.xml").ok_or("Kein Word-Dokument")?, "</w:p>")],
        // Zellen mit Text stehen in sharedStrings; Zahlen braucht die Suche selten
        "xlsx" => vec![part(&mut zip, "xl/sharedStrings.xml").map(|x| xml_text(&x, "</si>")).unwrap_or_default()],
        _ => {
            // Folien in ihrer Reihenfolge: slide1.xml, slide2.xml, … (nicht alphabetisch)
            let mut slides: Vec<(u32, String)> = zip
                .file_names()
                .filter_map(|n| Some((n.strip_prefix("ppt/slides/slide")?.strip_suffix(".xml")?.parse().ok()?, n.to_string())))
                .collect();
            slides.sort();
            slides.into_iter().map(|(_, n)| part(&mut zip, &n).map(|x| xml_text(&x, "</a:p>")).unwrap_or_default()).collect()
        }
    })
}

// UTF-8 (auch mit BOM), UTF-16 mit BOM (z. B. aus PowerShell 5.1), sonst Windows-1252
fn decode(bytes: &[u8]) -> String {
    if let Some(b) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        return String::from_utf16_lossy(&b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<_>>());
    }
    if let Some(b) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        return String::from_utf16_lossy(&b.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect::<Vec<_>>());
    }
    let b = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    // shortcut: 0x80–0x9F als Latin-1 statt der 1252-Sonderzeichen (€, „ …); Umlaute stimmen
    String::from_utf8(b.to_vec()).unwrap_or_else(|_| b.iter().map(|&c| c as char).collect())
}

fn cap(mut pages: Vec<String>) -> Vec<String> {
    let mut total = 0;
    for p in pages.iter_mut() {
        if total + p.len() > MAX_TEXT {
            let mut cut = MAX_TEXT.saturating_sub(total);
            while !p.is_char_boundary(cut) {
                cut -= 1;
            }
            p.truncate(cut);
        }
        total += p.len();
    }
    pages
}

pub(crate) fn pages(path: &Path) -> Result<Vec<String>, String> {
    let kind = ext(path);
    let pages = match kind.as_str() {
        "pdf" => pdf_pages(path).map_err(|e| format!("PDF: {e}"))?,
        k if OFFICE.contains(&k) => office_pages(path, k)?,
        k if TEXT.contains(&k) => {
            let mut bytes = Vec::new();
            fs::File::open(path).map_err(|e| e.to_string())?.take(MAX_TEXT as u64).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            vec![decode(&bytes)]
        }
        _ => return Err("Dateityp wird nicht durchsucht".into()),
    };
    Ok(cap(pages))
}

// Anhänge, aus denen sich Text lesen lässt ("uuid/Name")
#[tauri::command]
pub fn list_text_attachments(app: AppHandle) -> Result<Vec<String>, String> {
    let root = crate::attach::attachments(&app)?;
    let Ok(dirs) = fs::read_dir(&root) else { return Ok(vec![]) };
    let mut out = Vec::new();
    for dir in dirs.flatten() {
        let id = dir.file_name().to_string_lossy().to_string();
        for f in fs::read_dir(dir.path()).into_iter().flatten().flatten() {
            let rel = format!("{id}/{}", f.file_name().to_string_lossy());
            if readable(&f.path()) && crate::attach::resolve(&app, &rel).is_ok() {
                out.push(rel);
            }
        }
    }
    Ok(out)
}

// Text je Seite (PDF), Folie (PowerPoint) oder ein Eintrag für das ganze Dokument
#[tauri::command]
pub async fn attachment_text(app: AppHandle, rel: String) -> Result<Vec<String>, String> {
    let path = crate::attach::resolve(&app, &rel)?;
    tauri::async_runtime::spawn_blocking(move || pages(&path)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn xml_wird_text() {
        let xml = r#"<w:body><w:p><w:r><w:t>Switch &amp; Router</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Größe &#x2264; 3 &lt;ok&gt;</w:t></w:r></w:p></w:body>"#;
        assert_eq!(xml_text(xml, "</w:p>"), "Switch & Router\nGröße ≤ 3 <ok>\n");
        assert_eq!(unescape("A &unbekannt; B & C"), "A &unbekannt; B & C");
    }

    #[test]
    fn kodierungen() {
        assert_eq!(decode("Prüfung".as_bytes()), "Prüfung");
        assert_eq!(decode(&[b'P', b'r', 0xFC, b'f']), "Prüf");
        let utf16: Vec<u8> = [0xFF, 0xFE].into_iter().chain("Grüße".encode_utf16().flat_map(|u| u.to_le_bytes())).collect();
        assert_eq!(decode(&utf16), "Grüße");
    }

    // Word-Datei als Zip bauen und lesen
    #[test]
    fn liest_docx() {
        let path = std::env::temp_dir().join(format!("nexora-doc-{}.docx", std::process::id()));
        let script = format!(
            "Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::Open('{}', 'Create'); \
             $e = $z.CreateEntry('word/document.xml'); $w = New-Object IO.StreamWriter($e.Open()); \
             $w.Write('<w:document><w:body><w:p><w:t>Firewall Regel 42</w:t></w:p></w:body></w:document>'); $w.Close(); $z.Dispose()",
            path.display()
        );
        let ok = std::process::Command::new("powershell").args(["-NoProfile", "-Command", &script]).status().unwrap().success();
        assert!(ok, "Testdatei nicht erzeugt");
        let text = pages(&path).expect("docx nicht gelesen");
        let _ = fs::remove_file(&path);
        assert_eq!(text, vec!["Firewall Regel 42\n".to_string()]);
    }

    // PDF von Hand bauen (eine Zeile Helvetica je Seite): "Microsoft Print to PDF" ist umständlich, Word fehlt eventuell
    pub(crate) fn sample_pdf(texts: &[&str]) -> String {
        let n = texts.len();
        let kids: Vec<String> = (0..n).map(|i| format!("{} 0 R", 3 + i * 2)).collect();
        let mut objs = vec!["<< /Type /Catalog /Pages 2 0 R >>".to_string(), format!("<< /Type /Pages /Kids [{}] /Count {n} >>", kids.join(" "))];
        for (i, t) in texts.iter().enumerate() {
            let content = format!("BT /F1 36 Tf 60 700 Td ({t}) Tj ET");
            objs.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {} 0 R /Resources << /Font << /F1 {} 0 R >> >> >>", 4 + i * 2, 3 + n * 2));
            objs.push(format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()));
        }
        objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string());
        let mut pdf = String::from("%PDF-1.4\n");
        let mut offsets = Vec::new();
        for (i, o) in objs.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.push_str(&format!("{} 0 obj\n{o}\nendobj\n", i + 1));
        }
        let xref = pdf.len();
        pdf.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1));
        for o in offsets {
            pdf.push_str(&format!("{o:010} 00000 n \n"));
        }
        pdf.push_str(&format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objs.len() + 1));
        pdf
    }

    #[test]
    fn erkennt_pdf() {
        let path = std::env::temp_dir().join(format!("nexora-pdf-{}.pdf", std::process::id()));
        fs::write(&path, sample_pdf(&["Switch Rack 3 tauschen"])).unwrap();
        let text = pages(&path).expect("PDF nicht erkannt");
        let _ = fs::remove_file(&path);
        assert_eq!(text.len(), 1);
        assert!(text[0].contains("Rack 3"), "erkannt: {text:?}");
    }
}
