# Changelog

## Unreleased

- Forgejo Actions: build, test, and production binary; a green `main` mirrors
  branches and tags to GitHub (`git push --mirror`)
- Documentation translated to English
- Updated the frontend build toolchain and UI dependencies
- Removed obsolete GitHub-only dependency and Windows release automation; GitHub
  remains the public mirror

## 0.5.0-linux

Linux-focused release based on ChatVault 0.5.0 (original project:
[ssanaullahrais/Chat-Vault](https://github.com/ssanaullahrais/Chat-Vault)).

- Linux and Wayland paths (`HOME`, XDG); recycle via `gio trash`
- Grok sessions from `~/.grok/sessions`
- NousSave import (JSON preferred; Markdown with `platform` in the YAML front matter)
- Drop folder `~/Documents/ChatVault Import`; copies under `~/.local/share/chatvault/imported`
- Imported chats grouped by platform (ChatGPT, Gemini, Grok, and others)
- Production launch without the Vite dev server (`npx tauri build`)
- Auto-updater against GitHub Windows releases disabled
