#!/usr/bin/env bash
# Sets up a clean, isolated, synthetic demo environment in /tmp/chatvault-demo
# for generating private, non-leaking screenshots for documentation.
set -euo pipefail

DEMO_DIR="/tmp/chatvault-demo"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Setting up ChatVault synthetic demo environment in $DEMO_DIR ==="

# Clean existing demo directory
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"/{.config/chatvault,.local/share/chatvault/archive/{claude,codex,antigravity,hermes,opencode,grok,imported},.claude/projects/-home-demo-rust-cli,.codex/sessions,Documents/"ChatVault Import",Documents/"ChatVault Backup"/{claude,codex,archive,imported}}

# Run python generator for mock chats
python3 "$SCRIPT_DIR/generate-demo-data.py" "$DEMO_DIR"

echo "=== Demo environment ready! ==="
echo "To launch ChatVault in the demo environment:"
echo "  HOME=\"$DEMO_DIR\" XDG_DATA_HOME=\"$DEMO_DIR/.local/share\" XDG_CONFIG_HOME=\"$DEMO_DIR/.config\" \"$HOME/.local/bin/chatvault\""

