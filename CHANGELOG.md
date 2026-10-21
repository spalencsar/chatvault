# Changelog

## 0.5.0-linux

Linux-Port auf Basis von ChatVault 0.5.0 (upstream: [ssanaullahrais/Chat-Vault](https://github.com/ssanaullahrais/Chat-Vault)).

- Linux- und Wayland-Pfade (`HOME`, XDG), Papierkorb mit `gio trash`
- Grok-Sessions aus `~/.grok/sessions`
- NousSave-Import (JSON bevorzugt, Markdown mit `platform` in der YAML-Frontmatter)
- Ablageordner `~/Documents/ChatVault Import`; Kopien unter `~/.local/share/chatvault/imported`
- Importierte Chats nach Plattform gruppiert (ChatGPT, Gemini, Grok, …)
- Production-Start ohne Vite-Devserver (`npx tauri build`)
- Auto-Updater gegen GitHub-Windows-Releases abgeschaltet
