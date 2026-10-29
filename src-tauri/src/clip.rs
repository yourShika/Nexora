// Windows-Zwischenablage und Einfügen in andere Programme.
// Genutzt vom Tresor (Passwort kopieren), von "Zwischenablage in den Eingang" und vom Snippet-Picker.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use windows::core::HSTRING;
use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

const CF_UNICODETEXT: u32 = 13;
const CF_DIB: u32 = 8;

// Ein anderes Programm hält die Zwischenablage manchmal kurz fest
fn open() -> windows::core::Result<()> {
    for _ in 0..10 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    unsafe { OpenClipboard(None) }
}

unsafe fn set(format: u32, bytes: &[u8]) -> windows::core::Result<()> {
    let mem = GlobalAlloc(GMEM_MOVEABLE, bytes.len())?;
    let ptr = GlobalLock(mem) as *mut u8;
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
    let _ = GlobalUnlock(mem); // meldet beim letzten Entsperren "Fehler 0"
    SetClipboardData(format, Some(HANDLE(mem.0)))?;
    Ok(())
}

// Gibt die Sequenznummer zurück, an der man später erkennt, ob jemand anderes kopiert hat
pub fn put(text: &str, private: bool) -> windows::core::Result<u32> {
    open()?;
    unsafe {
        let result = (|| {
            EmptyClipboard()?;
            let wide: Vec<u8> = text.encode_utf16().chain([0]).flat_map(u16::to_le_bytes).collect();
            set(CF_UNICODETEXT, &wide)?;
            if private {
                // Windows-Zwischenablageverlauf (Win+V) und Cloud-Abgleich lassen solche Inhalte aus
                for name in ["ExcludeClipboardContentFromMonitorProcessing", "CanIncludeInClipboardHistory", "CanUploadToCloudClipboard"] {
                    set(RegisterClipboardFormatW(&HSTRING::from(name)), &0u32.to_le_bytes())?;
                }
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        // erst nach dem Schließen gezählt
        result.map(|_| GetClipboardSequenceNumber())
    }
}

pub fn clear_if_unchanged(seq: u32) {
    unsafe {
        if GetClipboardSequenceNumber() == seq && open().is_ok() {
            let _ = EmptyClipboard();
            let _ = CloseClipboard();
        }
    }
}

// Inhalt eines Formats als Bytes (gesperrt lesen, kopieren, entsperren)
fn read(format: u32) -> Option<Vec<u8>> {
    unsafe {
        IsClipboardFormatAvailable(format).ok()?;
        open().ok()?;
        let bytes = (|| {
            let h = HGLOBAL(GetClipboardData(format).ok()?.0);
            let ptr = GlobalLock(h) as *const u8;
            if ptr.is_null() {
                return None;
            }
            let v = std::slice::from_raw_parts(ptr, GlobalSize(h)).to_vec();
            let _ = GlobalUnlock(h);
            Some(v)
        })();
        let _ = CloseClipboard();
        bytes
    }
}

pub fn read_text() -> Option<String> {
    let bytes = read(CF_UNICODETEXT)?;
    let wide: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|&c| c != 0).collect();
    Some(String::from_utf16_lossy(&wide))
}

// Bild der Zwischenablage (CF_DIB) als BMP-Datei: Dateikopf davor, Bildpunkte beginnen hinter Kopf, Masken, Palette
fn bmp_file(dib: &[u8]) -> Option<Vec<u8>> {
    if dib.len() < 40 {
        return None;
    }
    let u32_at = |i: usize| u32::from_le_bytes([dib[i], dib[i + 1], dib[i + 2], dib[i + 3]]);
    let header = u32_at(0) as usize;
    let bits = u16::from_le_bytes([dib[14], dib[15]]);
    let masks = if u32_at(16) == 3 && header == 40 { 12 } else { 0 }; // BI_BITFIELDS
    let used = u32_at(32) as usize;
    let palette = if used > 0 { used * 4 } else if bits <= 8 { (1usize << bits) * 4 } else { 0 };
    let offset = 14 + header + masks + palette;
    let mut out = Vec::with_capacity(14 + dib.len());
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&((14 + dib.len()) as u32).to_le_bytes());
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&(offset as u32).to_le_bytes());
    out.extend_from_slice(dib);
    Some(out)
}

#[derive(Serialize)]
pub struct Clip {
    text: Option<String>,
    bmp: Option<String>, // Base64; die Oberfläche macht daraus PNG
}

