// KI-Anbieter: Die Anfragen laufen hier, damit der API-Schlüssel nie ins Frontend gelangt. Er liegt mit DPAPI verschlüsselt
// je Anbieter in <Daten>/ki/, nur dieser Windows-Benutzer kann ihn lesen; Datenbank, Exporte und Sicherungen enthalten ihn nicht.
use crate::team::{dpapi, http_with};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const ANSWER_TIMEOUT: Duration = Duration::from_secs(180);
const LIST_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_TOKENS: u32 = 8192; // Anthropic verlangt eine Obergrenze, die anderen haben eine eigene

#[derive(Deserialize)]
pub struct Provider {
    id: String,
    kind: String, // "openai" (auch amber, Azure, Mistral, Ollama, LM Studio) oder "anthropic"
    base: String,
    #[serde(default)]
    model: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Answer {
    text: String,
    truncated: bool,
}

fn key_file(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Ungültiger Anbieter".into());
    }
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("ki").join(format!("{id}.bin")))
}

fn read_key(app: &AppHandle, id: &str) -> Result<Option<String>, String> {
    let Ok(bytes) = fs::read(key_file(app, id)?) else { return Ok(None) };
    let plain = dpapi::unprotect(&bytes).map_err(|_| "Der gespeicherte Schlüssel lässt sich nicht lesen, bitte neu eintragen")?;
    Ok(Some(String::from_utf8_lossy(&plain).to_string()))
}

