//! CLI checks and explicit, user-initiated installation for the Continue menu.
use serde::Serialize;
use std::os::windows::process::CommandExt;
use std::{
    fs,
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    tool: String,
    name: &'static str,
    installed: bool,
    pub(crate) ready: bool,
    pub(crate) path: Option<String>,
    version: Option<String>,
    pub(crate) error: Option<String>,
    install_command: &'static str,
    docs_url: &'static str,
    prerequisite: Option<String>,
    desktop_path: Option<String>,
}

struct Tool {
    name: &'static str,
    commands: &'static [&'static str],
    install: &'static str,
    docs: &'static str,
    npm: bool,
}
fn tool(id: &str) -> Result<Tool, String> {
    Ok(match id {
        "claude" => Tool {
            name: "Claude Code",
            commands: &["claude"],
            install: "irm https://claude.ai/install.ps1 | iex",
            docs: "https://code.claude.com/docs/en/setup",
            npm: false,
        },
        "codex" => Tool {
            name: "Codex",
            commands: &["codex"],
            install: "irm https://chatgpt.com/codex/install.ps1 | iex",
            docs: "https://learn.chatgpt.com/docs/codex/cli",
            npm: false,
        },
        "gemini" => Tool {
            name: "Gemini CLI",
            commands: &["gemini"],
            install: "npm install -g @google/gemini-cli@latest",
            docs: "https://geminicli.com/docs/get-started/installation/",
            npm: true,
        },
        "cursor" => Tool {
            name: "Cursor Agent",
            commands: &["cursor-agent", "agent"],
            install: "irm 'https://cursor.com/install?win32=true' | iex",
            docs: "https://cursor.com/docs/cli/installation",
            npm: false,
        },
        "opencode" => Tool {
            name: "OpenCode",
            commands: &["opencode"],
            install: "npm install -g opencode-ai@latest",
            docs: "https://opencode.ai/docs/",
            npm: true,
        },
        "cline" => Tool {
            name: "Cline",
            commands: &["cline"],
            install: "npm install -g cline@latest",
            docs: "https://docs.cline.bot/getting-started/installing-cline",
            npm: true,
        },
        _ => return Err("Unknown CLI".into()),
    })
}

// A running GUI may have inherited PATH before a CLI was installed. Preserve it,
// and include the current persisted PATH plus the vendors' standard user folders.
pub const ENVIRONMENT: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:Path = ($env:Path, [Environment]::GetEnvironmentVariable('Path','User'), [Environment]::GetEnvironmentVariable('Path','Machine'), "$env:USERPROFILE\.local\bin", "$env:APPDATA\npm", "$env:LOCALAPPDATA\cursor-agent", "$env:LOCALAPPDATA\Programs\OpenAI\Codex\bin") -join ';'
function Find-Cli($names) {
    foreach ($name in $names) {
        foreach ($ext in @('.exe', '.cmd', '.ps1', '')) {
            $c = Get-Command ($name + $ext) -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($c) { return $c.Source }
        }
    }
    $npm = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($npm) {
        try {
            $prefix = & $npm.Source config get prefix 2>$null | Select-Object -Last 1
            if ($prefix -and (Test-Path -LiteralPath $prefix -PathType Container)) {
                foreach ($name in $names) {
                    foreach ($ext in @('.exe','.cmd','.ps1')) {
                        $candidate = Join-Path $prefix ($name + $ext)
                        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
                    }
                }
            }
        } catch { }
    }
}
"#;

pub fn powershell() -> Command {
    let exe = std::env::var_os("SystemRoot")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| "C:\\Windows".into())
        .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let mut c = Command::new(exe);
    c.args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"]);
    c.creation_flags(0x08000000);
    c
}

pub fn script_file(script: &str) -> Result<std::path::PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let path =
        std::env::temp_dir().join(format!("chatvault-cli-{}-{stamp}.ps1", std::process::id()));
    // Windows PowerShell needs a BOM to read non-ASCII prompts in UTF-8 scripts.
    fs::write(&path, format!("\u{feff}{script}")).map_err(|e| e.to_string())?;
    Ok(path)
}

