//! Parsers that turn one transcript line into displayable messages, for Claude Code and Codex.

use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize, Clone)]
pub struct Msg {
    pub role: String,
    pub ts: String,
    pub text: String,
    /// text | summary | image | tool | result | reasoning
    pub kind: String,
    /// Tool call id, so a result can be matched to its call.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Tool name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Structured tool input, kept only for the tools the viewer renders specially.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<bool>,
    /// Native database items keep their completed tool output on the same item.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Box<Msg>>,
}

/// Pictures larger than this are shown as a placeholder instead of being sent to the viewer.
const IMAGE_MAX: usize = 4_000_000;

impl Msg {
    pub fn new(role: &str, ts: &str, text: String, kind: &str) -> Msg {
        Msg { role: role.into(), ts: ts.into(), text, kind: kind.into(), id: None, name: None, data: None, error: None, result: None }
    }
}

pub fn clip(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n).collect();
        out.push('…');
        out
    }
}

fn claude_noise(t: &str) -> bool {
    let t = t.trim_start();
    t.starts_with("<system-reminder>")
        || t.starts_with("<local-command")
        || t.starts_with("<command-name>")
        || t.starts_with("<command-message>")
        || t.starts_with("<ide_")
        || t.starts_with("[Request interrupted")
}

const CODEX_NOISE: [&str; 14] = [
    "<environment_context",
    "<codex_internal_context",
    "<in-app-browser-context",
    "<external_codex_apps",
    "<send_user_message",
    "<image",
    "</image>",
    "<user_instructions",
    "<turn_aborted",
    "<permissions",
    "<app-context",
    "# AGENTS.md instructions",
    "# Files mentioned",
    "<collaboration_mode",
];

fn codex_noise(t: &str) -> bool {
    let t = t.trim_start();
    CODEX_NOISE.iter().any(|p| t.starts_with(p))
}

fn first_detail(inp: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|k| inp.get(*k).and_then(|x| x.as_str()))
        .unwrap_or("")
        .lines()
        .next()
        .unwrap_or("")
        .to_string()
}

/// Tools whose input the viewer draws as a terminal, plan, agent or source list.
fn keeps_data(name: &str) -> bool {
    matches!(
        name,
        "Bash" | "TodoWrite" | "Task" | "Agent" | "WebFetch" | "WebSearch" | "update_plan" | "exec_command" | "shell" | "local_shell" | "shell_command"
    )
}

/// Long strings inside tool input are shortened so a chat page stays small.
pub(crate) fn trim_value(v: &Value) -> Value {
    match v {
        Value::String(s) => Value::String(clip(s, 3000)),
        Value::Array(a) => Value::Array(a.iter().take(60).map(trim_value).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, x)| (k.clone(), trim_value(x))).collect()),
        other => other.clone(),
    }
}