// Leer löscht den Schlüssel
#[tauri::command]
pub fn ai_key_set(app: AppHandle, id: String, key: String) -> Result<(), String> {
    let file = key_file(&app, &id)?;
    let key = key.trim();
    if key.is_empty() {
        return match fs::remove_file(&file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    }
    fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(file, dpapi::protect(key.as_bytes())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_key_has(app: AppHandle, id: String) -> Result<bool, String> {
    Ok(key_file(&app, &id)?.exists())
}

// Ohne https ginge der Schlüssel im Klartext durchs Netz; erlaubt nur auf diesem PC und im eigenen Netz (Ollama, LM Studio)
fn endpoint(base: &str, path: &str) -> Result<String, String> {
    let url = url::Url::parse(base.trim()).map_err(|_| "Die Adresse des Anbieters ist ungültig".to_string())?;
    let host = url.host_str().unwrap_or_default().trim_matches(['[', ']']);
    let private = match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => ip.is_loopback() || ip.is_private(),
        Ok(std::net::IpAddr::V6(ip)) => ip.is_loopback(),
        Err(_) => host == "localhost" || host.ends_with(".local") || !host.contains('.'),
    };
    if url.scheme() != "https" && !(url.scheme() == "http" && private) {
        return Err("Der Anbieter braucht eine https://-Adresse, http geht nur auf diesem PC und im eigenen Netz".into());
    }
    Ok(format!("{}/{path}", url.as_str().trim_end_matches('/')))
}

fn body_for(p: &Provider, system: &str, text: &str) -> Value {
    if p.kind == "anthropic" {
        json!({ "model": p.model, "max_tokens": MAX_TOKENS, "system": system, "messages": [{ "role": "user", "content": text }] })
    } else {
        json!({ "model": p.model, "stream": false, "messages": [{ "role": "system", "content": system }, { "role": "user", "content": text }] })
    }
}

fn parse_answer(kind: &str, v: &Value) -> Result<Answer, String> {
    let (text, truncated) = if kind == "anthropic" {
        let text: String = v["content"].as_array().map(|parts| parts.iter().filter_map(|p| p["text"].as_str()).collect()).unwrap_or_default();
        (text, v["stop_reason"] == "max_tokens")
    } else {
        let choice = &v["choices"][0];
        let content = &choice["message"]["content"];
        // Inhalt ist meist Text, manche Anbieter schicken Teile
        let text: String = match content.as_array() {
            Some(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect(),
            None => content.as_str().unwrap_or_default().to_string(),
        };
        (text, choice["finish_reason"] == "length")
    };
    if text.trim().is_empty() {
        return Err("Der Anbieter hat keinen Text zurückgegeben".into());
    }
    Ok(Answer { text, truncated })
}

fn readable_error(status: u16, body: &str) -> String {
    let what = match status {
        401 | 403 => "Der Anbieter lehnt den Schlüssel ab".to_string(),
        404 => "Adresse oder Modell nicht gefunden".to_string(),
        429 => "Zu viele Anfragen oder Kontingent aufgebraucht".to_string(),
        s if s >= 500 => format!("Der Anbieter hat ein Problem ({s})"),
        s => format!("Anfrage abgelehnt ({s})"),
    };
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let detail = v["error"]["message"].as_str().or(v["error"].as_str()).or(v["message"].as_str()).unwrap_or_default();
    if detail.is_empty() {
        what
    } else {
        format!("{what}: {}", detail.chars().take(300).collect::<String>())
    }
}

fn authorized(req: reqwest::RequestBuilder, kind: &str, key: Option<&str>) -> reqwest::RequestBuilder {
    match (kind, key) {
        ("anthropic", key) => req.header("x-api-key", key.unwrap_or_default()).header("anthropic-version", "2023-06-01"),
        (_, Some(key)) => req.bearer_auth(key),
        (_, None) => req,
    }
}

// Die eigentliche Ursache steckt in der Kette (Name nicht gefunden, Zertifikat, Proxy); ohne Adresse, die zeigt die Oberfläche selbst
fn send_error(e: reqwest::Error) -> String {
    let timeout = e.is_timeout();
    let e = e.without_url();
    let mut causes = Vec::new();
    let mut source = std::error::Error::source(&e);
    while let Some(cause) = source {
        causes.push(cause.to_string());
        source = cause.source();
    }
    if timeout {
        return "Der Anbieter hat nicht rechtzeitig geantwortet".into();
    }
    match causes.last() {
        Some(cause) => format!("Keine Verbindung zum Anbieter: {}", cause.chars().take(200).collect::<String>()),
        None => format!("Keine Verbindung zum Anbieter: {e}"),
    }
}

#[tauri::command]
pub async fn ai_models(app: AppHandle, provider: Provider) -> Result<Vec<String>, String> {
    let url = endpoint(&provider.base, "models")?;
    let key = read_key(&app, &provider.id)?;
    let res = authorized(http_with(LIST_TIMEOUT)?.get(url), &provider.kind, key.as_deref()).send().await.map_err(send_error)?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(send_error)?;
    if !(200..300).contains(&status) {
        return Err(readable_error(status, &body));
    }
    let v: Value = serde_json::from_str(&body).map_err(|_| "Der Anbieter hat keine Modellliste geliefert".to_string())?;
    let mut names: Vec<String> = v["data"].as_array().map(|list| list.iter().filter_map(|m| m["id"].as_str().map(String::from)).collect()).unwrap_or_default();
    names.sort();
    Ok(names)
}

#[tauri::command]
pub async fn ai_complete(app: AppHandle, provider: Provider, system: String, text: String) -> Result<Answer, String> {
    if provider.model.trim().is_empty() {
        return Err("Für diesen Anbieter ist noch kein Modell eingetragen".into());
    }
    let url = endpoint(&provider.base, if provider.kind == "anthropic" { "messages" } else { "chat/completions" })?;
    let key = read_key(&app, &provider.id)?;
    let res = authorized(http_with(ANSWER_TIMEOUT)?.post(url), &provider.kind, key.as_deref())
        .json(&body_for(&provider, &system, &text))
        .send()
        .await
        .map_err(send_error)?;
    let status = res.status().as_u16();
    let body = res.text().await.map_err(send_error)?;
    if !(200..300).contains(&status) {
        return Err(readable_error(status, &body));
    }
    let v: Value = serde_json::from_str(&body).map_err(|_| "Die Antwort des Anbieters ist nicht lesbar".to_string())?;
    parse_answer(&provider.kind, &v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nur_https_ausser_im_eigenen_netz() {
        assert_eq!(endpoint("https://kunde.example.de/api/v1/", "models").unwrap(), "https://kunde.example.de/api/v1/models");
        assert_eq!(endpoint("https://api.anthropic.com/v1", "messages").unwrap(), "https://api.anthropic.com/v1/messages");
        for ok in ["http://localhost:11434/v1", "http://127.0.0.1:1234/v1", "http://192.168.1.20:11434/v1", "http://10.0.0.5/v1", "http://ki-server/v1", "http://[::1]:1234/v1"] {
            assert!(endpoint(ok, "models").is_ok(), "{ok}");
        }
        for bad in ["http://api.example.com/v1", "http://8.8.8.8/v1", "ftp://localhost/v1", "kein url", ""] {
            assert!(endpoint(bad, "models").is_err(), "{bad}");
        }
    }

    #[test]
    fn anfragen_je_anbieter() {
        let openai = Provider { id: "a".into(), kind: "openai".into(), base: String::new(), model: "m".into() };
        let b = body_for(&openai, "S", "T");
        assert_eq!(b["messages"][0]["role"], "system");
        assert_eq!(b["messages"][1]["content"], "T");
        assert_eq!(b["stream"], false);
        assert!(b.get("temperature").is_none(), "manche Modelle lehnen temperature ab");
        let anthropic = Provider { id: "a".into(), kind: "anthropic".into(), base: String::new(), model: "m".into() };
        let b = body_for(&anthropic, "S", "T");
        assert_eq!(b["system"], "S");
        assert_eq!(b["messages"][0]["content"], "T");
        assert_eq!(b["messages"].as_array().unwrap().len(), 1);
        assert!(b["max_tokens"].as_u64().unwrap() > 0);
    }

    #[test]
    fn antworten_lesen() {
        let a = parse_answer("openai", &json!({ "choices": [{ "message": { "content": "Hallo" }, "finish_reason": "stop" }] })).unwrap();
        assert_eq!(a, Answer { text: "Hallo".into(), truncated: false });
        let a = parse_answer("openai", &json!({ "choices": [{ "message": { "content": [{ "type": "text", "text": "A" }, { "type": "text", "text": "B" }] }, "finish_reason": "length" }] })).unwrap();
        assert_eq!(a, Answer { text: "AB".into(), truncated: true });
        let a = parse_answer("anthropic", &json!({ "content": [{ "type": "text", "text": "Hi" }], "stop_reason": "max_tokens" })).unwrap();
        assert_eq!(a, Answer { text: "Hi".into(), truncated: true });
        assert!(parse_answer("openai", &json!({ "choices": [] })).is_err());
        assert!(parse_answer("anthropic", &json!({ "content": [] })).is_err());
    }

    #[test]
    fn fehler_verstaendlich() {
        assert!(readable_error(401, r#"{"error":{"message":"bad key"}}"#).starts_with("Der Anbieter lehnt den Schlüssel ab: bad key"));
        assert_eq!(readable_error(404, ""), "Adresse oder Modell nicht gefunden");
        assert!(readable_error(429, r#"{"message":"slow"}"#).contains("slow"));
        assert!(readable_error(503, "<html>").contains("503"));
        assert_eq!(readable_error(400, r#"{"error":"nope"}"#), "Anfrage abgelehnt (400): nope");
        assert!(readable_error(400, &format!(r#"{{"error":"{}"}}"#, "x".repeat(900))).len() < 400);
    }
}