fn run(script: &str, timeout: Duration) -> Result<String, String> {
    let path = script_file(script)?;
    let stdout = path.with_extension("stdout.log");
    let stderr = path.with_extension("stderr.log");
    let mut child = powershell()
        .args(["-NonInteractive", "-File"])
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(fs::File::create(&stdout).map_err(|e| e.to_string())?)
        .stderr(fs::File::create(&stderr).map_err(|e| e.to_string())?)
        .spawn()
        .map_err(|e| format!("Could not start PowerShell: {e}"))?;
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if start.elapsed() > timeout {
            // Stop only this operation's process tree, including installer children.
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .creation_flags(0x08000000)
                .status();
            let _ = child.wait();
            return Err("CLI operation timed out. Check the installation and try again.".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let out = fs::read(&stdout).unwrap_or_default();
    let err = fs::read(&stderr).unwrap_or_default();
    if status.success() {
        Ok(String::from_utf8_lossy(&out).trim().to_string())
    } else {
        let text = format!(
            "{}\n{}",
            String::from_utf8_lossy(&err),
            String::from_utf8_lossy(&out)
        );
        let detail = text
            .chars()
            .rev()
            .take(4000)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>()
            .trim()
            .to_string();
        Err(if detail.is_empty() {
            format!("CLI exited with {status}")
        } else {
            detail
        })
    }
}

fn resolve(commands: &[&str]) -> Result<Option<String>, String> {
    let names = commands
        .iter()
        .map(|c| format!("'{c}'"))
        .collect::<Vec<_>>()
        .join(",");
    let path = run(
        &format!("{ENVIRONMENT}\n$p = Find-Cli @({names}); if ($p) {{ Write-Output $p }}"),
        Duration::from_secs(10),
    )?;
    Ok((!path.is_empty()).then_some(path))
}

fn desktop(id: &str) -> Result<(Option<String>, Option<String>), String> {
    // Desktop registration is evidence of an app, not evidence that its CLI is usable.
    // Only explicitly named bundled agent binaries are eligible for terminal launches.
    let (pattern, folders, binary) = match id {
        "codex" => (
            "OpenAI.Codex|OpenAI.ChatGPT-Desktop",
            "@('$env:LOCALAPPDATA\\Programs\\OpenAI\\Codex')",
            "codex.exe",
        ),
        "claude" => (
            "^Claude$|Claude Code",
            "@('$env:LOCALAPPDATA\\AnthropicClaude','$env:LOCALAPPDATA\\Programs\\Claude')",
            "claude.exe",
        ),
        "cursor" => (
            "^Cursor",
            "@('$env:LOCALAPPDATA\\Programs\\cursor')",
            "cursor-agent.exe",
        ),
        "opencode" => (
            "OpenCode",
            "@('$env:LOCALAPPDATA\\Programs\\OpenCode','$env:LOCALAPPDATA\\OpenCode')",
            "opencode-cli.exe",
        ),
        "cline" => (
            "Cline",
            "@('$env:LOCALAPPDATA\\Programs\\Cline')",
            "cline.exe",
        ),
        _ => return Ok((None, None)),
    };
    let folders = folders.replace("'", "\"");
    let script = format!(
        r#"{ENVIRONMENT}
$roots = @({folders} | Where-Object {{ Test-Path -LiteralPath $_ -PathType Container }})
$packages = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object {{ $_.Name -match '{pattern}' }})
$roots += @($packages | ForEach-Object {{ $_.InstallLocation }})
foreach ($reg in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*')) {{
    $roots += @(Get-ItemProperty $reg -ErrorAction SilentlyContinue | Where-Object {{ $_.DisplayName -match '{pattern}' -and $_.InstallLocation }} | ForEach-Object {{ $_.InstallLocation }})
}}
$app = $roots | Select-Object -First 1
$cli = $null
foreach ($root in $roots) {{
    foreach ($relative in @('app\resources\{binary}','resources\{binary}','{binary}')) {{
        # The top-level Claude/Cline executable may be a GUI, so never probe it as a CLI.
        if ('{id}' -in @('claude','cline') -and $relative -eq '{binary}') {{ continue }}
        $candidate = Join-Path $root $relative
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {{ $cli=$candidate; break }}
    }}
    if ($cli) {{ break }}
}}
@{{ desktop=$app; cli=$cli }} | ConvertTo-Json -Compress
"#
    );
    let raw = run(&script, Duration::from_secs(15))?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok((
        v.get("desktop").and_then(|p| p.as_str()).map(String::from),
        v.get("cli").and_then(|p| p.as_str()).map(String::from),
    ))
}

