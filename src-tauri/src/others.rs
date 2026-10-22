//! Gemini CLI, OpenCode and Cline chats. Each keeps plain, readable files, so they are read directly:
//! - Gemini CLI: `~/.gemini/tmp/<project>/chats/session-*.json`
//! - OpenCode: the SQLite file `~/.local/share/opencode/opencode.db` (sessions, messages and parts)
//! - Cline: `~/.cline/data/sessions/<id>/<id>.messages.json` with a `<id>.json` summary beside it

use crate::paths::*;
use crate::providers::{clip, Msg};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub const TOOLS: [&str; 6] = ["gemini", "opencode", "cline", "grok", "hermes", "imported"];
/// For SQL `IN (...)` when the index rebuilds these tools together.
pub const SQL_IN: &str = "'gemini','opencode','cline','grok','hermes','imported'";

pub struct OtherChat {
    pub provider: &'static str,
    pub id: String,
    pub title: String,
    pub cwd: Option<String>,
    pub created_ms: Option<i64>,
    pub last_ms: i64,
    pub size: i64,
    pub path: String,
    pub model: Option<String>,
    /// Set for imported NousSave chats: the web platform (ChatGPT, Gemini, Grok, …).
    pub account: Option<String>,
}

fn ms_of(iso: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(iso).ok().map(|d| d.timestamp_millis())
}

fn mtime(p: &Path) -> i64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn open_ro(path: &Path) -> Option<Connection> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(p).ok()?).ok()
}

// ---------------- Gemini CLI ----------------

/// The folders Gemini CLI keeps its chats in.
pub fn gemini_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for p in [env_path("GEMINI_CLI_HOME").map(|p| p.join(".gemini/tmp")), home().map(|h| h.join(".gemini/tmp"))].into_iter().flatten() {
        if !roots.contains(&p) {
            roots.push(p);
        }
    }
    roots
}

fn gemini_files() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for tmp in gemini_roots() {
    let Ok(rd) = fs::read_dir(&tmp) else { continue };
    for proj in rd.flatten() {
        let chats = proj.path().join("chats");
        if let Ok(files) = fs::read_dir(&chats) {
            for f in files.flatten() {
                let p = f.path();
                if p.extension().map(|e| e == "json").unwrap_or(false) {
                    out.push(p);
                }
            }
        }
    }
    }
    out
}

