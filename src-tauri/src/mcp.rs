// Nexora als MCP-Server für KI-Programme auf diesem PC: `nexora.exe --mcp`, JSON-RPC zeilenweise über stdin und stdout.
// Das Programm startet ihn selbst, ein offener Port entsteht nicht. Er braucht kein Fenster und kein offenes Nexora, sondern
// liest die Datenbank direkt. Die Rechte stehen in der Einstellung `mcp` und werden bei jedem Aufruf neu gelesen, von Haus aus
// ist alles aus. Passwort-artige Stellen werden maskiert, Tresor-Inhalte stehen ohnehin nicht in der Datenbank.
use regex::Regex;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Map, Value};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

const MODERN: &str = "2026-07-28";
const LEGACY: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY: usize = 100_000; // so viel Text geht auf einmal an das KI-Programm
const MAX_INPUT: usize = 1_000_000;
const MASK: &str = "••••••";

#[derive(Default, Clone, Copy, Debug, PartialEq)]
struct Rights {
    enabled: bool,
    read: bool,
    create: bool,
    edit: bool,
    privat: bool,
}

pub struct Server {
    db: PathBuf,
    version: String,
    legacy: bool, // alter Client: Sitzung per initialize, gilt für diesen Prozess
}

// Läuft, bis das KI-Programm stdin schließt
pub fn serve(identifier: &str) {
    let dir = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default().join(identifier);
    let mut server = Server { db: dir.join("nexora.db"), version: env!("CARGO_PKG_VERSION").into(), legacy: false };
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        if let Some(answer) = server.handle(&line) {
            if writeln!(stdout, "{answer}").and_then(|_| stdout.flush()).is_err() {
                break;
            }
        }
    }
}

fn open(path: &Path, write: bool) -> Result<Connection, String> {
    if !path.exists() {
        return Err("Die Nexora-Datenbank wurde nicht gefunden".into());
    }
    let flags = if write { OpenFlags::SQLITE_OPEN_READ_WRITE } else { OpenFlags::SQLITE_OPEN_READ_ONLY };
    let db = Connection::open_with_flags(path, flags).map_err(|e| e.to_string())?;
    db.busy_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?;
    Ok(db)
}

fn rights(db: &Connection) -> Rights {
    let saved: Option<String> = db.query_row("SELECT value FROM settings WHERE key = 'mcp'", [], |r| r.get(0)).optional().ok().flatten();
    let v: Value = saved.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    let on = |k: &str| v[k].as_bool().unwrap_or(false);
    Rights { enabled: on("enabled"), read: on("read"), create: on("create"), edit: on("edit"), privat: on("privat") }
}

impl Server {
    fn current_rights(&self) -> Rights {
        open(&self.db, false).map(|db| rights(&db)).unwrap_or_default()
    }

    fn server_meta(&self) -> Value {
        json!({ "io.modelcontextprotocol/serverInfo": { "name": "nexora", "title": "Nexora", "version": self.version } })
    }

    fn instructions(&self) -> String {
        if self.current_rights().enabled {
            "Notizen, Seiten und Listen aus Nexora. Seiten sind Markdown. Mit search_notes suchen, mit read_page lesen, Listenpunkte mit list_items.".into()
        } else {
            "Der Zugriff ist in Nexora ausgeschaltet. Bitte den Nutzer, ihn unter Einstellungen → KI freizugeben.".into()
        }
    }

    // Eine Zeile vom Client; None bei Benachrichtigungen, die keine Antwort bekommen
    pub fn handle(&mut self, line: &str) -> Option<Value> {
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => return Some(error(Value::Null, -32700, "Keine gültige JSON-Nachricht", None)),
        };
        if !msg.is_object() {
            return Some(error(Value::Null, -32600, "Erwartet wird eine einzelne Nachricht", None));
        }
        let method = msg["method"].as_str().unwrap_or_default().to_string();
        let Some(id) = msg.get("id").cloned() else { return None }; // Benachrichtigung (initialized, cancelled)
        if method.is_empty() {
            return None; // Antwort des Clients: gibt es hier nicht, wir stellen keine Fragen
        }
        let params = &msg["params"];
        if method == "initialize" {
            self.legacy = true;
            let wanted = params["protocolVersion"].as_str().unwrap_or_default();
            let version = LEGACY.iter().find(|v| **v == wanted).unwrap_or(&LEGACY[0]);
            let result = json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "nexora", "title": "Nexora", "version": self.version },
                "instructions": self.instructions(),
            });
            return Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
        }
        // Neue Clients nennen Version und Fähigkeiten in jeder Anfrage, alte haben sich mit initialize angemeldet
        let meta = &params["_meta"];
        match meta["io.modelcontextprotocol/protocolVersion"].as_str() {
            Some(v) if v == MODERN => {
                if !meta["io.modelcontextprotocol/clientCapabilities"].is_object() {
                    return Some(error(id, -32602, "In _meta fehlt clientCapabilities", None));
                }
            }
            Some(v) => {
                let supported: Vec<&str> = std::iter::once(MODERN).chain(LEGACY).collect();
                return Some(error(id, -32022, "Unsupported protocol version", Some(json!({ "supported": supported, "requested": v }))));
            }
            None if self.legacy || method == "ping" => {}
            None => return Some(error(id, -32602, "In _meta fehlt protocolVersion", None)),
        }
        let result = match method.as_str() {
            "ping" => json!({}),
            "server/discover" => {
                let supported: Vec<&str> = std::iter::once(MODERN).chain(LEGACY).collect();
                json!({ "supportedVersions": supported, "capabilities": { "tools": {} }, "instructions": self.instructions(), "ttlMs": 0, "cacheScope": "private" })
            }
            "tools/list" => json!({ "tools": tool_list(self.current_rights()), "ttlMs": 0, "cacheScope": "private" }),
            "tools/call" => {
                let name = params["name"].as_str().unwrap_or_default();
                if !ALL_TOOLS.contains(&name) {
                    return Some(error(id, -32602, &format!("Unbekanntes Werkzeug: {name}"), None));
                }
                let empty = json!({});
                let args = if params["arguments"].is_object() { &params["arguments"] } else { &empty };
                match call_tool(&self.db, name, args) {
                    Ok(v) => json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default() }], "isError": false }),
                    Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
                }
            }
            _ => return Some(error(id, -32601, &format!("Unbekannte Methode: {method}"), None)),
        };
        let mut result = result;
        result["resultType"] = json!("complete");
        result["_meta"] = self.server_meta();
        Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
    }
}

fn error(id: Value, code: i64, message: &str, data: Option<Value>) -> Value {
    let mut e = json!({ "code": code, "message": message });
    if let Some(d) = data {
        e["data"] = d;
    }
    if id.is_null() {
        json!({ "jsonrpc": "2.0", "error": e })
    } else {
        json!({ "jsonrpc": "2.0", "id": id, "error": e })
    }
}

