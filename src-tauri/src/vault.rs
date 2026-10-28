// Tresor (Vaultwarden) über die Bitwarden-CLI. Das Master-Passwort geht nur per Umgebungsvariable an bw,
// der Sitzungsschlüssel bleibt im Speicher dieses Prozesses. Passwörter erreichen das Frontend nie:
// Kopieren und Einsetzen in Runbooks passieren hier.
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;

const NO_WINDOW: u32 = 0x0800_0000;
pub const LOCKED: &str = "Der Tresor ist gesperrt";

struct Session {
    key: String,
    until: Option<Instant>, // None: bis Nexora beendet wird
}

#[derive(Default, Clone)]
pub struct Vault(Arc<Mutex<Option<Session>>>);

impl Vault {
    fn key(&self) -> Option<String> {
        let mut s = self.0.lock().unwrap();
        if s.as_ref().is_some_and(|x| x.until.is_some_and(|u| Instant::now() >= u)) {
            *s = None;
        }
        s.as_ref().map(|x| x.key.clone())
    }

    fn minutes_left(&self) -> Option<u64> {
        let s = self.0.lock().unwrap();
        s.as_ref()?.until.map(|u| u.saturating_duration_since(Instant::now()).as_secs().div_ceil(60))
    }

    pub fn lock_now(&self) {
        if let Some(s) = self.0.lock().unwrap().take() {
            let _ = bw(&["lock"], Some(&s.key), None);
        }
    }
}

// NEXORA_BW: Pfad zu einer anderen bw (Tests); sonst PATH, sonst die winget-Installation (PATH erst nach Neuanmeldung aktuell)
fn bw_path() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("NEXORA_BW") {
        return Some(p.into());
    }
    let in_path = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).flat_map(|d| [d.join("bw.exe"), d.join("bw.cmd")]).find(|p| p.is_file()));
    if let Some(Some(p)) = in_path {
        return Some(p);
    }
    let packages = PathBuf::from(std::env::var_os("LOCALAPPDATA")?).join("Microsoft").join("WinGet").join("Packages");
    fs::read_dir(packages)
        .ok()?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("Bitwarden.CLI"))
        .map(|e| e.path().join("bw.exe"))
        .find(|p| p.is_file())
}

fn bw(args: &[&str], session: Option<&str>, password: Option<&str>) -> Result<String, String> {
    let exe = bw_path().ok_or("Bitwarden-CLI (bw) nicht gefunden")?;
    let mut cmd = Command::new(exe);
    cmd.args(args).env("BW_NOINTERACTION", "true").creation_flags(NO_WINDOW);
    if let Some(s) = session {
        cmd.env("BW_SESSION", s);
    }
    if let Some(p) = password {
        cmd.env("NEXORA_BW_PASSWORD", p);
    }
    let out = cmd.output().map_err(|e| format!("bw startet nicht: {e}"))?;
    let text = |b: &[u8]| String::from_utf8_lossy(b).trim().to_string();
    if out.status.success() {
        return Ok(text(&out.stdout));
    }
    let err = [text(&out.stderr), text(&out.stdout)].into_iter().find(|e| !e.is_empty()).unwrap_or_default();
    Err(if err.contains("Invalid master password") {
        "Master-Passwort falsch".into()
    } else if err.contains("not logged in") {
        "bw ist nicht angemeldet: einmal im Terminal „bw login“ ausführen".into()
    } else {
        err
    })
}

fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> impl std::future::Future<Output = Result<T, String>> {
    async move { tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())? }
}

#[derive(Serialize)]
pub struct Status {
    installed: bool,
    status: String, // unauthenticated | locked | unlocked
    server: Option<String>,
    email: Option<String>,
    minutes: Option<u64>,
}

#[tauri::command]
pub async fn vault_status(vault: State<'_, Vault>) -> Result<Status, String> {
    let v = vault.inner().clone();
    blocking(move || {
        if bw_path().is_none() {
            return Ok(Status { installed: false, status: "missing".into(), server: None, email: None, minutes: None });
        }
        let key = v.key();
        let j: Value = serde_json::from_str(&bw(&["status"], key.as_deref(), None)?).map_err(|e| e.to_string())?;
        let status = j["status"].as_str().unwrap_or("unauthenticated").to_string();
        if status != "unlocked" && key.is_some() {
            *v.0.lock().unwrap() = None; // Schlüssel ungültig geworden
        }
        let field = |k: &str| j[k].as_str().map(String::from);
        Ok(Status { installed: true, minutes: v.minutes_left(), status, server: field("serverUrl"), email: field("userEmail") })
    })
    .await
}

