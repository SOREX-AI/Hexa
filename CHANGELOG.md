# Hexa changelog

## Unreleased

- Added cloud and local-model provider support.
- Rebranded Hexa-owned shell, engine runtime surfaces, helper executables, IPC, and build output.
- Expanded the permanent branding adapter to cover model prompts, login/cloud/MCP/TUI surfaces and moved unused upstream repository scripts behind the vendor reference boundary.
- Made Hexa's upstream staging adapter reapply branding and local-provider compatibility patches on every imported engine revision.
- Disabled the inherited upstream engine self-updater; engine updates are installed through Hexa's guarded updater.
- Fixed Windows rusty_v8 prebuilt acquisition for the Hexa Engine build.
