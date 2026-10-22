//! NousSave JSON and Markdown exports, kept under ChatVault's data folder.

use crate::others::OtherChat;
use crate::paths::*;
use crate::providers::{Msg, clip};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 50_000_000;
const MAX_EMBEDDED_IMAGE_BYTES: usize = 4_000_000;
const INBOX_CACHE_VERSION: &str = "2";

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportStats {
    pub added: usize,
    pub skipped: usize,
    pub failed: Vec<String>,
}

pub fn root() -> Option<PathBuf> {
    data_dir().map(|d| d.join("imported"))
}

/// User-facing drop folder: NousSave JSON/MD placed here are copied into ChatVault on the next scan.
pub fn inbox() -> Option<PathBuf> {
    crate::paths::home().map(|h| h.join("Documents").join("ChatVault Import"))
}

pub fn ensure_inbox() -> Option<PathBuf> {
    let p = inbox()?;
    fs::create_dir_all(&p).ok()?;
    let readme = p.join("README.txt");
    if !readme.exists() {
        let _ = fs::write(
            &readme,
            "Drop NousSave exports here (.json preferred, .md also works).\nChatVault copies them on the next scan. ChatGPT, Gemini and Grok stay separate.\n",
        );
    }
    Some(p)
}

pub fn ingest_inbox() {
    let Some(p) = ensure_inbox() else { return };
    let Some(stamp) = inbox_fingerprint(&p) else {
        return;
    };
    let Some(marker) = root().map(|d| d.join(".inbox-fingerprint")) else {
        return;
    };
    if fs::read_to_string(&marker).ok().as_deref() == Some(&stamp) {
        return;
    }
    let _ = import_paths(&[p.to_string_lossy().into_owned()]);
    // Remember unsupported files too. A parser upgrade changes the cache
    // version and retries them, while an unchanged large export is not parsed
    // again on every scan.
    let _ = fs::write(marker, stamp);
}

fn mtime(p: &Path) -> i64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn ms_of(iso: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(iso.trim())
        .ok()
        .map(|d| d.timestamp_millis())
}

