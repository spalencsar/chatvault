<div align="center">

<img src="app-icon.png" alt="ChatVault" width="96" height="96" />

# ChatVault (Linux)

Lokales Dashboard für AI-Chats auf dem eigenen Rechner. Liest, durchsucht und sichert Gespräche von CLI-Tools und importiert Web-Exports (NousSave).

Claude Code · Codex · Cursor · Grok · Gemini CLI · OpenCode · Cline · importierte Web-Chats

[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB?style=flat-square)](https://tauri.app)
[![Platform](https://img.shields.io/badge/platform-Linux-FCC624?style=flat-square)](#bauen)

</div>

Dieses Repository ist ein **Linux-Port** von [ssanaullahrais/Chat-Vault](https://github.com/ssanaullahrais/Chat-Vault) (MIT). Upstream ist Windows. Hier: Linux/Wayland, Grok-Sessions, NousSave-Import.

<p align="center">
  <img src="docs/screenshots/01-home.png" alt="ChatVault Startseite" width="900" />
</p>

---

## Was die App tut

ChatVault findet die Chat-Dateien, die die Tools schon auf der Platte haben, listet sie in einem Fenster und lässt sie lesen, durchsuchen, als Markdown/HTML/JSON speichern und in ein anderes Tool weitergeben (Handoff).

Zusätzlich importiert es **NousSave**-Exports aus dem Browser (ChatGPT, Gemini, Grok und andere Web-UIs).

Es läuft lokal. Chats gehen nicht in die Cloud. Es braucht kein Konto.

## Quellen

| Quelle | Ort (typisch) |
| --- | --- |
| Claude Code | `~/.claude/projects` |
| Codex | `~/.codex/sessions` |
| Cursor | `~/.cursor` |
| Grok | `~/.grok/sessions` |
| Gemini CLI | `~/.gemini/tmp` |
| OpenCode | `~/.local/share/opencode/opencode.db` |
| Cline | `~/.cline/data/sessions` |
| NousSave (Import) | Ablage: `~/Documents/ChatVault Import` |

Index und Kopien der Imports: `~/.local/share/chatvault`.

## NousSave importieren

1. JSON (bevorzugt) oder Markdown mit YAML-`platform` nach `~/Documents/ChatVault Import` legen, in der App scannen.
2. Oder Settings → **Imported** → Import files / Import folder.
3. Oder Strg+K → „Import NousSave chats“.

ChatGPT, Gemini und Grok bleiben unter **Imported**, getrennt nach Plattform (Dropdown und Gruppen in der Liste). Duplikate werden übersprungen.

## Tastatur

| Tasten | Aktion |
| --- | --- |
| `Strg` + `K` | Suche und Aktionen |
| `Strg` + `F` | Im offenen Chat suchen |
| `Esc` | Suche schließen |

## Voraussetzungen

- Linux (getestet auf Omarchy / Arch, Hyprland, Wayland)
- Node 20+
- Rust (rustup)
- WebKitGTK und die üblichen Tauri-Linux-Abhängigkeiten, z. B. unter Arch: `webkit2gtk-4.1`, `librsvg`, `openssl`

## Bauen

```bash
git clone <dieses-repo>
cd chat-vault
npm install
source "$HOME/.cargo/env"
npx tauri build --no-bundle --ci
```

Das Binary liegt in `src-tauri/target/release/chatvault`.

**Nicht** `cargo build --release` allein verwenden. Ohne `npx tauri build` fehlt das Frontend; die App versucht dann `http://localhost:1420` und bricht mit Connection refused ab.

Entwicklung mit Hot-Reload:

```bash
npx tauri dev
```

## Installieren

Nach dem Production-Build:

```bash
./scripts/install.sh
```

Das legt an:

- `~/.local/bin/chatvault`
- `~/.local/share/applications/chatvault.desktop`
- Icon unter `~/.local/share/icons/hicolor/128x128/apps/chatvault.png`

Start: Befehl `chatvault` oder der Eintrag **ChatVault** im Starter.

## CI

Forgejo baut und testet. Ist `main` grün, geht ein `--mirror` (Branches und Tags) nach GitHub. Entwicklung nur auf Forgejo; GitHub ist der öffentliche Spiegel.

Voraussetzung für den Spiegel: leeres Repo `spalencsar/chatvault` auf GitHub und Forgejo-Secret `DEPLOY_KEY` (Deploy-Key mit Schreibrecht).

## Datenschutz

ChatVault liest lokale Dateien und schreibt in `~/.local/share/chatvault` plus den optionalen Backup-Ordner. Es lädt keine Chats hoch. Der Upstream-Auto-Updater (GitHub) ist in diesem Fork abgeschaltet.

## Unterschied zu Upstream

- Linux-Pfade (`HOME` / XDG) statt Windows-`APPDATA`
- Papierkorb über `gio trash`
- Grok-CLI-Sessions
- NousSave JSON/MD-Import
- Linux-Bundles in der Tauri-Config (`appimage`, `deb`) neben den Windows-Targets
- Kein automatisches Update von GitHub-Windows-Releases

## Lizenz

[MIT](LICENSE) © Sanaullah Rais. Linux-Port und lokale Adapter © Sebastian Palencsar. Siehe [NOTICE](NOTICE).

ChatVault ist unabhängig und nicht mit Anthropic, OpenAI, Google, xAI oder Anysphere verbunden.
