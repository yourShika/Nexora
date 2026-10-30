// OneNote-Brücke, nur lesend: festes PowerShell-Skript spricht das installierte OneNote über COM an.
// Das Frontend wählt nur den Befehl und gibt IDs mit, eigenen Code kann es nicht ausführen.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::os::windows::process::CommandExt;
use std::process::Command;
use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
use windows::UI::Input::Inking::InkStrokeContainer;
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

const SCRIPT: &str = include_str!("onenote.ps1");
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// OneNote-IDs sehen aus wie {GUID}{1}{B0}; mehrere durch ; getrennt
fn valid_ids(ids: &str) -> bool {
    ids.chars().all(|c| c.is_ascii_alphanumeric() || "{}-;".contains(c))
}

fn call(op: &str, id: &str) -> Result<String, String> {
    // -EncodedCommand umgeht jede Maskierung von Anführungszeichen
    let utf16: Vec<u8> = SCRIPT.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let encoded = base64(&utf16);
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded])
        .env("NEXORA_OP", op)
        .env("NEXORA_ID", id)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("PowerShell nicht gestartet: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() { "OneNote antwortet nicht".into() } else { err });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub(crate) fn base64(bytes: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | (*b as u32) << (16 - 8 * i));
        for i in 0..4 {
            s.push(if i <= chunk.len() { ABC[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    s
}

#[tauri::command]
pub async fn onenote(op: String, id: String) -> Result<String, String> {
    if !matches!(op.as_str(), "notebooks" | "notebook" | "pages" | "pageinfo") || !valid_ids(&id) {
        return Err("Ungültige Anfrage an OneNote".into());
    }
    tauri::async_runtime::spawn_blocking(move || call(&op, &id)).await.map_err(|e| e.to_string())?
}

// Ein Freihand-Strich in DIPs (1/96 Zoll), wie Windows ihn aus dem ISF liest
#[derive(Serialize)]
pub struct Stroke {
    color: String,
    width: f32,
    marker: bool,
    points: Vec<[f32; 2]>,
}

// Freihand aus OneNote kommt als ISF (Ink Serialized Format); das liest Windows selbst über InkStrokeContainer
fn ink(isf: &[u8]) -> windows::core::Result<Vec<Stroke>> {
    let stream = InMemoryRandomAccessStream::new()?;
    let writer = DataWriter::CreateDataWriter(&stream)?;
    writer.WriteBytes(isf)?;
    writer.StoreAsync()?.join()?;
    writer.DetachStream()?;
    let container = InkStrokeContainer::new()?;
    container.LoadAsync(&stream.GetInputStreamAt(0)?)?.join()?;
    let mut out = Vec::new();
    for s in container.GetStrokes()? {
        let a = s.DrawingAttributes()?;
        let c = a.Color()?;
        let points = s.GetInkPoints()?.into_iter().filter_map(|p| p.Position().ok()).map(|q| [q.X, q.Y]).collect();
        out.push(Stroke { color: format!("#{:02x}{:02x}{:02x}", c.R, c.G, c.B), width: a.Size()?.Width, marker: a.DrawAsHighlighter()?, points });
    }
    Ok(out)
}

// Mehrere Freihand-Stücke (Base64) auf einmal; was Windows nicht lesen kann, kommt als null zurück
#[tauri::command]
pub async fn onenote_ink(data: Vec<String>) -> Result<Vec<Option<Vec<Stroke>>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        data.iter().map(|b| STANDARD.decode(b.trim()).ok().and_then(|bytes| ink(&bytes).ok())).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_und_base64() {
        assert!(valid_ids("{12AB-34}{1}{B0};{CD}{1}{B0}"));
        assert!(!valid_ids("x'; Remove-Item"));
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"M"), "TQ==");
    }

    // Striche mit Windows bauen, als ISF speichern (wie OneNote) und wieder lesen
    #[test]
    fn freihand_aus_isf() {
        use windows_collections::IIterable;
        use windows::Foundation::Point;
        use windows::Storage::Streams::DataReader;
        use windows::UI::Input::Inking::InkStrokeBuilder;
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let builder = InkStrokeBuilder::new().unwrap();
        let pts: Vec<Point> = (0..20).map(|i| Point { X: 10.0 + i as f32 * 5.0, Y: 40.0 + (i as f32).sin() * 8.0 }).collect();
        let stroke = builder.CreateStroke(&IIterable::from(pts)).unwrap();
        let container = InkStrokeContainer::new().unwrap();
        container.AddStroke(&stroke).unwrap();
        let stream = InMemoryRandomAccessStream::new().unwrap();
        container.SaveAsync(&stream.GetOutputStreamAt(0).unwrap()).unwrap().join().unwrap();
        let size = stream.Size().unwrap() as u32;
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).unwrap()).unwrap();
        reader.LoadAsync(size).unwrap().join().unwrap();
        let mut isf = vec![0u8; size as usize];
        reader.ReadBytes(&mut isf).unwrap();

        let strokes = ink(&isf).expect("ISF lesbar");
        assert_eq!(strokes.len(), 1);
        assert!(strokes[0].points.len() >= 10, "Punkte: {}", strokes[0].points.len());
        let xs: Vec<f32> = strokes[0].points.iter().map(|p| p[0]).collect();
        assert!(xs.iter().cloned().fold(f32::MIN, f32::max) - xs.iter().cloned().fold(f32::MAX, f32::min) > 80.0);
        assert!(ink(b"kein isf").is_err());
    }
}
