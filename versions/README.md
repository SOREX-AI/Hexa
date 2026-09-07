# Engine snapshots

`versions/` is the offline counterpart to Hexa's Git-based upstream updater. Put a compatible upstream source snapshot in a child folder; it may contain `codex-rs/`, `engine/`, or be the Rust workspace itself.

Validate without changing the active engine:

```powershell
npm run hexa:version -- <folder-name>
```

Install the snapshot:

```powershell
npm run hexa:version -- <folder-name> --apply
```

Before installation, Hexa copies the snapshot to a staging directory and runs the **same** `engine-patches.mjs` adapter used by Git updates. Branding, runtime helper names, local-model compatibility, resume compatibility, and Bazel relocation are therefore reapplied to every version import. The previous active engine is preserved as `engine.before-version-update`.

Never treat a raw snapshot as a finished Hexa Engine tree; the staged patch step is part of the versioning contract.
