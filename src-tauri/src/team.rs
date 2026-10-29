// Anmeldung am Team-Server über Microsoft Entra: Browser mit PKCE, Antwort auf einem freien localhost-Port.
// Der Token-Tausch passiert hier, weil Entra ihn für Desktop-Apps nicht aus dem Browser-Teil erlaubt.
// Der Erneuerungs-Token liegt mit Windows (DPAPI, nur dieser Benutzer) verschlüsselt im Datenordner,
// der Zugriffstoken nur im Speicher.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Serialize, Deserialize)]
struct Config {
    tenant: String,
    #[serde(rename = "clientId")]
    client_id: String,
    authority: String,
    scope: String,
}

#[derive(Serialize, Deserialize)]
struct Saved {
    server: String,
    config: Config,
    refresh: String,
}

// Zugriffstoken und Ablauf
#[derive(Default, Clone)]
pub struct Team(Arc<Mutex<Option<(String, Instant)>>>);

fn http() -> Result<reqwest::Client, String> {
    // reqwest prüft Zertifikate über den Windows-Speicher (auch interne CAs); Krypto wie beim Updater
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder().timeout(Duration::from_secs(20)).build().map_err(|e| e.to_string())
}

// Nur https, außer für Tests auf diesem PC
fn server_url(s: &str) -> Result<String, String> {
    let url = url::Url::parse(s.trim()).map_err(|_| "Die Adresse ist ungültig")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) {
        return Err("Der Team-Server braucht eine https://-Adresse".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn random(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    getrandom::fill(&mut b).expect("Zufallszahlen");
    URL_SAFE_NO_PAD.encode(b)
}

fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

mod dpapi {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

    unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as _)));
        v
    }

    pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
            let mut out = CRYPT_INTEGER_BLOB::default();
            CryptProtectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).map_err(|e| e.to_string())?;
            Ok(take(out))
        }
    }

    pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        unsafe {
            let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
            let mut out = CRYPT_INTEGER_BLOB::default();
            CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).map_err(|e| e.to_string())?;
            Ok(take(out))
        }
    }
}

fn saved_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("team.bin"))
}

fn load(app: &AppHandle) -> Option<Saved> {
    let bytes = dpapi::unprotect(&fs::read(saved_file(app).ok()?).ok()?).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn store(app: &AppHandle, saved: &Saved) -> Result<(), String> {
    let file = saved_file(app)?;
    fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(file, dpapi::protect(&serde_json::to_vec(saved).unwrap())?).map_err(|e| e.to_string())
}

async fn get_json(http: &reqwest::Client, url: &str, bearer: Option<&str>) -> Result<Value, String> {
    let mut req = http.get(url);
    if let Some(t) = bearer {
        req = req.bearer_auth(t);
    }
    let res = req.send().await.map_err(|e| format!("Server nicht erreichbar: {e}"))?;
    let status = res.status();
    let body: Value = res.json().await.map_err(|e| format!("Unerwartete Antwort vom Server: {e}"))?;
    if !status.is_success() {
        return Err(body["error"].as_str().unwrap_or("Server meldet einen Fehler").to_string());
    }
    Ok(body)
}

async fn token_request(http: &reqwest::Client, cfg: &Config, form: &[(&str, &str)]) -> Result<Value, String> {
    let res = http.post(format!("{}/oauth2/v2.0/token", cfg.authority)).form(form).send().await.map_err(|e| format!("Anmeldedienst nicht erreichbar: {e}"))?;
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if body["access_token"].is_string() {
        return Ok(body);
    }
    Err(body["error_description"].as_str().or(body["error"].as_str()).unwrap_or("Anmeldung abgelehnt").lines().next().unwrap_or_default().to_string())
}

fn remember(team: &Team, tokens: &Value) {
    let secs = tokens["expires_in"].as_u64().unwrap_or(3600).saturating_sub(60);
    *team.0.lock().unwrap() = Some((tokens["access_token"].as_str().unwrap_or_default().to_string(), Instant::now() + Duration::from_secs(secs)));
}

// Erste Zeile der Browser-Antwort: "GET /?code=…&state=… HTTP/1.1" → Code oder Fehlermeldung
fn parse_callback(line: &str, state: &str) -> Option<Result<String, String>> {
    let path = line.split_whitespace().nth(1)?;
    let url = url::Url::parse(&format!("http://localhost{path}")).ok()?;
    let get = |k: &str| url.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
    if let Some(err) = get("error") {
        return Some(Err(get("error_description").unwrap_or(err).lines().next().unwrap_or_default().to_string()));
    }
    let code = get("code")?;
    Some(if get("state").as_deref() == Some(state) { Ok(code) } else { Err("Anmeldung passt nicht zu dieser Anfrage".into()) })
}

// Wartet bis zu 5 Minuten auf die Weiterleitung aus dem Browser; andere Anfragen (favicon) bekommen 404
fn wait_for_code(listener: TcpListener, state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);
    while Instant::now() < deadline {
        let Ok((mut stream, _)) = listener.accept() else {
            std::thread::sleep(Duration::from_millis(100));
            continue;
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut line = String::new();
        let _ = BufReader::new(&stream).read_line(&mut line);
        let Some(result) = parse_callback(&line, state) else {
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
            continue;
        };
        let (title, text) = match &result {
            Ok(_) => ("Angemeldet", "Du kannst dieses Fenster schließen und zu Nexora zurückkehren.".to_string()),
            Err(e) => ("Anmeldung fehlgeschlagen", e.clone()),
        };
        let html = format!("<!doctype html><meta charset=utf-8><title>Nexora</title><body style=\"font-family:system-ui;padding:3rem\"><h2>{title}</h2><p>{}</p>", text.replace('<', "&lt;"));
        let _ = stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{html}", html.len()).as_bytes());
        return result;
    }
    Err("Keine Anmeldung innerhalb von 5 Minuten".into())
}

#[tauri::command]
pub async fn team_login(app: AppHandle, team: State<'_, Team>, server: String) -> Result<Value, String> {
    let server = server_url(&server)?;
    let http = http()?;
    // Ein anderer Dienst unter der Adresse antwortet mit 404 oder HTML: verständlich melden
    let other = |e: String| if e.starts_with("Server nicht erreichbar") { e } else { "Unter dieser Adresse läuft kein Nexora-Server".to_string() };
    let cfg: Config = serde_json::from_value(get_json(&http, &format!("{server}/api/config"), None).await.map_err(other)?).map_err(|_| "Unter dieser Adresse läuft kein Nexora-Server")?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let redirect = format!("http://localhost:{}", listener.local_addr().map_err(|e| e.to_string())?.port());
    let (verifier, state) = (random(32), random(16));
    let scope = format!("{} offline_access openid profile", cfg.scope);
    let url = url::Url::parse_with_params(
        &format!("{}/oauth2/v2.0/authorize", cfg.authority),
        &[
            ("client_id", cfg.client_id.as_str()),
            ("response_type", "code"),
            ("redirect_uri", &redirect),
            ("scope", &scope),
            ("code_challenge", &challenge(&verifier)),
            ("code_challenge_method", "S256"),
            ("state", &state),
        ],
    )
    .map_err(|e| e.to_string())?;
    // Tests: Adresse ins Protokoll statt Browser öffnen
    if std::env::var_os("NEXORA_NO_BROWSER").is_some() {
        eprintln!("NEXORA_LOGIN_URL {url}");
    } else {
        app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| e.to_string())?;
    }
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &state)).await.map_err(|e| e.to_string())??;
    let tokens = token_request(
        &http,
        &cfg,
        &[("client_id", &cfg.client_id), ("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", &redirect), ("code_verifier", &verifier), ("scope", &scope)],
    )
    .await?;
    let refresh = tokens["refresh_token"].as_str().ok_or("Entra hat keinen Erneuerungs-Token geschickt (offline_access fehlt?)")?.to_string();
    store(&app, &Saved { server: server.clone(), config: cfg, refresh })?;
    remember(&team, &tokens);
    let me = get_json(&http, &format!("{server}/api/me"), Some(tokens["access_token"].as_str().unwrap_or_default())).await?;
    Ok(json!({ "connected": true, "server": server, "user": me }))
}