pub fn status(id: &str) -> Result<CliStatus, String> {
    let t = tool(id)?;
    let mut path = configured(id)
        .filter(|p| std::path::Path::new(p).is_file())
        .or(resolve(t.commands)?);
    let desktop_path = if path.is_none() {
        let (app, bundled) = desktop(id)?;
        path = bundled;
        app
    } else {
        None
    };
    let mut result = CliStatus {
        tool: id.into(),
        name: t.name,
        installed: path.is_some(),
        ready: false,
        path: path.clone(),
        version: None,
        error: None,
        install_command: t.install,
        docs_url: t.docs,
        prerequisite: None,
        desktop_path,
    };
    if let Some(path) = path {
        let path = crate::ps_single_quoted_inner(&path);
        match run(
            &format!(
                "{ENVIRONMENT}\n& '{path}' --version\nif ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}"
            ),
            Duration::from_secs(20),
        ) {
            Ok(v) if !v.is_empty() => {
                result.ready = true;
                result.version = Some(v.chars().take(300).collect());
                if let Err(error) = check_startup(id, &path) {
                    result.ready = false;
                    result.error = Some(error);
                }
            }
            Ok(_) => result.error = Some(
                "The CLI did not return a version. Open its setup instructions or retry the check."
                    .into(),
            ),
            Err(e) => result.error = Some(e),
        }
    } else if t.npm {
        if resolve(&["npm"])?.is_none() || resolve(&["node"])?.is_none() {
            result.prerequisite = Some("Install Node.js 22 LTS or newer, then check again.".into());
        } else {
            let version = run(
                &format!("{ENVIRONMENT}\n& (Find-Cli @('node')) --version"),
                Duration::from_secs(10),
            )?;
            let major = version
                .trim_start_matches('v')
                .split('.')
                .next()
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(0);
            if major < 22 {
                result.prerequisite = Some(format!(
                    "Node.js {version} was found. Install Node.js 22 LTS or newer, then check again."
                ));
            }
        }
    }
    Ok(result)
}

// A version probe can succeed even when OpenCode cannot open its local database.
// Newer versions expose a non-TUI startup diagnostic, which surfaces those errors.
fn check_startup(id: &str, quoted_path: &str) -> Result<(), String> {
    if id != "opencode" { return Ok(()); }
    let help = run(
        &format!("{ENVIRONMENT}\n& '{quoted_path}' debug --help\nif ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}"),
        Duration::from_secs(20),
    )?;
    if !help.contains("debug info") { return Ok(()); }
    run(
        &format!("{ENVIRONMENT}\n& '{quoted_path}' debug info\nif ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}"),
        Duration::from_secs(20),
    ).map(|_| ()).map_err(|error| format!("OpenCode was found, but its startup check failed:\n{error}\nUpdate OpenCode using its official setup instructions, then check again."))
}

