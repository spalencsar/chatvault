//! Grok Build / Grok CLI chats under `~/.grok/sessions/<cwd>/<id>/chat_history.jsonl`.

use crate::others::OtherChat;
use crate::paths::*;
use crate::providers::{clip, Msg};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn grok_home() -> Option<PathBuf> {
    env_path("GROK_HOME").or_else(|| home().map(|h| h.join(".grok")))
}

/// Folder that holds one directory per workspace (URL-encoded cwd).
pub fn sessions_root() -> Option<PathBuf> {
    grok_home().map(|h| h.join("sessions"))
}

fn mtime(p: &Path) -> i64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn ms_of(iso: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(iso).ok().map(|d| d.timestamp_millis())
}

fn walk_named(root: &Path, name: &str, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk_named(&p, name, out);
        } else if p.file_name().is_some_and(|n| n == name) {
            out.push(p);
        }
    }
}

pub fn chat_files() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(root) = sessions_root() {
        walk_named(&root, "chat_history.jsonl", &mut out);
    }
    out
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(p).ok()?).ok()
}

fn flatten_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().filter_map(|p| p.get("text").and_then(|t| t.as_str()).map(String::from).or_else(|| {
            if p.get("type").and_then(|t| t.as_str()) == Some("text") {
                p.get("text").and_then(|t| t.as_str()).map(String::from)
            } else {
                None
            }
        })).collect::<Vec<_>>().join("\n"),
        Value::Object(o) => o.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string(),
        _ => String::new(),
    }
}

fn extract_tag(s: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let a = s.find(&open)?;
    let rest = &s[a + open.len()..];
    let b = rest.find(&close)?;
    Some(rest[..b].to_string())
}

fn grok_user_text(content: &Value) -> Option<String> {
    let raw = flatten_text(content);
    if raw.trim().is_empty() {
        return None;
    }
    if let Some(q) = extract_tag(&raw, "user_query") {
        let q = q.trim();
        if q.is_empty() {
            return None;
        }
        return Some(q.to_string());
    }
    if raw.contains("<user_info>") && (raw.contains("<rules>") || raw.contains("<user_rules>")) {
        return None;
    }
    Some(raw)
}

fn push_tool(out: &mut Vec<Msg>, ts: &str, call: &Value) {
    let name = call.get("name").or_else(|| call.get("tool_name")).and_then(|n| n.as_str()).unwrap_or("tool").to_string();
    let id = call.get("id").or_else(|| call.get("tool_call_id")).and_then(|n| n.as_str()).map(String::from);
    let mut tool = Msg::new("assistant", ts, format!("{name}:"), "tool");
    tool.name = Some(name);
    tool.id = id;
    tool.data = call.get("arguments").cloned().or_else(|| call.get("input").cloned());
    out.push(tool);
}

