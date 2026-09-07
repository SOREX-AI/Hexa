# Configuration and permissions

This is the canonical configuration guide for the Hexa desktop application and its engine integration.

Hexa reads effective engine settings through `config/read` and writes supported changes through `config/batchWrite`. The desktop client does not maintain a separate model, sandbox, or permission configuration.

## Configuration files

Hexa's default state directory is:

```text
~/.hexashell/
├─ config.toml
├─ auth.json and other engine state
├─ skills/
├─ plugins/
├─ sqlite/
└─ shell-preferences.json
```

Set `HEXA_ENGINE_HOME` to override the engine home and `HEXA_SQLITE_HOME` to override the SQLite location. The Electron host reads these canonical variables itself and passes the resolved paths to the app server. Older development builds also recognized `HEXA_HOME` and `HEXA_ENGINE_SQLITE_HOME`; those aliases remain fallback-only for compatibility.

## Accounts and models

OpenAI mode uses the signed-in OpenAI account and its model catalog. Local mode enables configured OpenAI-compatible providers without mixing their models into the OpenAI account view.

Settings → Agent can detect Ollama at `127.0.0.1:11434` and LM Studio at `127.0.0.1:1234`. Selecting a local model writes its provider and model IDs to `config.toml` through the engine configuration API.

An equivalent manual configuration is:

```toml
model = "my-local-model"
model_provider = "lmstudio"
oss_provider = "lmstudio"
model_reasoning_effort = "high"
```

Hexa refreshes effective configuration when the main window regains focus, so external TOML edits can appear without restarting the app.

## Context compaction

Automatic compaction uses the engine settings:

```toml
model_auto_compact_token_limit = 200000
model_auto_compact_token_limit_scope = "total"
```

Supported scopes are `total` and `body_after_prefix`. Leaving the limit unset uses the engine and model defaults. Conversations can also be compacted manually from the chat menu.

## Permission profiles

The composer loads profiles from `permissionProfile/list`. When a workspace is selected, its path is included so project-local profiles can appear. The selected profile is sent with thread and turn requests, while enforcement remains in the Rust engine.

## Approval requests

The app server can pause a turn and request a decision. Hexa displays these requests above the composer and handles:

- command execution;
- file changes;
- granular permission requests;
- structured tool questions;
- MCP elicitation;
- compatible fallback requests from newer protocol versions.

Command and file requests can be accepted once, accepted for the session when supported, or declined. Granular permission requests return only the approved subset.

The interface displays and responds to policy; the Rust sandbox and execution system enforce it.

## Managed settings

`configRequirements/read` reports requirements supplied through `requirements.toml` or device management. Hexa displays managed state because local controls cannot override administrator-enforced settings.

Privacy-related configuration is documented separately in [PRIVACY.md](./PRIVACY.md).
