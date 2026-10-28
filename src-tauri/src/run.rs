// Codeblöcke ausführen: PowerShell 5.1/7, CMD, Python. Ausgabe wird zeilenweise als Ereignis
// "run-line" gesendet, das Ende als "run-exit". Als Admin läuft das Skript über UAC; die
// Ausgabe kommt dann gesammelt aus einer Logdatei, weil ein erhöhter Prozess keine Pipe zurückgibt.
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Instant;
use crate::vault::{mask, Vault};
use tauri::{AppHandle, Emitter, Manager, State};

const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct Runs(Mutex<HashMap<String, u32>>);

#[derive(Clone, Serialize)]
struct Line {
    id: String,
    err: bool,
    text: String,
}

#[derive(Clone, Serialize)]
struct Exit {
    id: String,
    code: Option<i32>,
    ms: u128,
    error: Option<String>,
}

fn found(program: &str) -> bool {
    Command::new("where").arg(program).creation_flags(NO_WINDOW).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
}

// Welche Shells es auf diesem Rechner gibt
#[tauri::command]
pub fn shells() -> Vec<&'static str> {
    let mut list = vec!["powershell", "cmd"];
    if found("pwsh") {
        list.push("pwsh");
    }
    if found("py") || found("python") {
        list.push("python");
    }
    list
}

// Skriptdatei schreiben; Rückgabe: Programm und Argumente
fn prepare(shell: &str, code: &str, file: &Path, log: Option<&Path>) -> Result<(String, Vec<String>), String> {
    let path = file.display().to_string();
    match shell {
        "powershell" | "pwsh" => {
            // UTF-8 rein und raus, sonst werden Umlaute in PowerShell 5.1 zu Zeichensalat
            let head = "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\r\n$OutputEncoding = [Console]::OutputEncoding\r\n$ProgressPreference = 'SilentlyContinue'\r\n";
            let body = match log {
                Some(l) => format!("& {{\r\n{code}\r\n}} *>&1 | Out-File -FilePath '{}' -Encoding utf8 -Width 4096", ps_quote(l)),
                None => code.to_string(),
            };
            fs::write(file, format!("\u{FEFF}{head}{body}\r\n")).map_err(|e| e.to_string())?;
            let exe = if shell == "pwsh" { "pwsh.exe" } else { "powershell.exe" };
            Ok((exe.into(), vec!["-NoProfile".into(), "-NonInteractive".into(), "-ExecutionPolicy".into(), "Bypass".into(), "-File".into(), path]))
        }
        "cmd" => {
            fs::write(file, format!("@echo off\r\nchcp 65001 >nul\r\n{}\r\n", code.replace("\r\n", "\n").replace('\n', "\r\n"))).map_err(|e| e.to_string())?;
            // /s entfernt das äußere Anführungszeichenpaar, der Rest geht wörtlich an cmd
            let call = match log {
                Some(l) => format!("\"\"{path}\" > \"{}\" 2>&1\"", l.display()),
                None => format!("\"\"{path}\"\""),
            };
            Ok(("cmd.exe".into(), vec!["/d".into(), "/s".into(), "/c".into(), call]))
        }
        "python" => {
            fs::write(file, code).map_err(|e| e.to_string())?;
            let (exe, mut args) = if found("py") { ("py.exe", vec!["-3".to_string()]) } else { ("python.exe", vec![]) };
            args.extend(["-X".into(), "utf8".into(), path]);
            match log {
                Some(l) => Ok(("cmd.exe".into(), vec!["/d".into(), "/s".into(), "/c".into(), format!("\"{exe} {} > \"{}\" 2>&1\"", args.join(" "), l.display())])),
                None => Ok((exe.into(), args)),
            }
        }
        _ => Err(format!("Sprache {shell} lässt sich nicht ausführen")),
    }
}

fn ps_quote(p: &Path) -> String {
    p.display().to_string().replace('\'', "''")
}

