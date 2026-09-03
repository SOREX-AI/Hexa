# Build and run Hexa

This is the canonical build and release guide for Hexa.

Run all commands from the repository root. The launcher resolves the desktop client and Rust engine paths automatically.

## Requirements

All platforms require:

- Node.js 22.12 or newer;
- Git;
- Rust stable through rustup;
- pnpm, normally provided through the repository's package-manager declaration.

Platform-specific requirements:

- **Windows:** Visual Studio Build Tools or Visual Studio with Desktop development with C++, plus a current Windows SDK.
- **macOS:** Xcode Command Line Tools.
- **Linux:** the distribution's native compiler and development packages required by the Rust dependencies.

## Development

Install dependencies and check the local toolchain:

```sh
node hexa.mjs setup
node hexa.mjs check
```

Start the development app:

```sh
node hexa.mjs dev
```

The first run may compile the Rust engine and its helper executables. Later runs reuse a complete cached runtime.

## Checks and builds

```sh
node hexa.mjs typecheck
node hexa.mjs build
node hexa.mjs engine-check
node hexa.mjs engine-build
```

`build` compiles the Electron main process, preload bridge, and React renderer. `engine-build` compiles and stages the Rust runtime and required platform helpers.

## Updating the Hexa version

The Hexa release version is independent from the upstream engine version. Use a SemVer value **without** a leading `v` in source files; the About Hexa window adds the `v` prefix when it displays the version.

1. Update `shell/package.json` → `version`. This is the packaged Electron application version and determines installer artifact names such as `Hexa-0.0.2-x64.exe`.
2. Update `shell/src/main/engine/AppServerClient.ts` → `clientInfo.version` to the same value. This keeps the version reported to the Hexa Engine aligned with the desktop application.
3. Validate and package the release:

   ```sh
   pnpm --dir shell typecheck
   node hexa.mjs build
   node hexa.mjs dist
   ```

`node hexa.mjs version-import` updates the staged **upstream engine source**. It does not change Hexa's desktop release version.

## Packaging

### License obligations for releases

The Hexa Electron shell is GPL-3.0-only. A distributed binary must be accompanied by, or offered alongside, its complete corresponding shell source, including the build and installation scripts. Make the matching source revision available at no additional charge from the same release location. The source tree keeps the applicable texts in `LICENSE-GPL-3.0`, `LICENSE-APACHE-2.0`, and `NOTICE`; packaging copies them into the application as `licenses/HEXA-SHELL-LICENSE`, `licenses/UPSTREAM-ENGINE-LICENSE`, and `licenses/UPSTREAM-ENGINE-NOTICE`.

The bundled Codex engine remains separately licensed under Apache-2.0. Updating the engine does not change the GPL-3.0-only license that applies to Hexa shell code.

Create an unpacked application directory:

```sh
node hexa.mjs pack
```

Create an installer for the current operating system:

```sh
node hexa.mjs dist
```

Windows builds an NSIS installer, macOS builds a DMG plus the ZIP required by Electron's updater, and Linux builds an AppImage. Build releases on their target operating system so Cargo and Electron Builder can include the correct native executables. Finished packages are copied to `dist-release/`.

Packages are binary-only at runtime. `resources/bin` contains only the native Hexa Engine executables and platform helpers produced for the target operating system; the Cargo workspace is not copied into installers or unpacked app bundles.

## GitHub Actions builds

`.github/workflows/build-all-platforms.yml` builds the Rust engine, desktop client, and installer on native Windows, macOS, and Linux GitHub-hosted runners. Start it from **Actions → Build Hexa for all platforms → Run workflow**, or push a tag beginning with `v`.

Each platform is uploaded as a separate workflow artifact for 14 days. Tag builds also publish the installers, blockmaps, and platform update metadata to the matching GitHub Release. These builds run remotely and do not use the local computer's CPU, memory, or disk.

### Application updates

