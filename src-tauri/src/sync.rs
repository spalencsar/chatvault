//! Backs up supported live chat files and ChatVault's independent snapshots into Documents, and restores them again.
//! Restoring never overwrites a file that already exists.

use crate::paths::*;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

pub(crate) static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Default)]
pub struct SyncStats {
    pub copied: usize,
    pub skipped: usize,
    pub failed: usize,
    pub bytes: u64,
    pub total: usize,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SourceBreakdown {
    pub source: String,
    pub label: String,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RestoreCandidate {
    pub source: String,
    pub filename: String,
    pub bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    pub total_files: usize,
    pub total_bytes: u64,
    pub by_source: Vec<SourceBreakdown>,
    pub sample_candidates: Vec<RestoreCandidate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    pub path: String,
    pub exists: bool,
    pub files: usize,
    pub bytes: u64,
    pub last_sync_ms: Option<i64>,
    pub breakdown: Vec<SourceBreakdown>,
}

#[derive(Serialize, Clone)]
struct Progress {
    phase: String,
    done: usize,
    total: usize,
    current: String,
}

#[derive(Clone, Debug)]
pub struct SyncPair {
    pub source: String,
    pub src: PathBuf,
    pub dst: PathBuf,
}

pub(crate) fn walk_all(root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk_all(&p, out);
        } else {
            out.push(p);
        }
    }
}

pub fn source_label(source: &str) -> &'static str {
    match source {
        "archive" => "Snapshot Archive",
        "claude" => "Claude Code",
        "codex" => "Codex",
        "cursor" => "Cursor",
        "gemini" => "Gemini CLI",
        "cline" => "Cline",
        "opencode" => "OpenCode",
        "grok" => "Grok",
        "hermes" => "Hermes Agent",
        "antigravity" => "Antigravity",
        "imported" => "Imported",
        _ => "Other",
    }
}

fn calculate_breakdown(root: &Path) -> Vec<SourceBreakdown> {
    let mut map: std::collections::BTreeMap<String, (usize, u64)> = std::collections::BTreeMap::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if name.starts_with('.') {
                    continue;
                }
                let mut sub_files = Vec::new();
                walk_all(&path, &mut sub_files);
                let bytes: u64 = sub_files.iter().filter_map(|f| fs::metadata(f).ok()).map(|m| m.len()).sum();
                map.insert(name, (sub_files.len(), bytes));
            }
        }
    }
    map.into_iter()
        .map(|(source, (files, bytes))| SourceBreakdown {
            label: source_label(&source).to_string(),
            source,
            files,
            bytes,
        })
        .collect()
}