fn config_file() -> Result<std::path::PathBuf, String> {
    Ok(crate::paths::data_dir()
        .ok_or("No application data directory")?
        .join("cli-paths.json"))
}
fn configured(id: &str) -> Option<String> {
    let values: std::collections::BTreeMap<String, String> =
        serde_json::from_slice(&fs::read(config_file().ok()?).ok()?).ok()?;
    values.get(id).cloned()
}
#[tauri::command]
pub async fn set_cli_path(tool: String, path: String) -> Result<CliStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        self::tool(&tool)?;
        let executable = std::path::Path::new(&path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let ext = executable
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !executable.is_file() || !["exe", "cmd", "ps1"].contains(&ext.as_str()) {
            return Err("Choose a CLI executable or command script (.exe, .cmd, or .ps1).".into());
        }
        let file = config_file()?;
        let mut values: std::collections::BTreeMap<String, String> = fs::read(&file)
            .ok()
            .and_then(|s| serde_json::from_slice(&s).ok())
            .unwrap_or_default();
        values.insert(
            tool.clone(),
            executable
                .to_string_lossy()
                .trim_start_matches(r"\\?\")
                .to_string(),
        );
        fs::create_dir_all(file.parent().ok_or("Missing application data directory")?)
            .map_err(|e| e.to_string())?;
        fs::write(
            file,
            serde_json::to_vec_pretty(&values).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        status(&tool)
    })
    .await
    .map_err(|e| e.to_string())?
}

static INSTALLING: Mutex<()> = Mutex::new(());
#[tauri::command]
pub async fn cli_status(tool: String) -> Result<CliStatus, String> {
    tauri::async_runtime::spawn_blocking(move || status(&tool))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn install_cli(tool: String) -> Result<CliStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = INSTALLING.try_lock().map_err(|_| "Another CLI installation is already running")?;
        let t = self::tool(&tool)?;
        let before = status(&tool)?;
        if before.ready { return Ok(before); }
        if before.installed { return Err("This CLI is installed but cannot start. Check its error and setup instructions before reinstalling.".into()); }
        if let Some(p) = before.prerequisite { return Err(p); }
        let command = if t.npm { t.install.replacen("npm ", "& (Find-Cli @('npm')) ", 1) } else { t.install.into() };
        let setup = if tool == "codex" { "$env:CODEX_NON_INTERACTIVE='1'" } else { "" };
        run(&format!("{ENVIRONMENT}\n{setup}\n{command}\nif ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}"), Duration::from_secs(600))?;
        let after = status(&tool)?;
        if !after.ready { return Err(after.error.unwrap_or_else(|| "Installation finished, but the CLI was not found. Check the official setup instructions.".into())); }
        Ok(after)
    }).await.map_err(|e| e.to_string())?
}

