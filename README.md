<div align="center">

<img src="app-icon.png" alt="ChatVault" width="96" height="96" />

# ChatVault - 3.75 MB Only.

**One place to read, search, back up and continue every AI coding chat on your PC.**

Claude Code · Codex · Cursor · Gemini CLI · OpenCode · Cline — across every account you have ever signed in with.

[![Latest release](https://img.shields.io/github/v/release/ssanaullahrais/Chat-Vault?style=flat-square&label=release)](https://github.com/ssanaullahrais/Chat-Vault/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/ssanaullahrais/Chat-Vault/total?style=flat-square)](https://github.com/ssanaullahrais/Chat-Vault/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6?style=flat-square)](#download)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB?style=flat-square)](https://tauri.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

[Download](#download) · [Privacy](#privacy) · [Build from source](#build-from-source)

</div>

<p align="center">
  <img src="docs/screenshots/01-home.png" alt="ChatVault home: activity, storage and recent chats across every tool, with sample data" width="900" />
</p>
<p align="center">
  <img src="docs/screenshots/02-chat.png" alt="A chat open in ChatVault with its plan, tool steps, table and code, with sample data" width="900" />
</p>
<p align="center">
  <img src="docs/screenshots/03-search-all-tools.png" alt="Search across every tool at once: Claude, Codex, Gemini CLI, Cursor Agent, OpenCode and Cline, with sample data" width="900" />
</p>
<p align="center">
  <img src="docs/screenshots/04-settings.png" alt="Settings: switch each tool on or off and see exactly where its chats are read from, with sample data" width="900" />
</p>
<p align="center">
  <img src="docs/screenshots/05-sync-backup.png" alt="Sync and backup: choose the backup folder, sync now, restore missing chats and back up automatically, with sample data" width="900" />
</p>

---

## Why ChatVault?

Claude Code, Codex, Cursor, Gemini CLI, OpenCode and Cline keep your chats on your computer, but each app only shows the chats of the account that is signed in right now. Sign out, switch accounts or reinstall, and your history seems to vanish, even though the files are still on disk.

ChatVault finds those files, lists them in one fast window, and lets you read them, search them across every tool, back them up, save them as Markdown, HTML, text or JSON, and **pick the work up again in any other tool without losing the context**. A handoff file carries the whole chat, so the new tool starts from where you stopped.

## Download

Get the latest installer from the **[Releases page](https://github.com/ssanaullahrais/Chat-Vault/releases/latest)**.

| File | Use it when |
| --- | --- |
| `ChatVault_x.y.z_x64-setup.exe` | You want the normal installer (recommended) |
| `ChatVault_x.y.z_x64_en-US.msi` | You deploy with Windows Installer or Group Policy |
| `ChatVault_x.y.z_x64-portable.exe` | You want to run it without installing |

Requires Windows 10 or 11 (64-bit). The installers are small (about 3 to 4 MB) and use the WebView2 runtime that ships with Windows.

> **Updates are automatic.** ChatVault checks GitHub for a newer release, downloads it in the background and shows a toast with a **Restart now** button.

## Privacy

ChatVault is a local app. It only **reads** your chat files, never uploads them and needs no account. The only network request it makes is to GitHub, to check for a new version. It never touches your sign-in files.

## Code signing policy

The installers are built from this repository by the [release workflow](.github/workflows/release.yml) on GitHub Actions, and every release is approved by hand before it is published. ChatVault is applying for free code signing from [SignPath Foundation](https://signpath.org). Until that is approved, the Windows installers are not code signed, so Windows may show an "unknown publisher" warning. The update files carry a separate updater signature that the app checks before installing an update.

**Team roles**

- Author, reviewer and approver: [@ssanaullahrais](https://github.com/ssanaullahrais). Every release is approved by this person before signing.

**Privacy**

ChatVault does not send information to any other networked system, except a check against GitHub for a new version. See [Privacy](#privacy).

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl` + `K` | Search chats and actions |
| `Ctrl` + `F` | Find in the open chat |
| `Enter` / `Shift` + `Enter` | Next or previous match |
| `Esc` | Close search |

## Build from source

You need Node 20 or newer, Rust, and the [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/) (WebView2 and the Visual Studio C++ build tools).

```bash
git clone https://github.com/ssanaullahrais/Chat-Vault.git
cd Chat-Vault
npm install
npm run tauri dev      # run with hot reload
npm run tauri build    # build the installers
```

The installers appear in `src-tauri/target/release/bundle/`. To produce the signed update files, set `TAURI_SIGNING_PRIVATE_KEY` first.

## Releasing

Update the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, then push a matching tag:

```bash
git tag v0.3.0
git push origin v0.3.0
```

The [release workflow](.github/workflows/release.yml) builds the `.msi`, the setup `.exe` and a portable `.exe`, signs the update bundles and publishes everything, including the `latest.json` that installed copies use to update themselves.

## Tech stack

[Tauri 2](https://tauri.app) · Rust · SQLite (FTS5) · React 19 · TypeScript · Tailwind CSS 4 · [shadcn/ui](https://ui.shadcn.com)

## License

[MIT](LICENSE) © Sanaullah Rais

<div align="center">
<sub>ChatVault is an independent project and is not affiliated with Anthropic, OpenAI or Anysphere.</sub>
</div>