fn fnv1a(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

fn pretty_platform(s: &str) -> String {
    match s.trim().to_ascii_lowercase().as_str() {
        "chatgpt" | "openai" | "gpt" => "ChatGPT".into(),
        "gemini" | "google" | "bard" => "Gemini".into(),
        "grok" | "xai" | "x.ai" => "Grok".into(),
        "claude" | "anthropic" => "Claude".into(),
        "perplexity" => "Perplexity".into(),
        "copilot" | "github copilot" => "Copilot".into(),
        "deepseek" => "DeepSeek".into(),
        "kimi" => "Kimi".into(),
        "qwen" => "Qwen".into(),
        "mistral" | "le chat" => "Mistral".into(),
        "poe" => "Poe".into(),
        "" => "Imported".into(),
        other => {
            let mut c = other.chars();
            match c.next() {
                Some(f) => format!("{}{}", f.to_uppercase(), c.as_str()),
                None => "Imported".into(),
            }
        }
    }
}

fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    let mut i = 0;
    let bytes = s.as_bytes();
    while i < bytes.len() {
        let c = bytes[i];
        if c == b'<' {
            in_tag = true;
            i += 1;
            continue;
        }
        if c == b'>' && in_tag {
            in_tag = false;
            i += 1;
            out.push('\n');
            continue;
        }
        if in_tag {
            i += 1;
            continue;
        }
        if c == b'&' {
            let rest = &s[i..];
            if rest.starts_with("&amp;") {
                out.push('&');
                i += 5;
                continue;
            }
            if rest.starts_with("&lt;") {
                out.push('<');
                i += 4;
                continue;
            }
            if rest.starts_with("&gt;") {
                out.push('>');
                i += 4;
                continue;
            }
            if rest.starts_with("&quot;") {
                out.push('"');
                i += 6;
                continue;
            }
            if rest.starts_with("&nbsp;") {
                out.push(' ');
                i += 6;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    collapse_ws(&out)
}

fn collapse_ws(s: &str) -> String {
    let mut out = String::new();
    let mut blank = 0;
    for line in s.lines() {
        let t = line.trim_end();
        if t.trim().is_empty() {
            blank += 1;
            if blank <= 1 {
                out.push('\n');
            }
        } else {
            blank = 0;
            out.push_str(t.trim_start());
            out.push('\n');
        }
    }
    out.trim().to_string()
}

fn flatten_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(a) => a
            .iter()
            .map(flatten_text)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(o) => o
            .get("text")
            .or_else(|| o.get("content"))
            .map(flatten_text)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

/// NousSave keeps screenshots in `htmlContent` even when `contentText` only
/// contains an "image omitted" marker. Return safe, viewer-ready data URLs.
fn embedded_images(html: &str) -> Vec<&str> {
    let mut images = Vec::new();
    let mut rest = html;
    while let Some(start) = rest.find("src=") {
        rest = &rest[start + 4..];
        let Some(quote @ ('\'' | '"')) = rest.chars().next() else {
            continue;
        };
        rest = &rest[quote.len_utf8()..];
        let Some(end) = rest.find(quote) else { break };
        let src = &rest[..end];
        if src.starts_with("data:image/") && src.len() <= MAX_EMBEDDED_IMAGE_BYTES {
            images.push(src);
        }
        rest = &rest[end + quote.len_utf8()..];
    }
    images
}

fn remove_omitted_image_markers(text: &str) -> String {
    text.lines()
        .filter(|line| {
            let line = line.trim();
            !(line.starts_with("[Image: image omitted") && line.ends_with(']'))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn role_of(s: &str) -> Option<&'static str> {
    match s.trim().to_ascii_lowercase().as_str() {
        "user" | "human" | "you" => Some("user"),
        "assistant" | "ai" | "model" | "bot" | "gpt" => Some("assistant"),
        "system" => None,
        _ => None,
    }
}

struct Parsed {
    title: String,
    platform: String,
    model: Option<String>,
    created_ms: Option<i64>,
    last_ms: Option<i64>,
    messages: Vec<Msg>,
}

fn push_json_msg(out: &mut Vec<Msg>, m: &Value) {
    let role = m.get("role").and_then(|r| r.as_str()).and_then(role_of);
    let Some(role) = role else { return };
    let ts = m
        .get("timestamp")
        .or_else(|| m.get("created_at"))
        .or_else(|| m.get("capturedAt"))
        .and_then(|t| t.as_str())
        .unwrap_or("");
    let thinking = m.get("thinking").map(flatten_text).unwrap_or_default();
    if !thinking.trim().is_empty() {
        out.push(Msg::new(
            "assistant",
            ts,
            clip(thinking.trim(), 8000),
            "reasoning",
        ));
    }
    if let Some(html) = m.get("htmlContent").and_then(Value::as_str) {
        for src in embedded_images(html) {
            let mut image = Msg::new(role, ts, "[Image]".into(), "image");
            image.data = Some(Value::String(src.to_string()));
            out.push(image);
        }
    }
    let mut text = flatten_text(
        m.get("content")
            .or_else(|| m.get("contentText"))
            .unwrap_or(&Value::Null),
    );
    text = remove_omitted_image_markers(&text);
    if text.trim().is_empty() {
        if let Some(html) = m
            .get("html")
            .or_else(|| m.get("htmlContent"))
            .and_then(|h| h.as_str())
        {
            text = strip_html(html);
        }
    }
    if text.trim().is_empty() {
        return;
    }
    out.push(Msg::new(role, ts, text, "text"));
}

fn parse_json(v: &Value) -> Option<Parsed> {
    let meta = v.get("meta").or_else(|| v.get("conversation")).unwrap_or(v);
    let msgs_v = v
        .get("messages")
        .or_else(|| v.get("conversation").and_then(|c| c.get("messages")))
        .or_else(|| v.get("data").and_then(|c| c.get("messages")))?;
    let arr = msgs_v.as_array()?;
    let mut messages = Vec::new();
    for m in arr {
        push_json_msg(&mut messages, m);
    }
    if messages.is_empty() {
        return None;
    }
    let platform = pretty_platform(
        meta.get("platformName")
            .and_then(|s| s.as_str())
            .or_else(|| meta.get("platform").and_then(|s| s.as_str()))
            .unwrap_or(""),
    );
    let title = meta
        .get("title")
        .and_then(|s| s.as_str())
        .map(|t| clip(t.trim(), 80))
        .filter(|t| !t.is_empty())
        .or_else(|| {
            messages
                .iter()
                .find(|m| m.role == "user")
                .map(|m| clip(m.text.lines().next().unwrap_or("Chat").trim(), 80))
        })
        .unwrap_or_else(|| "Chat".into());
    let model = meta
        .get("modelName")
        .or_else(|| meta.get("model"))
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);
    let exported = v
        .get("exportedAt")
        .or_else(|| meta.get("exportedAt"))
        .or_else(|| meta.get("date"))
        .and_then(|s| s.as_str())
        .and_then(ms_of);
    let created = meta
        .get("firstSeenAt")
        .and_then(|s| s.as_str())
        .and_then(ms_of)
        .or(exported);
    let last = meta
        .get("lastSeenAt")
        .and_then(|s| s.as_str())
        .and_then(ms_of)
        .or_else(|| messages.iter().rev().find_map(|m| ms_of(&m.ts)))
        .or(exported);
    Some(Parsed {
        title,
        platform,
        model,
        created_ms: created,
        last_ms: last,
        messages,
    })
}

fn parse_frontmatter(s: &str) -> (std::collections::BTreeMap<String, String>, &str) {
    let mut map = std::collections::BTreeMap::new();
    let rest = s.trim_start_matches('\u{feff}');
    if !rest.starts_with("---") {
        return (map, rest);
    }
    let after = rest[3..].trim_start_matches(['\n', '\r']);
    let Some(end) = after.find("\n---") else {
        return (map, rest);
    };
    let yaml = &after[..end];
    let body = after[end + 4..].trim_start_matches(['\n', '\r']);
    for line in yaml.lines() {
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let mut val = v.trim().to_string();
        if val.len() >= 2
            && ((val.starts_with('"') && val.ends_with('"'))
                || (val.starts_with('\'') && val.ends_with('\'')))
        {
            val = val[1..val.len() - 1].to_string();
        }
        map.insert(k.trim().to_string(), val);
    }
    (map, body)
}

fn unquote_md(s: &str) -> String {
    let lines: Vec<&str> = s.lines().collect();
    if !lines.is_empty()
        && lines
            .iter()
            .filter(|l| !l.trim().is_empty())
            .all(|l| l.starts_with('>'))
    {
        lines
            .iter()
            .map(|l| {
                l.strip_prefix("> ")
                    .or_else(|| l.strip_prefix('>'))
                    .unwrap_or(l)
            })
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string()
    } else {
        s.trim().to_string()
    }
}

fn parse_md(s: &str) -> Option<Parsed> {
    let (meta, body) = parse_frontmatter(s);
    let mut messages = Vec::new();
    let mut heading = String::new();
    let mut buf = String::new();
    let flush = |heading: &str, buf: &str, messages: &mut Vec<Msg>| {
        if heading.is_empty() {
            return;
        }
        let text = unquote_md(buf);
        if text.is_empty() {
            return;
        }
        let h = heading.to_ascii_lowercase();
        if h.contains("thinking") || h.contains("💭") {
            messages.push(Msg::new("assistant", "", clip(&text, 8000), "reasoning"));
            return;
        }
        let role = if h.contains("user") || h.contains("👤") || h.contains("you") {
            "user"
        } else {
            "assistant"
        };
        messages.push(Msg::new(role, "", text, "text"));
    };
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            flush(&heading, &buf, &mut messages);
            heading = rest.trim().to_string();
            buf.clear();
            continue;
        }
        if line.starts_with("### ") && (line.contains("Thinking") || line.contains("💭")) {
            flush(&heading, &buf, &mut messages);
            heading = line.trim_start_matches('#').trim().to_string();
            buf.clear();
            continue;
        }
        if line.starts_with("*🕐") || line.starts_with("*📅") || line.trim() == "---" {
            continue;
        }
        buf.push_str(line);
        buf.push('\n');
    }
    flush(&heading, &buf, &mut messages);
    if messages.is_empty() {
        return None;
    }
    let platform_raw = meta
        .get("platform")
        .or_else(|| meta.get("source_platform"))
        .map(|s| s.as_str())
        .unwrap_or("");
    if platform_raw.trim().is_empty() {
        return None;
    }
    let platform = pretty_platform(platform_raw);
    let title = meta
        .get("title")
        .map(|t| clip(t.trim(), 80))
        .filter(|t| !t.is_empty())
        .or_else(|| {
            messages
                .iter()
                .find(|m| m.role == "user")
                .map(|m| clip(m.text.lines().next().unwrap_or("Chat").trim(), 80))
        })
        .unwrap_or_else(|| "Chat".into());
    let model = meta.get("model").filter(|s| !s.is_empty()).cloned();
    let created = meta
        .get("date")
        .or_else(|| meta.get("exported_at"))
        .and_then(|s| ms_of(s));
    Some(Parsed {
        title,
        platform,
        model,
        created_ms: created,
        last_ms: created,
        messages,
    })
}

/// NousSave full-capsule exports keep chats under `vines`. Some variants only
/// carry them as `capsules[].vine`; prefer the top-level list so the same chat
/// is not imported twice when both representations are present.
fn exported_vines(v: &Value) -> Vec<&Value> {
    if let Some(vines) = v
        .get("vines")
        .and_then(Value::as_array)
        .filter(|v| !v.is_empty())
    {
        return vines.iter().collect();
    }
    v.get("capsules")
        .and_then(Value::as_array)
        .map(|capsules| capsules.iter().filter_map(|c| c.get("vine")).collect())
        .unwrap_or_default()
}

fn parse_file(path: &Path, bytes: &[u8]) -> Result<Parsed, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let text = String::from_utf8_lossy(bytes);
    if ext == "json" || text.trim_start().starts_with('{') {
        let v: Value = serde_json::from_str(text.trim()).map_err(|e| format!("JSON: {e}"))?;
        let vines = exported_vines(&v);
        let chat = if vines.len() == 1 { vines[0] } else { &v };
        parse_json(chat).ok_or_else(|| "No messages in this JSON".into())
    } else if ext == "md" || ext == "markdown" {
        parse_md(&text).ok_or_else(|| "No messages in this Markdown".into())
    } else {
        Err("Use a NousSave .json or .md file".into())
    }
}

pub fn messages(path: &Path) -> Vec<Msg> {
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    parse_file(path, &bytes)
        .map(|p| p.messages)
        .unwrap_or_default()
}

pub fn chat_files() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Some(root) = root() else { return out };
    let Ok(rd) = fs::read_dir(root) else {
        return out;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_file() {
            let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("");
            if matches!(ext, "json" | "md" | "markdown") {
                out.push(p);
            }
        }
    }
    out
}