// minutes = 0: offen bis zum Beenden
#[tauri::command]
pub async fn vault_unlock(vault: State<'_, Vault>, password: String, minutes: u64) -> Result<(), String> {
    let v = vault.inner().clone();
    blocking(move || {
        let key = bw(&["unlock", "--passwordenv", "NEXORA_BW_PASSWORD", "--raw"], None, Some(&password))?;
        if key.is_empty() {
            return Err("Entsperren fehlgeschlagen".into());
        }
        let _ = bw(&["sync"], Some(&key), None); // aktuelle Einträge vom Server
        let until = (minutes > 0).then(|| Instant::now() + Duration::from_secs(minutes * 60));
        *v.0.lock().unwrap() = Some(Session { key: key.clone(), until });
        // Nach Ablauf sperren, auch wenn Nexora derweil nichts mit dem Tresor macht
        if let Some(u) = until {
            std::thread::spawn(move || {
                std::thread::sleep(u.saturating_duration_since(Instant::now()));
                if v.0.lock().unwrap().as_ref().is_some_and(|s| s.key == key) {
                    v.lock_now();
                }
            });
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn vault_lock(vault: State<'_, Vault>) -> Result<(), String> {
    let v = vault.inner().clone();
    blocking(move || Ok(v.lock_now())).await
}

#[derive(Serialize)]
pub struct Item {
    id: String,
    name: String,
    user: Option<String>,
    uri: Option<String>,
}

// Nur Name, Benutzer und Adresse, nie Passwörter
#[tauri::command]
pub async fn vault_search(vault: State<'_, Vault>, query: String) -> Result<Vec<Item>, String> {
    let v = vault.inner().clone();
    blocking(move || {
        let key = v.key().ok_or(LOCKED)?;
        let items: Vec<Value> = serde_json::from_str(&bw(&["list", "items", "--search", &query], Some(&key), None)?).map_err(|e| e.to_string())?;
        Ok(items
            .iter()
            .take(30)
            .map(|i| Item {
                id: i["id"].as_str().unwrap_or_default().into(),
                name: i["name"].as_str().unwrap_or_default().into(),
                user: i["login"]["username"].as_str().map(String::from),
                uri: i["login"]["uris"][0]["uri"].as_str().map(String::from),
            })
            .collect())
    })
    .await
}

fn field(item: &Value, field: &str) -> Option<String> {
    item["login"][if field == "benutzer" { "username" } else { "password" }].as_str().filter(|s| !s.is_empty()).map(String::from)
}

// Benutzer oder Passwort in die Zwischenablage; nach 30 s wieder weg, sofern nichts anderes kopiert wurde
#[tauri::command]
pub async fn vault_copy(vault: State<'_, Vault>, id: String, what: String) -> Result<(), String> {
    if !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') || !matches!(what.as_str(), "passwort" | "benutzer") {
        return Err("Ungültige Anfrage".into());
    }
    let v = vault.inner().clone();
    blocking(move || {
        let key = v.key().ok_or(LOCKED)?;
        let item: Value = serde_json::from_str(&bw(&["get", "item", &id], Some(&key), None)?).map_err(|e| e.to_string())?;
        let value = field(&item, &what).ok_or("Der Eintrag hat dieses Feld nicht")?;
        let seq = clipboard::put(&value, what == "passwort").map_err(|e| format!("Zwischenablage: {e}"))?;
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(30));
            clipboard::clear_if_unchanged(seq);
        });
        Ok(())
    })
    .await
}

