//! ChatVault-owned, provider-independent conversation snapshots.
//!
//! Every successfully parsed live chat is written as one normalized JSON file. Live sources always
//! win in the index; a snapshot is shown only after its source disappears. Writes use a temporary
//! file and an atomic rename, so an interrupted update cannot damage the previous snapshot.

use crate::index::ChatSummary;
use crate::paths::data_dir;
use crate::providers::Msg;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};

const PREFIX: &str = "archive:";
const SCHEMA_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    schema_version: u32,
    archived_at_ms: i64,
    chat: ChatSummary,
    messages: Vec<Msg>,
}

pub struct ArchivedChat {
    pub chat: ChatSummary,
    pub mtime: i64,
}

pub fn root() -> Option<PathBuf> {
    data_dir().map(|d| d.join("archive"))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn mtime(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn hash(provider: &str, id: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in provider.bytes().chain([0]).chain(id.bytes()) {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

fn target(root: &Path, provider: &str, id: &str) -> PathBuf {
    root.join(provider).join(format!("{}.json", hash(provider, id)))
}

#[cfg(unix)]
fn private_dir(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
}

#[cfg(not(unix))]
fn private_dir(_path: &Path) {}

#[cfg(unix)]
fn private_file(file: &File) {
    use std::os::unix::fs::PermissionsExt;
    let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn private_file(_file: &File) {}

fn save_at(root: &Path, chat: &ChatSummary, messages: &[Msg]) -> Result<PathBuf, String> {
    if messages.is_empty() || chat.path.starts_with(PREFIX) {
        return Err("There is no live conversation to archive".into());
    }
    let dir = root.join(&chat.provider);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    private_dir(root);
    private_dir(&dir);
    let path = target(root, &chat.provider, &chat.id);
    let tmp = path.with_extension("json.tmp");
    let file = File::create(&tmp).map_err(|e| e.to_string())?;
    private_file(&file);
    let snapshot = Snapshot {
        schema_version: SCHEMA_VERSION,
        archived_at_ms: now_ms(),
        chat: chat.clone(),
        messages: messages.to_vec(),
    };
    let mut writer = BufWriter::new(file);
    if let Err(e) = serde_json::to_writer(&mut writer, &snapshot).and_then(|_| writer.flush().map_err(serde_json::Error::io)) {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    drop(writer);
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(path)
}

pub fn save(chat: &ChatSummary, messages: &[Msg]) -> Result<PathBuf, String> {
    let root = root().ok_or("No ChatVault data folder")?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    save_at(&root, chat, messages)
}

fn read_file(path: &Path) -> Result<Snapshot, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let snapshot: Snapshot = serde_json::from_reader(BufReader::new(file)).map_err(|e| e.to_string())?;
    if snapshot.schema_version != SCHEMA_VERSION || snapshot.chat.provider.is_empty() || snapshot.chat.id.is_empty() {
        return Err("Unsupported ChatVault archive file".into());
    }
    Ok(snapshot)
}

fn files_at(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(providers) = fs::read_dir(root) else { return out };
    for provider in providers.flatten().filter(|e| e.path().is_dir()) {
        let Ok(files) = fs::read_dir(provider.path()) else { continue };
        out.extend(files.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "json")));
    }
    out
}

pub fn scan() -> Vec<ArchivedChat> {
    let Some(root) = root() else { return Vec::new() };
    files_at(&root)
        .into_iter()
        .filter_map(|path| {
            let mut snapshot = read_file(&path).ok()?;
            snapshot.chat.path = format!("{PREFIX}{}", path.display());
            snapshot.chat.size = fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
            snapshot.chat.backup = false;
            Some(ArchivedChat { chat: snapshot.chat, mtime: mtime(&path) })
        })
        .collect()
}

fn listed(path: &str) -> Option<PathBuf> {
    let requested = PathBuf::from(path.strip_prefix(PREFIX)?);
    let root = root()?;
    files_at(&root).into_iter().find(|p| p == &requested)
}

pub fn read(path: &str) -> Result<Vec<Msg>, String> {
    let file = listed(path).ok_or("That archived conversation is no longer available")?;
    Ok(read_file(&file)?.messages)
}

pub fn real_file(path: &str) -> Option<PathBuf> {
    listed(path)
}

pub fn deletable(path: &str) -> Option<PathBuf> {
    listed(path)
}

pub fn is_path(path: &str) -> bool {
    path.starts_with(PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> ChatSummary {
        ChatSummary {
            provider: "antigravity".into(), id: "chat/with unsafe chars".into(), local_id: None,
            title: "Saved conversation".into(), account: "local".into(), project: "Demo".into(),
            cwd: Some("/tmp/demo".into()), created_ms: Some(1), last_ms: 2, archived: false,
            size: 3, path: "antigravity-db:source|id".into(), model: None, has_metadata: true,
            backup: false, user_archived: false,
        }
    }

    #[test]
    fn snapshot_is_atomic_safe_and_round_trips_messages() {
        let root = std::env::temp_dir().join(format!("chatvault-archive-test-{}", now_ms()));
        let messages = vec![Msg::new("user", "", "hello".into(), "text"), Msg::new("assistant", "", "world".into(), "text")];
        let path = save_at(&root, &sample(), &messages).unwrap();
        assert_eq!(path.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()), Some("antigravity"));
        assert!(!path.to_string_lossy().contains("unsafe chars"));
        let saved = read_file(&path).unwrap();
        assert_eq!(saved.chat.id, "chat/with unsafe chars");
        assert_eq!(saved.messages.len(), 2);
        assert_eq!(saved.messages[1].text, "world");
        assert!(!path.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(root);
    }
}
