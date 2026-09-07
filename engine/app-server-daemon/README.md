# Hexa app-server daemon

This crate is retained from the upstream engine for Unix app-server lifecycle and remote-control compatibility. Hexa deliberately disables the upstream standalone self-updater.

## Update authority

Hexa has one engine update path: an upstream commit or saved engine version is copied into a staging directory, `shell/scripts/engine-patches.mjs` is applied, structural checks run, and only then is the staged tree installed. The daemon does not download or execute the upstream standalone installer, does not run a pid update loop, and reports `autoUpdateEnabled: false`.

The remaining upstream backend/wire identifiers are compatibility contracts, not Hexa local process or storage identities. Hexa does not share the official Codex home, project-config, keyring, resource, or app-server namespaces; see `UPSTREAM_COMPATIBILITY.md` at the repository root.