/// (source, destination) pairs. `forward` = live -> backup, otherwise backup -> live.
fn pairs(forward: bool) -> Vec<SyncPair> {
    let Some(b) = backup_root() else { return Vec::new() };
    // (source_id, live root, backup root, filter: 0 = everything, 1 = Claude transcripts only, 2 = Cursor transcripts only, 3 = Gemini chats, 4 = OpenCode database, 5 = Grok)
    let mut maps: Vec<(&'static str, PathBuf, PathBuf, u8)> = Vec::new();
    let on = crate::integrations::is_enabled;
    // Provider-independent snapshots are always safe to copy both ways: they belong to ChatVault,
    // not to a live tool database, and restoring them never writes into another application.
    if let Some(p) = crate::archive::root() {
        maps.push(("archive", p, b.join("archive"), 0));
    }
    if let (true, Some(p)) = (on("claude"), claude_projects()) {
        maps.push(("claude", p, b.join("claude").join("projects"), 1));
    }
    if let (true, Some(p)) = (on("claude"), claude_meta()) {
        maps.push(("claude", p, b.join("claude").join("sessions-meta"), 0));
    }
    if let (true, Some(c)) = (on("codex"), codex_home()) {
        maps.push(("codex", c.join("sessions"), b.join("codex").join("sessions"), 0));
        maps.push(("codex", c.join("archived_sessions"), b.join("codex").join("archived_sessions"), 0));
    }
    // Cursor: the plain-text agent transcripts and the CLI chat stores. The IDE database itself is not copied while Cursor may be writing to it.
    if let (true, Some(h)) = (on("cursor"), home()) {
        maps.push(("cursor", h.join(".cursor").join("projects"), b.join("cursor").join("projects"), 2));
        maps.push(("cursor", h.join(".cursor").join("chats"), b.join("cursor").join("chats"), 0));
    }
    // Gemini CLI (chat files per project) and Cline (one folder per task). OpenCode keeps everything in one SQLite file:
    // it is copied into the backup but never written back over the live one.
    if let Some(h) = home() {
        if on("gemini") {
            maps.push(("gemini", h.join(".gemini").join("tmp"), b.join("gemini").join("tmp"), 3));
        }
        if on("cline") {
            maps.push(("cline", h.join(".cline").join("data").join("sessions"), b.join("cline").join("sessions"), 0));
        }
        if forward && on("opencode") {
            let db = h.join(".local").join("share").join("opencode");
            maps.push(("opencode", db, b.join("opencode"), 4));
        }
        if on("grok") {
            maps.push(("grok", h.join(".grok").join("sessions"), b.join("grok").join("sessions"), 5));
        }
    }
    if on("imported") {
        if let Some(d) = crate::imported::root() {
            maps.push(("imported", d, b.join("imported"), 0));
        }
    }
    let mut out = Vec::new();
    for (src_name, live, back, filter) in maps {
        let (from, to) = if forward { (&live, &back) } else { (&back, &live) };
        let mut files = Vec::new();
        walk_all(from, &mut files);
        for f in files {
            let Ok(rel) = f.strip_prefix(from) else { continue };
            // Claude project folders also hold sub-agent and tool-result files; keep only transcripts.
            let is_jsonl = f.extension().map(|e| e == "jsonl").unwrap_or(false);
            if filter == 1 && !(rel.components().count() == 2 && is_jsonl) {
                continue;
            }
            if filter == 2 && !(is_jsonl && rel.to_string_lossy().contains("agent-transcripts")) {
                continue;
            }
            // Gemini: only the saved chats (tmp/<project>/chats/*.json) and the file naming the project.
            if filter == 3 {
                let s = rel.to_string_lossy();
                let name = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if !((s.contains("chats") && name.ends_with(".json")) || name == ".project_root") {
                    continue;
                }
            }
            // OpenCode: just its database file.
            if filter == 4 && f.file_name().map(|n| n != "opencode.db").unwrap_or(true) {
                continue;
            }
            // Grok: session transcripts and the summary next to them.
            if filter == 5 {
                let name = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if name != "chat_history.jsonl" && name != "summary.json" {
                    continue;
                }
            }
            out.push(SyncPair {
                source: src_name.to_string(),
                src: f.clone(),
                dst: to.join(rel),
            });
        }
    }
    out
}

fn needs_copy(src: &Path, dst: &Path, overwrite_changed: bool) -> bool {
    let Ok(dm) = fs::metadata(dst) else { return true };
    if !overwrite_changed {
        return false;
    }
    let Ok(sm) = fs::metadata(src) else { return false };
    if sm.len() != dm.len() {
        return true;
    }
    match (sm.modified(), dm.modified()) {
        (Ok(s), Ok(d)) => s.duration_since(d).map(|x| x.as_secs() > 2).unwrap_or(false),
        _ => false,
    }
}

fn run(app: &AppHandle, forward: bool, source_filter: Option<Vec<String>>) -> Result<SyncStats, String> {
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err("A sync is already running".into());
    }
    let result = (|| {
        let root = backup_root().ok_or("No Documents folder")?;
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let all = pairs(forward);
        let mut todo: Vec<&SyncPair> = all.iter().filter(|p| needs_copy(&p.src, &p.dst, forward)).collect();
        if let Some(ref allowed) = source_filter {
            if !allowed.is_empty() {
                todo.retain(|p| allowed.contains(&p.source));
            }
        }
        let mut stats = SyncStats { total: todo.len(), skipped: all.len() - todo.len(), ..Default::default() };
        let phase = if forward { "Backing up" } else { "Restoring" };
        for (i, pair) in todo.iter().enumerate() {
            if let Some(parent) = pair.dst.parent() {
                let _ = fs::create_dir_all(parent);
            }
            match fs::copy(&pair.src, &pair.dst) {
                Ok(n) => {
                    stats.copied += 1;
                    stats.bytes += n;
                }
                Err(_) => stats.failed += 1,
            }
            if i % 10 == 0 {
                let _ = app.emit(
                    "sync-progress",
                    Progress {
                        phase: phase.into(),
                        done: i + 1,
                        total: todo.len(),
                        current: pair.src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                    },
                );
            }
        }
        merge_codex_index(forward);
        if forward {
            let ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let _ = fs::write(root.join(".chatvault-sync.json"), format!("{{\"lastSyncMs\":{}}}", ms));
        }
        let _ = app.emit(
            "sync-progress",
            Progress { phase: "Done".into(), done: todo.len(), total: todo.len(), current: String::new() },
        );
        Ok(stats)
    })();
    BUSY.store(false, Ordering::SeqCst);
    result
}