const ALL_TOOLS: [&str; 8] = ["search_notes", "list_children", "read_page", "list_items", "create_page", "create_item", "update_page", "update_item"];

fn tool(name: &str, title: &str, description: &str, props: Value, required: &[&str], read_only: bool, destructive: bool) -> Value {
    json!({
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": { "type": "object", "properties": props, "required": required, "additionalProperties": false },
        "annotations": { "title": title, "readOnlyHint": read_only, "destructiveHint": destructive, "idempotentHint": read_only, "openWorldHint": false },
    })
}

fn tool_list(r: Rights) -> Vec<Value> {
    let mut list = Vec::new();
    if !r.enabled {
        return list;
    }
    if r.read {
        list.push(tool("search_notes", "Notizen durchsuchen", "Volltextsuche über Titel, Text und Felder aller freigegebenen Seiten und Listenpunkte. Jedes Wort braucht mindestens 3 Zeichen, alle Wörter müssen vorkommen. Liefert ID, Titel, Pfad und einen Textausschnitt.", json!({
            "query": { "type": "string", "description": "Suchbegriffe" },
            "limit": { "type": "integer", "minimum": 1, "maximum": 50, "description": "Höchstzahl Treffer, Standard 20" },
        }), &["query"], true, false));
        list.push(tool("list_children", "Struktur ansehen", "Listet, was in einem Notizbuch, Abschnitt oder einer Seite liegt. Ohne parent_id die Notizbücher. Listenpunkte stehen nicht hier, dafür gibt es list_items.", json!({
            "parent_id": { "type": "string", "description": "ID des übergeordneten Eintrags; weglassen für die Notizbücher" },
        }), &[], true, false));
        list.push(tool("read_page", "Seite lesen", "Liest eine Seite oder einen Listenpunkt als Markdown, bei Punkten mit Feldern und Kommentaren, bei Listen mit der Felddefinition. Passwort-artige Stellen sind maskiert.", json!({
            "id": { "type": "string", "description": "ID aus search_notes, list_children oder list_items" },
        }), &["id"], true, false));
        list.push(tool("list_items", "Listenpunkte lesen", "Punkte einer Liste mit ihren Feldern, in der Reihenfolge der Liste. Erledigte nur auf Wunsch.", json!({
            "list_id": { "type": "string", "description": "ID der Liste" },
            "include_done": { "type": "boolean", "description": "Auch erledigte und verworfene Punkte" },
            "limit": { "type": "integer", "minimum": 1, "maximum": 500, "description": "Höchstzahl, Standard 100" },
        }), &["list_id"], true, false));
    }
    if r.create {
        list.push(tool("create_page", "Seite anlegen", "Legt eine neue Seite in einem Notizbuch, Abschnitt oder unter einer Seite an. Vorhandenes bleibt unberührt.", json!({
            "parent_id": { "type": "string", "description": "ID von Notizbuch, Abschnitt oder Seite" },
            "title": { "type": "string" },
            "body": { "type": "string", "description": "Inhalt als Markdown" },
        }), &["parent_id", "title"], false, false));
        list.push(tool("create_item", "Listenpunkt anlegen", "Legt einen neuen Punkt in einer Liste an. Felder nach Name oder ID, Auswahlwerte nach ihrem Namen, Datum als JJJJ-MM-TT; read_page auf die Liste zeigt die Felder.", json!({
            "list_id": { "type": "string" },
            "title": { "type": "string" },
            "body": { "type": "string", "description": "Text des Punkts als Markdown" },
            "fields": { "type": "object", "description": "z. B. {\"Priorität\": \"Hoch\", \"Fällig\": \"2026-12-24\"}" },
        }), &["list_id", "title"], false, false));
    }
    if r.edit {
        list.push(tool("update_page", "Seite ändern", "Ändert Titel oder Inhalt einer Seite. body ersetzt den ganzen Text, append hängt unten an. Gesperrte Seiten und Seiten mit Zeichnungen gehen nicht. Alte Fassungen bleiben im Verlauf der Seite.", json!({
            "id": { "type": "string" },
            "title": { "type": "string" },
            "body": { "type": "string", "description": "Neuer ganzer Inhalt als Markdown" },
            "append": { "type": "string", "description": "Text, der unten angehängt wird" },
        }), &["id"], false, true));
        list.push(tool("update_item", "Listenpunkt ändern", "Ändert Titel, Text oder Felder eines Listenpunkts. Felder wie bei create_item, null leert ein Feld.", json!({
            "id": { "type": "string" },
            "title": { "type": "string" },
            "body": { "type": "string" },
            "append": { "type": "string" },
            "fields": { "type": "object" },
        }), &["id"], false, true));
    }
    list
}

// Die Werkzeuge selbst prüfen ihr Recht: die Liste kann das Programm noch von vorhin kennen
fn call_tool(path: &Path, name: &str, args: &Value) -> Result<Value, String> {
    let write = name.starts_with("create_") || name.starts_with("update_");
    let db = open(path, write)?;
    let r = rights(&db);
    if !r.enabled {
        return Err("Der Zugriff ist in Nexora ausgeschaltet (Einstellungen → KI).".into());
    }
    let allowed = match name {
        "create_page" | "create_item" => r.create,
        "update_page" | "update_item" => r.edit,
        _ => r.read,
    };
    if !allowed {
        return Err(format!("Das Werkzeug {name} ist in Nexora nicht freigegeben (Einstellungen → KI)."));
    }
    match name {
        "search_notes" => search_notes(&db, r, args),
        "list_children" => list_children(&db, r, args),
        "read_page" => read_page(&db, r, args),
        "list_items" => list_items(&db, r, args),
        "create_page" => create_page(&db, r, args),
        "create_item" => create_item(&db, r, args),
        "update_page" => update_node(&db, r, args, "page"),
        _ => update_node(&db, r, args, "row"),
    }
}

struct Node {
    id: String,
    parent: Option<String>,
    kind: String,
    title: String,
    body: String,
    props: Value,
    config: Value,
    locked: bool,
    area: Option<String>,
    updated: String,
}

