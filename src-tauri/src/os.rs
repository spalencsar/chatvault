//! Folder open, recycle, hidden processes and a new terminal — Windows and Linux.

use std::path::Path;
use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Hide a child console on Windows. On Linux the process is left as it is.
pub fn hide(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn open_dir(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer").arg(path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open").arg(path).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Reveal a file in the file manager (select it on Windows; open its folder on Linux).
pub fn reveal_file(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let parent = path.parent().filter(|p| p.is_dir()).unwrap_or(path);
        Command::new("xdg-open").arg(parent).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer").arg(path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open").arg(path).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Recycle Bin on Windows, trash on Linux (`gio trash`, then `trash-put`).
pub fn recycle(target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let plain = target.to_string_lossy().trim_start_matches(r"\\?\").to_string();
        let script = if target.is_dir() {
            "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:CHATVAULT_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')"
        } else {
            "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:CHATVAULT_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')"
        };
        let status = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("CHATVAULT_PATH", &plain)
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() || Path::new(&plain).exists() {
            return Err("It could not be moved to the Recycle Bin".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let arg = target.as_os_str();
        let gio = Command::new("gio").args(["trash", "--"]).arg(arg).status();
        let ok = match gio {
            Ok(s) if s.success() => true,
            _ => Command::new("trash-put").arg(arg).status().map(|s| s.success()).unwrap_or(false),
        };
        if !ok || target.exists() {
            return Err("It could not be moved to the trash".into());
        }
        Ok(())
    }
}

pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        let _ = hide(&mut c).status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("pkill").args(["-TERM", "-P", &pid.to_string()]).status();
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    }
}

/// Open a new terminal in `dir` and run `script` (PowerShell on Windows, bash on Linux).
pub fn launch_terminal(script: &Path, dir: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let shell = crate::cli::powershell();
        Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg("")
            .arg(shell.get_program())
            .args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-File"])
            .arg(script)
            .current_dir(dir)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Could not open terminal: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let inner = format!("bash -- '{}' ; echo; exec bash", script.display().to_string().replace('\'', "'\\''"));
        let dir_s = dir.to_string_lossy().to_string();
        let tries: [(&str, Vec<String>); 4] = [
            ("alacritty", vec!["--working-directory".into(), dir_s.clone(), "-e".into(), "bash".into(), "-lc".into(), inner.clone()]),
            ("kitty", vec!["--directory".into(), dir_s.clone(), "bash".into(), "-lc".into(), inner.clone()]),
            ("foot", vec!["-D".into(), dir_s.clone(), "bash".into(), "-lc".into(), inner.clone()]),
            ("xdg-terminal-exec", vec!["bash".into(), "-lc".into(), format!("cd '{}' && {inner}", dir_s.replace('\'', "'\\''"))]),
        ];
        for (bin, args) in tries {
            let mut c = Command::new(bin);
            c.args(&args).current_dir(dir);
            if c.spawn().is_ok() {
                return Ok(());
            }
        }
        Err("Could not open a terminal. Install Alacritty, Kitty or Foot.".into())
    }
}

pub fn open_url(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("cmd").args(["/C", "start", "", url]).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open").arg(url).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}