Packaged Hexa builds check the `SOREX-AI/Hexa` GitHub Releases feed shortly after launch and every 30 minutes while running. Checks never download automatically. When a newer release is available, the title bar keeps an update button visible until the user chooses to download it. Its confirmation dialog renders the Markdown notes for that specific release, and About Hexa also provides a manual check and reports the current status.

The desktop package is the update unit. Its `resources/bin` directory contains the matching Hexa Engine, app server, code-mode host, command runner, and platform sandbox helpers, so they are replaced together with the shell. On the first launch of a new app version, Hexa deletes generated engine caches and any legacy staged source left by older releases; account state, chats, configuration, plugins, skills, and workspaces remain untouched.

For an update to be discoverable:

1. Set the same SemVer in the shell package and app-server client metadata.
2. Commit the complete corresponding source and create a matching `v<version>` tag.
3. Allow the all-platform workflow to finish and publish its GitHub Release assets.
4. Verify that the release contains the installer plus `latest.yml`, `latest-mac.yml`, or `latest-linux.yml` as appropriate.

Ordinary branch and pull-request builds are development artifacts and may be unsigned. Tag-triggered production releases require signing credentials: `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` for Windows, plus `MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for macOS signing and notarization. The workflow refuses to publish a tagged release when these credentials are absent. The updater also verifies Electron Builder's release metadata and artifact checksum.

The workflow caches Cargo downloads, Electron downloads, Electron Builder tools, and the platform-specific Rusty V8 assets. It intentionally does not cache `engine/target`, which can grow beyond the practical cache and disk limits of a hosted runner.

## Cleaning generated files

Preview generated files and dependency directories that would be removed:

```sh
node hexa.mjs clean --dry-run
```

Remove them:

```sh
node hexa.mjs clean
```

The clean command removes known build output, caches, staged binaries, and dependency directories throughout the repository. It preserves source files and dependency lockfiles. Run `node hexa.mjs setup` before building again.

## Command reference

| Command                                 | Purpose                                                          |
| --------------------------------------- | ---------------------------------------------------------------- |
| `node hexa.mjs setup`                   | Install JavaScript dependencies                                  |
| `node hexa.mjs check`                   | Check development prerequisites                                  |
| `node hexa.mjs dev`                     | Start the development app                                        |
| `node hexa.mjs typecheck`               | Type-check desktop TypeScript                                    |
| `node hexa.mjs build`                   | Build the desktop client                                         |
| `node hexa.mjs engine-check`            | Validate the engine layout                                       |
| `node hexa.mjs engine-build`            | Build and stage the Rust runtime                                 |
| `node hexa.mjs pack`                    | Create an unpacked app                                           |
| `node hexa.mjs dist`                    | Create an installer                                              |
| `node hexa.mjs clean`                   | Remove dependencies and generated files                          |
| `node hexa.mjs protocol-sync`           | Refresh generated protocol types                                 |
| `node hexa.mjs upstream-update <ref>`   | Preview an engine-source update; add `--apply` to install it     |
| `node hexa.mjs version-import <folder>` | Validate an offline engine snapshot; add `--apply` to install it |

`node hexa.mjs <command>` is the canonical interface. The root package also exposes matching `npm run shell:<command>` helpers, plus selected `npm run hexa:<command>` release helpers; use `node hexa.mjs help` to see the complete current command list.

## Runtime files

Source builds compile `engine/Cargo.toml`. Packaged Windows builds stage `HexaEngine.exe`, `HexaAppServer.exe`, `HexaCodeModeHost.exe`, `HexaCommandRunner.exe`, and `HexaSandboxSetup.exe`; other platforms use equivalent `hexa-*` names.

The app launches `HexaAppServer` over standard input and output. Source checkouts can rebuild the engine from `./engine` with Cargo. Packaged builds never compile Rust or depend on a bundled source tree; they run the prebuilt binaries from `resources/bin`.