#[tauri::command]
pub async fn clipboard_read() -> Result<Clip, String> {
    tauri::async_runtime::spawn_blocking(|| Clip { text: read_text(), bmp: read(CF_DIB).and_then(|d| bmp_file(&d)).map(|b| STANDARD.encode(b)) })
        .await
        .map_err(|e| e.to_string())
}

// Snippet-Picker: welches Fenster vorher vorne war (dorthin wird eingefügt)
#[derive(Default)]
pub struct Picker(Mutex<isize>);

#[tauri::command]
pub fn toggle_picker(app: AppHandle, picker: State<Picker>) {
    let Some(w) = app.get_webview_window("picker") else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    *picker.0.lock().unwrap() = unsafe { GetForegroundWindow() }.0 as isize;
    let _ = w.center();
    let _ = w.show();
    let _ = w.set_focus();
}

fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() }, ..Default::default() } },
    }
}

// Text ins vorher aktive Fenster einfügen: über die Zwischenablage und Strg+V, danach die alte Zwischenablage zurück.
// {{vault:…}} setzt der Tresor ein; dann ist die Zwischenablage privat (nicht im Verlauf) und wird danach geleert
#[tauri::command]
pub async fn picker_paste(app: AppHandle, picker: State<'_, Picker>, vault: State<'_, crate::vault::Vault>, text: String) -> Result<(), String> {
    let target = *picker.0.lock().unwrap();
    let v = vault.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (text, secrets) = crate::vault::fill(&v, &text)?;
        let before = read_text();
        let seq = put(&text, !secrets.is_empty()).map_err(|e| format!("Zwischenablage: {e}"))?;
        if let Some(w) = app.get_webview_window("picker") {
            let _ = w.hide();
        }
        unsafe {
            let _ = SetForegroundWindow(HWND(target as _));
        }
        std::thread::sleep(Duration::from_millis(150));
        // Nie in ein anderes Fenster tippen als das, aus dem der Picker geöffnet wurde
        if unsafe { GetForegroundWindow() }.0 as isize != target {
            if !secrets.is_empty() {
                std::thread::spawn(move || (std::thread::sleep(Duration::from_secs(30)), clear_if_unchanged(seq)));
            }
            return Err("Das Fenster ließ sich nicht nach vorne holen; der Text liegt in der Zwischenablage, mit Strg+V selbst einfügen.".into());
        }
        let keys = [key(VK_CONTROL, false), key(VIRTUAL_KEY(b'V' as u16), false), key(VIRTUAL_KEY(b'V' as u16), true), key(VK_CONTROL, true)];
        unsafe { SendInput(&keys, std::mem::size_of::<INPUT>() as i32) };
        // Das Zielprogramm liest die Zwischenablage etwas verzögert
        std::thread::sleep(Duration::from_millis(400));
        match before {
            // auch Zurückgelegtes nicht in den Verlauf: es kann selbst ein Passwort gewesen sein
            Some(old) => {
                let _ = put(&old, true);
            }
            None if !secrets.is_empty() => {
                let _ = put("", true).map(clear_if_unchanged);
            }
            None => {}
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bmp_kopf() {
        // 1×1 Pixel, 32 Bit, BI_BITFIELDS mit drei Masken
        let mut dib = vec![0u8; 40 + 12 + 4];
        dib[0] = 40;
        dib[4] = 1;
        dib[8] = 1;
        dib[12] = 1;
        dib[14] = 32;
        dib[16] = 3;
        let bmp = bmp_file(&dib).unwrap();
        assert_eq!(&bmp[0..2], b"BM");
        assert_eq!(u32::from_le_bytes(bmp[2..6].try_into().unwrap()) as usize, 14 + dib.len());
        assert_eq!(u32::from_le_bytes(bmp[10..14].try_into().unwrap()), 14 + 40 + 12);
        assert!(bmp_file(&[0; 10]).is_none());
    }

    // Verändert die echte Zwischenablage, darum nur auf Wunsch: cargo test -- --ignored
    #[test]
    #[ignore]
    fn zwischenablage() {
        let seq = put("nexora-test ü", true).unwrap();
        assert_eq!(read_text().as_deref(), Some("nexora-test ü"));
        clear_if_unchanged(seq);
        assert_eq!(read_text(), None);
    }
}