fn read_node(db: &Connection, id: &str) -> Result<Option<Node>, String> {
    db.query_row(
        "SELECT id, parent_id, kind, title, body, props, config, locked, area, updated_at FROM nodes WHERE id = ?1 AND deleted_at IS NULL",
        [id],
        |r| {
            let json_of = |v: Option<String>| v.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
            Ok(Node {
                id: r.get(0)?,
                parent: r.get(1)?,
                kind: r.get(2)?,
                title: r.get(3)?,
                body: r.get(4)?,
                props: json_of(r.get(5)?),
                config: json_of(r.get(6)?),
                locked: r.get::<_, Option<i64>>(7)?.unwrap_or(0) != 0,
                area: r.get(8)?,
                updated: r.get(9)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

// Kette von oben nach unten; None, wenn etwas davon gelöscht oder im gesperrten Bereich Privat liegt
fn chain(db: &Connection, r: Rights, id: &str) -> Result<Option<Vec<Node>>, String> {
    let mut nodes = Vec::new();
    let mut at = Some(id.to_string());
    while let Some(current) = at {
        if nodes.len() > 100 {
            return Ok(None);
        }
        let Some(node) = read_node(db, &current)? else { return Ok(None) };
        at = node.parent.clone();
        nodes.push(node);
    }
    nodes.reverse();
    let private = nodes.first().and_then(|n| n.area.as_deref()) == Some("privat");
    Ok(if private && !r.privat { None } else { Some(nodes) })
}

fn visible(db: &Connection, r: Rights, id: &str) -> Result<Vec<Node>, String> {
    chain(db, r, id)?.ok_or_else(|| format!("Eintrag {id} nicht gefunden oder nicht freigegeben"))
}

fn path_text(nodes: &[Node]) -> String {
    nodes.iter().map(|n| if n.title.is_empty() { "Ohne Titel" } else { n.title.as_str() }).collect::<Vec<_>>().join(" / ")
}

fn secret_patterns() -> &'static (Vec<Regex>, Regex) {
    static PATTERNS: OnceLock<(Vec<Regex>, Regex)> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        // Wie secrets.js beim Einfügen
        let blocks = [
            r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
            r"\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}",
            r"\bAKIA[0-9A-Z]{16}\b",
            r"\bgh[pousr]_[A-Za-z0-9]{30,}\b",
            r"\bxox[abpr]-[A-Za-z0-9-]{10,}",
        ];
        let keyed = Regex::new(r#"(?i)\b(pass(?:wor[dt])?|pwd|kennwort|secret|token|api[-_]?key|client[-_]?secret|account[-_]?key|shared[-_]?access[-_]?key)\b["']?\s*[:=]\s*["']?([^\s"';,]{4,})"#).unwrap();
        (blocks.iter().map(|b| Regex::new(b).unwrap()).collect(), keyed)
    })
}

fn mask_secrets(text: &str) -> String {
    let (blocks, keyed) = secret_patterns();
    let mut out = text.to_string();
    for re in blocks {
        out = re.replace_all(&out, MASK).to_string();
    }
    keyed
        .replace_all(&out, |c: &regex::Captures| {
            let whole = &c[0];
            let value = c.get(2).unwrap().as_str();
            format!("{}{MASK}", &whole[..whole.len() - value.len()])
        })
        .to_string()
}

// Für das KI-Programm: ohne Strich-Zeilen von Zeichnungen und ohne Positionszeilen freier Seiten, Geheimes maskiert
fn clean_body(body: &str) -> String {
    let lines = body.lines().filter(|l| {
        let t = l.trim_start();
        !(t.starts_with("<!-- ink ") || t.starts_with("<!-- box ") || t.starts_with("<!-- nexora:"))
    });
    mask_secrets(lines.collect::<Vec<_>>().join("\n").trim())
}

fn text_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    match args[key].as_str() {
        Some(s) if !s.trim().is_empty() => Ok(s),
        _ => Err(format!("{key} fehlt")),
    }
}

fn input_ok(args: &Value) -> Result<(), String> {
    for key in ["title", "body", "append"] {
        let len = args[key].as_str().map_or(0, str::len);
        if len > MAX_INPUT {
            return Err(format!("{key} ist zu lang"));
        }
    }
    Ok(())
}

fn search_notes(db: &Connection, r: Rights, args: &Value) -> Result<Value, String> {
    let words: Vec<String> = text_arg(args, "query")?.split_whitespace().filter(|w| w.chars().count() >= 3).map(|w| format!("\"{}\"", w.replace('"', "\"\""))).collect();
    if words.is_empty() {
        return Err("Jedes Suchwort braucht mindestens 3 Zeichen".into());
    }
    let limit = args["limit"].as_u64().unwrap_or(20).clamp(1, 50) as usize;
    let mut stmt = db
        .prepare("SELECT id, title, snippet(search, 2, '', '', '…', 32) FROM search WHERE search MATCH ?1 ORDER BY rank LIMIT ?2")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![words.join(" "), (limit * 5) as i64], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))
        .map_err(|e| e.to_string())?;
    let mut hits = Vec::new();
    for row in rows {
        let (id, title, snippet) = row.map_err(|e| e.to_string())?;
        if hits.len() == limit {
            break;
        }
        if let Some(nodes) = chain(db, r, &id)? {
            hits.push(json!({ "id": id, "title": title, "kind": nodes.last().unwrap().kind, "path": path_text(&nodes), "snippet": mask_secrets(&snippet) }));
        }
    }
    Ok(json!({ "results": hits }))
}

fn list_children(db: &Connection, r: Rights, args: &Value) -> Result<Value, String> {
    let parent = args["parent_id"].as_str().filter(|s| !s.is_empty());
    if let Some(p) = parent {
        visible(db, r, p)?;
    }
    let mut stmt = db
        .prepare("SELECT id, kind, title, area FROM nodes WHERE parent_id IS ?1 AND deleted_at IS NULL AND kind <> 'row' ORDER BY sort LIMIT 500")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![parent], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, Option<String>>(3)?)))
        .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for row in rows {
        let (id, kind, title, area) = row.map_err(|e| e.to_string())?;
        if parent.is_none() && area.as_deref() == Some("privat") && !r.privat {
            continue;
        }
        items.push(json!({ "id": id, "kind": kind, "title": title }));
    }
    Ok(json!({ "items": items }))
}

fn fields_of(list: &Node) -> Vec<Value> {
    list.config["fields"].as_array().cloned().unwrap_or_default()
}

fn option_name(field: &Value, id: &Value) -> Value {
    let found = field["options"].as_array().and_then(|o| o.iter().find(|x| x["id"] == *id)).map(|x| x["name"].clone());
    found.unwrap_or_else(|| id.clone())
}

// Wert eines Felds so, wie ihn Menschen in Nexora sehen
fn shown(field: &Value, value: &Value, list: &Node) -> Value {
    match field["type"].as_str().unwrap_or_default() {
        "status" | "select" => option_name(field, value),
        "multi" => match value.as_array() {
            Some(items) => Value::Array(items.iter().map(|v| option_name(field, v)).collect()),
            None => value.clone(),
        },
        "nr" => {
            let prefix = list.config["prefix"].as_str().unwrap_or_default();
            match value.as_i64() {
                Some(n) if prefix.is_empty() => json!(n),
                Some(n) => json!(format!("{prefix}-{n:03}")),
                None => value.clone(),
            }
        }
        _ => value.clone(),
    }
}