pub fn scan(out: &mut Vec<OtherChat>) {
    ingest_inbox();
    for p in chat_files() {
        let Ok(bytes) = fs::read(&p) else { continue };
        let Ok(parsed) = parse_file(&p, &bytes) else {
            continue;
        };
        let id = p
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let last = parsed.last_ms.unwrap_or_else(|| mtime(&p));
        out.push(OtherChat {
            provider: "imported",
            id,
            title: parsed.title,
            cwd: None,
            created_ms: parsed.created_ms,
            last_ms: last,
            size: bytes.len() as i64,
            path: format!("imported:{}", p.to_string_lossy()),
            model: parsed.model,
            account: Some(parsed.platform),
        });
    }
}

pub fn fingerprint() -> i64 {
    let stored = chat_files()
        .into_iter()
        .map(|p| mtime(&p))
        .max()
        .unwrap_or(0);
    let drop = inbox().map(|p| mtime(&p)).unwrap_or(0);
    stored.max(drop)
}

pub fn deletable(path: &str) -> Option<PathBuf> {
    let p = PathBuf::from(path.strip_prefix("imported:")?);
    let root = root()?.canonicalize().ok()?;
    let canon = p.canonicalize().ok()?;
    if !canon.starts_with(&root) || !canon.is_file() {
        return None;
    }
    Some(canon)
}

