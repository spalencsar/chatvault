//! Read-only support for Hermes Agent's canonical `state.db` session store.

use crate::others::OtherChat;
use crate::paths::{env_path, home};
use crate::providers::{Msg, clip};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const JSON_PREFIX: &str = "\0json:";

#[derive(Clone)]
struct Session {
    id: String,
    source: String,
    title: String,
    cwd: Option<String>,
    model: Option<String>,
    parent: Option<String>,
    model_config: Option<String>,
    started: f64,
    ended: Option<f64>,
    last: Option<f64>,
    end_reason: Option<String>,
    hidden: bool,
}

pub fn database_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for p in [
        env_path("HERMES_HOME").map(|p| p.join("state.db")),
        home().map(|p| p.join(".hermes/state.db")),
    ]
    .into_iter()
    .flatten()
    {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

pub fn database_files() -> Vec<PathBuf> {
    database_candidates()
        .into_iter()
        .filter(|p| p.is_file())
        .collect()
}

fn open_ro(path: &Path) -> Option<Connection> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
}

fn mtime(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn fingerprint() -> i64 {
    database_files().into_iter().fold(0, |latest, db| {
        let mut wal = db.clone().into_os_string();
        wal.push("-wal");
        latest.max(mtime(&db)).max(mtime(Path::new(&wal)))
    })
}

fn load_sessions(c: &Connection) -> Vec<Session> {
    let Ok(mut st) = c.prepare(
        "SELECT id, source, COALESCE(NULLIF(title,''),NULLIF(display_name,''),''), cwd, model, \
         parent_session_id, model_config, started_at, ended_at, last_activity_at, end_reason, COALESCE(hidden,0) \
         FROM sessions",
    ) else {
        return Vec::new();
    };
    st.query_map([], |r| {
        Ok(Session {
            id: r.get(0)?,
            source: r.get(1)?,
            title: r.get(2)?,
            cwd: r.get(3)?,
            model: r.get(4)?,
            parent: r.get(5)?,
            model_config: r.get(6)?,
            started: r.get(7)?,
            ended: r.get(8)?,
            last: r.get(9)?,
            end_reason: r.get(10)?,
            hidden: r.get::<_, i64>(11)? != 0,
        })
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

fn marker_names_parent(config: Option<&str>, parent: &str) -> bool {
    let Some(Value::Object(v)) = config.and_then(|s| serde_json::from_str::<Value>(s).ok()) else {
        return false;
    };
    ["_branched_from", "_delegate_from", "_reset_from"]
        .iter()
        .any(|key| v.get(*key).and_then(Value::as_str) == Some(parent))
}

fn is_compression_child(child: &Session, sessions: &HashMap<String, Session>) -> bool {
    let Some(parent_id) = child.parent.as_deref() else {
        return false;
    };
    child.source != "tool"
        && !marker_names_parent(child.model_config.as_deref(), parent_id)
        && sessions
            .get(parent_id)
            .and_then(|p| p.end_reason.as_deref())
            == Some("compression")
}

fn lineage_ids(id: &str, sessions: &HashMap<String, Session>) -> Vec<String> {
    let mut chain = Vec::new();
    let mut current = id;
    let mut seen = HashSet::new();
    for _ in 0..100 {
        if !seen.insert(current.to_string()) {
            break;
        }
        chain.push(current.to_string());
        let Some(session) = sessions.get(current) else {
            break;
        };
        if !is_compression_child(session, sessions) {
            break;
        }
        let Some(parent) = session.parent.as_deref() else {
            break;
        };
        current = parent;
    }
    chain.reverse();
    chain
}

fn seconds_to_ms(value: f64) -> i64 {
    (value * 1000.0).round() as i64
}

fn session_count(c: &Connection, ids: &[String]) -> i64 {
    ids.iter()
        .map(|id| c.query_row("SELECT COUNT(*) FROM messages WHERE session_id=?1 AND (active=1 OR compacted=1) AND COALESCE(display_kind,'')!='hidden'", [id], |r| r.get::<_, i64>(0)).unwrap_or(0))
        .sum()
}

fn scan_db(db: &Path, out: &mut Vec<OtherChat>) {
    let Some(c) = open_ro(db) else { return };
    let sessions: HashMap<String, Session> = load_sessions(&c)
        .into_iter()
        .map(|s| (s.id.clone(), s))
        .collect();
    let continued: HashSet<String> = sessions
        .values()
        .filter(|s| is_compression_child(s, &sessions))
        .filter_map(|s| s.parent.clone())
        .collect();
    let bytes = fs::metadata(db).map(|m| m.len() as i64).unwrap_or(0);

    for s in sessions.values() {
        if s.hidden || s.source == "tool" || continued.contains(&s.id) {
            continue;
        }
        let ids = lineage_ids(&s.id, &sessions);
        let count = session_count(&c, &ids);
        if count == 0 {
            continue;
        }
        let title = if s.title.trim().is_empty() {
            first_user_text(&c, &ids).unwrap_or_else(|| "Hermes chat".into())
        } else {
            s.title.clone()
        };
        out.push(OtherChat {
            provider: "hermes",
            id: s.id.clone(),
            title: clip(title.trim(), 80),
            cwd: s.cwd.clone(),
            created_ms: Some(seconds_to_ms(s.started)),
            last_ms: seconds_to_ms(s.last.or(s.ended).unwrap_or(s.started)),
            size: if sessions.len() == 1 {
                bytes
            } else {
                (bytes / sessions.len() as i64).max(count * 256)
            },
            path: format!("hermes-db:{}|{}", db.display(), s.id),
            model: s.model.clone(),
            account: Some(if s.source.trim().is_empty() {
                "local".into()
            } else {
                s.source.clone()
            }),
        });
    }
}

pub fn scan(out: &mut Vec<OtherChat>) {
    for db in database_files() {
        scan_db(&db, out);
    }
}

pub fn chat_count(db: &Path) -> Option<usize> {
    let mut out = Vec::new();
    scan_db(db, &mut out);
    Some(out.len())
}

fn parse_path(path: &str) -> Result<(PathBuf, String), String> {
    let value = path.strip_prefix("hermes-db:").ok_or("Not a Hermes chat")?;
    let (raw_db, id) = value.rsplit_once('|').ok_or("Invalid Hermes chat path")?;
    if id.is_empty() {
        return Err("Invalid Hermes session id".into());
    }
    let requested = PathBuf::from(raw_db);
    let found = database_files()
        .into_iter()
        .find(
            |db| matches!((db.canonicalize(), requested.canonicalize()), (Ok(a), Ok(b)) if a == b),
        )
        .ok_or("Hermes database is not an allowed source")?;
    Ok((found, id.to_string()))
}

fn decode_content(raw: &str) -> Value {
    raw.strip_prefix(JSON_PREFIX)
        .and_then(|json| serde_json::from_str(json).ok())
        .unwrap_or_else(|| Value::String(raw.to_string()))
}

fn text_content(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                if let Some(s) = part.as_str() {
                    return Some(s.to_string());
                }
                let kind = part.get("type").and_then(Value::as_str).unwrap_or("");
                if matches!(kind, "text" | "input_text" | "output_text") {
                    return part.get("text").and_then(Value::as_str).map(String::from);
                }
                if kind == "image_url" || kind == "image" {
                    return Some("[Image]".into());
                }
                part.get("content")
                    .map(text_content)
                    .filter(|s| !s.is_empty())
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => map
            .get("text")
            .or_else(|| map.get("content"))
            .map(text_content)
            .unwrap_or_default(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn first_user_text(c: &Connection, ids: &[String]) -> Option<String> {
    for id in ids {
        let raw: Option<String> = c.query_row(
            "SELECT content FROM messages WHERE session_id=?1 AND role='user' AND (active=1 OR compacted=1) AND COALESCE(display_kind,'')!='hidden' ORDER BY id LIMIT 1",
            [id], |r| r.get(0),
        ).optional().ok().flatten();
        if let Some(text) = raw
            .map(|s| text_content(&decode_content(&s)))
            .filter(|s| !s.trim().is_empty())
        {
            return Some(
                text.lines()
                    .find(|l| !l.trim().is_empty())
                    .unwrap_or("Hermes chat")
                    .trim()
                    .to_string(),
            );
        }
    }
    None
}

fn timestamp(value: f64) -> String {
    chrono::DateTime::from_timestamp_millis(seconds_to_ms(value))
        .map(|d| d.to_rfc3339())
        .unwrap_or_default()
}

fn push_tool_calls(out: &mut Vec<Msg>, ts: &str, raw: Option<String>) {
    let Some(Value::Array(calls)) = raw.and_then(|s| serde_json::from_str::<Value>(&s).ok()) else {
        return;
    };
    for call in calls {
        let function = call.get("function").unwrap_or(&call);
        let name = function
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("tool")
            .to_string();
        let id = call.get("id").and_then(Value::as_str).map(String::from);
        let args = function.get("arguments").cloned().and_then(|v| match v {
            Value::String(s) => serde_json::from_str(&s).ok().or(Some(Value::String(s))),
            other => Some(other),
        });
        let mut msg = Msg::new("assistant", ts, format!("{name}:"), "tool");
        msg.name = Some(name);
        msg.id = id;
        msg.data = args;
        out.push(msg);
    }
}

fn read_db(db: &Path, id: &str) -> Result<Vec<Msg>, String> {
    let c = open_ro(db).ok_or("Could not open Hermes database")?;
    let sessions: HashMap<String, Session> = load_sessions(&c)
        .into_iter()
        .map(|s| (s.id.clone(), s))
        .collect();
    if !sessions.contains_key(id) {
        return Err("Hermes session no longer exists".into());
    }
    let mut out = Vec::new();
    let mut seen_users = HashSet::new();
    for sid in lineage_ids(id, &sessions) {
        let mut st = c.prepare(
            "SELECT role, content, tool_call_id, tool_calls, tool_name, timestamp, reasoning, reasoning_content \
             FROM messages WHERE session_id=?1 AND (active=1 OR compacted=1) AND COALESCE(display_kind,'')!='hidden' ORDER BY id",
        ).map_err(|e| e.to_string())?;
        let rows = st
            .query_map([sid], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, f64>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, Option<String>>(7)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            let (role, content, call_id, calls, tool_name, at, reasoning, reasoning_content) = row;
            let ts = timestamp(at);
            if role == "assistant" {
                if let Some(reason) = reasoning_content
                    .or(reasoning)
                    .filter(|s| !s.trim().is_empty())
                {
                    out.push(Msg::new("assistant", &ts, clip(&reason, 6000), "reasoning"));
                }
                if let Some(text) = content
                    .map(|s| text_content(&decode_content(&s)))
                    .filter(|s| !s.trim().is_empty())
                {
                    out.push(Msg::new("assistant", &ts, text, "text"));
                }
                push_tool_calls(&mut out, &ts, calls);
            } else if role == "user" {
                if let Some(text) = content
                    .map(|s| text_content(&decode_content(&s)))
                    .filter(|s| !s.trim().is_empty())
                {
                    let key = format!("{at:?}\0{text}");
                    if seen_users.insert(key) {
                        out.push(Msg::new("user", &ts, text, "text"));
                    }
                }
            } else if role == "tool" {
                if let Some(text) = content
                    .map(|s| text_content(&decode_content(&s)))
                    .filter(|s| !s.trim().is_empty())
                {
                    let mut result = Msg::new("assistant", &ts, clip(&text, 8000), "result");
                    result.id = call_id;
                    result.name = tool_name;
                    out.push(result);
                }
            }
        }
    }
    Ok(out)
}

pub fn read(path: &str) -> Result<Vec<Msg>, String> {
    let (db, id) = parse_path(path)?;
    read_db(&db, &id)
}

pub fn real_file(path: &str) -> Option<PathBuf> {
    parse_path(path).ok().map(|(db, _)| db)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        let db = crate::cli::script_file("")
            .unwrap()
            .with_extension("hermes.db");
        let c = Connection::open(&db).unwrap();
        c.execute_batch("CREATE TABLE sessions(id TEXT PRIMARY KEY,source TEXT NOT NULL,display_name TEXT,title TEXT,cwd TEXT,model TEXT,parent_session_id TEXT,model_config TEXT,started_at REAL,ended_at REAL,last_activity_at REAL,end_reason TEXT,hidden INTEGER DEFAULT 0); CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,tool_call_id TEXT,tool_calls TEXT,tool_name TEXT,timestamp REAL,reasoning TEXT,reasoning_content TEXT,active INTEGER DEFAULT 1,compacted INTEGER DEFAULT 0,display_kind TEXT);").unwrap();
        c.execute("INSERT INTO sessions VALUES('parent','cli',NULL,'A useful chat','/tmp/project','model-a',NULL,NULL,1000,1010,1010,'compression',0)", []).unwrap();
        c.execute("INSERT INTO sessions VALUES('tip','cli',NULL,'A useful chat','/tmp/project','model-a','parent','{}',1010,NULL,1020,NULL,0)", []).unwrap();
        c.execute("INSERT INTO messages(id,session_id,role,content,timestamp,active,compacted) VALUES(1,'parent','user','hello',1000,0,1)", []).unwrap();
        c.execute("INSERT INTO messages(id,session_id,role,content,timestamp,active,compacted) VALUES(2,'tip','assistant','world',1020,1,0)", []).unwrap();
        db
    }

    #[test]
    fn compression_lineage_is_one_complete_read_only_chat() {
        let db = fixture();
        let mut chats = Vec::new();
        scan_db(&db, &mut chats);
        assert_eq!(chats.len(), 1);
        assert_eq!(chats[0].id, "tip");
        let msgs = read_db(&db, "tip").unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].text, "hello");
        assert_eq!(msgs[1].text, "world");
        let ro = open_ro(&db).unwrap();
        assert!(ro.execute("DELETE FROM messages", []).is_err());
        let _ = fs::remove_file(db);
    }
}
