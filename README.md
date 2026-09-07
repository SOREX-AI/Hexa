<h1 align="center">Hexa</h1>
<p align="center">An open workspace for working with coding agents.</p>

<p align="center">
  <img src="./shell/assets/ui-anatomy.png" alt="The Hexa desktop workspace" width="94%" />
</p>

Hexa is built for people who want a capable agentic environment without giving up ownership of the software around it. It brings conversations, tools, files, approvals, and local or hosted intelligence into a focused desktop workspace that can be inspected, changed, and rebuilt.

The project grew from a simple belief: powerful models deserve an equally thoughtful interface, and that interface should not have to be proprietary. Hexa aims to provide a rich desktop experience while remaining open enough for people to understand how it works, adapt it to their own workflows, and let its capabilities scale with the models and hardware they choose.

## What Hexa stands for

- **A complete workspace.** Conversation, execution, review, and project context belong together instead of being scattered across separate tools.
- **An interface that respects the work.** Details such as tool progress, permissions, file changes, context usage, and conversation history should be clear without getting in the way.
- **Open and inspectable software.** The shell and its integration with the engine can be studied, rebuilt, and improved by the people who use it.
- **Choice of intelligence.** Hexa is designed to work with hosted models as well as compatible local providers, allowing the environment to grow with the user's needs and hardware.
- **Upstream respect.** Hexa builds on existing open-source work while preserving the attribution, licensing, and compatibility boundaries that make continued collaboration possible.

## Getting started

The [building guide](./docs/BUILDING.md) is the canonical place for prerequisites, platform setup, development, and packaging instructions.

## Documentation

- [Documentation overview](./docs/README.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Configuration and permissions](./docs/CONFIGURATION.md)
- [Interface design](./docs/DESIGN.md)
- [Privacy](./docs/PRIVACY.md)
- [Updating the engine source](./ENGINE_UPSTREAM.md)
- [Upstream compatibility](./UPSTREAM_COMPATIBILITY.md)

## Project lineage

The Rust workspace under `engine/` is a downstream copy of the open-source OpenAI Codex `codex-rs` engine; Hexa does not claim ownership of that upstream implementation. OpenAI's and other contributors' code retains its original copyright and Apache-2.0 licensing. This repository separately maintains the Hexa desktop shell, product experience, integration code, and the repeatable patches used to adapt compatible upstream revisions for Hexa. The exact boundary is documented in [UPSTREAM_COMPATIBILITY.md](./UPSTREAM_COMPATIBILITY.md).

## Licensing and attribution

This repository contains components under separate licenses; it is not offering a choice of license for the same code:

- The Hexa Electron shell, Copyright © 2026 SOREX AI, is licensed under [GNU GPL v3.0 only](./LICENSE-GPL-3.0).
- The upstream-derived Codex engine is licensed under [Apache License 2.0](./LICENSE-APACHE-2.0).

Hexa retains the notices, copyright statements, and attribution applicable to the work it includes. See [`NOTICE`](./NOTICE) for the accompanying upstream notices.
