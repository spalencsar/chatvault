//! Read-only access to Google Antigravity's local conversation search index.
//!
//! Antigravity keeps conversation metadata and an FTS5 text index in
//! `~/.gemini/antigravity/conversation_summaries.db`. The message bodies in that index are plain
//! UTF-8; JSON byte-offset arrays map every body slice back to its original trajectory step. This
//! lets ChatVault preserve user/assistant order without decoding Antigravity's protobuf payloads.

use crate::others::OtherChat;
use crate::paths::*;
use crate::providers::{Msg, clip};
use rusqlite::{Connection, OpenFlags};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const PREFIX: &str = "antigravity-db:";

fn mtime(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn wal(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push("-wal");
    PathBuf::from(name)
}

fn open_ro(path: &Path) -> Option<Connection> {
    // A WAL-mode database with no current sidecars may still make SQLite create `-shm` beside it.
    // Sandboxed/read-only locations forbid that; immutable mode is safe once no WAL exists.
    if !wal(path).exists() {
        let escaped = path
            .to_string_lossy()
            .replace('%', "%25")
            .replace(' ', "%20")
            .replace('#', "%23")
            .replace('?', "%3F");
        if let Ok(c) = Connection::open_with_flags(
            format!("file:{escaped}?immutable=1"),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
        ) {
            return Some(c);
        }
    }
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()
}

/// Every known place where Antigravity may keep its summary/search database.
pub fn database_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(p) = env_path("ANTIGRAVITY_HOME") {
        out.push(p.join("conversation_summaries.db"));
    }
    if let Some(h) = home() {
        for folder in ["antigravity", "antigravity-ide", "antigravity-cli"] {
            let p = h
                .join(".gemini")
                .join(folder)
                .join("conversation_summaries.db");
            if !out.contains(&p) {
                out.push(p);
            }
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

pub fn chat_count(path: &Path) -> Option<usize> {
    let c = open_ro(path)?;
    c.query_row(
        "SELECT COUNT(*) FROM conversation_summaries WHERE step_count > 0",
        [],
        |r| r.get::<_, i64>(0),
    )
    .ok()
    .map(|n| n as usize)
}

fn timestamp_ms(value: &str) -> Option<i64> {
    let rfc = if value.contains('T') {
        value.to_string()
    } else {
        value.replacen(' ', "T", 1)
    };
    chrono::DateTime::parse_from_rfc3339(&rfc)
        .ok()
        .map(|d| d.timestamp_millis())
}

fn decode_uri_path(uri: &str) -> Option<String> {
    let raw = uri.strip_prefix("file://")?;
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            if let Ok(v) = u8::from_str_radix(hex, 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).ok().filter(|s| !s.is_empty())
}

fn workspace(value: &str) -> Option<String> {
    serde_json::from_str::<Vec<String>>(value)
        .ok()?
        .first()
        .and_then(|s| decode_uri_path(s))
}

fn first_user_text(c: &Connection, id: &str) -> Option<String> {
    c.query_row(
        "SELECT user_body FROM conversations_fts WHERE conversation_id=?1 AND chunk_index>=0 AND length(trim(user_body))>0 ORDER BY chunk_index LIMIT 1",
        [id],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .and_then(|s| s.lines().find(|line| !line.trim().is_empty()).map(|line| clip(line.trim(), 80)))
}

pub fn scan(out: &mut Vec<OtherChat>) {
    let mut seen = HashSet::new();
    for db in database_files() {
        let Some(c) = open_ro(&db) else {
            #[cfg(test)]
            eprintln!("Antigravity database could not be opened: {}", db.display());
            continue;
        };
        let prepared = c.prepare(
            "SELECT conversation_id,title,preview,step_count,last_modified_time,last_user_input_time,workspace_uris,
                    COALESCE((SELECT SUM(length(user_body)+length(agent_body)) FROM conversations_fts f
                              WHERE f.conversation_id=conversation_summaries.conversation_id AND f.chunk_index>=0),0)
             FROM conversation_summaries WHERE step_count>0 ORDER BY last_modified_time DESC",
        );
        let Ok(mut st) = prepared else {
            #[cfg(test)]
            eprintln!(
                "Antigravity summary query could not be prepared: {:?}",
                prepared.err()
            );
            continue;
        };
        let queried = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, i64>(7)?,
            ))
        });
        let Ok(rows) = queried else {
            #[cfg(test)]
            eprintln!(
                "Antigravity summaries could not be queried: {:?}",
                queried.err()
            );
            continue;
        };
        for row in rows {
            let Ok(row) = row else {
                #[cfg(test)]
                eprintln!("Antigravity summary row could not be read: {:?}", row.err());
                continue;
            };
            let (id, title, preview, _steps, modified, last_user, workspaces, size) = row;
            if !seen.insert(id.clone()) {
                continue;
            }
            let fallback = first_user_text(&c, &id).unwrap_or_else(|| "Antigravity chat".into());
            let title = [title.trim(), preview.trim()]
                .into_iter()
                .find(|s| !s.is_empty())
                .map(|s| clip(s, 80))
                .unwrap_or(fallback);
            let last_ms = [timestamp_ms(&modified), timestamp_ms(&last_user)]
                .into_iter()
                .flatten()
                .filter(|value| *value > 0)
                .max()
                .unwrap_or_else(|| mtime(&db).max(mtime(&wal(&db))));
            out.push(OtherChat {
                provider: "antigravity",
                id: id.clone(),
                title,
                cwd: workspace(&workspaces),
                created_ms: None,
                last_ms,
                size,
                path: format!("{PREFIX}{}|{id}", db.display()),
                model: None,
                account: None,
            });
        }
    }
}