fn shown_fields(row: &Node, list: Option<&Node>) -> Value {
    let mut out = Map::new();
    if let Some(list) = list {
        for f in fields_of(list) {
            let (Some(id), Some(name)) = (f["id"].as_str(), f["name"].as_str()) else { continue };
            let v = &row.props[id];
            if !v.is_null() && *v != json!("") && *v != json!([]) {
                out.insert(name.to_string(), shown(&f, v, list));
            }
        }
    }
    Value::Object(out)
}

fn read_page(db: &Connection, r: Rights, args: &Value) -> Result<Value, String> {
    let nodes = visible(db, r, text_arg(args, "id")?)?;
    let node = nodes.last().unwrap();
    let body = clean_body(&node.body);
    let cut = body.char_indices().nth(MAX_BODY).map(|(i, _)| i);
    let mut out = json!({
        "id": node.id,
        "kind": node.kind,
        "title": node.title,
        "path": path_text(&nodes),
        "updated_at": node.updated,
        "locked": node.locked,
        "body": cut.map_or(body.as_str(), |i| &body[..i]),
    });
    if cut.is_some() {
        out["truncated"] = json!(true);
    }
    if node.kind == "database" {
        let fields: Vec<Value> = fields_of(node)
            .iter()
            .map(|f| {
                let options: Vec<Value> = f["options"].as_array().map(|o| o.iter().map(|x| x["name"].clone()).collect()).unwrap_or_default();
                json!({ "name": f["name"], "type": f["type"], "options": options })
            })
            .collect();
        out["fields"] = json!(fields);
    }
    if node.kind == "row" {
        let list = nodes.len().checked_sub(2).map(|i| &nodes[i]);
        out["fields"] = shown_fields(node, list);
        let mut stmt = db.prepare("SELECT text, created_at FROM activity WHERE node_id = ?1 AND kind = 'comment' ORDER BY id").map_err(|e| e.to_string())?;
        let comments: Vec<Value> = stmt
            .query_map([&node.id], |row| Ok(json!({ "text": mask_secrets(&row.get::<_, String>(0)?), "at": row.get::<_, String>(1)? })))
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .collect();
        out["comments"] = json!(comments);
    }
    Ok(out)
}

fn is_done(row: &Node, list: &Node) -> bool {
    fields_of(list).iter().filter(|f| f["type"] == "status").any(|f| {
        let id = f["id"].as_str().unwrap_or_default();
        f["options"].as_array().is_some_and(|o| o.iter().any(|x| x["id"] == row.props[id] && x["done"] == true))
    })
}

fn list_of(db: &Connection, r: Rights, id: &str) -> Result<Node, String> {
    let mut nodes = visible(db, r, id)?;
    let node = nodes.pop().unwrap();
    if node.kind != "database" {
        return Err(format!("{id} ist keine Liste"));
    }
    Ok(node)
}

fn list_items(db: &Connection, r: Rights, args: &Value) -> Result<Value, String> {
    let list = list_of(db, r, text_arg(args, "list_id")?)?;
    let with_done = args["include_done"].as_bool().unwrap_or(false);
    let limit = args["limit"].as_u64().unwrap_or(100).clamp(1, 500) as usize;
    let mut stmt = db.prepare("SELECT id FROM nodes WHERE parent_id = ?1 AND kind = 'row' AND deleted_at IS NULL ORDER BY sort").map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt.query_map([&list.id], |row| row.get(0)).map_err(|e| e.to_string())?.filter_map(Result::ok).collect();
    let mut items = Vec::new();
    for id in ids {
        let Some(row) = read_node(db, &id)? else { continue };
        if !with_done && is_done(&row, &list) {
            continue;
        }
        if items.len() == limit {
            break;
        }
        items.push(json!({ "id": row.id, "title": row.title, "fields": shown_fields(&row, Some(&list)) }));
    }
    Ok(json!({ "list": list.title, "items": items }))
}

fn new_id() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("Zufallszahlen");
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..])
}

fn insert_node(db: &Connection, id: &str, parent: &str, kind: &str, title: &str, body: &str, props: Option<String>) -> Result<(), String> {
    db.execute(
        "INSERT INTO nodes (id, parent_id, kind, title, body, props, sort, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, CAST(strftime('%s', 'now') AS REAL) * 1000, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
        params![id, parent, kind, title, body, props],
    )
    .map_err(|e| e.to_string())?;
    note(db, id, "Über MCP angelegt")
}

fn note(db: &Connection, id: &str, text: &str) -> Result<(), String> {
    db.execute("INSERT INTO activity (node_id, kind, text) VALUES (?1, 'change', ?2)", params![id, text]).map(|_| ()).map_err(|e| e.to_string())
}

fn create_page(db: &Connection, r: Rights, args: &Value) -> Result<Value, String> {
    input_ok(args)?;
    let parent = text_arg(args, "parent_id")?;
    let nodes = visible(db, r, parent)?;
    if !matches!(nodes.last().unwrap().kind.as_str(), "notebook" | "section" | "page") {
        return Err("Seiten gehören in ein Notizbuch, einen Abschnitt oder unter eine Seite".into());
    }
    let id = new_id();
    insert_node(db, &id, parent, "page", text_arg(args, "title")?, args["body"].as_str().unwrap_or_default(), None)?;
    Ok(json!({ "id": id, "created": true }))
}

fn find_field<'a>(fields: &'a [Value], key: &str) -> Option<&'a Value> {
    let low = key.to_lowercase();
    fields.iter().find(|f| f["id"] == key).or_else(|| fields.iter().find(|f| f["name"].as_str().is_some_and(|n| n.to_lowercase() == low)))
}

fn field_value(field: &Value, input: &Value) -> Result<Value, String> {
    let name = field["name"].as_str().unwrap_or_default();
    let options = || field["options"].as_array().cloned().unwrap_or_default();
    let pick = |wanted: &Value| -> Result<Value, String> {
        let text = wanted.as_str().unwrap_or_default().to_lowercase();
        let hit = options().into_iter().find(|o| o["id"] == *wanted || o["name"].as_str().is_some_and(|n| n.to_lowercase() == text));
        hit.map(|o| o["id"].clone()).ok_or_else(|| {
            let names: Vec<String> = options().iter().filter_map(|o| o["name"].as_str().map(String::from)).collect();
            format!("{name}: „{}“ gibt es nicht, möglich sind: {}", wanted.as_str().unwrap_or_default(), names.join(", "))
        })
    };
    match field["type"].as_str().unwrap_or_default() {
        "status" | "select" => pick(input),
        "multi" => {
            let list = input.as_array().cloned().unwrap_or_else(|| vec![input.clone()]);
            // Tags dürfen neu sein (ID ist der Name), andere Mehrfachauswahlen nicht
            let free = field["id"] == "tags";
            let picked: Result<Vec<Value>, String> = list.iter().map(|v| if free { pick(v).or_else(|_| Ok(v.clone())) } else { pick(v) }).collect();
            Ok(Value::Array(picked?))
        }
        "date" => match input.as_str() {
            Some(d) if is_date(d) => Ok(input.clone()),
            _ => Err(format!("{name}: Datum als JJJJ-MM-TT, optional mit Uhrzeit JJJJ-MM-TTTHH:MM")),
        },
        "number" => input.as_f64().map(|_| input.clone()).ok_or_else(|| format!("{name}: Zahl erwartet")),
        "checkbox" => input.as_bool().map(|_| input.clone()).ok_or_else(|| format!("{name}: true oder false erwartet")),
        "text" | "link" => input.as_str().map(|_| input.clone()).ok_or_else(|| format!("{name}: Text erwartet")),
        "person" => {
            let ok = input.is_string() || input.as_array().is_some_and(|a| a.iter().all(Value::is_string));
            if ok {
                Ok(input.clone())
            } else {
                Err(format!("{name}: Name oder Liste von Namen erwartet"))
            }
        }
        other => Err(format!("{name}: Felder vom Typ {other} lassen sich hier nicht setzen")),
    }
}