pub fn real_file(path: &str) -> Option<PathBuf> {
    let p = PathBuf::from(path.strip_prefix("imported:")?);
    p.exists().then_some(p)
}

const MAX_WALK: u32 = 3;

fn collect_files(paths: &[String], out: &mut Vec<PathBuf>) {
    for raw in paths {
        collect_one(PathBuf::from(raw), out, 0);
    }
}

fn collect_one(p: PathBuf, out: &mut Vec<PathBuf>, depth: u32) {
    if p.is_file() {
        out.push(p);
        return;
    }
    if !p.is_dir() || depth > MAX_WALK {
        return;
    }
    let Ok(rd) = fs::read_dir(&p) else { return };
    for e in rd.flatten() {
        collect_one(e.path(), out, depth + 1);
    }
}

fn supported_file(p: &Path) -> bool {
    matches!(
        p.extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "json" | "md" | "markdown"
    )
}

/// A cheap persistent identity for the drop folder. File metadata is used
/// rather than contents so a large unchanged export can be skipped without
/// first allocating and parsing it again. Parser upgrades change the version.
fn inbox_fingerprint(dir: &Path) -> Option<String> {
    let mut files = Vec::new();
    collect_one(dir.to_path_buf(), &mut files, 0);
    files.retain(|p| supported_file(p));
    files.sort();
    let mut state = format!("{INBOX_CACHE_VERSION}\n");
    for p in files {
        let meta = fs::metadata(&p).ok()?;
        let modified = meta
            .modified()
            .ok()?
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_nanos();
        state.push_str(&format!(
            "{}\0{}\0{modified}\n",
            p.to_string_lossy(),
            meta.len()
        ));
    }
    Some(fnv1a(state.as_bytes()))
}