/// One Claude Code transcript line.
pub fn claude_messages(v: &Value) -> Vec<Msg> {
    let mut out = Vec::new();
    let ty = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    if ty != "user" && ty != "assistant" {
        return out;
    }
    if v.get("isMeta").and_then(|x| x.as_bool()).unwrap_or(false) {
        return out;
    }
    let ts = v.get("timestamp").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let role = ty.to_string();
    let Some(content) = v.get("message").and_then(|m| m.get("content")) else { return out };
    let push_text = |out: &mut Vec<Msg>, t: &str| {
        if t.trim().is_empty() || (role == "user" && claude_noise(t)) {
            return;
        }
        let kind = if role == "user" && t.starts_with("This session is being continued") { "summary" } else { "text" };
        out.push(Msg::new(&role, &ts, t.to_string(), kind));
    };
    match content {
        Value::String(s) => push_text(&mut out, s),
        Value::Array(blocks) => {
            for b in blocks {
                match b.get("type").and_then(|x| x.as_str()).unwrap_or("") {
                    "text" => {
                        if let Some(t) = b.get("text").and_then(|x| x.as_str()) {
                            push_text(&mut out, t);
                        }
                    }
                    "thinking" => {
                        let t = b.get("thinking").and_then(|x| x.as_str()).unwrap_or("");
                        if !t.trim().is_empty() {
                            out.push(Msg::new(&role, &ts, clip(t, 6000), "reasoning"));
                        }
                    }
                    "image" => {
                        let mut m = Msg::new(&role, &ts, "[Image]".into(), "image");
                        let src = b.get("source");
                        let kind = src.and_then(|s| s.get("type")).and_then(|x| x.as_str()).unwrap_or("");
                        let url = if kind == "base64" {
                            let mt = src.and_then(|s| s.get("media_type")).and_then(|x| x.as_str()).unwrap_or("image/png");
                            src.and_then(|s| s.get("data")).and_then(|x| x.as_str()).map(|d| format!("data:{mt};base64,{d}"))
                        } else {
                            src.and_then(|s| s.get("url")).and_then(|x| x.as_str()).map(|u| u.to_string())
                        };
                        m.data = url.filter(|u| u.len() <= IMAGE_MAX).map(Value::String);
                        out.push(m);
                    }
                    "tool_use" => {
                        let name = b.get("name").and_then(|x| x.as_str()).unwrap_or("tool");
                        let input = b.get("input");
                        let detail = input
                            .map(|i| first_detail(i, &["description", "command", "file_path", "pattern", "url", "query", "prompt"]))
                            .unwrap_or_default();
                        let mut m = Msg::new(&role, &ts, format!("{}: {}", name, clip(&detail, 160)), "tool");
                        m.id = b.get("id").and_then(|x| x.as_str()).map(String::from);
                        m.name = Some(name.to_string());
                        if keeps_data(name) {
                            m.data = input.map(trim_value);
                        }
                        out.push(m);
                    }
                    "tool_result" => {
                        let body = match b.get("content") {
                            Some(Value::String(s)) => s.clone(),
                            Some(Value::Array(a)) => a
                                .iter()
                                .filter_map(|x| x.get("text").and_then(|t| t.as_str()))
                                .collect::<Vec<_>>()
                                .join("\n"),
                            _ => String::new(),
                        };
                        let mut m = Msg::new(&role, &ts, clip(&body, 3000), "result");
                        m.id = b.get("tool_use_id").and_then(|x| x.as_str()).map(String::from);
                        m.error = b.get("is_error").and_then(|x| x.as_bool());
                        out.push(m);
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
    out
}

/// Codex wraps command output as JSON with an exit code; unwrap it when it does.
fn codex_output(raw: &str) -> (String, Option<bool>) {
    if let Ok(v) = serde_json::from_str::<Value>(raw) {
        if let Some(o) = v.get("output").and_then(|x| x.as_str()) {
            let failed = v
                .get("metadata")
                .and_then(|m| m.get("exit_code"))
                .and_then(|c| c.as_i64())
                .map(|c| c != 0);
            return (clip(o, 3000), failed);
        }
    }
    let failed = raw
        .lines()
        .find_map(|l| l.strip_prefix("Exit code: ").or_else(|| l.strip_prefix("Process exited with code ")))
        .and_then(|c| c.trim().parse::<i64>().ok())
        .map(|c| c != 0);
    (clip(raw, 3000), failed)
}

/// One Codex rollout line.
pub fn codex_messages(v: &Value) -> Vec<Msg> {
    let mut out = Vec::new();
    if v.get("type").and_then(|x| x.as_str()) != Some("response_item") {
        return out;
    }
    let Some(p) = v.get("payload") else { return out };
    let ts = v.get("timestamp").and_then(|x| x.as_str()).unwrap_or("").to_string();
    match p.get("type").and_then(|x| x.as_str()).unwrap_or("") {
        "message" => {
            let role = p.get("role").and_then(|x| x.as_str()).unwrap_or("");
            if role != "user" && role != "assistant" {
                return out;
            }
            let Some(blocks) = p.get("content").and_then(|c| c.as_array()) else { return out };
            for b in blocks {
                match b.get("type").and_then(|x| x.as_str()).unwrap_or("") {
                    "input_text" | "output_text" => {
                        let t = b.get("text").and_then(|x| x.as_str()).unwrap_or("");
                        if t.trim().is_empty() || (role == "user" && codex_noise(t)) {
                            continue;
                        }
                        out.push(Msg::new(role, &ts, t.to_string(), "text"));
                    }
                    "input_image" => {
                        let mut m = Msg::new(role, &ts, "[Image]".into(), "image");
                        m.data = b.get("image_url").and_then(|x| x.as_str()).filter(|u| u.len() <= IMAGE_MAX).map(|u| Value::String(u.to_string()));
                        out.push(m);
                    }
                    _ => {}
                }
            }
        }
        "reasoning" => {
            let text = p
                .get("summary")
                .and_then(|s| s.as_array())
                .map(|a| a.iter().filter_map(|x| x.get("text").and_then(|t| t.as_str())).collect::<Vec<_>>().join("\n\n"))
                .unwrap_or_default();
            if !text.trim().is_empty() {
                out.push(Msg::new("assistant", &ts, clip(&text, 6000), "reasoning"));
            }
        }
        "function_call" => {
            let name = p.get("name").and_then(|x| x.as_str()).unwrap_or("tool");
            let args = p.get("arguments").and_then(|x| x.as_str()).unwrap_or("");
            let parsed = serde_json::from_str::<Value>(args).ok();
            let detail = parsed
                .as_ref()
                .map(|a| first_detail(a, &["cmd", "command", "path", "query", "url", "explanation"]))
                .unwrap_or_else(|| args.lines().next().unwrap_or("").to_string());
            let mut m = Msg::new("assistant", &ts, format!("{}: {}", name, clip(&detail, 160)), "tool");
            m.id = p.get("call_id").and_then(|x| x.as_str()).map(String::from);
            m.name = Some(name.to_string());
            if keeps_data(name) {
                m.data = parsed.as_ref().map(trim_value);
            }
            out.push(m);
        }
        "custom_tool_call" => {
            let name = p.get("name").and_then(|x| x.as_str()).unwrap_or("tool");
            let input = p.get("input").and_then(|x| x.as_str()).unwrap_or("");
            let mut m = Msg::new("assistant", &ts, format!("{}: {}", name, clip(input.lines().next().unwrap_or(""), 160)), "tool");
            m.id = p.get("call_id").and_then(|x| x.as_str()).map(String::from);
            m.name = Some(name.to_string());
            m.data = Some(json!({ "cmd": clip(input, 3000) }));
            out.push(m);
        }
        "function_call_output" | "custom_tool_call_output" => {
            let raw = p.get("output").and_then(|x| x.as_str()).unwrap_or("");
            let (text, failed) = codex_output(raw);
            let mut m = Msg::new("assistant", &ts, text, "result");
            m.id = p.get("call_id").and_then(|x| x.as_str()).map(String::from);
            m.error = failed;
            out.push(m);
        }
        _ => {}
    }
    out
}

pub fn messages_for(provider: &str, v: &Value) -> Vec<Msg> {
    if provider == "codex" {
        codex_messages(v)
    } else {
        claude_messages(v)
    }
}

/// Kinds that carry readable conversation, as opposed to tool traffic.
pub fn is_readable(m: &Msg) -> bool {
    matches!(m.kind.as_str(), "text" | "summary" | "image")
}
