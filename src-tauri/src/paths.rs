//! Well-known folders on this PC.

use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

pub fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).filter(|v|!v.is_empty()).map(PathBuf::from)
}

pub fn home() -> Option<PathBuf> {
    env_path("USERPROFILE")
}

pub fn claude_projects() -> Option<PathBuf> {
    env_path("CLAUDE_CONFIG_DIR").or_else(|| home().map(|p|p.join(".claude"))).map(|p|p.join("projects"))
}

pub fn claude_meta() -> Option<PathBuf> {
    env_path("APPDATA").map(|p| p.join("Claude").join("claude-code-sessions"))
}

pub fn codex_home() -> Option<PathBuf> {
    env_path("CODEX_HOME").or_else(||home().map(|p| p.join(".codex")))
}

pub fn codex_roots() -> Vec<PathBuf> {
    unique_roots([codex_home(),home().map(|p|p.join(".codex"))])
}

pub fn claude_project_roots() -> Vec<PathBuf> {
    unique_roots([claude_projects(),home().map(|p|p.join(".claude/projects"))])
}

fn unique_roots(candidates:impl IntoIterator<Item=Option<PathBuf>>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for p in candidates.into_iter().flatten() {
        if !roots.contains(&p) { roots.push(p); }
    }
    roots
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn custom_and_default_user_locations_are_both_kept_without_duplicates() {
        let default=PathBuf::from(r"D:\Users\Other User\非ASCII\.codex");
        let custom=PathBuf::from(r"E:\Agent profiles\work");
        assert_eq!(unique_roots([Some(custom.clone()),Some(default.clone()),Some(custom.clone()),None]),vec![custom,default]);
    }
}

/// Where the backup lives: the folder the user chose, or Documents\ChatVault Backup (see `backuploc`).
pub fn backup_root() -> Option<PathBuf> {
    crate::backuploc::custom().or_else(crate::backuploc::default_root)
}

pub fn data_dir() -> Option<PathBuf> {
    env_path("LOCALAPPDATA").map(|p| p.join("ChatVault"))
}

pub fn subdirs(p: &Path) -> Vec<PathBuf> {
    fs::read_dir(p)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default()
}

/// Every `.jsonl` (and optionally `.json`) file below `root`, to any depth.
pub fn walk_files(root: &Path, exts: &[&str], out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk_files(&p, exts, out);
        } else if p.extension().map(|x| exts.iter().any(|e| x == *e)).unwrap_or(false) {
            out.push(p);
        }
    }
}

/// A transcript path may only point inside the folders ChatVault reads.
pub fn check_transcript(path: &str) -> Result<PathBuf, String> {
    let canon = PathBuf::from(path).canonicalize().map_err(|e| e.to_string())?;
    if canon.extension().map(|e| e != "jsonl" && e != "zst").unwrap_or(true) {
        return Err("That file is not a chat transcript".into());
    }
    let mut roots = claude_project_roots();
    for c in codex_roots() { roots.extend([c.join("sessions"),c.join("archived_sessions")]); }
    roots.extend(backup_root());
    for r in roots {
        if let Ok(r) = r.canonicalize() {
            if canon.starts_with(&r) {
                return Ok(canon);
            }
        }
    }
    Err("That file is not inside a chat folder".into())
}

/// Lines of a transcript. Codex archives older chats as zstd-compressed `.jsonl.zst`.
pub fn open_lines(path: &Path) -> Option<Box<dyn Iterator<Item = String>>> {
    let f = File::open(path).ok()?;
    if path.extension().map(|e| e == "zst").unwrap_or(false) {
        let d = zstd::stream::read::Decoder::new(f).ok()?;
        Some(Box::new(BufReader::new(d).lines().map_while(Result::ok)))
    } else {
        Some(Box::new(BufReader::new(f).lines().map_while(Result::ok)))
    }
}