/// Return one persistable document per chat. Legacy single-chat exports remain
/// byte-for-byte intact. A full-capsule export is split into its vines so every
/// imported conversation receives its own stable id and file.
fn import_units(path: &Path, bytes: &[u8]) -> Result<Vec<Vec<u8>>, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let text = String::from_utf8_lossy(bytes);
    if ext != "json" && !text.trim_start().starts_with('{') {
        parse_file(path, bytes)?;
        return Ok(vec![bytes.to_vec()]);
    }
    let v: Value = serde_json::from_str(text.trim()).map_err(|e| format!("JSON: {e}"))?;
    let vines = exported_vines(&v);
    if vines.is_empty() {
        parse_json(&v).ok_or_else(|| "No messages in this JSON".to_string())?;
        return Ok(vec![bytes.to_vec()]);
    }
    let mut out = Vec::with_capacity(vines.len());
    for (i, vine) in vines.into_iter().enumerate() {
        parse_json(vine).ok_or_else(|| format!("No messages in chat {} of this JSON", i + 1))?;
        out.push(serde_json::to_vec(vine).map_err(|e| format!("JSON: {e}"))?);
    }
    Ok(out)
}

fn looks_like_noussave(ext: &str, bytes: &[u8]) -> bool {
    let t = String::from_utf8_lossy(bytes);
    if ext == "json" {
        t.contains("\"messages\"") && (t.contains("\"platform\"") || t.contains("\"meta\""))
    } else {
        t.contains("platform:") && t.contains("---")
    }
}