/// The text of a Gemini user turn: the typed text when it is recorded, otherwise the first text part of the content.
fn gemini_user_text(m: &Value) -> String {
    let flat = |v: &Value| -> String {
        match v {
            Value::String(s) => s.clone(),
            Value::Array(a) => a.iter().filter_map(|p| p.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().join("\n"),
            _ => String::new(),
        }
    };
    let shown = m.get("displayContent").map(flat).unwrap_or_default();
    if !shown.trim().is_empty() {
        return shown;
    }
    m.get("content").map(flat).unwrap_or_default()
}

fn gemini_project(p: &Path) -> Option<String> {
    let root = p.parent()?.parent()?.join(".project_root");
    fs::read_to_string(root).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn gemini_messages(p: &Path) -> Vec<Msg> {
    let Some(j) = read_json(p) else { return Vec::new() };
    let mut out = Vec::new();
    for m in j.get("messages").and_then(|m| m.as_array()).cloned().unwrap_or_default() {
        let ts = m.get("timestamp").and_then(|t| t.as_str()).unwrap_or("").to_string();
        match m.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "user" => {
                let t = gemini_user_text(&m);
                if !t.trim().is_empty() {
                    out.push(Msg::new("user", &ts, t, "text"));
                }
            }
            "gemini" => {
                if let Some(thoughts) = m.get("thoughts").and_then(|t| t.as_array()) {
                    let text: Vec<String> = thoughts
                        .iter()
                        .map(|t| format!("{}: {}", t.get("subject").and_then(|x| x.as_str()).unwrap_or(""), t.get("description").and_then(|x| x.as_str()).unwrap_or("")))
                        .collect();
                    if !text.is_empty() {
                        out.push(Msg::new("assistant", &ts, clip(&text.join("\n"), 6000), "reasoning"));
                    }
                }
                let t = m.get("content").and_then(|c| c.as_str()).unwrap_or("");
                if !t.trim().is_empty() {
                    out.push(Msg::new("assistant", &ts, t.to_string(), "text"));
                }
                for call in m.get("toolCalls").and_then(|c| c.as_array()).cloned().unwrap_or_default() {
                    let name = call.get("name").and_then(|n| n.as_str()).unwrap_or("tool").to_string();
                    let id = call.get("id").and_then(|n| n.as_str()).map(String::from);
                    let mut tool = Msg::new("assistant", &ts, format!("{}:", name), "tool");
                    tool.name = Some(name);
                    tool.id = id.clone();
                    tool.data = call.get("args").cloned();
                    out.push(tool);
                    let result = call.get("resultDisplay").and_then(|r| r.as_str()).map(String::from).or_else(|| call.get("result").map(|r| clip(&r.to_string(), 4000)));
                    if let Some(r) = result.filter(|r| !r.trim().is_empty()) {
                        let mut res = Msg::new("assistant", &ts, clip(&r, 8000), "result");
                        res.id = id;
                        out.push(res);
                    }
                }
            }
            "error" => {
                let t = m.get("content").and_then(|c| c.as_str()).unwrap_or("");
                if !t.trim().is_empty() {
                    let mut e = Msg::new("assistant", &ts, t.to_string(), "text");
                    e.error = Some(true);
                    out.push(e);
                }
            }
            _ => {}
        }
    }
    out
}

fn scan_gemini(out: &mut Vec<OtherChat>) {
    for p in gemini_files() {
        let Some(j) = read_json(&p) else { continue };
        let msgs = gemini_messages(&p);
        let Some(first) = msgs.iter().find(|m| m.role == "user") else { continue };
        let first_line = first.text.lines().find(|l| !l.trim().is_empty()).unwrap_or("Chat").trim();
        let id = j.get("sessionId").and_then(|s| s.as_str()).map(String::from).unwrap_or_else(|| p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default());
        out.push(OtherChat {
            provider: "gemini",
            id,
            title: clip(first_line, 80),
            cwd: gemini_project(&p),
            created_ms: j.get("startTime").and_then(|s| s.as_str()).and_then(ms_of),
            last_ms: j.get("lastUpdated").and_then(|s| s.as_str()).and_then(ms_of).unwrap_or_else(|| mtime(&p)),
            size: fs::metadata(&p).map(|m| m.len() as i64).unwrap_or(0),
            path: format!("gemini:{}", p.to_string_lossy()),
            model: None,
            account: None,
        });
    }
}

// ---------------- OpenCode ----------------

fn opencode_db() -> Option<PathBuf> {
    opencode_dbs().into_iter().next()
}
/// Where OpenCode's database can be: the places it is looked for, whether or not a file is there.
pub fn opencode_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for p in [env_path("OPENCODE_DB"), env_path("XDG_DATA_HOME").map(|p| p.join("opencode/opencode.db")), home().map(|h| h.join(".local/share/opencode/opencode.db"))].into_iter().flatten() {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

pub fn opencode_found() -> Vec<PathBuf> {
    opencode_dbs()
}

fn opencode_dbs() -> Vec<PathBuf> {
    let mut out=Vec::new();
    for p in [env_path("OPENCODE_DB"),env_path("XDG_DATA_HOME").map(|p|p.join("opencode/opencode.db")),home().map(|h|h.join(".local/share/opencode/opencode.db"))].into_iter().flatten() {
        if p.is_file() && !out.contains(&p) {out.push(p);}
    }
    out
}

fn scan_opencode(out: &mut Vec<OtherChat>) {
    for db in opencode_dbs() { scan_opencode_db(&db,out); }
}
fn scan_opencode_db(db:&Path,out:&mut Vec<OtherChat>) {
    let Some(c) = open_ro(&db) else { return };
    let Ok(mut st) = c.prepare("SELECT s.id, s.title, s.directory, s.time_created, s.time_updated, (SELECT COUNT(*) FROM message m WHERE m.session_id=s.id) FROM session s") else { return };
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, i64>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?)));
    let Ok(rows) = rows else { return };
    for (id, title, dir, created, updated, n) in rows.flatten() {
        if n == 0 {
            continue;
        }
        out.push(OtherChat {
            provider: "opencode",
            id: id.clone(),
            title: clip(title.trim(), 80),
            cwd: dir.filter(|d| d != "/" && !d.is_empty()),
            created_ms: Some(created),
            last_ms: updated.max(created),
            size: n * 2000,
            path: format!("opencode:{}|{}", db.display(), id),
            model: None,
            account: None,
        });
    }
}

