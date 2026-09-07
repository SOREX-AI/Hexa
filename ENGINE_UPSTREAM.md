# Updating the Hexa Engine source

Hexa maintains the desktop app, Cargo/runtime naming, local-provider compatibility, state isolation, packaging, updater, and the patched Rust engine shipped with the app. Open-source Codex code remains available as an engine source dependency under its original license. **A raw imported source tree is never installed directly.**

Every branch, tag, commit, or saved version is copied to a staging directory and transformed through Hexa's deterministic adapter first.

## Preview an update

```powershell
npm run hexa:upstream -- main
```

## Apply a branch, tag, or commit

```powershell
npm run hexa:upstream -- <ref> --apply
```

The updater fetches `https://github.com/openai/codex.git` by default, stages the upstream `codex-rs/` workspace, validates the expected raw-upstream layout, runs `shell/scripts/engine-patches.mjs`, and only then replaces `engine/`. The prior tree is retained as `engine.before-update`.

Set `HEXA_ENGINE_UPSTREAM` to another compatible Git remote if needed.

## What the adapter reapplies

The adapter is Hexa's permanent downstream transformation layer. On every imported upstream snapshot it reapplies:

- Hexa model/user-facing branding and CLI identity;
- the local/OpenAI-compatible provider request fixes, including Responses-Lite gating and developer/system-message folding;
- resumed-thread compatibility for stores without paginated cursor support;
- removal of inherited self-update paths and unrelated desktop launch or promotion paths;
- Hexa helper/runtime discovery names;
- dedicated app-server identity and local telemetry identity;
- Hexa-specific auth, MCP, and generic-secret keyring services;
- `.hexashell` global state through `HEXA_ENGINE_HOME`/`HEXA_SQLITE_HOME`, with no `CODEX_HOME` state fallback;
- `.hexa/` repository-local configuration instead of `.codex/`;
- Hexa-specific packaged-resource, temporary sandbox, daemon-state, and app-server control-socket namespaces;
- Hexa-specific Windows/macOS managed-configuration namespaces;
- Bazel root relocation needed by the Hexa tree;
- Cargo package rebranding from upstream `codex-*` packages to `hexa-*` packages;
- Cargo binary-target rebranding, including `hexa-engine` and the standalone `hexa-app-server` process;
- selected source-directory renaming where an inherited directory carried another app's name.

The package/process transformation lives in `shell/scripts/engine-package-rebrand.mjs` and is invoked by `engine-patches.mjs`, so it cannot be skipped by the normal updater/version-import flow.

If a required upstream anchor changes, staging fails closed instead of installing a partially patched tree.

## Process and state isolation

Hexa can run alongside other coding-agent applications without sharing its runtime state.

Hexa uses:

```text
HexaEngine.exe
HexaAppServer.exe
HexaCodeModeHost.exe
HexaCommandRunner.exe
HexaSandboxSetup.exe
```

On non-Windows platforms the equivalent runtime names use the `hexa-*` form.

The shell launches `HexaAppServer.exe` directly over stdio. It does not launch `HexaEngine.exe app-server`. Hexa also supplies private state roots and keyring namespaces so the official Codex process, `~/.codex`, and Codex credential entries are not reused by Hexa.

A few `codex_*` source aliases plus backend route and protocol/schema identifiers remain as compatibility contracts. The official Codex home/SQLite environment variables are not used by Hexa. They are documented in [`UPSTREAM_COMPATIBILITY.md`](./UPSTREAM_COMPATIBILITY.md) and are not local process/package identities.

## Required verification

```powershell
npm run hexa:engine-check
npm run hexa:upstream -- <tag-or-commit>
npm run hexa:upstream -- <tag-or-commit> --apply
npm run hexa:engine-check
```

Do not copy a raw engine tree over `engine/` by hand. That bypasses Hexa's local-model fixes, branding, package/process rebrand, and isolation layer.