/// session_index.jsonl holds Codex thread names. Add any thread the destination does not have yet.
fn merge_codex_index(forward: bool) {
    if !crate::integrations::is_enabled("codex") {
        return;
    }
    let (Some(c), Some(b)) = (codex_home(), backup_root()) else { return };
    let live = c.join("session_index.jsonl");
    let back = b.join("codex").join("session_index.jsonl");
    let (from, to) = if forward { (live, back) } else { (back, live) };
    let Ok(src) = File::open(&from) else { return };
    let have: HashSet<String> = File::open(&to)
        .map(|f| {
            BufReader::new(f)
                .lines()
                .flatten()
                .filter_map(|l| serde_json::from_str::<Value>(&l).ok())
                .filter_map(|v| v.get("id").and_then(|x| x.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let mut add = Vec::new();
    for line in BufReader::new(src).lines().flatten() {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(id) = v.get("id").and_then(|x| x.as_str()) {
            if !have.contains(id) {
                add.push(line);
            }
        }
    }
    if add.is_empty() {
        return;
    }
    if let Some(parent) = to.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&to) {
        for l in add {
            let _ = writeln!(f, "{}", l);
        }
    }
}

pub fn backup(app: &AppHandle) -> Result<SyncStats, String> {
    run(app, true, None)
}

pub fn restore(app: &AppHandle) -> Result<SyncStats, String> {
    run(app, false, None)
}

pub fn restore_selected(app: &AppHandle, sources: Option<Vec<String>>) -> Result<SyncStats, String> {
    run(app, false, sources)
}

pub fn preview_restore() -> Result<RestorePreview, String> {
    let all = pairs(false);
    let missing: Vec<&SyncPair> = all.iter().filter(|p| needs_copy(&p.src, &p.dst, false)).collect();

    let mut by_source_map: std::collections::BTreeMap<String, (usize, u64)> = std::collections::BTreeMap::new();
    let mut candidates = Vec::new();

    let mut total_bytes = 0u64;
    for pair in &missing {
        let b = fs::metadata(&pair.src).map(|m| m.len()).unwrap_or(0);
        total_bytes += b;
        let entry = by_source_map.entry(pair.source.clone()).or_insert((0, 0));
        entry.0 += 1;
        entry.1 += b;

        if candidates.len() < 50 {
            candidates.push(RestoreCandidate {
                source: pair.source.clone(),
                filename: pair.src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                bytes: b,
            });
        }
    }

    let by_source = by_source_map
        .into_iter()
        .map(|(source, (files, bytes))| SourceBreakdown {
            label: source_label(&source).to_string(),
            source,
            files,
            bytes,
        })
        .collect();

    Ok(RestorePreview {
        total_files: missing.len(),
        total_bytes,
        by_source,
        sample_candidates: candidates,
    })
}

pub fn create_tarball(target_path: &Path) -> Result<(usize, u64), String> {
    let root = backup_root().ok_or("No backup root folder configured")?;
    if !root.exists() {
        return Err("Backup folder does not exist yet. Run a backup first.".into());
    }
    if let Some(parent) = target_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let output = std::process::Command::new("tar")
        .arg("-czf")
        .arg(target_path)
        .arg("-C")
        .arg(&root)
        .arg(".")
        .output()
        .map_err(|e| format!("Failed to run tar command: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Tar compression failed: {err}"));
    }
    let meta = fs::metadata(target_path).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    walk_all(&root, &mut files);
    Ok((files.len(), meta.len()))
}

pub fn status() -> BackupStatus {
    let Some(root) = backup_root() else {
        return BackupStatus { path: String::new(), exists: false, files: 0, bytes: 0, last_sync_ms: None, breakdown: Vec::new() };
    };
    let mut files = Vec::new();
    walk_all(&root, &mut files);
    let bytes = files.iter().filter_map(|f| fs::metadata(f).ok()).map(|m| m.len()).sum();
    let last_sync_ms = fs::read_to_string(root.join(".chatvault-sync.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("lastSyncMs").and_then(|x| x.as_i64()));
    let breakdown = calculate_breakdown(&root);
    BackupStatus {
        path: root.to_string_lossy().to_string(),
        exists: root.exists(),
        files: files.len(),
        bytes,
        last_sync_ms,
        breakdown,
    }
}
