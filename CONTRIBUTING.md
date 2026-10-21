# Mitwirken

Dieses Repository ist der Linux-Port. Upstream (Windows) liegt unter
https://github.com/ssanaullahrais/Chat-Vault.

## Setup

Siehe [README](README.md#bauen). Kurz:

```bash
npm install
source "$HOME/.cargo/env"
npx tauri dev
```

Production-Binary nur mit:

```bash
npx tauri build --no-bundle --ci
```

## Tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Ein Test liest echte Chat-Ordner auf dem Rechner und erwartet Claude-Chats; der kann hier fehlschlagen.

## CI und Spiegel

Forgejo Actions baut und testet PRs, manuelle Läufe und Pushes auf `main`.
Ein grüner Push auf `main` spiegelt Branches und Tags per `git push --mirror`
nach GitHub (`spalencsar/chatvault`). Nicht direkt auf den Spiegel pushen.

## Hinweise

- Login-Shell bleibt bash. Fish nur in Alacritty, falls so konfiguriert.
- Keine Secrets, Tokens oder echte Chat-Exports committen.
- UI der App ist Englisch; Doku hier auf Deutsch.
