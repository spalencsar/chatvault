# Changelog

## Unreleased

No unreleased changes.

## 0.6.0 - 2026-10-21

### Changed

- Reworked the public documentation to present ChatVault as an independent,
  Linux-focused continuation with clearer feature, privacy, build, installation,
  and project-lineage information
- Updated Lucide React to 1.61.0, Recharts to 3.10.1, TypeScript to 7.0.2, and
  Vite to 8.3.5
- Replaced the legacy `__dirname` Vite alias with an ESM-compatible file URL
- Added Forgejo change classification: documentation-only changes skip the
  native test/build job but are still mirrored to GitHub
- Forgejo Actions now test and build code changes before mirroring all branches
  and tags from `main` to the public GitHub repository
- Added downloadable Debian and AppImage packages for the first independent
  Linux release

### Removed

- Removed obsolete GitHub Dependabot configuration and the Windows-only GitHub
  release workflow; Forgejo remains the source of truth and GitHub the public
  mirror

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
