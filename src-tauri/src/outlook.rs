// Outlook-Brücke über das installierte Outlook (COM), festes PowerShell-Skript wie bei OneNote.
// Lesen aus dem Standardkalender; schreiben nur in den eigenen Unterkalender "Nexora" (Tests: "Nexora-Test").
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

const SCRIPT: &str = include_str!("outlook.ps1");
const NO_WINDOW: u32 = 0x0800_0000;

fn call(op: &str, env: &[(&str, &str)], input: Option<String>) -> Result<String, String> {
    let utf16: Vec<u8> = SCRIPT.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let mut child = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &crate::onenote::base64(&utf16)])
        .env("NEXORA_OP", op)
        .envs(env.iter().copied())
        .creation_flags(NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("PowerShell nicht gestartet: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("stdin fehlt")?;
    stdin.write_all(input.unwrap_or_default().as_bytes()).map_err(|e| e.to_string())?;
    drop(stdin);
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() { "Outlook antwortet nicht".into() } else { err });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

// "2026-10-28T00:00:00"
fn valid_date(s: &str) -> bool {
    s.len() == 19 && s.chars().enumerate().all(|(i, c)| match i {
        4 | 7 => c == '-',
        10 => c == 'T',
        13 | 16 => c == ':',
        _ => c.is_ascii_digit(),
    })
}

async fn blocking(f: impl FnOnce() -> Result<String, String> + Send + 'static) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

// folder leer: Standardkalender
#[tauri::command]
pub async fn outlook_events(from: String, to: String, folder: String) -> Result<String, String> {
    if !valid_date(&from) || !valid_date(&to) || !matches!(folder.as_str(), "" | "Nexora-Test") {
        return Err("Ungültige Anfrage an Outlook".into());
    }
    blocking(move || call("events", &[("NEXORA_FROM", &from), ("NEXORA_TO", &to), ("NEXORA_FOLDER", &folder)], None)).await
}

#[tauri::command]
pub async fn outlook_push(folder: String, job: String) -> Result<String, String> {
    if !matches!(folder.as_str(), "Nexora" | "Nexora-Test") {
        return Err("Nexora schreibt nur in den eigenen Kalender".into());
    }
    blocking(move || call("push", &[("NEXORA_FOLDER", &folder)], Some(job))).await
}

// Nur der Testkalender lässt sich ganz löschen (landet in "Gelöschte Elemente")
#[tauri::command]
pub async fn outlook_drop_test() -> Result<String, String> {
    blocking(|| call("drop", &[("NEXORA_FOLDER", "Nexora-Test")], None)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn datum() {
        assert!(valid_date("2026-10-28T00:00:00"));
        assert!(!valid_date("2026-10-28"));
        assert!(!valid_date("2026-10-28T00:00:0'"));
    }
}
