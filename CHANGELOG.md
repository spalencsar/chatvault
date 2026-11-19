# Changelog

## 0.7.0 - 2026-11-19

### Added

- **Deep Search & In-Chat jumping**: Jump directly to matching message lines with glowing amber highlights and virtualized scroll positioning when clicking search hits in the Command Palette (`Ctrl`+`K`), Deep Search, or conversation browser.
- **Granular restore preview & selective restore**: Dry-run restore scanner (`preview_restore_chats`) comparing backups against live stores to preview missing conversations before restoring, with tool-level selection (`restore_selected_chats`).
- **Compressed backup bundles**: One-click `.tar.gz` archive creation (`create_backup_tarball`) for durable offsite backups.
- **Structured JSON bulk export**: Export all indexed conversations as structured JSON (`export_all_json`) alongside existing Markdown bulk exports.
- **Sync & Backup overhaul**: Live source breakdown cards displaying file counts and storage size per tool, configurable auto-sync intervals (10m, 30m, 1h, 6h), and safe snapshot protection for SQLite-backed agents (Hermes Agent, Antigravity).
- **Universal modern design system**: Completely overhauled Command Palette (`Ctrl`+`K`), Deep Search overlay, and all context/dropdown menus (`ContextMenu`, `DropdownMenu`) using Dark Charcoal (`#161618`), subtle borders, warm amber focus states, and consistent FontAwesome/SVG vector glyphs (`sourceGlyph()`).

### Fixed

- Eliminated WebKitGTK subpixel blur bug by replacing `translate(-50%, -50%)` with device-pixel-aligned `fixed inset-0 m-auto h-fit` across all modal dialogs.
- Fixed search workspace leak where typing in the global TitleBar search bar from the dashboard locked searches into previously visited workspaces.
- Fixed middle conversation list displaying "No Chats Found" when opening a full-text search result.
- Removed redundant "Backup" tab from Settings dialog to unify all backup workflows in Sync & Backup.
- Fixed OpenCode schema support for `session_v2` and `session_message`.

## 0.6.2 - 2026-11-12

### Added

- Added read-only support for Google Antigravity conversations from its local
  SQLite search index, including ordered user/agent messages, projects, local
  search, overview statistics, Markdown export, source settings, and a native
  provider icon
- Added a provider-independent local archive under
  `~/.local/share/chatvault/archive`. ChatVault now keeps atomic normalized
  snapshots of parsed conversations, uses them when a live source disappears,
  and includes them in backup and restore operations

### Changed

- Archived copies are treated as read-only handoff sources in the interface,
  while live provider data remains the preferred source without duplicate rows

### Fixed

- Detect source-database removal independently from newer transcript files so
  ChatVault can activate its managed archive fallback without an app restart
- Use the native KSNI/StatusNotifierItem tray backend on Linux instead of
  loading the deprecated `libayatana-appindicator` compatibility library
- `--version` and `--help` are now answered on the command line instead of
  starting the desktop application. Previously both flags built the GUI event
  loop, so an invocation without a reachable display socket (headless shell, CI,
  agent sandbox) aborted the process through `gtk_init` and produced a SIGABRT
  core dump

## 0.6.1 - 2026-10-22

### Added

- Added read-only support for Hermes Agent sessions from its canonical
  `~/.hermes/state.db`, including compressed session lineages, search, filters,
  overview statistics, exports, and source settings

### Fixed

- Added support for NousSave schema v2 `vines-full-capsule` JSON exports,
  including one managed import per conversation in multi-vine capsules
- Restored images embedded by NousSave in `htmlContent` instead of leaving
  `[Image: image omitted …]` placeholders in imported conversations
- Show native Grok and Gemini icons for imported chats from those platforms
- Point in-app project, release, and issue links to the current ChatVault
  repository while retaining the original project attribution in the docs
- Prevented the automatic drop-folder scan from repeatedly parsing unchanged
  large exports, which could make the app appear unresponsive
- Removed three stale Rust compiler warnings from the index, source, and Cursor
  integration code

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