// Gültiger Zugriffstoken: aus dem Speicher oder mit dem Erneuerungs-Token frisch geholt
async fn access_token(app: &AppHandle, team: &Team, http: &reqwest::Client) -> Result<(String, String), String> {
    let saved = load(app).ok_or("Nicht angemeldet")?;
    if let Some((token, until)) = team.0.lock().unwrap().clone() {
        if Instant::now() < until {
            return Ok((saved.server, token));
        }
    }
    let scope = format!("{} offline_access openid profile", saved.config.scope);
    let tokens = token_request(http, &saved.config, &[("client_id", &saved.config.client_id), ("grant_type", "refresh_token"), ("refresh_token", &saved.refresh), ("scope", &scope)]).await?;
    // Entra tauscht den Erneuerungs-Token bei jeder Nutzung aus
    if let Some(r) = tokens["refresh_token"].as_str() {
        store(app, &Saved { server: saved.server.clone(), config: saved.config.clone(), refresh: r.to_string() })?;
    }
    remember(team, &tokens);
    Ok((saved.server, tokens["access_token"].as_str().unwrap_or_default().to_string()))
}

#[tauri::command]
pub async fn team_status(app: AppHandle, team: State<'_, Team>) -> Result<Value, String> {
    let Some(saved) = load(&app) else { return Ok(json!({ "connected": false })) };
    let http = http()?;
    let result = async {
        let (server, token) = access_token(&app, team.inner(), &http).await?;
        get_json(&http, &format!("{server}/api/me"), Some(&token)).await
    }
    .await;
    Ok(match result {
        Ok(me) => json!({ "connected": true, "server": saved.server, "user": me }),
        Err(e) => json!({ "connected": false, "server": saved.server, "error": e }),
    })
}

#[tauri::command]
pub async fn team_logout(app: AppHandle, team: State<'_, Team>) -> Result<(), String> {
    *team.0.lock().unwrap() = None;
    let file = saved_file(&app)?;
    if file.exists() {
        fs::remove_file(file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_nach_rfc_7636() {
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert_ne!(random(32), random(32));
    }

    #[test]
    fn adressen() {
        assert_eq!(server_url("https://nexora.firma.local/").unwrap(), "https://nexora.firma.local");
        assert!(server_url("http://nexora.firma.local").is_err());
        assert!(server_url("http://localhost:8093").is_ok());
        assert!(server_url("kein url").is_err());
    }

    #[test]
    fn rueckmeldung_aus_dem_browser() {
        assert_eq!(parse_callback("GET /?code=abc&state=s1 HTTP/1.1", "s1"), Some(Ok("abc".into())));
        assert!(parse_callback("GET /?code=abc&state=falsch HTTP/1.1", "s1").unwrap().is_err());
        assert_eq!(parse_callback("GET /?error=access_denied&error_description=Nein%0Amehr HTTP/1.1", "s1"), Some(Err("Nein".into())));
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1", "s1"), None);
    }

    #[test]
    fn dpapi_hin_und_zurueck() {
        let secret = b"refresh-token-test";
        let enc = dpapi::protect(secret).unwrap();
        assert_ne!(enc.as_slice(), secret);
        assert_eq!(dpapi::unprotect(&enc).unwrap(), secret);
    }
}
