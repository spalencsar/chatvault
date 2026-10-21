# Security Policy

## Supported versions

This Linux-focused fork tracks `main`. There is no separate LTS line.

Original project releases: https://github.com/ssanaullahrais/Chat-Vault/releases

## Reporting a vulnerability

Email **hello@linuxcommand.dev**. Do not open a public issue for a security
problem.

If the issue also affects the original Chat-Vault project, report it privately
to its maintainer as well:
https://github.com/ssanaullahrais/Chat-Vault/security/advisories/new

## Build and release

Forgejo Actions builds and tests changes. Only a successful `main` build is
mirrored to the public GitHub repository (`spalencsar/chatvault`). Do not push
the mirror directly.

## What ChatVault accesses

ChatVault reads chat files that the tools already keep on this machine and can
copy them into a backup folder. It does not upload chat content. The GitHub
auto-updater tied to the original project's release feed is disabled in this
fork.