pub fn import_paths(paths: &[String]) -> Result<ImportStats, String> {
    let dir = root().ok_or("No data folder")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    collect_files(paths, &mut files);
    if files.is_empty() {
        return Err("Choose a NousSave .json or .md file, or a folder of them.".into());
    }
    let mut stats = ImportStats::default();
    for p in files {
        let name = p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| p.display().to_string());
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !matches!(ext.as_str(), "json" | "md" | "markdown") {
            continue;
        }
        let meta = match fs::metadata(&p) {
            Ok(m) => m,
            Err(e) => {
                stats.failed.push(format!("{name}: {e}"));
                continue;
            }
        };
        if meta.len() > MAX_BYTES {
            stats.failed.push(format!("{name}: larger than 50 MB"));
            continue;
        }
        let bytes = match fs::read(&p) {
            Ok(b) => b,
            Err(e) => {
                stats.failed.push(format!("{name}: {e}"));
                continue;
            }
        };
        match import_units(&p, &bytes) {
            Ok(units) => {
                for unit in units {
                    let id = fnv1a(&unit);
                    let suffix = if ext == "markdown" {
                        "md"
                    } else {
                        ext.as_str()
                    };
                    let dest = dir.join(format!("{id}.{suffix}"));
                    if dest.exists() {
                        stats.skipped += 1;
                        continue;
                    }
                    if let Err(e) = fs::write(&dest, unit) {
                        stats.failed.push(format!("{name}: {e}"));
                        continue;
                    }
                    stats.added += 1;
                }
            }
            Err(e) => {
                if looks_like_noussave(&ext, &bytes) {
                    stats.failed.push(format!("{name}: {e}"));
                }
            }
        }
    }
    if stats.added == 0 && stats.skipped == 0 && stats.failed.is_empty() {
        return Err("No .json or .md files in that selection.".into());
    }
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "writes into the real ChatVault data folder"]
    fn import_home_downloads() {
        let home = std::env::var("HOME").unwrap_or_default();
        let dir = format!("{home}/Downloads");
        let stats = import_paths(&[dir]).expect("import Downloads");
        println!("{stats:?}");
        assert!(
            stats.added + stats.skipped > 0,
            "expected NousSave files in Downloads"
        );
    }

    #[test]
    fn noussave_json_v2_yields_user_and_assistant() {
        let v = serde_json::json!({
            "version": "2.0.0",
            "exportedAt": "2026-10-16T12:45:06.493Z",
            "meta": { "title": "Check the numbers", "platform": "chatgpt", "platformName": "ChatGPT", "model": "GPT-6 Thinking" },
            "messages": [
                { "role": "user", "content": "Please check the dBmV values." },
                { "role": "ai", "content": "Here is the reading.", "thinking": "Look at the table." }
            ]
        });
        let p = parse_json(&v).unwrap();
        assert_eq!(p.platform, "ChatGPT");
        assert_eq!(p.title, "Check the numbers");
        assert_eq!(p.messages[0].role, "user");
        assert_eq!(p.messages[1].kind, "reasoning");
        assert_eq!(p.messages[2].role, "assistant");
    }

    #[test]
    fn vines_full_capsule_splits_and_reads_each_chat() {
        let vine = |id: &str, title: &str| {
            serde_json::json!({
                "id": id,
                "title": title,
                "platform": "chatgpt",
                "platformName": "ChatGPT",
                "modelName": "GPT-6",
                "firstSeenAt": "2026-10-20T10:00:00Z",
                "lastSeenAt": "2026-10-20T10:01:00Z",
                "messages": [
                    {
                        "role": "user",
                        "capturedAt": "2026-10-20T10:00:00Z",
                        "contentText": "[Image: image omitted]\nQuestion",
                        "htmlContent": "<p><img src=\"data:image/png;base64,aGVsbG8=\"></p>"
                    },
                    { "role": "assistant", "capturedAt": "2026-10-20T10:01:00Z", "contentText": "Answer", "thinking": "Check it" }
                ]
            })
        };
        let first = vine("one", "First chat");
        let v = serde_json::json!({
            "schemaVersion": 2,
            "exportKind": "vines-full-capsule",
            "vines": [first.clone(), vine("two", "Second chat")],
            "capsules": [{ "vine": first }]
        });
        let bytes = serde_json::to_vec(&v).unwrap();
        let units = import_units(Path::new("capsule.json"), &bytes).unwrap();
        assert_eq!(
            units.len(),
            2,
            "top-level vines win over duplicate capsule vines"
        );

        let parsed = parse_file(Path::new("one.json"), &units[0]).unwrap();
        assert_eq!(parsed.title, "First chat");
        assert_eq!(parsed.platform, "ChatGPT");
        assert_eq!(parsed.model.as_deref(), Some("GPT-6"));
        assert_eq!(parsed.messages.len(), 4);
        assert_eq!(parsed.messages[0].kind, "image");
        assert_eq!(
            parsed.messages[0].data.as_ref().and_then(Value::as_str),
            Some("data:image/png;base64,aGVsbG8=")
        );
        assert_eq!(parsed.messages[1].text, "Question");
        assert_eq!(parsed.messages[2].kind, "reasoning");
        assert_eq!(parsed.messages[3].text, "Answer");
        assert_eq!(parsed.created_ms, ms_of("2026-10-20T10:00:00Z"));
        assert_eq!(parsed.last_ms, ms_of("2026-10-20T10:01:00Z"));
    }

    #[test]
    fn inbox_fingerprint_changes_only_with_supported_sources() {
        let dir = std::env::temp_dir().join(format!(
            "chatvault-import-fingerprint-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("chat.json"), "{}").unwrap();
        let first = inbox_fingerprint(&dir).unwrap();
        fs::write(dir.join("README.txt"), "ignored").unwrap();
        assert_eq!(first, inbox_fingerprint(&dir).unwrap());
        fs::write(dir.join("chat.json"), "{\"changed\":true}").unwrap();
        assert_ne!(first, inbox_fingerprint(&dir).unwrap());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn real_noussave_markdown_in_downloads_parses() {
        let home = std::env::var("HOME").unwrap_or_default();
        let p = PathBuf::from(home).join("Downloads/202610161445-chatgpt-Bitte-überprüfe-deine-technische-Interpretation-de-turn-2msg.md");
        if !p.exists() {
            return;
        }
        let bytes = fs::read(&p).unwrap();
        let parsed = parse_file(&p, &bytes).expect("parse real NousSave markdown");
        assert_eq!(parsed.platform, "ChatGPT");
        assert!(parsed.messages.iter().any(|m| m.role == "user"));
        assert!(parsed.messages.iter().any(|m| m.role == "assistant"));
        assert!(parsed.messages.iter().any(|m| m.kind == "reasoning"));
    }

    #[test]
    fn real_vines_capsule_in_inbox_parses() {
        let Some(inbox) = inbox() else { return };
        let Ok(entries) = fs::read_dir(inbox) else {
            return;
        };
        let Some(path) = entries.flatten().map(|entry| entry.path()).find(|path| {
            path.extension().and_then(|ext| ext.to_str()) == Some("json")
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.ends_with("-capsule.json"))
        }) else {
            return;
        };

        let bytes = fs::read(&path).expect("read real NousSave capsule");
        let units = import_units(&path, &bytes).expect("split real NousSave capsule");
        assert!(!units.is_empty());
        let parsed = parse_file(Path::new("vine.json"), &units[0])
            .expect("parse first chat in real NousSave capsule");
        assert_eq!(parsed.platform, "ChatGPT");
        assert!(parsed.messages.len() >= 500);
        assert!(parsed.messages.iter().any(|message| message.role == "user"));
        assert!(
            parsed
                .messages
                .iter()
                .any(|message| message.role == "assistant")
        );
        let images: Vec<&Msg> = parsed
            .messages
            .iter()
            .filter(|message| message.kind == "image")
            .collect();
        assert!(images.len() >= 30);
        assert!(images.iter().all(|message| message
            .data
            .as_ref()
            .and_then(Value::as_str)
            .is_some_and(|src| src.starts_with("data:image/"))));
    }

    #[test]
    fn noussave_markdown_frontmatter_and_quoted_user() {
        let s = "---\ntitle: \"Hello\"\ndate: \"2026-10-16T12:45:06.493Z\"\nplatform: \"ChatGPT\"\nmodel: \"GPT-6\"\n---\n\n## 👤 User\n\n> First question\n\n---\n\n## 🤖 GPT-6\n\nThe answer.\n";
        let p = parse_md(s).unwrap();
        assert_eq!(p.platform, "ChatGPT");
        assert!(parse_md("# No frontmatter\n\n## User\n\nHi\n").is_none());
        assert_eq!(p.messages[0].text, "First question");
        assert_eq!(p.messages[1].role, "assistant");
        assert!(p.messages[1].text.contains("The answer"));
    }
}