pub fn launch_script(path: &str, arguments: &str, receipt: &str) -> String {
    let path = crate::ps_single_quoted_inner(path);
    let receipt = crate::ps_single_quoted_inner(receipt);
    format!(
        r#"{ENVIRONMENT}
try {{
    Write-Host 'Starting CLI. Complete sign-in in this window if requested.'
    & '{path}' {arguments}
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {{ throw "CLI exited with code $LASTEXITCODE. Review the output above." }}
}} catch {{
    $message = $_.Exception.Message
    Write-Host "ChatVault could not continue this chat: $message" -ForegroundColor Red
    [IO.File]::WriteAllText('{receipt}', $message)
}}
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opencode_startup_failure_blocks_version_only_readiness() {
        let fixture = script_file("param($command,$option)\nif ($option -eq '--help') { Write-Output 'opencode debug info'; exit 0 }\n[Console]::Error.WriteLine('no such column: name'); exit 1").unwrap();
        let quoted = crate::ps_single_quoted_inner(&fixture.to_string_lossy());
        let error = check_startup("opencode", &quoted).unwrap_err();
        assert!(error.contains("startup check failed"));
        assert!(error.contains("no such column: name"));
        assert!(check_startup("claude", "missing.exe").is_ok());
    }
    #[test]
    fn opencode_without_new_diagnostic_keeps_legacy_support() {
        let fixture = script_file("Write-Output 'opencode debug config'; exit 0").unwrap();
        assert!(check_startup("opencode", &crate::ps_single_quoted_inner(&fixture.to_string_lossy())).is_ok());
    }
    #[test]
    fn command_discovery_handles_another_install_path() {
        let dir = script_file("")
            .unwrap()
            .with_extension("fixture")
            .join("Other User 非ASCII #100%");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("chatvault-portable-fixture.cmd"),
            "@echo portable-cli 1.0\r\n",
        )
        .unwrap();
        let script = format!(
            "{ENVIRONMENT}\n$env:Path = '{}' + ';' + $env:Path\n$p = Find-Cli @('chatvault-portable-fixture'); if (!$p) {{ throw 'not found' }}; & $p --version",
            crate::ps_single_quoted_inner(&dir.to_string_lossy())
        );
        assert_eq!(
            run(&script, Duration::from_secs(15)).unwrap(),
            "portable-cli 1.0"
        );
    }
    #[test]
    fn installers_are_allowlisted_and_unknown_tools_fail() {
        assert!(tool("cline; Write-Host injected").is_err());
        for id in ["claude", "codex", "gemini", "cursor", "opencode", "cline"] {
            let t = tool(id).unwrap();
            assert!(t.docs.starts_with("https://"));
            assert!(!t.commands.is_empty());
        }
    }
    #[test]
    fn launch_quotes_paths_and_preserves_prompt_arguments() {
        let script = launch_script("C:\\O'Brien\\tool.cmd", "'hello'", "C:\\O'Brien\\error.txt");
        assert!(script.contains("& 'C:\\O''Brien\\tool.cmd' 'hello'"));
        assert!(script.contains("WriteAllText('C:\\O''Brien\\error.txt'"));
        assert!(script.contains("CLI exited with code"));
    }
    #[test]
    fn subprocess_preserves_unicode_and_reports_nonzero_exit() {
        assert_eq!(run("[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); Write-Output 'ready \u{03b1}'", Duration::from_secs(10)).unwrap(), "ready \u{03b1}");
        let error = run(
            "[Console]::Error.WriteLine('broken CLI'); exit 7",
            Duration::from_secs(10),
        )
        .unwrap_err();
        assert!(error.contains("broken CLI"));
    }
    #[test]
    fn hung_checks_are_bounded() {
        let before = Instant::now();
        assert!(
            run("Start-Sleep -Seconds 30", Duration::from_millis(400))
                .unwrap_err()
                .contains("timed out")
        );
        assert!(before.elapsed() < Duration::from_secs(8));
    }
    #[test]
    fn failed_launch_leaves_an_actionable_receipt() {
        let executable = script_file("throw 'fixture launch failure'").unwrap();
        let receipt = executable.with_extension("error.txt");
        run(
            &launch_script(
                &executable.to_string_lossy(),
                "'safe argument'",
                &receipt.to_string_lossy(),
            ),
            Duration::from_secs(10),
        )
        .unwrap();
        assert!(
            fs::read_to_string(receipt)
                .unwrap()
                .contains("fixture launch failure")
        );
    }
    #[test]
    #[ignore = "diagnostic check of CLIs installed on the current Windows machine"]
    fn installed_cli_checks() {
        for id in ["claude", "codex", "gemini", "cursor", "opencode", "cline"] {
            println!("{}", serde_json::to_string(&status(id).unwrap()).unwrap());
        }
    }
    #[test]
    #[ignore = "read-only check of a Microsoft Store bundled CLI on this PC"]
    fn desktop_bundled_cli_is_usable() {
        let (app, cli) = desktop("codex").unwrap();
        assert!(app.is_some());
        let cli = cli.unwrap();
        let version = run(
            &format!(
                "{ENVIRONMENT}\n& '{}' --version",
                crate::ps_single_quoted_inner(&cli)
            ),
            Duration::from_secs(20),
        )
        .unwrap();
        assert!(version.contains("codex"));
        println!("Microsoft Store Codex bundled CLI: {version}");
    }
}
