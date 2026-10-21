#!/usr/bin/env bash
# Install the production ChatVault binary for the current user.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
bin="$root/src-tauri/target/release/chatvault"
if [[ ! -x "$bin" ]]; then
  echo "No production binary found. Build first:" >&2
  echo "  source \"\$HOME/.cargo/env\" && npx tauri build --no-bundle --ci" >&2
  exit 1
fi
install -Dm755 "$bin" "$HOME/.local/bin/chatvault"
install -Dm644 "$root/packaging/linux/chatvault.desktop" "$HOME/.local/share/applications/chatvault.desktop"
install -Dm644 "$root/src-tauri/icons/128x128.png" "$HOME/.local/share/icons/hicolor/128x128/apps/chatvault.png"
echo "Installed: $HOME/.local/bin/chatvault"
echo "Launcher: ChatVault (~/.local/bin must be on PATH)"
