#!/usr/bin/env node
import { cp, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { engineRoot as currentTree, repoRoot, requiredEnginePaths, versionsRoot } from './engine-layout.mjs';
import { applyHexaEnginePatches } from './engine-patches.mjs';
const requested = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const apply = process.argv.includes('--apply');

if (!requested) throw new Error('Specify a folder under ./versions, for example: npm run hexa:version -- 0.99.0');
const versionRoot = path.resolve(versionsRoot, requested);
const relativeVersion = path.relative(versionsRoot, versionRoot);
if (!relativeVersion || relativeVersion.startsWith('..') || path.isAbsolute(relativeVersion)) {
  throw new Error('The version must resolve to a child folder of ./versions.');
}

async function exists(candidate) {
  return stat(candidate).then(() => true, () => false);
}

let sourceTree = versionRoot;
if (await exists(path.join(versionRoot, 'codex-rs', 'Cargo.toml'))) sourceTree = path.join(versionRoot, 'codex-rs');
if (await exists(path.join(versionRoot, 'engine', 'Cargo.toml'))) sourceTree = path.join(versionRoot, 'engine');
if (!(await exists(path.join(sourceTree, 'Cargo.toml')))) throw new Error(`No compatible upstream Rust workspace was found in ${versionRoot}.`);

const missing = [];
for (const relative of requiredEnginePaths.slice(1)) {
  if (!(await exists(path.join(sourceTree, relative)))) missing.push(relative);
}
const manifest = await readFile(path.join(sourceTree, 'Cargo.toml'), 'utf8');
if (!manifest.includes('codex-app-server') || !manifest.includes('codex-cli')) {
  missing.push('workspace binary declarations for codex-app-server/codex-cli');
}
if (missing.length) throw new Error(`Snapshot is incompatible with Hexa's engine adapter:\n- ${missing.join('\n- ')}`);

const backupTree = path.join(repoRoot, 'engine.before-version-update');
console.log(`Validated upstream engine snapshot: ${sourceTree}`);
if (!apply) {
  console.log('No files changed. Re-run with --apply to install it and preserve the current tree as engine.before-version-update.');
  process.exit(0);
}
if (await exists(backupTree)) throw new Error(`Archive or remove the existing backup first: ${backupTree}`);

const stage = path.join(repoRoot, '.hexa-version-stage');
await rm(stage, { recursive: true, force: true });
await cp(sourceTree, stage, { recursive: true, force: true });
const patches = await applyHexaEnginePatches(stage);
await rename(currentTree, backupTree);
try {
  await rename(stage, currentTree);
} catch (error) {
  await rename(backupTree, currentTree);
  throw error;
}
console.log(`Installed ${requested}. Hexa's adapter applied branding (${patches.brandingFilesChanged} files), Cargo/package/process rebrand (${patches.cargoPackagesRenamed} packages, ${patches.cargoSourceDirectoriesRenamed} directories), runtime/state isolation (${patches.runtimeIsolationFilesChanged} files), local-provider/resume compatibility, and ${patches.bazelFilesChanged} Bazel path files.\nPrevious tree: ${backupTree}`);