// {{vault:Name}} → Passwort, {{vault:Name:benutzer}} → Benutzername. Liefert den Code und die eingesetzten Passwörter zum Maskieren
pub fn fill(v: &Vault, code: &str) -> Result<(String, Vec<String>), String> {
    let refs = placeholders(code);
    if refs.is_empty() {
        return Ok((code.to_string(), vec![]));
    }
    let key = v.key().ok_or(LOCKED)?;
    let (mut out, mut secrets) = (code.to_string(), vec![]);
    for (raw, name, what) in refs {
        let items: Vec<Value> = serde_json::from_str(&bw(&["list", "items", "--search", &name], Some(&key), None)?).map_err(|e| e.to_string())?;
        let hits: Vec<_> = items.iter().filter(|i| i["name"].as_str().is_some_and(|n| n.trim().eq_ignore_ascii_case(&name))).collect();
        let item = match hits.as_slice() {
            [one] => one,
            [] => return Err(format!("Kein Tresor-Eintrag „{name}“")),
            _ => return Err(format!("Mehrere Tresor-Einträge heißen „{name}“")),
        };
        let value = field(item, &what).ok_or(format!("„{name}“ hat kein Feld {what}"))?;
        out = out.replace(&raw, &value);
        if what == "passwort" {
            secrets.push(value);
        }
    }
    Ok((out, secrets))
}

// (roher Platzhalter, Name, "passwort" | "benutzer"), jeder nur einmal
fn placeholders(code: &str) -> Vec<(String, String, String)> {
    let mut out: Vec<(String, String, String)> = vec![];
    let mut rest = code;
    while let Some(start) = rest.find("{{vault:") {
        let Some(len) = rest[start..].find("}}") else { break };
        let raw = &rest[start..start + len + 2];
        let inner = raw[8..raw.len() - 2].trim();
        let (name, what) = match inner.rsplit_once(':') {
            Some((n, w)) if w.trim().eq_ignore_ascii_case("benutzer") => (n.trim(), "benutzer"),
            _ => (inner, "passwort"),
        };
        if !name.is_empty() && !out.iter().any(|(r, ..)| r == raw) {
            out.push((raw.to_string(), name.to_string(), what.to_string()));
        }
        rest = &rest[start + len + 2..];
    }
    out
}

// Eingesetzte Passwörter tauchen in Ausgabe und Protokoll nur als •••••• auf
pub fn mask(line: &str, secrets: &[String]) -> String {
    secrets.iter().filter(|s| !s.is_empty()).fold(line.to_string(), |l, s| l.replace(s.as_str(), "••••••"))
}

mod clipboard {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    const CF_UNICODETEXT: u32 = 13;

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
        unsafe {
            OpenClipboard(None)?;
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
            if GetClipboardSequenceNumber() == seq && OpenClipboard(None).is_ok() {
                let _ = EmptyClipboard();
                let _ = CloseClipboard();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platzhalter_und_maske() {
        let found = placeholders("a {{vault:Server Admin}} b {{vault: DB :benutzer}} {{vault:Server Admin}} {{Name}}");
        assert_eq!(
            found,
            vec![
                ("{{vault:Server Admin}}".into(), "Server Admin".into(), "passwort".into()),
                ("{{vault: DB :benutzer}}".into(), "DB".into(), "benutzer".into()),
            ]
        );
        assert!(placeholders("{{vault:offen").is_empty());
        assert_eq!(mask("pw=Geheim1 und Geheim1", &["Geheim1".into(), String::new()]), "pw=•••••• und ••••••");
    }

    #[test]
    fn gesperrt_ohne_schluessel() {
        assert_eq!(fill(&Vault::default(), "x {{vault:A}}").unwrap_err(), LOCKED);
        assert_eq!(fill(&Vault::default(), "ohne").unwrap(), ("ohne".to_string(), vec![]));
    }

    // Verändert die echte Zwischenablage, darum nur auf Wunsch: cargo test -- --ignored
    #[test]
    #[ignore]
    fn zwischenablage() {
        let seq = clipboard::put("nexora-test", true).unwrap();
        let read = || String::from_utf8(Command::new("powershell").args(["-NoProfile", "-Command", "Get-Clipboard"]).output().unwrap().stdout).unwrap();
        assert_eq!(read().trim(), "nexora-test");
        clipboard::clear_if_unchanged(seq);
        assert_eq!(read().trim(), "");
    }
}
