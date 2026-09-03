# Hexa documentation

Hexa is **Your Open Agentic Workspace**. Its `engine/` workspace is a downstream copy of the open-source [OpenAI Codex `codex-rs` engine](https://github.com/openai/codex), while its Electron shell and integration layer are maintained by the Hexa project. Hexa does not claim ownership of the upstream Codex implementation; upstream copyright, licensing, and attribution continue to apply. This folder is the canonical user-facing documentation for Hexa v0.0.1 and its integration with that engine.

Some documents are retained as **upstream reference material**. References to `codex`, Codex CLI, OpenAI configuration, OpenAI grants, or OpenAI contribution policy in those pages describe the upstream project only; they are not Hexa product policy. Every retained upstream-reference page says so at its start. Hexa-specific application behavior and integration details are documented in the Hexa sections below.

Some upstream documents also exist under `vendor/upstream-engine-reference/` as part of the staged reference snapshot. Those files are intentionally retained for upstream comparison; this `docs/` folder is the canonical, user-facing location for Hexa documentation.

## Upstream engine reference

- [Getting started](getting-started.md)
- [Installation and building](install.md)
- [Configuration](config.md) and [sample configuration](example-config.md)
- [Authentication](authentication.md)
- [Sandboxing and approvals](sandbox.md)
- [Execution policy](execpolicy.md) and [non-interactive mode](exec.md)
- [Skills](skills.md), [slash commands](slash_commands.md), and [AGENTS.md](agents_md.md)
- [Upstream Codex CLI installation](install.md), [CLA](CLA.md), and [Open Source Fund](open-source-fund.md)

## Hexa application documentation

- [Build and run Hexa](BUILDING.md)
- [Architecture](ARCHITECTURE.md)
- [Configuration and permissions](CONFIGURATION.md)
- [Privacy](PRIVACY.md)
- [Interface design](DESIGN.md)
- [Licensing](license.md)

## Documentation conventions

- `BUILDING.md`, `ARCHITECTURE.md`, `CONFIGURATION.md`, `DESIGN.md`, and `PRIVACY.md` describe Hexa directly.
- Lowercase `config.md`, `sandbox.md`, and similarly labeled CLI pages are retained upstream references; the index above explicitly identifies Hexa-owned pages such as `license.md`.
- Legal attribution remains in [`LICENSE-APACHE-2.0`](../LICENSE-APACHE-2.0), [`LICENSE-GPL-3.0`](../LICENSE-GPL-3.0), and [`NOTICE`](../NOTICE). The upstream CLA is not a Hexa contribution agreement.
