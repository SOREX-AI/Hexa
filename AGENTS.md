# Hexa repository instructions

## Architecture

Hexa is the app maintained in this repository. `shell/` contains the Electron/React client and build/update orchestration. `engine/` is a staged Rust engine derived from the upstream OpenAI Codex `codex-rs` tree.

## Upstream boundary

Do not mechanically rename upstream Cargo package/crate names, protocol field names, compatibility environment variables, or legal attribution. Those identifiers are documented in `UPSTREAM_COMPATIBILITY.md` and may be required to merge future upstream revisions.

All Hexa-owned branding and compatibility transformations that affect `engine/` must be expressed in `shell/scripts/engine-patches.mjs`. Never patch only the current `engine/` copy: the same transformation must survive `hexa:upstream` and `hexa:version`.

The updater stages a new upstream snapshot, applies `applyHexaEnginePatches()`, validates it, then replaces `engine/`. If an upstream change invalidates a required patch anchor, fail closed rather than silently installing a partially patched engine.

## Local providers

Preserve the local-provider compatibility layer. Local providers must not use Responses Lite encoding, resumed developer/system history must be folded into a single instruction block, and stale developer-role AdditionalTools entries must not be replayed into LM Studio-style chat templates.

## Branding

User-visible/runtime-owned names are Hexa: IPC (`hexa-engine:*`), preload (`window.hexa`), executable (`HexaEngine.exe` / `hexa-engine`), Code Mode host, sandbox helpers, CLI copy, OAuth client label, Git baseline identity, build messages, and documentation.

## Validation

After engine-boundary changes run:

```sh
node --check shell/scripts/engine-patches.mjs
node shell/scripts/check-engine-layout.mjs
```

If Cargo is intentionally unavailable in a source-analysis environment only, `HEXA_SKIP_CARGO_METADATA=1` may be used for the source-level layout check. Do not use that escape hatch for release validation.
