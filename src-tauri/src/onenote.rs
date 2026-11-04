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

// Bilder, die WebView2 nicht zeigt, als PNG: EMF (Dateiausdrucke) zeichnet GDI auf weißen Grund, `width` Pixel breit;
// BMP, TIFF und Co. liest der Windows-Bilddecoder in voller Größe
fn picture(bytes: &[u8], width: u32) -> windows::core::Result<Vec<u8>> {
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapEncoder, BitmapPixelFormat, SoftwareBitmap};
    use windows::Storage::Streams::DataReader;
    let out = InMemoryRandomAccessStream::new()?;
    let encoder = BitmapEncoder::CreateAsync(BitmapEncoder::PngEncoderId()?, &out)?.join()?;
    if bytes.len() > 44 && &bytes[40..44] == b" EMF" {
        let (w, h, pixels) = emf(bytes, width)?;
        encoder.SetPixelData(BitmapPixelFormat::Bgra8, BitmapAlphaMode::Ignore, w, h, 96.0, 96.0, &pixels)?;
    } else {
        let stream = InMemoryRandomAccessStream::new()?;
        let writer = DataWriter::CreateDataWriter(&stream)?;
        writer.WriteBytes(bytes)?;
        writer.StoreAsync()?.join()?;
        writer.DetachStream()?;
        let bitmap = BitmapDecoder::CreateAsync(&stream)?.join()?.GetSoftwareBitmapAsync()?.join()?;
        encoder.SetSoftwareBitmap(&SoftwareBitmap::ConvertWithAlpha(&bitmap, BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied)?)?;
    }
    encoder.FlushAsync()?.join()?;
    let size = out.Size()? as u32;
    let reader = DataReader::CreateDataReader(&out.GetInputStreamAt(0)?)?;
    reader.LoadAsync(size)?.join()?;
    let mut png = vec![0u8; size as usize];
    reader.ReadBytes(&mut png)?;
    Ok(png)
}

// EMF → BGRA-Pixel; Höhe aus dem Seitenverhältnis des Bildrahmens, beides gedeckelt (Speicher)
fn emf(bytes: &[u8], width: u32) -> windows::core::Result<(u32, u32, Vec<u8>)> {
    use windows::Win32::Foundation::{E_FAIL, RECT};
    use windows::Win32::Graphics::Gdi::*;
    unsafe {
        let meta = SetEnhMetaFileBits(bytes);
        if meta.is_invalid() {
            return Err(E_FAIL.into());
        }
        let mut head = ENHMETAHEADER::default();
        GetEnhMetaFileHeader(meta, std::mem::size_of::<ENHMETAHEADER>() as u32, Some(&mut head));
        let frame = head.rclFrame;
        let (fw, fh) = ((frame.right - frame.left).max(1) as f64, (frame.bottom - frame.top).max(1) as f64);
        let w = width.clamp(16, 3000);
        let h = ((w as f64 * fh / fw).round() as u32).clamp(1, 6000);
        let dc = CreateCompatibleDC(None);
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: w as i32, biHeight: -(h as i32), biPlanes: 1, biBitCount: 32, ..Default::default() },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let result = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0).and_then(|bmp| {
            let old = SelectObject(dc, bmp.into());
            let pixels = std::slice::from_raw_parts_mut(bits as *mut u8, (w * h * 4) as usize);
            pixels.fill(255);
            let ok = PlayEnhMetaFile(dc, meta, &RECT { left: 0, top: 0, right: w as i32, bottom: h as i32 }).as_bool();
            let _ = GdiFlush();
            pixels.chunks_exact_mut(4).for_each(|p| p[3] = 255);
            let copy = pixels.to_vec();
            SelectObject(dc, old);
            let _ = DeleteObject(bmp.into());
            if ok { Ok((w, h, copy)) } else { Err(E_FAIL.into()) }
        });
        let _ = DeleteDC(dc);
        let _ = DeleteEnhMetaFile(Some(meta));
        result
    }
}

#[tauri::command]
pub async fn onenote_picture(data: String, width: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let bytes = STANDARD.decode(data.trim()).map_err(|e| e.to_string())?;
        picture(&bytes, width).map(|png| STANDARD.encode(png)).map_err(|e| format!("Bild nicht lesbar: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_size(png: &[u8]) -> (u32, u32) {
        let n = |i: usize| u32::from_be_bytes(png[i..i + 4].try_into().unwrap());
        assert_eq!(&png[1..4], b"PNG");
        (n(16), n(20))
    }

    // EMF mit GDI selbst zeichnen (schwarzes Rechteck links oben), dann als PNG in gewünschter Breite
    #[test]
    fn emf_und_bmp_als_png() {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::RECT;
        use windows::Win32::Graphics::Gdi::*;
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let bytes = unsafe {
            // Rahmen 100 × 50 mm (Einheit 0,01 mm)
            let dc = CreateEnhMetaFileW(None, PCWSTR::null(), Some(&RECT { left: 0, top: 0, right: 10000, bottom: 5000 }), PCWSTR::null());
            SelectObject(dc, GetStockObject(BLACK_BRUSH));
            let _ = Rectangle(dc, 0, 0, 40, 40);
            let meta = CloseEnhMetaFile(dc);
            let mut buf = vec![0u8; GetEnhMetaFileBits(meta, None) as usize];
            GetEnhMetaFileBits(meta, Some(&mut buf));
            let _ = DeleteEnhMetaFile(Some(meta));
            buf
        };
        assert_eq!(&bytes[40..44], b" EMF");
        let (w, h, pixels) = emf(&bytes, 400).expect("EMF lesbar");
        assert_eq!((w, h), (400, 200));
        assert!(pixels[..3].iter().all(|&b| b < 50), "links oben schwarz");
        assert!(pixels[pixels.len() - 4..].iter().all(|&b| b == 255), "rechts unten weiß");
        assert_eq!(png_size(&picture(&bytes, 400).unwrap()), (400, 200));
        // BMP 2 × 1, 24 Bit
        let mut bmp = b"BM".to_vec();
        for v in [62u32, 0, 54, 40, 2, 1] {
            bmp.extend(v.to_le_bytes());
        }
        bmp.extend([1, 0, 24, 0]);
        bmp.extend([0u8; 24]);
        bmp.extend([0, 0, 255, 255, 0, 0, 0, 0]);
        assert_eq!(png_size(&picture(&bmp, 400).unwrap()), (2, 1));
        assert!(picture(b"kein bild", 400).is_err());
    }

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