pub fn messages(path: &Path) -> Vec<Msg> {
    let Some(lines) = open_lines(path) else { return Vec::new() };
    let mut out = Vec::new();
    for line in lines {
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        let kind = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let ts = v.get("timestamp").and_then(|t| t.as_str()).unwrap_or("").to_string();
        match kind {
            "system" => {}
            "user" => {
                if let Some(t) = v.get("content").and_then(grok_user_text) {
                    out.push(Msg::new("user", &ts, t, "text"));
                }
            }
            "assistant" => {
                let t = flatten_text(v.get("content").unwrap_or(&Value::Null));
                if !t.trim().is_empty() {
                    out.push(Msg::new("assistant", &ts, t, "text"));
                }
                if let Some(calls) = v.get("tool_calls").and_then(|c| c.as_array()) {
                    for call in calls {
                        push_tool(&mut out, &ts, call);
                    }
                }
            }
            "function_tool_call" | "tool_call" => push_tool(&mut out, &ts, &v),
            "tool_result" => {
                let raw = v.get("content").cloned().unwrap_or(Value::Null);
                let text = match &raw {
                    Value::String(s) => s.clone(),
                    Value::Array(a) => a.iter().filter_map(|x| x.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().join("\n"),
                    other if !other.is_null() => clip(&other.to_string(), 4000),
                    _ => String::new(),
                };
                if !text.trim().is_empty() {
                    let mut res = Msg::new("assistant", &ts, clip(&text, 8000), "result");
                    res.id = v.get("tool_call_id").or_else(|| v.get("id")).and_then(|n| n.as_str()).map(String::from);
                    out.push(res);
                }
            }
            "reasoning" => {
                if v.get("encrypted_content").is_some() && v.get("content").is_none() && v.get("text").is_none() {
                    continue;
                }
                let t = v.get("content").or_else(|| v.get("text")).map(flatten_text).unwrap_or_default();
                if !t.trim().is_empty() {
                    out.push(Msg::new("assistant", &ts, clip(&t, 6000), "reasoning"));
                }
            }
            _ => {}
        }
    }
    out
}

pub fn scan(out: &mut Vec<OtherChat>) {
    for p in chat_files() {
        let msgs = messages(&p);
        if msgs.is_empty() {
            continue;
        }
        let dir = p.parent().unwrap_or(&p);
        let id = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let summary = read_json(&dir.join("summary.json"));
        let info = summary.as_ref().and_then(|s| s.get("info"));
        let title = summary
            .as_ref()
            .and_then(|s| s.get("generated_title").or_else(|| s.get("session_summary")).or_else(|| s.get("last_turn_summary")).and_then(|t| t.as_str()))
            .map(|t| clip(t.trim(), 80))
            .filter(|t| !t.is_empty() && !t.starts_with('<'))
            .or_else(|| {
                msgs.iter().find(|m| m.role == "user").and_then(|m| {
                    m.text.lines().find(|l| {
                        let t = l.trim();
                        !t.is_empty() && !t.starts_with('<')
                    }).map(|l| clip(l.trim(), 80))
                })
            })
            .unwrap_or_else(|| "Chat".into());
        let cwd = info.and_then(|i| i.get("cwd")).and_then(|c| c.as_str()).map(String::from);
        let created = summary.as_ref().and_then(|s| s.get("created_at")).and_then(|t| t.as_str()).and_then(ms_of);
        let last = summary
            .as_ref()
            .and_then(|s| s.get("last_active_at").or_else(|| s.get("updated_at")))
            .and_then(|t| t.as_str())
            .and_then(ms_of)
            .unwrap_or_else(|| mtime(&p));
        let model = summary.as_ref().and_then(|s| s.get("current_model_id")).and_then(|t| t.as_str()).map(String::from);
        out.push(OtherChat {
            provider: "grok",
            id,
            title,
            cwd,
            created_ms: created,
            last_ms: last,
            size: fs::metadata(&p).map(|m| m.len() as i64).unwrap_or(0),
            path: format!("grok:{}", p.to_string_lossy()),
            model,
            account: None,
        });
    }
}

pub fn fingerprint() -> i64 {
    chat_files().into_iter().map(|p| mtime(&p)).max().unwrap_or(0)
}

pub fn deletable(path: &str) -> Option<PathBuf> {
    let p = PathBuf::from(path.strip_prefix("grok:")?);
    let listed = chat_files().into_iter().find(|f| matches!((f.canonicalize(), p.canonicalize()), (Ok(a), Ok(b)) if a == b))?;
    Some(listed.parent().map(Path::to_path_buf).unwrap_or(listed))
}

pub fn real_file(path: &str) -> Option<PathBuf> {
    let p = PathBuf::from(path.strip_prefix("grok:")?);
    p.exists().then_some(p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_query_is_taken_from_the_tag_and_scaffolding_is_dropped() {
        let v = serde_json::json!([{"type":"text","text":"<user_info>os</user_info>\n<user_query>fix the font</user_query>"}]);
        assert_eq!(grok_user_text(&v).as_deref(), Some("fix the font"));
        let skip = serde_json::json!("<user_info>os</user_info>\n<rules>be kind</rules>");
        assert!(grok_user_text(&skip).is_none());
    }
}
