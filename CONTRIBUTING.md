# Contributing

This repository is a Linux-focused continuation of ChatVault, derived from
https://github.com/ssanaullahrais/Chat-Vault.

## Setup

See the [README](README.md#build). In short:

```bash
npm install
source "$HOME/.cargo/env"
npx tauri dev
```

Production binary:

```bash
npx tauri build --no-bundle --ci
```

## Tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

`indexes_and_reads_real_chats` reads chat folders on the host and expects
Claude, Codex, and Cursor data. It is skipped in CI.

## Continuous integration

Forgejo Actions builds and tests pull requests, manual runs, and pushes to
`main`. A successful push to `main` mirrors branches and tags to GitHub
(`spalencsar/chatvault`) with `git push --mirror`. Do not push the public
mirror directly.

Documentation-only changes (`*.md`, `*.mdx`, `LICENSE*`, `NOTICE*`, and
`docs/**`) skip the build and tests but are still mirrored to GitHub.

## Notes

- Do not commit secrets, tokens, or real chat exports.
- The application UI and documentation are English.
