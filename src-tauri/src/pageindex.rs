//! A small per-file index of where the messages sit in a big transcript, so opening a chat and loading earlier
//! messages read only the part of the file that is needed instead of parsing all of it again.
//!
//! The index keeps, for every line that holds messages, its byte offset and how many messages it holds. It is built
//! once per file; when the file grows, only the new part is scanned.

use crate::providers::{messages_for, Msg};
use crate::{clip_msg, relevant};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;
use std::sync::{Arc, Mutex};

pub struct Index {
    /// Bytes scanned so far. Always the end of a complete line, so a line still being written is left for next time.
    scanned: u64,
    /// Byte offset of every line that holds messages, with how many it holds.
    lines: Vec<(u64, u32)>,
    /// Running total of messages after each of those lines.
    ends: Vec<usize>,
}

impl Index {
    pub fn total(&self) -> usize {
        self.ends.last().copied().unwrap_or(0)
    }
}

/// The few most recently used files; a long session reads a handful of chats at a time.
const KEEP: usize = 6;
static CACHE: Mutex<Option<HashMap<String, Arc<Index>>>> = Mutex::new(None);

fn scan(provider: &str, path: &Path, from: Option<&Index>) -> Result<Index, String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let (mut pos, mut lines, mut ends) = match from {
        Some(i) => (i.scanned, i.lines.clone(), i.ends.clone()),
        None => (0, Vec::new(), Vec::new()),
    };
    let mut total = ends.last().copied().unwrap_or(0);
    f.seek(SeekFrom::Start(pos)).map_err(|e| e.to_string())?;
    let mut r = BufReader::with_capacity(1 << 20, f);
    let mut buf: Vec<u8> = Vec::new();
    loop {
        buf.clear();
        let n = r.read_until(b'\n', &mut buf).map_err(|e| e.to_string())?;
        if n == 0 || buf.last() != Some(&b'\n') {
            break;
        }
        let start = pos;
        pos += n as u64;
        let text = String::from_utf8_lossy(&buf);
        let line = text.trim_end_matches(['\n', '\r']);
        if !relevant(provider, line) {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        let count = messages_for(provider, &v).len();
        if count > 0 {
            total += count;
            lines.push((start, count as u32));
            ends.push(total);
        }
    }
    Ok(Index { scanned: pos, lines, ends })
}

/// The index of a transcript, built or extended when the file has grown.
pub fn get(provider: &str, path: &Path) -> Result<Arc<Index>, String> {
    let key = format!("{}|{}", provider, path.to_string_lossy());
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    let cached = CACHE.lock().map_err(|e| e.to_string())?.as_ref().and_then(|m| m.get(&key).cloned());
    if let Some(c) = &cached {
        if c.scanned == size {
            return Ok(c.clone());
        }
    }
    // A file that only grew continues from where the last scan stopped; one that shrank or changed is read afresh.
    let base = cached.as_deref().filter(|c| c.scanned <= size);
    let fresh = Arc::new(scan(provider, path, base)?);
    let mut guard = CACHE.lock().map_err(|e| e.to_string())?;
    let map = guard.get_or_insert_with(HashMap::new);
    if map.len() >= KEEP && !map.contains_key(&key) {
        map.clear();
    }
    map.insert(key, fresh.clone());
    Ok(fresh)
}

/// Messages `lo..hi` (by position in the whole chat), reading only the lines they sit on.
pub fn read_range(provider: &str, path: &Path, index: &Index, lo: usize, hi: usize) -> Result<Vec<Msg>, String> {
    let hi = hi.min(index.total());
    if lo >= hi {
        return Ok(Vec::new());
    }
    // The first line whose running total goes past `lo`.
    let k = index.ends.partition_point(|&e| e <= lo);
    let mut at = if k == 0 { 0 } else { index.ends[k - 1] };
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(index.lines[k].0)).map_err(|e| e.to_string())?;
    let mut r = BufReader::with_capacity(1 << 20, f);
    let mut buf: Vec<u8> = Vec::new();
    let mut out = Vec::with_capacity(hi - lo);
    while at < hi {
        buf.clear();
        if r.read_until(b'\n', &mut buf).map_err(|e| e.to_string())? == 0 {
            break;
        }
        let text = String::from_utf8_lossy(&buf);
        let line = text.trim_end_matches(['\n', '\r']);
        if !relevant(provider, line) {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        for m in messages_for(provider, &v) {
            if at >= lo && at < hi {
                out.push(clip_msg(m, 30_000));
            }
            at += 1;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn line(n: usize) -> String {
        match n % 5 {
            0 => format!(r#"{{"type":"user","timestamp":"2026-01-01T00:00:{:02}Z","message":{{"role":"user","content":"question {n}"}}}}"#, n % 60),
            1 => format!(r#"{{"type":"assistant","timestamp":"2026-01-01T00:00:{:02}Z","message":{{"role":"assistant","content":[{{"type":"text","text":"answer {n}"}},{{"type":"text","text":"more {n}"}}]}}}}"#, n % 60),
            2 => format!(r#"{{"type":"file-history-snapshot","n":{n}}}"#),
            3 => "not json at all".to_string(),
            _ => format!(r#"{{"type":"assistant","timestamp":"2026-01-01T00:00:{:02}Z","message":{{"role":"assistant","content":[{{"type":"text","text":"solo {n}"}}]}}}}"#, n % 60),
        }
    }

    /// The old way: parse every line and keep what falls in the range.
    fn naive(path: &Path, lo: usize, hi: usize) -> Vec<String> {
        let mut at = 0;
        let mut out = Vec::new();
        for l in std::fs::read_to_string(path).unwrap().lines() {
            if !relevant("claude", l) {
                continue;
            }
            let Ok(v) = serde_json::from_str::<Value>(l) else { continue };
            for m in messages_for("claude", &v) {
                if at >= lo && at < hi {
                    out.push(m.text.clone());
                }
                at += 1;
            }
        }
        out
    }

    fn write(path: &Path, from: usize, to: usize) {
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap();
        for n in from..to {
            writeln!(f, "{}", line(n)).unwrap();
        }
    }

    #[test]
    fn ranges_match_a_full_parse_and_follow_a_growing_file() {
        let dir = std::env::temp_dir().join(format!("chatvault-pageindex-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("chat.jsonl");
        let _ = std::fs::remove_file(&path);
        write(&path, 0, 200);

        let idx = get("claude", &path).unwrap();
        let all = naive(&path, 0, usize::MAX);
        assert_eq!(idx.total(), all.len());
        for (lo, hi) in [(0, 10), (5, 6), (37, 91), (idx.total() - 7, idx.total()), (0, idx.total()), (idx.total() + 3, idx.total() + 9)] {
            let got: Vec<String> = read_range("claude", &path, &idx, lo, hi).unwrap().into_iter().map(|m| m.text).collect();
            assert_eq!(got, naive(&path, lo, hi), "range {lo}..{hi}");
        }

        // The file grows: only the new part is scanned, and the result still matches a full parse.
        write(&path, 200, 330);
        let idx2 = get("claude", &path).unwrap();
        assert_eq!(idx2.total(), naive(&path, 0, usize::MAX).len());
        let got: Vec<String> = read_range("claude", &path, &idx2, idx.total() - 3, idx2.total()).unwrap().into_iter().map(|m| m.text).collect();
        assert_eq!(got, naive(&path, idx.total() - 3, idx2.total()));

        // A half-written last line is left alone until its line break arrives.
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        write!(f, "{}", &line(330)[..20]).unwrap();
        let idx3 = get("claude", &path).unwrap();
        assert_eq!(idx3.total(), idx2.total());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
