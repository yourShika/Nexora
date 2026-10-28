// Texterkennung mit der in Windows eingebauten OCR: offline, ohne Download,
// erkennt die Sprachen, die in Windows installiert sind.
use std::path::Path;
use tauri::{AppHandle, Manager};
use windows::core::HSTRING;
use windows::Graphics::Imaging::BitmapDecoder;
use windows::Media::Ocr::OcrEngine;
use windows::Storage::{FileAccessMode, StorageFile};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

fn recognize(path: &Path) -> windows::core::Result<String> {
    // Der Hilfsthread braucht WinRT; "schon initialisiert" ist kein Fehler
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.join()?;
    let stream = file.OpenAsync(FileAccessMode::Read)?.join()?;
    let bitmap = BitmapDecoder::CreateAsync(&stream)?.join()?.GetSoftwareBitmapAsync()?.join()?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
    let mut lines = Vec::new();
    for line in engine.RecognizeAsync(&bitmap)?.join()?.Lines()? {
        lines.push(line.Text()?.to_string_lossy());
    }
    Ok(lines.join("\n"))
}

// Erkannter Text eines Bilds aus <Daten>\bilder, Zeilen durch \n getrennt
#[tauri::command]
pub async fn ocr_image(app: AppHandle, name: String) -> Result<String, String> {
    if !crate::files::valid_image_name(&name) {
        return Err("Ungültiger Bildname".into());
    }
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("bilder").join(&name);
    tauri::async_runtime::spawn_blocking(move || recognize(&path).map_err(|e| format!("Texterkennung: {e}")))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    // Bild mit Text über System.Drawing malen (gibt es in jedem Windows) und zurücklesen
    #[test]
    fn erkennt_text() {
        let path = std::env::temp_dir().join(format!("nexora-ocr-{}.png", std::process::id()));
        let script = format!(
            "Add-Type -AssemblyName System.Drawing; $b = New-Object Drawing.Bitmap 900,160; $g = [Drawing.Graphics]::FromImage($b); \
             $g.Clear([Drawing.Color]::White); $g.DrawString('Switch Rack 3 tauschen', (New-Object Drawing.Font 'Arial',36), [Drawing.Brushes]::Black, 20, 40); \
             $b.Save('{}'); $g.Dispose(); $b.Dispose()",
            path.display()
        );
        let ok = std::process::Command::new("powershell").args(["-NoProfile", "-Command", &script]).status().unwrap().success();
        assert!(ok, "Testbild nicht erzeugt");
        let text = recognize(&path).expect("OCR fehlgeschlagen");
        let _ = std::fs::remove_file(&path);
        assert!(text.contains("Rack 3"), "erkannt: {text}");
    }
}
