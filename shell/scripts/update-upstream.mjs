#!/usr/bin/env node
import { cp, mkdtemp, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { engineRoot as currentTree, repoRoot, requiredEnginePaths } from './engine-layout.mjs';
import { applyHexaEnginePatches } from './engine-patches.mjs';

const backupTree = path.join(repoRoot, 'engine.before-update');
const apply = process.argv.includes('--apply');
const requestedRef = process.argv.slice(2).find((argument) => !argument.startsWith('--')) || 'main';
const remote = process.env.HEXA_ENGINE_UPSTREAM || 'https://github.com/openai/codex.git';

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false, windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

if (!apply) {
  console.log(`Hexa upstream update preview\n\nRemote: ${remote}\nRef:    ${requestedRef}\nTarget: ${currentTree}\n\nNo files changed. Re-run with --apply to fetch this ref, preserve the current tree as engine.before-update, and install the new upstream engine tree.`);
  process.exit(0);
}

if (!existsSync(currentTree)) throw new Error(`Missing upstream tree: ${currentTree}`);
if (existsSync(backupTree)) throw new Error(`Remove or archive the existing backup before updating: ${backupTree}`);

const temporary = await mkdtemp(path.join(os.tmpdir(), 'hexa-engine-upstream-'));
const checkout = path.join(temporary, 'checkout');
const stagedTree = path.join(repoRoot, '.hexa-upstream-stage');
try {
  await run('git', ['clone', '--filter=blob:none', '--no-checkout', remote, checkout], repoRoot);
  await run('git', ['fetch', '--depth=1', 'origin', requestedRef], checkout);
  await run('git', ['checkout', '--detach', 'FETCH_HEAD'], checkout);
  await rm(stagedTree, { recursive: true, force: true });
  const upstreamTree = path.join(checkout, 'codex-rs');
  for (const relative of requiredEnginePaths) {
    if (!existsSync(path.join(upstreamTree, relative))) {
      throw new Error(`Upstream layout changed: missing codex-rs/${relative}`);
    }
  }
  await cp(upstreamTree, stagedTree, { recursive: true, force: true });
  const patches = await applyHexaEnginePatches(stagedTree);
  await rename(currentTree, backupTree);
  try {
    await rename(stagedTree, currentTree);
  } catch (error) {
    await rename(backupTree, currentTree);
    throw error;
  }
  console.log(`Updated engine from ${remote} at ${requestedRef}.\nPrevious source: ${backupTree}\nApplied Hexa adapter: branding (${patches.brandingFilesChanged} files) + Cargo/package/process rebrand (${patches.cargoPackagesRenamed} packages, ${patches.cargoSourceDirectoriesRenamed} directories) + runtime/state isolation (${patches.runtimeIsolationFilesChanged} files) + local-provider/resume compatibility + ${patches.bazelFilesChanged} Bazel path files.\n\nRun npm run hexa:engine-check and npm run hexa:build before deleting the backup.`);
} finally {
  await rm(stagedTree, { recursive: true, force: true });
  await rm(temporary, { recursive: true, force: true });
}
