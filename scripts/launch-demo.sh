#!/usr/bin/env bash
# Launch ChatVault in the isolated demo environment for taking screenshots.
set -euo pipefail

DEMO_DIR="/tmp/chatvault-demo"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -d "$DEMO_DIR" ]]; then
  echo "Demo environment not found. Initializing..."
  "$SCRIPT_DIR/demo-environment.sh"
fi

BIN="${CHATVAULT_BIN:-$HOME/.local/bin/chatvault}"
if [[ ! -x "$BIN" ]]; then
  BIN="$(command -v chatvault || true)"
fi

if [[ ! -x "$BIN" ]]; then
  echo "Error: ChatVault binary not found at $BIN or on PATH." >&2
  exit 1
fi

echo "Launching ChatVault with isolated DEMO profile: $DEMO_DIR"
HOME="$DEMO_DIR" \
XDG_DATA_HOME="$DEMO_DIR/.local/share" \
XDG_CONFIG_HOME="$DEMO_DIR/.config" \
exec "$BIN" "$@"