fn opencode_messages(key: &str) -> Vec<Msg> {
    let (db,id)=if let Some((path,id))=key.rsplit_once('|') {
        let db=PathBuf::from(path);
        if !opencode_dbs().contains(&db) {return Vec::new();}
        (db,id)
    } else { let Some(db)=opencode_db() else{return Vec::new()};(db,key) };
    let Some(c) = open_ro(&db) else { return Vec::new() };
    let Ok(mut st) = c.prepare("SELECT m.id, m.time_created, m.data FROM message m WHERE m.session_id=?1 ORDER BY m.time_created") else { return Vec::new() };
    let msgs: Vec<(String, i64, String)> = st.query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map(|r| r.flatten().collect()).unwrap_or_default();
    let mut out = Vec::new();
    for (mid, created, data) in msgs {
        let role = serde_json::from_str::<Value>(&data).ok().and_then(|v| v.get("role").and_then(|r| r.as_str()).map(String::from)).unwrap_or_else(|| "assistant".into());
        let role = if role == "user" { "user" } else { "assistant" };
        let ts = chrono::DateTime::from_timestamp_millis(created).map(|d| d.to_rfc3339()).unwrap_or_default();
        let Ok(mut ps) = c.prepare("SELECT data FROM part WHERE message_id=?1 ORDER BY time_created") else { continue };
        let parts: Vec<String> = ps.query_map([&mid], |r| r.get(0)).map(|r| r.flatten().collect()).unwrap_or_default();
        for pd in parts {
            let Ok(p) = serde_json::from_str::<Value>(&pd) else { continue };
            match p.get("type").and_then(|t| t.as_str()).unwrap_or("") {
                "text" => {
                    if p.get("synthetic").and_then(|s| s.as_bool()) == Some(true) {
                        continue;
                    }
                    let t = p.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    if !t.trim().is_empty() {
                        out.push(Msg::new(role, &ts, t.to_string(), "text"));
                    }
                }
                "reasoning" => {
                    let t = p.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    if !t.trim().is_empty() {
                        out.push(Msg::new("assistant", &ts, clip(t, 6000), "reasoning"));
                    }
                }
                "tool" => {
                    let name = p.get("tool").and_then(|t| t.as_str()).unwrap_or("tool").to_string();
                    let cid = p.get("callID").and_then(|t| t.as_str()).map(String::from);
                    let mut tool = Msg::new("assistant", &ts, format!("{}:", name), "tool");
                    tool.name = Some(name);
                    tool.id = cid.clone();
                    tool.data = p.get("state").and_then(|s| s.get("input")).cloned();
                    out.push(tool);
                    if let Some(o) = p.get("state").and_then(|s| s.get("output")).and_then(|o| o.as_str()).filter(|o| !o.trim().is_empty()) {
                        let mut res = Msg::new("assistant", &ts, clip(o, 8000), "result");
                        res.id = cid;
                        out.push(res);
                    }
                }
                _ => {}
            }
        }
    }
    out
}

// ---------------- Cline ----------------

/// The folders Cline keeps its tasks in: its own command line, and the extension inside each editor.
/// The Google account Gemini CLI is signed in with (its list of accounts holds emails only, no tokens).
pub fn gemini_account() -> Option<String> {
    let f = home()?.join(".gemini/google_accounts.json");
    let v: Value = serde_json::from_str(&fs::read_to_string(f).ok()?).ok()?;
    v.get("active")?.as_str().filter(|e| e.contains('@')).map(String::from)
}

pub fn cline_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(h) = home() {
        roots.push(h.join(".cline/data/sessions"));
    }
    if let Some(app) = env_path("APPDATA").or_else(config_home) {
        for editor in ["Code", "Code - Insiders", "Cursor", "Windsurf", "VSCodium"] {
            let user = app.join(editor).join("User");
            roots.push(user.join("globalStorage/saoudrizwan.claude-dev/tasks"));
            for profile in subdirs(&user.join("profiles")) {
                roots.push(profile.join("globalStorage/saoudrizwan.claude-dev/tasks"));
            }
        }
    }
    roots
}

pub fn gemini_chat_files() -> Vec<PathBuf> {
    gemini_files()
}