fn is_date(s: &str) -> bool {
    let b = s.as_bytes();
    let digits = |r: std::ops::Range<usize>| r.into_iter().all(|i| b[i].is_ascii_digit());
    match b.len() {
        10 => digits(0..4) && b[4] == b'-' && digits(5..7) && b[7] == b'-' && digits(8..10),
        16 => digits(0..4) && b[4] == b'-' && digits(5..7) && b[7] == b'-' && digits(8..10) && b[10] == b'T' && digits(11..13) && b[13] == b':' && digits(14..16),
        _ => false,
    }
}

// Felder aus der Eingabe in props übernehmen; neue Tags kommen in die Liste, wie in Nexora selbst
fn apply_fields(list: &mut Node, props: &mut Map<String, Value>, input: &Value) -> Result<Vec<String>, String> {
    let mut changed = Vec::new();
    let Some(input) = input.as_object() else { return Ok(changed) };
    for (key, value) in input {
        let fields = fields_of(list);
        let field = find_field(&fields, key).ok_or_else(|| {
            let names: Vec<&str> = fields.iter().filter_map(|f| f["name"].as_str()).collect();
            format!("Feld „{key}“ gibt es nicht, vorhanden: {}", names.join(", "))
        })?;
        let id = field["id"].as_str().unwrap_or_default().to_string();
        if value.is_null() {
            props.remove(&id);
        } else {
            let v = field_value(field, value)?;
            if id == "tags" {
                add_tags(list, &v);
            }
            props.insert(id, v);
        }
        changed.push(field["name"].as_str().unwrap_or_default().to_string());
    }
    Ok(changed)
}

fn add_tags(list: &mut Node, tags: &Value) {
    let Some(fields) = list.config["fields"].as_array_mut() else { return };
    let Some(field) = fields.iter_mut().find(|f| f["id"] == "tags") else { return };
    let Some(options) = field["options"].as_array_mut() else { return };
    for tag in tags.as_array().into_iter().flatten() {
        if !options.iter().any(|o| o["id"] == *tag) {
            options.push(json!({ "id": tag, "name": tag }));
        }
    }
}

fn create_item(db: &Connection, r: Rights, args: &Value) -> Result<Value, String> {
    input_ok(args)?;
    let mut list = list_of(db, r, text_arg(args, "list_id")?)?;
    let title = text_arg(args, "title")?;
    let mut props = Map::new();
    let fields = fields_of(&list);
    // Wie beim Anlegen in Nexora: erster Status und die nächste Nummer
    if let Some(status) = fields.iter().find(|f| f["type"] == "status") {
        if let (Some(id), Some(first)) = (status["id"].as_str(), status["options"].get(0)) {
            props.insert(id.to_string(), first["id"].clone());
        }
    }
    apply_fields(&mut list, &mut props, &args["fields"])?;
    let mut nr = None;
    if fields.iter().any(|f| f["type"] == "nr") {
        let next = list.config["nextNr"].as_i64().unwrap_or(1);
        props.insert("nr".into(), json!(next));
        list.config["nextNr"] = json!(next + 1);
        nr = Some(shown(&json!({ "type": "nr" }), &json!(next), &list));
    }
    let id = new_id();
    db.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    let done = insert_node(db, &id, &list.id, "row", title, args["body"].as_str().unwrap_or_default(), Some(Value::Object(props).to_string())).and_then(|_| {
        db.execute("UPDATE nodes SET config = ?1 WHERE id = ?2", params![list.config.to_string(), list.id]).map(|_| ()).map_err(|e| e.to_string())
    });
    db.execute_batch(if done.is_ok() { "COMMIT" } else { "ROLLBACK" }).map_err(|e| e.to_string())?;
    done?;
    Ok(json!({ "id": id, "nr": nr, "created": true }))
}

