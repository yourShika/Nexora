// Eigene Verknüpfungen im Farbschema: Bei einem installierten Programm zeigt die Taskleiste das Icon der Startmenü-Verknüpfung,
// nicht das des Fensters (am echten Nexora nachgemessen). Darum eine Icon-Datei im Datenordner und die Verknüpfungen darauf umstellen.
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use tauri::{AppHandle, Manager};
use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNE_UPDATEITEM, SHCNF_IDLIST, SHCNF_PATHW};

const SCRIPT: &str = include_str!("shortcuts.ps1");
const NO_WINDOW: u32 = 0x0800_0000;
const PREFIX: &str = "nexora-";

fn valid_ico(b: &[u8]) -> bool {
    b.len() > 22 && b[..4] == [0, 0, 1, 0]
}

// Name nach Inhalt: Explorer merkt sich Icons je Pfad, ein neues Schema braucht einen neuen Namen
fn ico_name(bytes: &[u8]) -> String {
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    format!("{PREFIX}{:016x}.ico", h.finish())
}

fn relink(exe: &str, ico: &str) -> Result<Vec<String>, String> {
    let utf16: Vec<u8> = SCRIPT.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &crate::onenote::base64(&utf16)])
        .env("NEXORA_EXE", exe)
        .env("NEXORA_ICO", ico)
        .creation_flags(NO_WINDOW)
        .output()
        .map_err(|e| format!("PowerShell nicht gestartet: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect())
}

// Explorer sagen, dass sich die Verknüpfungen geändert haben. UPDATEITEM allein reicht der Taskleiste nicht (ausprobiert),
// erst ASSOCCHANGED lässt sie das Icon neu lesen; darum nur, wenn sich wirklich etwas geändert hat
fn notify_shell(paths: &[String]) {
    for path in paths {
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe { SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, Some(wide.as_ptr() as *const _), None) };
    }
    if !paths.is_empty() {
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    }
}

// ico: Icon im Schema; None (Standard-Petrol) stellt umgestellte Verknüpfungen zurück. Rückgabe: Zahl der geänderten
#[tauri::command]
pub async fn tint_shortcuts(app: AppHandle, ico: Option<Vec<u8>>) -> Result<usize, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?.join("icons");
    let exe = std::env::current_exe().map_err(|e| e.to_string())?.display().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let mut keep = None;
        if let Some(bytes) = ico {
            if !valid_ico(&bytes) {
                return Err("Keine Icon-Datei".to_string());
            }
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join(ico_name(&bytes));
            if !path.exists() {
                fs::write(&path, bytes).map_err(|e| e.to_string())?;
            }
            keep = Some(path);
        }
        let target = keep.as_deref().map(|p: &Path| p.display().to_string()).unwrap_or_default();
        let changed = relink(&exe, &target)?;
        notify_shell(&changed);
        // alte Dateien erst jetzt weg: Bis hierher zeigten die Verknüpfungen noch darauf
        for entry in fs::read_dir(&dir).into_iter().flatten().flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(PREFIX) && name.ends_with(".ico") && Some(entry.path()) != keep {
                let _ = fs::remove_file(entry.path());
            }
        }
        Ok(changed.len())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nur_icons_und_name_nach_inhalt() {
        assert!(!valid_ico(b"kein icon"));
        assert!(!valid_ico(&[0, 0, 1, 0]));
        assert!(valid_ico(&[&[0u8, 0, 1, 0][..], &[0u8; 30]].concat()));
        assert_ne!(ico_name(&[1, 2, 3]), ico_name(&[1, 2, 4]));
        assert!(ico_name(&[1]).starts_with(PREFIX) && ico_name(&[1]).ends_with(".ico"));
    }
}
