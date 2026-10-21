//! Which tools ChatVault looks at. All of them are on by default. A tool that is switched off is ignored: its chats
//! are not read, listed, counted or backed up. Nothing of the tool's own is touched or deleted, and ChatVault's own
//! notes about its chats (tags, pins, archive) are kept, so switching it back on brings everything back.

use crate::paths::data_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::RwLock;

pub const ALL: [&str; 8] = ["claude", "codex", "cursor", "gemini", "opencode", "cline", "grok", "imported"];

#[derive(Serialize, Deserialize, Default, Clone)]
struct Config {
    disabled: Vec<String>,
}

static STATE: RwLock<Option<Config>> = RwLock::new(None);

fn file() -> Option<std::path::PathBuf> {
    data_dir().map(|d| d.join("integrations.json"))
}

fn config() -> Config {
    if let Ok(g) = STATE.read() {
        if let Some(c) = g.as_ref() {
            return c.clone();
        }
    }
    let loaded = file()
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str::<Config>(&s).ok())
        .unwrap_or_default();
    if let Ok(mut g) = STATE.write() {
        *g = Some(loaded.clone());
    }
    loaded
}

/// The tools that are switched off.
pub fn disabled() -> Vec<String> {
    config().disabled
}

pub fn is_enabled(provider: &str) -> bool {
    !config().disabled.iter().any(|p| p == provider)
}

/// The list of switched-off tools after one tool is switched on or off.
fn toggled(mut off: Vec<String>, provider: &str, enabled: bool) -> Vec<String> {
    off.retain(|p| p != provider);
    if !enabled {
        off.push(provider.to_string());
    }
    off
}

/// Switches a tool on or off.
pub fn set(provider: &str, enabled: bool) -> Result<(), String> {
    if !ALL.contains(&provider) {
        return Err("Unknown tool".into());
    }
    let mut c = config();
    c.disabled = toggled(c.disabled, provider, enabled);
    let f = file().ok_or("No place to keep settings")?;
    if let Some(dir) = f.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = f.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(&c).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &f).map_err(|e| e.to_string())?;
    if let Ok(mut g) = STATE.write() {
        *g = Some(c);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn switching_a_tool_off_and_on_changes_only_that_tool() {
        let off = toggled(Vec::new(), "cursor", false);
        assert_eq!(off, ["cursor"]);
        let off = toggled(off, "cursor", false);
        assert_eq!(off, ["cursor"], "switching off twice does not list it twice");
        let off = toggled(off, "gemini", false);
        assert_eq!(off, ["cursor", "gemini"]);
        let off = toggled(off, "cursor", true);
        assert_eq!(off, ["gemini"]);
        assert!(set("not-a-tool", false).is_err(), "only the known tools can be switched");
    }
}