fn update_node(db: &Connection, r: Rights, args: &Value, kind: &str) -> Result<Value, String> {
    input_ok(args)?;
    let id = text_arg(args, "id")?;
    let mut nodes = visible(db, r, id)?;
    let node = nodes.pop().unwrap();
    if node.kind != kind {
        return Err(format!("{id} ist vom Typ {}, das passende Werkzeug ist ein anderes", node.kind));
    }
    if node.locked {
        return Err("Die Seite ist in Nexora gesperrt".into());
    }
    let mut changed = Vec::new();
    let mut body = node.body.clone();
    let new_body = args["body"].as_str();
    let append = args["append"].as_str().filter(|a| !a.is_empty());
    if new_body.is_some() || append.is_some() {
        // Strich-Zeilen und Positionen sieht das KI-Programm nicht; es würde sie beim Zurückschreiben löschen
        if body.contains("<!-- ink ") || body.contains("<!-- nexora:") {
            return Err("Diese Seite enthält Zeichnungen oder ist frei angeordnet, ihren Text bitte in Nexora ändern".into());
        }
        if let Some(text) = new_body {
            if text.contains(MASK) && !body.contains(MASK) {
                return Err("Der neue Text enthält maskierte Stellen (••••••) und würde sie überschreiben. Bitte append verwenden.".into());
            }
            body = text.to_string();
        }
        if let Some(text) = append {
            body = if body.trim().is_empty() { text.to_string() } else { format!("{}\n\n{text}", body.trim_end()) };
        }
        changed.push("Text".to_string());
    }
    let title = match args["title"].as_str() {
        Some(t) if !t.trim().is_empty() => {
            changed.push("Titel".to_string());
            t.to_string()
        }
        _ => node.title.clone(),
    };
    let mut props = node.props.as_object().cloned().unwrap_or_default();
    let mut list = nodes.pop();
    if !args["fields"].is_null() {
        let Some(owner) = list.as_mut().filter(|l| l.kind == "database") else {
            return Err("Felder gibt es nur bei Listenpunkten in einer Liste".into());
        };
        changed.extend(apply_fields(owner, &mut props, &args["fields"])?);
    }
    if changed.is_empty() {
        return Err("Nichts zu ändern: title, body, append oder fields angeben".into());
    }
    db.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    let done = db
        .execute(
            "UPDATE nodes SET title = ?1, body = ?2, props = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?4",
            params![title, body, if node.kind == "row" { Some(Value::Object(props).to_string()) } else { None }, id],
        )
        .map_err(|e| e.to_string())
        .and_then(|_| match list.as_ref().filter(|l| l.kind == "database") {
            Some(l) => db.execute("UPDATE nodes SET config = ?1 WHERE id = ?2", params![l.config.to_string(), l.id]).map(|_| ()).map_err(|e| e.to_string()),
            None => Ok(()),
        })
        .and_then(|_| note(db, id, &format!("Über MCP geändert: {}", changed.join(", "))));
    db.execute_batch(if done.is_ok() { "COMMIT" } else { "ROLLBACK" }).map_err(|e| e.to_string())?;
    done?;
    Ok(json!({ "id": id, "changed": changed }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const META: &str = r#""_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}"#;

    struct Fixture {
        path: PathBuf,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    // Die Tabellen wie nach den Migrationen, soweit der Server sie braucht
    fn fixture(name: &str, mcp: Option<&str>) -> Fixture {
        let path = std::env::temp_dir().join(format!("nexora-mcp-{name}-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "CREATE TABLE nodes (id TEXT PRIMARY KEY, parent_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', props TEXT, config TEXT, locked INTEGER DEFAULT 0, area TEXT, sort REAL NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT NOT NULL DEFAULT '', deleted_at TEXT);
             CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
             CREATE TABLE activity (id INTEGER PRIMARY KEY AUTOINCREMENT, node_id TEXT, kind TEXT, text TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
             CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED, title, body, extra, tokenize = 'trigram remove_diacritics 1');
             CREATE TRIGGER s_ai AFTER INSERT ON nodes BEGIN INSERT INTO search (id, title, body, extra) VALUES (new.id, new.title, new.body, ''); END;
             CREATE TRIGGER s_au AFTER UPDATE OF title, body ON nodes BEGIN DELETE FROM search WHERE id = old.id; INSERT INTO search (id, title, body, extra) VALUES (new.id, new.title, new.body, ''); END;
             INSERT INTO nodes (id, kind, title, sort) VALUES ('nb', 'notebook', 'Arbeit', 1);
             INSERT INTO nodes (id, parent_id, kind, title, body, sort) VALUES ('sec', 'nb', 'section', 'Kunden', '', 1);
             INSERT INTO nodes (id, parent_id, kind, title, body, sort) VALUES ('p1', 'sec', 'page', 'Serverraum', 'Der Serverraum ist kühl. Passwort: geheim123 steht hier. [[vault:abc|Admin]]', 1);
             INSERT INTO nodes (id, parent_id, kind, title, body, locked, sort) VALUES ('p2', 'sec', 'page', 'Gesperrt', 'Fest', 1, 2);
             INSERT INTO nodes (id, parent_id, kind, title, body, sort) VALUES ('p3', 'sec', 'page', 'Skizze', 'Text
<!-- nexora:zeichnung h=100 | t=pen c=text w=2 p=1,1 2,2 -->
Mehr', 3);
             INSERT INTO nodes (id, parent_id, kind, title, body, sort, deleted_at) VALUES ('p4', 'sec', 'page', 'Serverraum alt', 'weg', 4, 'x');
             INSERT INTO nodes (id, kind, title, area, sort) VALUES ('nbp', 'notebook', 'Privat', 'privat', 2);
             INSERT INTO nodes (id, parent_id, kind, title, body, sort) VALUES ('pp', 'nbp', 'page', 'Hobbykeller Serverraum', 'Privater Text', 1);",
        )
        .unwrap();
        let config = json!({ "prefix": "LOP", "nextNr": 7, "fields": [
            { "id": "nr", "name": "Nr.", "type": "nr" },
            { "id": "status", "name": "Status", "type": "status", "options": [{ "id": "offen", "name": "Offen" }, { "id": "erledigt", "name": "Erledigt", "done": true }] },
            { "id": "prio", "name": "Priorität", "type": "select", "options": [{ "id": "hoch", "name": "Hoch" }, { "id": "niedrig", "name": "Niedrig" }] },
            { "id": "due", "name": "Fällig", "type": "date" },
            { "id": "tags", "name": "Tags", "type": "multi", "options": [] },
        ] });
        db.execute("INSERT INTO nodes (id, parent_id, kind, title, config, sort) VALUES ('lst', 'nb', 'database', 'Offene Punkte', ?1, 2)", [config.to_string()]).unwrap();
        db.execute("INSERT INTO nodes (id, parent_id, kind, title, props, sort) VALUES ('r1', 'lst', 'row', 'Drucker', ?1, 1)", [json!({ "nr": 5, "status": "offen", "prio": "hoch" }).to_string()]).unwrap();
        db.execute("INSERT INTO nodes (id, parent_id, kind, title, props, sort) VALUES ('r2', 'lst', 'row', 'Fertig', ?1, 2)", [json!({ "nr": 6, "status": "erledigt" }).to_string()]).unwrap();
        db.execute("INSERT INTO activity (node_id, kind, text) VALUES ('r1', 'comment', 'Toner token=abcd1234 fehlt')", []).unwrap();
        if let Some(v) = mcp {
            db.execute("INSERT INTO settings (key, value) VALUES ('mcp', ?1)", [v]).unwrap();
        }
        Fixture { path }
    }

    fn server(f: &Fixture) -> Server {
        Server { db: f.path.clone(), version: "1.2.3".into(), legacy: false }
    }

    fn call(s: &mut Server, name: &str, args: Value) -> (bool, Value) {
        let line = json!({ "jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": { "name": name, "arguments": args, "_meta": { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientCapabilities": {} } } }).to_string();
        let r = s.handle(&line).unwrap();
        let result = &r["result"];
        assert_eq!(result["resultType"], "complete", "{r}");
        let text = result["content"][0]["text"].as_str().unwrap();
        (result["isError"] == true, serde_json::from_str(text).unwrap_or(json!(text)))
    }

    fn names(s: &mut Server) -> Vec<String> {
        let r = s.handle(&format!(r#"{{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{{{META}}}}}"#)).unwrap();
        assert_eq!(r["result"]["ttlMs"], 0);
        r["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn neuer_und_alter_client() {
        let f = fixture("proto", Some(r#"{"enabled":true,"read":true}"#));
        let mut s = server(&f);
        // Neu: server/discover ohne Handshake
        let r = s.handle(&format!(r#"{{"jsonrpc":"2.0","id":"d","method":"server/discover","params":{{{META}}}}}"#)).unwrap();
        assert_eq!(r["id"], "d");
        assert_eq!(r["result"]["supportedVersions"][0], MODERN);
        assert_eq!(r["result"]["resultType"], "complete");
        assert_eq!(r["result"]["_meta"]["io.modelcontextprotocol/serverInfo"]["name"], "nexora");
        // Unbekannte Version nennt, was geht
        let r = s.handle(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"1900-01-01","io.modelcontextprotocol/clientCapabilities":{}}}}"#).unwrap();
        assert_eq!(r["error"]["code"], -32022);
        assert_eq!(r["error"]["data"]["requested"], "1900-01-01");
        // Fehlende Pflichtangaben
        assert_eq!(s.handle(r#"{"jsonrpc":"2.0","id":3,"method":"tools/list"}"#).unwrap()["error"]["code"], -32602);
        let r = s.handle(r#"{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}"#).unwrap();
        assert_eq!(r["error"]["code"], -32602);
        // Alt: initialize, danach ohne _meta
        let r = s.handle(r#"{"jsonrpc":"2.0","id":4,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}"#).unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(r["result"]["serverInfo"]["version"], "1.2.3");
        assert!(r["result"]["capabilities"]["tools"].is_object());
        assert!(s.handle(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none());
        let r = s.handle(r#"{"jsonrpc":"2.0","id":5,"method":"tools/list"}"#).unwrap();
        assert!(!r["result"]["tools"].as_array().unwrap().is_empty());
        assert!(s.handle(r#"{"jsonrpc":"2.0","id":6,"method":"ping"}"#).unwrap()["result"].is_object());
        // Unbekannte Dinge
        assert_eq!(s.handle(r#"{"jsonrpc":"2.0","id":7,"method":"gibtsnicht"}"#).unwrap()["error"]["code"], -32601);
        assert_eq!(s.handle("kein json").unwrap()["error"]["code"], -32700);
        assert_eq!(s.handle("[1]").unwrap()["error"]["code"], -32600);
        let r = s.handle(r#"{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"loesche_alles"}}"#).unwrap();
        assert_eq!(r["error"]["code"], -32602);
        // Unbekannte Version bei initialize: neueste alte
        let r = s.handle(r#"{"jsonrpc":"2.0","id":9,"method":"initialize","params":{"protocolVersion":"2000-01-01"}}"#).unwrap();
        assert_eq!(r["result"]["protocolVersion"], LEGACY[0]);
    }

    #[test]
    fn rechte_kommen_aus_den_einstellungen() {
        // Von Haus aus aus
        let f = fixture("aus", None);
        let mut s = server(&f);
        assert!(names(&mut s).is_empty());
        let (err, text) = call(&mut s, "read_page", json!({ "id": "p1" }));
        assert!(err);
        assert!(text.as_str().unwrap().contains("Einstellungen"));

        let f = fixture("lesen", Some(r#"{"enabled":true,"read":true}"#));
        let mut s = server(&f);
        assert_eq!(names(&mut s), ["search_notes", "list_children", "read_page", "list_items"]);
        assert!(call(&mut s, "create_page", json!({ "parent_id": "nb", "title": "x" })).0);
        assert!(call(&mut s, "update_page", json!({ "id": "p1", "append": "x" })).0);

        // Änderung wirkt sofort, auch ohne Neustart des Servers
        let db = Connection::open(&f.path).unwrap();
        db.execute("UPDATE settings SET value = '{\"enabled\":true,\"read\":false,\"create\":true,\"edit\":true}' WHERE key = 'mcp'", []).unwrap();
        assert_eq!(names(&mut s), ["create_page", "create_item", "update_page", "update_item"]);
        assert!(call(&mut s, "read_page", json!({ "id": "p1" })).0);
        db.execute("UPDATE settings SET value = '{\"enabled\":false,\"read\":true,\"create\":true,\"edit\":true}' WHERE key = 'mcp'", []).unwrap();
        assert!(names(&mut s).is_empty());
        assert!(call(&mut s, "list_children", json!({})).0);
    }

    #[test]
    fn lesen_und_suchen() {
        let f = fixture("read", Some(r#"{"enabled":true,"read":true}"#));
        let mut s = server(&f);
        let (err, v) = call(&mut s, "list_children", json!({}));
        assert!(!err);
        assert_eq!(v["items"].as_array().unwrap().len(), 1, "Privat bleibt draußen: {v}");
        let (_, v) = call(&mut s, "list_children", json!({ "parent_id": "lst" }));
        assert!(v["items"].as_array().unwrap().is_empty(), "Punkte nur über list_items");

        let (_, v) = call(&mut s, "read_page", json!({ "id": "p1" }));
        assert_eq!(v["path"], "Arbeit / Kunden / Serverraum");
        let body = v["body"].as_str().unwrap();
        assert!(!body.contains("geheim123"), "{body}");
        assert!(body.contains("Passwort: ••••••"), "{body}");
        assert!(body.contains("[[vault:abc|Admin]]"));

        let (_, v) = call(&mut s, "read_page", json!({ "id": "p3" }));
        assert_eq!(v["body"], "Text\nMehr", "keine Strich-Zeilen");

        let (_, v) = call(&mut s, "search_notes", json!({ "query": "serverraum" }));
        let hits = v["results"].as_array().unwrap();
        assert_eq!(hits.len(), 1, "ohne Gelöschtes und ohne Privat: {v}");
        assert_eq!(hits[0]["id"], "p1");
        assert!(!hits[0]["snippet"].as_str().unwrap().contains("geheim123"));
        assert!(call(&mut s, "search_notes", json!({ "query": "ab" })).0);

        for id in ["pp", "nbp", "p4", "gibtsnicht"] {
            assert!(call(&mut s, "read_page", json!({ "id": id })).0, "{id}");
        }

        let (_, v) = call(&mut s, "list_items", json!({ "list_id": "lst" }));
        let items = v["items"].as_array().unwrap();
        assert_eq!(items.len(), 1, "Erledigtes nur auf Wunsch");
        assert_eq!(items[0]["fields"]["Nr."], "LOP-005");
        assert_eq!(items[0]["fields"]["Status"], "Offen");
        assert_eq!(items[0]["fields"]["Priorität"], "Hoch");
        let (_, v) = call(&mut s, "list_items", json!({ "list_id": "lst", "include_done": true }));
        assert_eq!(v["items"].as_array().unwrap().len(), 2);
        assert!(call(&mut s, "list_items", json!({ "list_id": "p1" })).0);

        let (_, v) = call(&mut s, "read_page", json!({ "id": "r1" }));
        assert_eq!(v["fields"]["Priorität"], "Hoch");
        assert!(v["comments"][0]["text"].as_str().unwrap().contains("token=••••••"));
        let (_, v) = call(&mut s, "read_page", json!({ "id": "lst" }));
        assert_eq!(v["fields"][1]["options"][1], "Erledigt");
    }

    #[test]
    fn privat_nur_mit_freigabe() {
        let f = fixture("privat", Some(r#"{"enabled":true,"read":true,"create":true,"privat":true}"#));
        let mut s = server(&f);
        let (_, v) = call(&mut s, "list_children", json!({}));
        assert_eq!(v["items"].as_array().unwrap().len(), 2);
        assert!(!call(&mut s, "read_page", json!({ "id": "pp" })).0);
        let (_, v) = call(&mut s, "search_notes", json!({ "query": "serverraum" }));
        assert_eq!(v["results"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn anlegen() {
        let f = fixture("create", Some(r#"{"enabled":true,"read":true,"create":true}"#));
        let mut s = server(&f);
        let (err, v) = call(&mut s, "create_page", json!({ "parent_id": "sec", "title": "Neu", "body": "# Inhalt" }));
        assert!(!err, "{v}");
        let id = v["id"].as_str().unwrap().to_string();
        assert_eq!(id.len(), 36);
        let (_, v) = call(&mut s, "read_page", json!({ "id": id }));
        assert_eq!(v["body"], "# Inhalt");
        assert_eq!(v["path"], "Arbeit / Kunden / Neu");
        // Im gesperrten Privat und unter einer Liste nicht
        assert!(call(&mut s, "create_page", json!({ "parent_id": "nbp", "title": "x" })).0);
        assert!(call(&mut s, "create_page", json!({ "parent_id": "lst", "title": "x" })).0);
        assert!(call(&mut s, "create_page", json!({ "parent_id": "sec", "title": " " })).0);

        let (err, v) = call(&mut s, "create_item", json!({ "list_id": "lst", "title": "Punkt", "fields": { "Priorität": "niedrig", "due": "2026-12-24", "Tags": ["neu"] } }));
        assert!(!err, "{v}");
        assert_eq!(v["nr"], "LOP-007");
        let (_, v) = call(&mut s, "read_page", json!({ "id": v["id"] }));
        assert_eq!(v["fields"]["Status"], "Offen", "erster Status");
        assert_eq!(v["fields"]["Priorität"], "Niedrig");
        assert_eq!(v["fields"]["Fällig"], "2026-12-24");
        assert_eq!(v["fields"]["Tags"][0], "neu");
        let (_, v) = call(&mut s, "read_page", json!({ "id": "lst" }));
        assert_eq!(v["fields"][4]["options"][0], "neu", "neuer Tag steht in der Liste");
        let (_, v) = call(&mut s, "create_item", json!({ "list_id": "lst", "title": "Zweiter" }));
        assert_eq!(v["nr"], "LOP-008", "Zähler läuft weiter");

        let (err, text) = call(&mut s, "create_item", json!({ "list_id": "lst", "title": "x", "fields": { "Priorität": "Mega" } }));
        assert!(err);
        assert!(text.as_str().unwrap().contains("Hoch, Niedrig"));
        assert!(call(&mut s, "create_item", json!({ "list_id": "lst", "title": "x", "fields": { "Gibtsnicht": 1 } })).0);
        assert!(call(&mut s, "create_item", json!({ "list_id": "lst", "title": "x", "fields": { "Fällig": "morgen" } })).0);
        assert!(call(&mut s, "create_item", json!({ "list_id": "lst", "title": "x", "fields": { "Nr.": 99 } })).0);
    }

    #[test]
    fn bearbeiten() {
        let f = fixture("edit", Some(r#"{"enabled":true,"read":true,"edit":true}"#));
        let mut s = server(&f);
        let db = Connection::open(&f.path).unwrap();
        let body = |id: &str| db.query_row("SELECT body FROM nodes WHERE id = ?1", [id], |r| r.get::<_, String>(0)).unwrap();

        // Maskiertes darf das Original nicht überschreiben, Anhängen geht
        let (err, text) = call(&mut s, "update_page", json!({ "id": "p1", "body": "Passwort: ••••••" }));
        assert!(err);
        assert!(text.as_str().unwrap().contains("append"));
        assert!(body("p1").contains("geheim123"));
        let (err, v) = call(&mut s, "update_page", json!({ "id": "p1", "append": "Neue Zeile" }));
        assert!(!err, "{v}");
        assert!(body("p1").contains("geheim123") && body("p1").ends_with("\n\nNeue Zeile"));

        let (err, _) = call(&mut s, "update_page", json!({ "id": "p1", "title": "Anders", "body": "Ganz neu" }));
        assert!(!err);
        assert_eq!(body("p1"), "Ganz neu");
        let log: String = db.query_row("SELECT text FROM activity WHERE node_id = 'p1' ORDER BY id DESC", [], |r| r.get(0)).unwrap();
        assert_eq!(log, "Über MCP geändert: Text, Titel");

        assert!(call(&mut s, "update_page", json!({ "id": "p2", "append": "x" })).0, "gesperrt");
        assert!(call(&mut s, "update_page", json!({ "id": "p3", "append": "x" })).0, "Zeichnung");
        assert!(body("p3").contains("zeichnung"));
        assert!(call(&mut s, "update_page", json!({ "id": "p1" })).0, "nichts zu ändern");
        assert!(call(&mut s, "update_page", json!({ "id": "pp", "append": "x" })).0, "Privat");
        assert!(call(&mut s, "update_page", json!({ "id": "r1", "append": "x" })).0, "falsches Werkzeug");

        let (err, v) = call(&mut s, "update_item", json!({ "id": "r1", "fields": { "Status": "Erledigt", "Priorität": null } }));
        assert!(!err, "{v}");
        let (_, v) = call(&mut s, "read_page", json!({ "id": "r1" }));
        assert_eq!(v["fields"]["Status"], "Erledigt");
        assert!(v["fields"].get("Priorität").is_none());
        assert_eq!(v["fields"]["Nr."], "LOP-005", "Nummer bleibt");
        assert!(call(&mut s, "update_item", json!({ "id": "p1", "fields": { "Status": "Erledigt" } })).0);
    }

    #[test]
    fn geheimes_wird_maskiert() {
        assert_eq!(mask_secrets("Kennwort = Sommer2026! ok"), "Kennwort = •••••• ok");
        assert_eq!(mask_secrets(r#""password": "abc12345""#), r#""password": "••••••""#);
        assert_eq!(mask_secrets("Der Token ist weg"), "Der Token ist weg");
        assert_eq!(mask_secrets("x AKIAABCDEFGHIJKLMNOP y"), "x •••••• y");
        assert_eq!(mask_secrets("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----"), MASK);
    }

    #[test]
    fn datum_pruefen() {
        assert!(is_date("2026-12-24"));
        assert!(is_date("2026-12-24T14:30"));
        for bad in ["24.12.2026", "morgen", "2026-1-1", "2026-12-24 14:30", ""] {
            assert!(!is_date(bad), "{bad}");
        }
    }
}