#[tauri::command]
pub async fn run_script(app: AppHandle, runs: State<'_, Runs>, vault: State<'_, Vault>, id: String, shell: String, code: String, admin: bool) -> Result<(), String> {
    if !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("Ungültige Lauf-ID".into());
    }
    // {{vault:…}} einsetzen; bw braucht etwas, darum nicht im UI-Thread. Die Werte werden in der Ausgabe maskiert
    let v = vault.inner().clone();
    let (code, secrets) = tauri::async_runtime::spawn_blocking(move || crate::vault::fill(&v, &code)).await.map_err(|e| e.to_string())??;
    let secrets = std::sync::Arc::new(secrets);
    let dir = std::env::temp_dir().join("nexora-runs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ext = match shell.as_str() { "cmd" => "cmd", "python" => "py", _ => "ps1" };
    let file = dir.join(format!("{id}.{ext}"));
    let log = admin.then(|| dir.join(format!("{id}.log")));
    let (exe, args) = prepare(&shell, &code, &file, log.as_deref())?;

    let mut cmd = if admin {
        // Erhöht starten und warten; Exit-Code des Skripts weiterreichen
        let list = args.iter().map(|a| format!("'{}'", a.replace('\'', "''"))).collect::<Vec<_>>().join(",");
        let wrapper = format!("$p = Start-Process -FilePath '{exe}' -ArgumentList {list} -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode");
        let mut c = Command::new("powershell.exe");
        c.args(["-NoProfile", "-NonInteractive", "-Command", &wrapper]);
        c
    } else {
        let mut c = Command::new(&exe);
        // cmd versteht die übliche \"-Maskierung nicht: Argumente wörtlich übergeben
        if exe == "cmd.exe" {
            c.raw_arg(args.join(" "));
        } else {
            c.args(&args);
        }
        c
    };
    cmd.creation_flags(NO_WINDOW)
        .current_dir(std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into()))
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let started = Instant::now();
    let mut child = cmd.spawn().map_err(|e| format!("{exe} startet nicht: {e}"))?;
    runs.0.lock().unwrap().insert(id.clone(), child.id());

    let readers: Vec<_> = [(child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), false), (child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), true)]
        .into_iter()
        .filter_map(|(stream, err)| stream.map(|s| (s, err)))
        .map(|(stream, err)| {
            let (app, id, secrets) = (app.clone(), id.clone(), secrets.clone());
            std::thread::spawn(move || {
                for line in BufReader::new(stream).split(b'\n').map_while(Result::ok) {
                    let text = mask(String::from_utf8_lossy(&line).trim_end_matches('\r'), &secrets);
                    let _ = app.emit("run-line", Line { id: id.clone(), err, text });
                }
            })
        })
        .collect();

    std::thread::spawn(move || {
        let status = child.wait();
        for r in readers {
            let _ = r.join();
        }
        if let Some(l) = &log {
            if let Ok(text) = fs::read_to_string(l) {
                for line in text.trim_start_matches('\u{FEFF}').lines() {
                    let _ = app.emit("run-line", Line { id: id.clone(), err: false, text: mask(line, &secrets) });
                }
            }
            let _ = fs::remove_file(l);
        }
        let _ = fs::remove_file(&file);
        let (code, error) = match status {
            Ok(s) => (s.code(), None),
            Err(e) => (None, Some(e.to_string())),
        };
        if let Some(runs) = app.try_state::<Runs>() {
            runs.0.lock().unwrap().remove(&id);
        }
        let _ = app.emit("run-exit", Exit { id, code, ms: started.elapsed().as_millis(), error });
    });
    Ok(())
}

// Laufenden Lauf samt Unterprozessen beenden
#[tauri::command]
pub fn cancel_run(runs: State<Runs>, id: String) -> Result<(), String> {
    let pid = runs.0.lock().unwrap().get(&id).copied().ok_or("Lauf ist schon beendet")?;
    Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).creation_flags(NO_WINDOW).status().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn powershell_skript_mit_bom_und_utf8() {
        let f = std::env::temp_dir().join(format!("nexora-test-{}.ps1", std::process::id()));
        let (exe, args) = prepare("powershell", "Write-Output 'Grüße'", &f, None).unwrap();
        let text = fs::read_to_string(&f).unwrap();
        assert!(text.starts_with('\u{FEFF}') && text.contains("OutputEncoding") && text.contains("Grüße"));
        assert_eq!(exe, "powershell.exe");
        assert_eq!(args.last().unwrap(), &f.display().to_string());
        fs::remove_file(f).unwrap();
    }

    #[test]
    fn unbekannte_sprache_wird_abgelehnt() {
        assert!(prepare("bash", "ls", &std::env::temp_dir().join("x.sh"), None).is_err());
    }
}
