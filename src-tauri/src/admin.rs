// Admin-Links mit Strg+Klick öffnen: Ordner im Explorer, Dateien nur im Ordner zeigen (nie ausführen),
// rdp:// mit Remotedesktop, ssh:// im Terminal
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;

fn valid_host(h: &str) -> bool {
    let (name, port) = match h.rsplit_once(':') {
        Some((n, p)) => (n, Some(p)),
        None => (h, None),
    };
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c)) && port.map_or(true, |p| !p.is_empty() && p.len() <= 5 && p.chars().all(|c| c.is_ascii_digit()))
}

// "admin@host:2222" → ["admin@host", "-p", "2222"]
fn ssh_args(rest: &str) -> Option<Vec<String>> {
    let rest = rest.trim_end_matches('/');
    let (user, host) = match rest.split_once('@') {
        Some((u, h)) => (Some(u), h),
        None => (None, rest),
    };
    if !valid_host(host) || user.is_some_and(|u| u.is_empty() || !u.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))) {
        return None;
    }
    let (name, port) = match host.rsplit_once(':') {
        Some((n, p)) => (n, Some(p)),
        None => (host, None),
    };
    let mut args = vec![user.map_or(name.to_string(), |u| format!("{u}@{name}"))];
    if let Some(p) = port {
        args.extend(["-p".to_string(), p.to_string()]);
    }
    Some(args)
}

fn open(target: &str) -> Result<(), String> {
    let run = |c: &mut Command| c.spawn().map(|_| ()).map_err(|e| e.to_string());
    if let Some(host) = target.strip_prefix("rdp://") {
        let host = host.trim_end_matches('/');
        if !valid_host(host) {
            return Err("Ungültiger Rechnername".into());
        }
        return run(Command::new("mstsc").arg(format!("/v:{host}")));
    }
    if let Some(rest) = target.strip_prefix("ssh://") {
        let args = ssh_args(rest).ok_or("Ungültige ssh-Adresse")?;
        // Windows Terminal, sonst eine eigene Konsole
        if Command::new("wt").arg("new-tab").arg("ssh").args(&args).spawn().is_ok() {
            return Ok(());
        }
        return run(Command::new("cmd").args(["/c", "start", "", "ssh"]).args(&args));
    }
    if target.contains('"') {
        return Err("Ungültiger Pfad".into());
    }
    let path = Path::new(target);
    if path.is_dir() {
        return run(Command::new("explorer").arg(path));
    }
    if path.exists() {
        return run(Command::new("explorer").raw_arg(format!("/select,\"{target}\"")));
    }
    Err(format!("Nicht gefunden oder nicht erreichbar: {target}"))
}

#[tauri::command]
pub async fn open_admin_link(target: String) -> Result<(), String> {
    // Freigaben können beim Prüfen einige Sekunden hängen
    tauri::async_runtime::spawn_blocking(move || open(&target)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adressen() {
        assert!(valid_host("srv-app01:3390"));
        assert!(valid_host("10.0.3.1"));
        assert!(!valid_host("srv;calc"));
        assert!(!valid_host("srv:99999x"));
        assert_eq!(ssh_args("admin@10.0.3.1:2222/").unwrap(), ["admin@10.0.3.1", "-p", "2222"]);
        assert_eq!(ssh_args("host").unwrap(), ["host"]);
        assert!(ssh_args("a b@host").is_none());
        assert!(ssh_args("@host").is_none());
    }
}
