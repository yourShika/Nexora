// OneNote-Brücke, nur lesend: festes PowerShell-Skript spricht das installierte OneNote über COM an.
// Das Frontend wählt nur den Befehl und gibt IDs mit, eigenen Code kann es nicht ausführen.
use std::os::windows::process::CommandExt;
use std::process::Command;

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
}
