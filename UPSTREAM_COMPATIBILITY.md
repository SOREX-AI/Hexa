# Engine source compatibility

The Rust workspace under `engine/` is a downstream working copy of the open-source OpenAI Codex `codex-rs` engine. It is not an independently authored engine that Hexa owns, and inclusion in this repository does not transfer ownership of OpenAI's or other contributors' code. That upstream-derived code remains under the Apache License 2.0 with its applicable copyright and attribution notices.

Hexa adds a separately maintained Electron shell, integration code, and a reproducible downstream patch layer. That patch layer adapts the upstream engine for the Hexa application by changing selected product-facing package names, executable targets, process names, state directories, and credential namespaces. References below to Hexa names describe those downstream modifications and runtime identities, not ownership of the underlying Codex implementation.

The update adapter deliberately keeps inherited identifiers that are required by source or API compatibility contracts. They are not used as Hexa's local app or process names.

## Downstream Hexa integration changes

- Cargo package names are `hexa-*`, including `hexa-core`, `hexa-app-server`, `hexa-tui`, and the rest of the internal workspace.
- Cargo executable targets are Hexa-named, including `hexa-engine`, `hexa-app-server`, `hexa-code-mode-host`, `hexa-mcp-server`, sandbox helpers, and secondary developer/test binaries.
- The desktop runtime stages a dedicated `HexaAppServer.exe` on Windows (`hexa-app-server` elsewhere) instead of running app-server as a subcommand inside the main engine process.
- Hexa's global engine home is `.hexashell`; `HEXA_ENGINE_HOME` and `HEXA_SQLITE_HOME` are its environment namespaces. The engine does not consume `CODEX_HOME`/`CODEX_SQLITE_HOME`.
- Repository-local engine configuration uses `.hexa/`, not `.codex/`.
- Authentication, MCP OAuth credentials, and generic secret storage use Hexa-specific OS keyring services.
- Windows managed configuration uses `%ProgramData%\Hexa\Engine`; macOS managed preferences use the `com.hexa.engine` application id.
- Electron IPC channels, preload globals, TypeScript bridge/status types, and other shell integration code are maintained by Hexa. The downstream patch layer also supplies Hexa-facing runtime identity, CLI usage text, execution banners, helper executable names, selected TUI/user copy, and local telemetry process identity in the staged engine copy.
- The upstream package-manager updater, upstream desktop launcher, and app-server daemon standalone update loop are removed. Hexa's staged updater is the only engine-update authority.

## Intentionally retained compatibility identifiers

Some inherited names remain because changing them would alter source-level, wire-level, backend, or migration contracts rather than simply rename the app:

- Rust dependency aliases and library crate identifiers such as `codex_core`, `codex_protocol`, and `codex_app_server`. Cargo package names themselves are Hexa; these aliases keep the very large upstream Rust module graph mergeable without rewriting protocol-facing identifiers.
- RPC/schema fields and serialized enum values that are part of the app-server wire contract, including fields such as `codexHome`.
- External OpenAI backend identifiers, service SKUs, OAuth/API paths, and JWT audiences where the literal `codex` value is part of the service contract.
- Upstream Git/release URLs needed to fetch OpenAI Codex source or matching V8 build assets.
- Legacy migration keys that Hexa may read only to preserve compatible historical data.
- Plugin/package format names that belong to the upstream ecosystem and would break compatibility if renamed.
- Upstream legal notices, licenses, copyrights, and factual attribution/reference material.
- Inert upstream repository material under `vendor/upstream-engine-reference/`.

## Update guarantee

`shell/scripts/engine-patches.mjs` is the permanent downstream adapter. For a raw upstream engine snapshot it applies the Hexa integration changes: product-facing branding, local-model compatibility, runtime/state isolation (including Hexa home/project/resource/socket namespaces), and self-updater removal. It then invokes `shell/scripts/engine-package-rebrand.mjs` to transform Cargo package/bin identities and selected source directories in the downstream copy. A second pass must be a no-op.

`shell/scripts/check-engine-layout.mjs` rejects an installed tree if critical package names, process isolation, keyring namespaces, `.hexa` project configuration, or update-flow hooks are missing.
