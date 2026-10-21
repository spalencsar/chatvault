<div align="center">

<img src="app-icon.png" alt="ChatVault" width="96" height="96" />

# ChatVault

A local dashboard for AI coding chats on Linux. Search, read, export, and continue conversations from the tools already on this machine, and import browser exports from NousSave.

Claude Code · Codex · Cursor · Grok · Gemini CLI · OpenCode · Cline · imported web chats

[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB?style=flat-square)](https://tauri.app)
[![Platform](https://img.shields.io/badge/platform-Linux-FCC624?style=flat-square)](#build)

</div>

This repository is a Linux port of [ssanaullahrais/Chat-Vault](https://github.com/ssanaullahrais/Chat-Vault) (MIT). The upstream project targets Windows. This tree adds Linux/Wayland paths, Grok sessions, and NousSave import.

<p align="center">
  <img src="docs/screenshots/01-home.png" alt="ChatVault home: activity, storage, and recent chats" width="900" />
</p>
<p align="center">
  <img src="docs/screenshots/02-chat.png" alt="A chat open in ChatVault" width="900" />
</p>
<p align="center">
  <img src="docs/screenshots/03-search-all-tools.png" alt="Search across every connected tool" width="900" />
</p>

---

## Overview

ChatVault indexes chat files that CLI tools already store on disk. It lists them in one window, supports full-text search, export to Markdown, HTML, text, or JSON, and handoff so work can continue in another tool.

It also imports **NousSave** JSON and Markdown exports from web UIs such as ChatGPT, Gemini, and Grok.

The application is local. It does not upload chats and does not require an account.

## Data sources

| Source | Typical location |
| --- | --- |
| Claude Code | `~/.claude/projects` |
| Codex | `~/.codex/sessions` |
| Cursor | `~/.cursor` |
| Grok | `~/.grok/sessions` |
| Gemini CLI | `~/.gemini/tmp` |
| OpenCode | `~/.local/share/opencode/opencode.db` |
| Cline | `~/.cline/data/sessions` |
| NousSave import | `~/Documents/ChatVault Import` |

The search index and imported copies live under `~/.local/share/chatvault`.

## Importing NousSave chats

1. Place JSON (preferred) or Markdown with YAML `platform` in `~/Documents/ChatVault Import`, then scan in the app.
2. Settings → **Imported** → Import files or Import folder.
3. `Ctrl`+`K` → **Import NousSave chats**.

Imported conversations stay under **Imported**, grouped by platform (ChatGPT, Gemini, Grok, and others). Duplicates are skipped.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl`+`K` | Command palette and search |
| `Ctrl`+`F` | Find in the open chat |
| `Esc` | Close search |

## Requirements

- Linux (tested on Omarchy / Arch, Hyprland, Wayland)
- Node.js 20 or newer
- Rust via rustup
- WebKitGTK and other Tauri Linux libraries, for example on Arch: `webkit2gtk-4.1`, `librsvg`, `openssl`

## Build

```bash
git clone https://github.com/spalencsar/chatvault.git
cd chatvault
npm install
source "$HOME/.cargo/env"
npx tauri build --no-bundle --ci
```

The binary is written to `src-tauri/target/release/chatvault`.

Production builds must go through the Tauri CLI so the frontend is embedded. A plain `cargo build --release` loads `http://localhost:1420` and fails unless the Vite dev server is running.

Development with hot reload:

```bash
npx tauri dev
```

## Install

After a production build:

```bash
./scripts/install.sh
```

This installs:

- `~/.local/bin/chatvault`
- `~/.local/share/applications/chatvault.desktop`
- `~/.local/share/icons/hicolor/128x128/apps/chatvault.png`

Launch with `chatvault` or the **ChatVault** desktop entry. `~/.local/bin` must be on `PATH`.

## Continuous integration

Forgejo Actions builds and tests each change. A successful push to `main` mirrors branches and tags to GitHub with `git push --mirror`. Development happens on Forgejo; GitHub is the public mirror.

The mirror job needs a GitHub repository `spalencsar/chatvault` and a Forgejo secret `DEPLOY_KEY` (a deploy key with write access).

## Privacy

ChatVault reads local chat files and writes to `~/.local/share/chatvault` and an optional backup folder. Chat content is not uploaded. The upstream GitHub auto-updater is disabled in this port.

## Differences from upstream

- Linux paths (`HOME` / XDG) instead of Windows `%APPDATA%`
- Recycle via `gio trash`
- Grok CLI sessions
- NousSave JSON and Markdown import
- Linux bundle targets (`appimage`, `deb`) in addition to Windows
- No automatic updates from upstream Windows releases

## License

[MIT](LICENSE) © Sanaullah Rais. Linux port and local adapters © Sebastian Palencsar. See [NOTICE](NOTICE).

ChatVault is an independent project and is not affiliated with Anthropic, OpenAI, Google, xAI, or Anysphere.
