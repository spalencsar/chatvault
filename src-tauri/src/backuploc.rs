//! Where the backup lives. The default is `Documents\ChatVault Backup`; the user can choose another folder.
//!
//! Changing it is a move, never a quiet switch: the files are copied and checked before the new place is used, and
//! the old folder is never deleted on its own. It stays where it was until the user removes it, and then only to
//! the Recycle Bin.

use crate::paths::*;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;
use tauri::{AppHandle, Emitter};

/// Written into a folder that ChatVault made or moved a backup into, so a later check knows it is one.
const MARKER: &str = ".chatvault-backup";
/// Folders a backup contains; a folder with any of them (or a marker) counts as an existing ChatVault backup.
const KNOWN: [&str; 7] = ["claude", "codex", "cursor", "gemini", "opencode", "cline", MARKER];

#[derive(Serialize, Deserialize, Default, Clone)]
struct Config {
    /// A folder the user chose; none means the default in Documents.
    path: Option<String>,
    /// The folder the backup was in before the last change, until the user removes it.
    previous: Option<String>,
}

static CONFIG: RwLock<Option<Config>> = RwLock::new(None);
static CANCEL: AtomicBool = AtomicBool::new(false);

fn config_file() -> Option<PathBuf> {
    data_dir().map(|d| d.join("backup-location.json"))
}

fn config() -> Config {
    if let Ok(g) = CONFIG.read() {
        if let Some(c) = g.as_ref() {
            return c.clone();
        }
    }
    let loaded = config_file()
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str::<Config>(&s).ok())
        .unwrap_or_default();
    if let Ok(mut g) = CONFIG.write() {
        *g = Some(loaded.clone());
    }
    loaded
}

fn save(c: &Config) -> Result<(), String> {
    let file = config_file().ok_or("No place to keep settings")?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // Written to a side file first, so a crash can never leave half a setting behind.
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(c).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    if let Ok(mut g) = CONFIG.write() {
        *g = Some(c.clone());
    }
    Ok(())
}

/// The folder the user chose, if any.
pub fn custom() -> Option<PathBuf> {
    config().path.filter(|p| !p.trim().is_empty()).map(PathBuf::from)
}

pub fn default_root() -> Option<PathBuf> {
    home().map(|p| p.join("Documents").join("ChatVault Backup"))
}

fn same(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

fn plain(p: &Path) -> String {
    p.to_string_lossy().trim_start_matches(r"\\?\").to_string()
}

fn has_backup_shape(dir: &Path) -> bool {
    KNOWN.iter().any(|k| dir.join(k).exists())
}

fn is_empty_dir(dir: &Path) -> bool {
    fs::read_dir(dir).map(|mut r| r.next().is_none()).unwrap_or(false)
}

/// Folders a backup must never be placed in: the tools' own chat folders and the system. Putting it inside one of
/// those would mix the copy with the originals or copy the backup into itself.
fn protected() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    if let Some(h) = home() {
        for d in [".claude", ".codex", ".gemini", ".cursor", ".cline", ".local/share/opencode", ".config/opencode"] {
            v.push(h.join(d));
        }
    }
    for var in ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
        if let Some(p) = env_path(var) {
            v.push(p);
        }
    }
    if let Some(app) = env_path("APPDATA") {
        for d in ["Claude", "Cursor", "Code", "Windsurf", "VSCodium", "Codex"] {
            v.push(app.join(d));
        }
    }
    if let Some(d) = data_dir() {
        v.push(d);
    }
    v
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub path: String,
    pub is_default: bool,
    pub default_path: String,
    /// The folder before the last change, while it still exists and holds a backup.
    pub previous: Option<String>,
    /// False when the folder (or its drive) cannot be reached right now, for example an unplugged drive.
    pub available: bool,
}