fn split_body(role: &'static str, body: &str, offsets_json: &str, out: &mut Vec<(usize, u8, Msg)>) {
    let Ok(offsets) = serde_json::from_str::<Vec<(usize, usize)>>(offsets_json) else {
        return;
    };
    for (i, (step, start)) in offsets.iter().copied().enumerate() {
        let end = offsets.get(i + 1).map(|(_, n)| *n).unwrap_or(body.len());
        let Some(text) = body
            .get(start..end)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let order = if role == "user" { 0 } else { 1 };
        out.push((step, order, Msg::new(role, "", text.to_string(), "text")));
    }
}

pub fn read(path: &str) -> Result<Vec<Msg>, String> {
    let value = path.strip_prefix(PREFIX).ok_or("Not an Antigravity chat")?;
    let (db, id) = value.rsplit_once('|').ok_or("Invalid Antigravity chat")?;
    if id.is_empty() || !database_files().iter().any(|p| p == Path::new(db)) {
        return Err("That Antigravity database is no longer available".into());
    }
    let c =
        open_ro(Path::new(db)).ok_or("Antigravity's conversation database could not be opened")?;
    let mut st = c
        .prepare(
            "SELECT user_body,CAST(user_step_byte_offsets AS TEXT),agent_body,CAST(agent_step_byte_offsets AS TEXT)
             FROM conversations_fts WHERE conversation_id=?1 AND chunk_index>=0 ORDER BY chunk_index",
        )
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut ordered = Vec::new();
    for row in rows.flatten() {
        split_body("user", &row.0, &row.1, &mut ordered);
        split_body("assistant", &row.2, &row.3, &mut ordered);
    }
    ordered.sort_by_key(|(step, order, _)| (*step, *order));
    Ok(ordered.into_iter().map(|(_, _, msg)| msg).collect())
}

pub fn fingerprint() -> i64 {
    database_files()
        .into_iter()
        .fold(0, |latest, db| latest.max(mtime(&db)).max(mtime(&wal(&db))))
}

pub fn real_file(path: &str) -> Option<PathBuf> {
    let (db, _) = path.strip_prefix(PREFIX)?.rsplit_once('|')?;
    database_files().into_iter().find(|p| p == Path::new(db))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn body_offsets_restore_step_order() {
        let mut out = Vec::new();
        split_body("user", "first\nsecond\n", "[[0,0],[4,6]]", &mut out);
        split_body(
            "assistant",
            "reply one\nreply two\n",
            "[[2,0],[5,10]]",
            &mut out,
        );
        out.sort_by_key(|(step, order, _)| (*step, *order));
        let got: Vec<(&str, &str)> = out
            .iter()
            .map(|(_, _, m)| (m.role.as_str(), m.text.as_str()))
            .collect();
        assert_eq!(
            got,
            [
                ("user", "first"),
                ("assistant", "reply one"),
                ("user", "second"),
                ("assistant", "reply two")
            ]
        );
    }

    #[test]
    fn file_uri_becomes_a_local_path() {
        assert_eq!(
            decode_uri_path("file:///home/me/My%20Project"),
            Some("/home/me/My Project".into())
        );
    }

    #[test]
    #[ignore = "read-only diagnostic of Antigravity conversations on this PC"]
    fn reads_real_conversations() {
        let mut chats = Vec::new();
        scan(&mut chats);
        assert!(
            !chats.is_empty(),
            "Antigravity conversations were not found"
        );
        let mut messages = 0;
        for chat in &chats {
            let read = read(&chat.path).unwrap_or_else(|e| panic!("{}: {e}", chat.id));
            assert!(read.iter().all(|m| !m.text.trim().is_empty()));
            messages += read.len();
        }
        assert!(
            messages > 0,
            "Antigravity's search index contained no readable messages"
        );
        println!(
            "read {} Antigravity chats with {} visible messages",
            chats.len(),
            messages
        );
    }
}