pub fn cline_chat_files() -> Vec<PathBuf> {
    cline_sessions()
}

/// How many chats an OpenCode database holds.
pub fn opencode_chat_count(db: &Path) -> Option<usize> {
    let c = open_ro(db)?;
    c.query_row("SELECT COUNT(*) FROM session", [], |r| r.get::<_, i64>(0)).ok().map(|n| n as usize)
}

fn cline_sessions() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let roots = cline_roots();
    for root in roots {
    let Ok(rd) = fs::read_dir(&root) else { continue };
    for d in rd.flatten() {
        if let Ok(files) = fs::read_dir(d.path()) {
            for f in files.flatten() {
                let p = f.path();
                if p.file_name().map(|n| n.to_string_lossy().ends_with(".messages.json") || n=="api_conversation_history.json").unwrap_or(false) {
                    out.push(p);
                }
            }
        }
    }
    }
    out
}

/// Cline stores each message's content as a list of blocks (text, thinking, tool calls and tool results).
fn blocks(v: &Value) -> Vec<Value> {
    match v {
        Value::Array(a) => a.clone(),
        Value::String(s) => serde_json::from_str::<Value>(s).ok().and_then(|x| x.as_array().cloned()).unwrap_or_else(|| vec![serde_json::json!({"type":"text","text":s})]),
        _ => Vec::new(),
    }
}

fn clean_cline_text(t: &str) -> String {
    let t = t.trim();
    // user turns are wrapped like <user_input mode="act">…</user_input>
    if let Some(a) = t.find("<user_input") {
        if let Some(open_end) = t[a..].find('>') {
            let inner = &t[a + open_end + 1..];
            return inner.split("</user_input>").next().unwrap_or(inner).trim().to_string();
        }
    }
    t.to_string()
}

