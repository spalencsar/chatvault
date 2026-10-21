# Security Policy

## Supported versions

This Linux port tracks the local `main` branch. There is no separate LTS.

Upstream Windows releases: https://github.com/ssanaullahrais/Chat-Vault/releases

## Reporting a vulnerability

Mail **hello@linuxcommand.dev**. Do not open a public issue for a security problem.

For issues that also affect upstream Windows ChatVault, report them privately to the original project as well:
https://github.com/ssanaullahrais/Chat-Vault/security/advisories/new

## What ChatVault touches

ChatVault reads chat files that the tools already keep on this machine and can copy them into a backup folder. It does not upload chat content. The GitHub auto-updater from upstream is disabled in this fork.
