# Privacy

This is the canonical privacy guide for the Hexa desktop application.

## What Hexa controls

Hexa does not add an analytics SDK. Privacy settings use the controls exposed by the Rust engine configuration.

Applying the privacy preset writes these values through `config/batchWrite`:

```toml
[analytics]
enabled = false

[feedback]
enabled = false

[otel]
log_user_prompt = false
exporter = "none"
trace_exporter = "none"
metrics_exporter = "none"
```

The app server is launched without its analytics-default-enable flag. Writing `[analytics].enabled = false` records the choice explicitly instead of relying on that launch default.

The preset disables the log, trace, and metrics exporters together.

## Feedback

`[feedback].enabled = false` disables the feedback flow exposed by the engine configuration. Hexa does not create a replacement feedback uploader.

## Local history

The settings page also exposes an explicit action to set:

```toml
[history]
persistence = "none"
```

When history persistence is disabled, conversations are not expected to remain in the sidebar after restarting. The sidebar reads history from the engine's thread store.

## Network activity

A cloud model still sends model requests to its configured provider. Use Local account mode and a local provider when inference must remain on the computer.

MCP servers, web search, browser or computer tools, connected apps, and inference servers may also use the network according to their own configuration. Hexa's privacy controls do not act as a system-wide firewall.

## Managed requirements

`configRequirements/read` can report policies from `requirements.toml` or device management. These requirements may constrain analytics, feedback, sandbox modes, permissions, web search, models, and other settings. Hexa displays managed state when local controls cannot override it.