pub fn info() -> Info {
    let default = default_root().unwrap_or_default();
    let root = backup_root().unwrap_or_default();
    let previous = config()
        .previous
        .map(PathBuf::from)
        .filter(|p| p.is_dir() && !same(p, &root) && has_backup_shape(p))
        .map(|p| plain(&p));
    Info {
        is_default: custom().is_none(),
        available: root.is_dir() || root.parent().is_some_and(|p| p.is_dir()),
        path: root.to_string_lossy().to_string(),
        default_path: default.to_string_lossy().to_string(),
        previous,
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub path: String,
    pub files_to_move: usize,
    pub bytes_to_move: u64,
    /// The folder already holds a ChatVault backup, which will be used as it is.
    pub is_existing_backup: bool,
}

/// Decides whether `chosen` can be the backup folder. Nothing is created or changed.
pub fn check(chosen: &str) -> Result<Check, String> {
    let chosen = chosen.trim().trim_matches('"');
    if chosen.is_empty() {
        return Err("Choose a folder first.".into());
    }
    let raw = PathBuf::from(chosen);
    if !raw.is_absolute() {
        return Err("Choose a full folder path, for example D:\\Backups\\ChatVault.".into());
    }
    if raw.parent().is_none() {
        return Err("A whole drive cannot be the backup folder. Make a folder on it.".into());
    }
    let exists = raw.exists();
    if exists && !raw.is_dir() {
        return Err("That is a file, not a folder.".into());
    }
    // The folder may not exist yet, so its nearest existing parent is checked instead.
    let anchor = if exists { raw.clone() } else { raw.ancestors().skip(1).find(|a| a.is_dir()).map(Path::to_path_buf).ok_or("That drive or folder cannot be reached right now.")? };
    let real = anchor.canonicalize().map_err(|_| "That folder cannot be reached right now.".to_string())?;
    let target = if exists { real.clone() } else { real.join(raw.strip_prefix(&anchor).unwrap_or(Path::new(""))) };
    for p in protected() {
        let p = p.canonicalize().unwrap_or(p);
        if target.starts_with(&p) {
            return Err(format!("Choose a different place. {} belongs to another program (or to ChatVault itself).", plain(&p)));
        }
    }
    let current = backup_root().unwrap_or_default();
    if same(&target, &current) {
        return Err("That is already the backup folder.".into());
    }
    let cur_real = current.canonicalize().unwrap_or(current.clone());
    if target.starts_with(&cur_real) || cur_real.starts_with(&target) {
        return Err("The new folder cannot be inside the current backup folder, or contain it.".into());
    }
    let mut is_existing_backup = false;
    if exists {
        if has_backup_shape(&target) {
            is_existing_backup = true;
        } else if !is_empty_dir(&target) {
            return Err("That folder already has other files in it. Choose an empty folder, or make a new one.".into());
        }
    }
    // Writing must work there; a test file is made and removed (in the folder, or its nearest existing parent).
    let probe = anchor.join(".chatvault-write-test");
    fs::write(&probe, b"ok").map_err(|e| format!("ChatVault cannot write to that folder ({e})."))?;
    let _ = fs::remove_file(&probe);

    let mut files = Vec::new();
    if current.is_dir() {
        crate::sync::walk_all(&current, &mut files);
    }
    let bytes = files.iter().filter_map(|f| fs::metadata(f).ok()).map(|m| m.len()).sum();
    Ok(Check { path: plain(&target), files_to_move: files.len(), bytes_to_move: bytes, is_existing_backup })
}

#[derive(Serialize, Clone)]
struct MoveProgress {
    done: usize,
    total: usize,
    current: String,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MoveResult {
    pub copied: usize,
    pub skipped: usize,
    pub bytes: u64,
    pub path: String,
    pub moved: bool,
}

pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Copies every file of `old` into `target`, then checks that each one is there with the same size. A file already
/// in place with the same size is not copied again, so a move that was cancelled can simply be started again.
fn move_tree(old: &Path, target: &Path, mut progress: impl FnMut(usize, usize, &str)) -> Result<MoveResult, String> {
    let mut files = Vec::new();
    crate::sync::walk_all(old, &mut files);
    let total = files.len();
    let mut out = MoveResult::default();
    for (i, src) in files.iter().enumerate() {
        if CANCEL.load(Ordering::SeqCst) {
            return Err("Cancelled. The backup stays where it was.".to_string());
        }
        let rel = src.strip_prefix(old).map_err(|e| e.to_string())?;
        let dst = target.join(rel);
        let len = fs::metadata(src).map(|m| m.len()).unwrap_or(0);
        if fs::metadata(&dst).map(|m| m.len() == len).unwrap_or(false) {
            out.skipped += 1;
        } else {
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::copy(src, &dst).map_err(|e| format!("Could not copy {} ({e}). The backup stays where it was.", rel.display()))?;
            out.copied += 1;
            out.bytes += len;
        }
        if i % 20 == 0 || i + 1 == total {
            progress(i + 1, total, &rel.to_string_lossy());
        }
    }
    for src in &files {
        let rel = src.strip_prefix(old).map_err(|e| e.to_string())?;
        let same_len = fs::metadata(src).ok().map(|m| m.len()) == fs::metadata(target.join(rel)).ok().map(|m| m.len());
        if !same_len {
            return Err(format!("{} did not copy completely. The backup stays where it was.", rel.display()));
        }
    }
    Ok(out)
}

/// Switches the backup to `chosen`. With `move_files`, everything in the old folder is copied there first and
/// checked file by file; if anything fails or the move is cancelled, the old folder stays in use.
pub fn set(app: &AppHandle, chosen: &str, move_files: bool) -> Result<MoveResult, String> {
    let checked = check(chosen)?;
    if crate::sync::BUSY.swap(true, Ordering::SeqCst) {
        return Err("A backup is running. Try again when it has finished.".into());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let result = (|| {
        let target = PathBuf::from(&checked.path);
        let old = backup_root().ok_or("No current backup folder")?;
        fs::create_dir_all(&target).map_err(|e| format!("Could not create the folder: {e}"))?;
        let mut out = MoveResult { path: checked.path.clone(), ..Default::default() };
        if move_files && old.is_dir() {
            let done = move_tree(&old, &target, |done, total, current| {
                let _ = app.emit("backup-move-progress", MoveProgress { done, total, current: current.to_string() });
            })?;
            out.copied = done.copied;
            out.skipped = done.skipped;
            out.bytes = done.bytes;
            out.moved = true;
        }
        let _ = fs::write(target.join(MARKER), "This folder is a ChatVault backup.\n");
        let default = default_root();
        let to_default = default.as_deref().is_some_and(|d| same(d, &target));
        save(&Config { path: if to_default { None } else { Some(plain(&target)) }, previous: Some(plain(&old)) })?;
        // Chats that were read from the old folder are dropped from the list; the next scan finds the new ones.
        let _ = crate::index::forget_under(&plain(&old));
        Ok(out)
    })();
    crate::sync::BUSY.store(false, Ordering::SeqCst);
    result
}

/// Sends the folder the backup used to be in to the Recycle Bin. Only that exact folder, only while it still looks
/// like a ChatVault backup, and never the folder in use.
pub fn delete_previous() -> Result<(), String> {
    let mut c = config();
    let prev = PathBuf::from(c.previous.clone().ok_or("There is no previous backup folder.")?);
    let current = backup_root().unwrap_or_default();
    if !prev.is_dir() {
        c.previous = None;
        return save(&c);
    }
    if same(&prev, &current) || current.starts_with(&prev) || prev.starts_with(&current) {
        return Err("That folder is the backup in use, so it was not removed.".into());
    }
    if !has_backup_shape(&prev) {
        return Err("That folder no longer looks like a ChatVault backup, so it was not removed.".into());
    }
    crate::recycle(&prev)?;
    c.previous = None;
    save(&c)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("chatvault-backuploc-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn refuses_drive_roots_files_and_folders_with_other_content() {
        assert!(check("").is_err());
        assert!(check("relative\\path").is_err());
        assert!(check("C:\\").is_err(), "a whole drive is refused");
        let dir = temp("busy");
        fs::write(dir.join("notes.txt"), "mine").unwrap();
        assert!(check(&dir.to_string_lossy()).unwrap_err().contains("other files"));
        let file = dir.join("notes.txt");
        assert!(check(&file.to_string_lossy()).unwrap_err().contains("file"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_an_empty_folder_a_new_folder_and_an_existing_backup() {
        let base = temp("ok");
        assert!(check(&base.to_string_lossy()).is_ok(), "an empty folder is fine");
        assert!(check(&base.join("new").join("deeper").to_string_lossy()).is_ok(), "a folder that does not exist yet is fine");
        let backup = base.join("old-backup");
        fs::create_dir_all(backup.join("claude")).unwrap();
        fs::write(backup.join("claude").join("a.jsonl"), "x").unwrap();
        let c = check(&backup.to_string_lossy()).unwrap();
        assert!(c.is_existing_backup);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_move_copies_and_checks_every_file_and_can_be_cancelled() {
        let base = temp("move");
        let old = base.join("old");
        fs::create_dir_all(old.join("claude/projects/p1")).unwrap();
        fs::create_dir_all(old.join("codex")).unwrap();
        for (name, body) in [("claude/projects/p1/a.jsonl", "aaaa"), ("claude/projects/p1/b.jsonl", "bbbbbbbb"), ("codex/session_index.jsonl", "c")] {
            fs::write(old.join(name), body).unwrap();
        }
        let target = base.join("new");
        fs::create_dir_all(&target).unwrap();

        // Cancelled before it starts: nothing is switched and the old folder is untouched.
        CANCEL.store(true, Ordering::SeqCst);
        assert!(move_tree(&old, &target, |_, _, _| {}).unwrap_err().contains("Cancelled"));
        CANCEL.store(false, Ordering::SeqCst);

        let mut seen = 0;
        let first = move_tree(&old, &target, |done, total, _| {
            assert!(done <= total);
            seen += 1;
        })
        .unwrap();
        assert_eq!((first.copied, first.skipped, first.bytes), (3, 0, 13));
        assert!(seen > 0);
        assert_eq!(fs::read_to_string(target.join("claude/projects/p1/b.jsonl")).unwrap(), "bbbbbbbb");
        assert!(old.join("claude/projects/p1/b.jsonl").exists(), "the old folder is never emptied");

        // Run again: everything is already there, so nothing is copied twice.
        let again = move_tree(&old, &target, |_, _, _| {}).unwrap();
        assert_eq!((again.copied, again.skipped), (0, 3));

        // A file that is cut short in the copy is caught by the check.
        fs::write(target.join("codex/session_index.jsonl"), "").unwrap();
        fs::write(old.join("codex/session_index.jsonl"), "cc").unwrap();
        fs::write(target.join("codex/session_index.jsonl"), "c").unwrap();
        let healed = move_tree(&old, &target, |_, _, _| {}).unwrap();
        assert_eq!(healed.copied, 1, "a file whose size differs is copied again");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn never_inside_the_tools_own_chat_folders() {
        if let Some(h) = home() {
            let inside = h.join(".claude").join("chatvault-backup-test");
            assert!(check(&inside.to_string_lossy()).is_err());
        }
    }
}