fn cline_messages(p: &Path) -> Vec<Msg> {
    let Some(j) = read_json(p) else { return Vec::new() };
    let mut out = Vec::new();
    for m in j.as_array().or_else(||j.get("messages").and_then(|m|m.as_array())).cloned().unwrap_or_default() {
        let role = if m.get("role").and_then(|r| r.as_str()) == Some("user") { "user" } else { "assistant" };
        let ts = m.get("ts").and_then(|t| t.as_str().map(String::from).or_else(|| t.as_i64().map(|n| n.to_string()))).and_then(|s| s.parse::<i64>().ok()).and_then(chrono::DateTime::from_timestamp_millis).map(|d| d.to_rfc3339()).unwrap_or_default();
        for b in blocks(m.get("content").unwrap_or(&Value::Null)) {
            match b.get("type").and_then(|t| t.as_str()).unwrap_or("") {
                "text" => {
                    let t = clean_cline_text(b.get("text").and_then(|t| t.as_str()).unwrap_or(""));
                    if !t.is_empty() {
                        out.push(Msg::new(role, &ts, t, "text"));
                    }
                }
                "thinking" => {
                    let t = b.get("thinking").and_then(|t| t.as_str()).unwrap_or("");
                    if !t.trim().is_empty() {
                        out.push(Msg::new("assistant", &ts, clip(t, 6000), "reasoning"));
                    }
                }
                "tool_use" => {
                    let name = b.get("name").and_then(|n| n.as_str()).unwrap_or("tool").to_string();
                    let mut tool = Msg::new("assistant", &ts, format!("{}:", name), "tool");
                    tool.name = Some(name);
                    tool.id = b.get("id").and_then(|n| n.as_str()).map(String::from);
                    tool.data = b.get("input").cloned();
                    out.push(tool);
                }
                "tool_result" => {
                    let raw = b.get("content").cloned().unwrap_or(Value::Null);
                    let text = match &raw {
                        Value::String(s) => s.clone(),
                        Value::Array(a) => a.iter().filter_map(|x| x.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().join("\n"),
                        other => other.to_string(),
                    };
                    if !text.trim().is_empty() {
                        let mut res = Msg::new("assistant", &ts, clip(&text, 8000), "result");
                        res.id = b.get("tool_use_id").and_then(|n| n.as_str()).map(String::from);
                        out.push(res);
                    }
                }
                _ => {}
            }
        }
    }
    out
}

fn scan_cline(out: &mut Vec<OtherChat>) {
    for p in cline_sessions() {
        let msgs = cline_messages(&p);
        let Some(first) = msgs.iter().find(|m| m.role == "user") else { continue };
        let meta = if p.file_name().is_some_and(|n|n=="api_conversation_history.json") {p.with_file_name("task_metadata.json")} else {p.with_file_name(p.file_name().map(|n| n.to_string_lossy().replace(".messages.json", ".json")).unwrap_or_default())};
        let mj = read_json(&meta);
        let started = mj.as_ref().and_then(|m| m.get("started_at")).and_then(|s| s.as_str()).and_then(ms_of);
        let ended = mj.as_ref().and_then(|m| m.get("ended_at")).and_then(|s| s.as_str()).and_then(ms_of);
        let id = p.parent().and_then(|d| d.file_name()).map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        out.push(OtherChat {
            provider: "cline",
            id,
            title: clip(first.text.lines().find(|l| !l.trim().is_empty()).unwrap_or("Chat").trim(), 80),
            cwd: mj.as_ref().and_then(|m| m.get("cwd")).and_then(|s| s.as_str()).map(String::from),
            created_ms: started,
            last_ms: ended.or(started).unwrap_or_else(|| mtime(&p)),
            size: fs::metadata(&p).map(|m| m.len() as i64).unwrap_or(0),
            path: format!("cline:{}", p.to_string_lossy()),
            model: mj.as_ref().and_then(|m| m.get("model")).and_then(|s| s.as_str()).map(String::from),
            account: None,
        });
    }
}

// ---------------- shared ----------------

pub fn scan() -> Vec<OtherChat> {
    let mut out = Vec::new();
    scan_gemini(&mut out);
    scan_opencode(&mut out);
    scan_cline(&mut out);
    crate::grok::scan(&mut out);
    crate::hermes::scan(&mut out);
    crate::imported::scan(&mut out);
    out
}

/// Changes whenever any of these tools writes a chat, so the index can skip a rescan when nothing changed.
pub fn fingerprint() -> i64 {
    let mut m = 0;
    for p in gemini_files() {
        m = m.max(mtime(&p));
    }
    for p in cline_sessions() {
        m = m.max(mtime(&p));
    }
    for db in opencode_dbs() {
        m = m.max(mtime(&db));
        let mut wal = db.into_os_string();
        wal.push("-wal");
        m = m.max(mtime(Path::new(&wal)));
    }
    m.max(crate::grok::fingerprint()).max(crate::hermes::fingerprint()).max(crate::imported::fingerprint())
}

pub fn read(path: &str) -> Result<Vec<Msg>, String> {
    if let Some(p) = path.strip_prefix("gemini:") {
        return Ok(gemini_messages(Path::new(p)));
    }
    if let Some(id) = path.strip_prefix("opencode:") {
        return Ok(opencode_messages(id));
    }
    if let Some(p) = path.strip_prefix("cline:") {
        return Ok(cline_messages(Path::new(p)));
    }
    if let Some(p) = path.strip_prefix("grok:") {
        return Ok(crate::grok::messages(Path::new(p)));
    }
    if path.starts_with("hermes-db:") {
        return crate::hermes::read(path);
    }
    if let Some(p) = path.strip_prefix("imported:") {
        return Ok(crate::imported::messages(Path::new(p)));
    }
    Err("Unknown chat".into())
}

pub fn is_virtual(path: &str) -> bool {
    path.starts_with("hermes-db:") || TOOLS.iter().any(|t| path.starts_with(&format!("{t}:")))
}

/// What deleting a Gemini or Cline chat removes: only a file or folder that the scan itself lists, so a path
/// from outside can never point this at anything else. A Cline task is a folder, so the whole folder goes.
pub fn deletable(path: &str) -> Option<PathBuf> {
    let same = |a: &Path, b: &Path| matches!((a.canonicalize(), b.canonicalize()), (Ok(x), Ok(y)) if x == y);
    if let Some(p) = path.strip_prefix("gemini:") {
        let p = PathBuf::from(p);
        return gemini_files().into_iter().find(|f| same(f, &p)).map(|_| p);
    }
    if let Some(p) = path.strip_prefix("cline:") {
        let p = PathBuf::from(p);
        let listed = cline_sessions().into_iter().find(|f| same(f, &p))?;
        let task = listed.parent().filter(|d| listed.file_name().is_some_and(|n| n == "api_conversation_history.json") && d.parent().and_then(|t| t.file_name()).is_some_and(|n| n == "tasks"));
        return Some(task.map(Path::to_path_buf).unwrap_or(listed));
    }
    if path.starts_with("grok:") {
        return crate::grok::deletable(path);
    }
    if path.starts_with("imported:") {
        return crate::imported::deletable(path);
    }
    None
}

/// The real file behind a virtual path, for "show file".
pub fn real_file(path: &str) -> Option<PathBuf> {
    if let Some(p) = path.strip_prefix("gemini:").or_else(|| path.strip_prefix("cline:")) {
        let p = PathBuf::from(p);
        return p.exists().then_some(p);
    }
    if path.starts_with("opencode:") {
        if let Some((db,_))=path.strip_prefix("opencode:")?.rsplit_once('|') {
            return opencode_dbs().into_iter().find(|p|p==Path::new(db));
        }
        return opencode_db();
    }
    if path.starts_with("grok:") {
        return crate::grok::real_file(path);
    }
    if path.starts_with("hermes-db:") {
        return crate::hermes::real_file(path);
    }
    if path.starts_with("imported:") {
        return crate::imported::real_file(path);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extension_and_cli_cline_transcripts_both_parse() {
        let sample=serde_json::json!([{"role":"user","content":[{"type":"text","text":"fixture question"}]},{"role":"assistant","content":[{"type":"text","text":"fixture answer"}]}]);
        for value in [sample.clone(),serde_json::json!({"messages":sample})] {
            let path=crate::cli::script_file("").unwrap().with_extension("json");
            fs::write(&path,value.to_string()).unwrap();
            let messages=cline_messages(&path);
            assert_eq!(messages.len(),2);assert_eq!(messages[0].role,"user");assert_eq!(messages[1].text,"fixture answer");
        }
    }
    #[test]
    fn database_paths_with_unicode_spaces_hash_and_percent_are_read_only() {
        let dir=crate::cli::script_file("").unwrap().with_extension("fixture");fs::create_dir_all(&dir).unwrap();
        let db=dir.join("other user's 非ASCII #100%.db");
        {let c=Connection::open(&db).unwrap();c.execute_batch("CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES('readable')").unwrap();}
        let c=open_ro(&db).unwrap();
        assert_eq!(c.query_row("SELECT value FROM fixture",[],|r|r.get::<_,String>(0)).unwrap(),"readable");
        assert!(c.execute("INSERT INTO fixture VALUES('no write')",[]).is_err());
    }
    #[test]
    fn only_chats_the_scan_lists_can_be_deleted() {
        let root = crate::cli::script_file("").unwrap().with_extension("geminihome");
        let chats = root.join(".gemini/tmp/project/chats");
        fs::create_dir_all(&chats).unwrap();
        let listed = chats.join("session-1.json");
        fs::write(&listed, r#"{"sessionId":"s1","messages":[{"type":"user","content":"hello"}]}"#).unwrap();
        let stranger = root.join("not-a-chat.json");
        fs::write(&stranger, "{}").unwrap();
        // SAFETY: only this test reads GEMINI_CLI_HOME, and it sets and clears it within the test.
        unsafe { std::env::set_var("GEMINI_CLI_HOME", &root) };
        let found = deletable(&format!("gemini:{}", listed.display()));
        assert_eq!(found.map(|p| p.canonicalize().unwrap()), Some(listed.canonicalize().unwrap()));
        assert!(deletable(&format!("gemini:{}", stranger.display())).is_none(), "a file the scan does not list must be refused");
        assert!(deletable(&format!("gemini:{}", chats.join("..").join("..").join("..").join("not-a-chat.json").display())).is_none());
        assert!(deletable("opencode:whatever|id").is_none());
        unsafe { std::env::remove_var("GEMINI_CLI_HOME") };
        let _ = fs::remove_dir_all(&root);
    }
    #[test]
    #[ignore="read-only inspection of local provider stores"]
    fn real_provider_stores() {
        let chats=scan();
        for tool in TOOLS {
            let selected:Vec<_>=chats.iter().filter(|c|c.provider==tool).collect();
            println!("{tool}: {} readable chats",selected.len());
            for chat in selected {assert!(!read(&chat.path).unwrap().is_empty());}
        }
    }
}
