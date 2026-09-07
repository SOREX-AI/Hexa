# Desktop client

`shell/` contains Hexa's Electron and React interface, native host integration, packaging, and engine lifecycle code.

Run development commands from the repository root:

```sh
node hexa.mjs setup
node hexa.mjs check
node hexa.mjs dev
```

The main directories are:

```text
src/main/       Electron host and engine bridge
src/preload/    isolated renderer API
src/renderer/   React interface
src/shared/     shared TypeScript types
scripts/        build, packaging, and maintenance scripts
resources/      packaged runtime resources
assets/         artwork and build assets
```

Use the root [README](../README.md) for an overview and [`docs/BUILDING.md`](../docs/BUILDING.md) for complete development instructions.
