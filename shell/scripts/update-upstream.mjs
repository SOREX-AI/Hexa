#!/usr/bin/env node
import { appendFile, cp, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { engineRoot as currentTree, repoRoot, requiredEnginePaths } from './engine-layout.mjs';
import { applyHexaEnginePatches } from './engine-patches.mjs';

const backupTree = path.join(repoRoot, 'engine.before-update');
const referenceTree = path.join(repoRoot, 'vendor', 'upstream-engine-reference');
const referenceBackupTree = path.join(repoRoot, 'vendor', 'upstream-engine-reference.before-update');
const apply = process.argv.includes('--apply');
const referenceOnly = process.argv.includes('--reference-only');
const requestedRef = process.argv.slice(2).find((argument) => !argument.startsWith('--')) || 'main';
const remote = process.env.HEXA_ENGINE_UPSTREAM || 'https://github.com/openai/codex.git';

function run(command, args, cwd, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      shell: false,
      windowsHide: true,
    });
    let output = '';
    if (capture) child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0
      ? resolve(capture ? output.trim() : undefined)
      : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function installStagedTrees(entries) {
  for (const entry of entries) {
    if (entry.requireCurrent !== false && !existsSync(entry.current)) throw new Error(`Missing update target: ${entry.current}`);
    if (existsSync(entry.backup)) throw new Error(`Remove or archive the existing backup before updating: ${entry.backup}`);
  }

  const backedUp = [];
  const installed = [];
  try {
    for (const entry of entries) {
      if (existsSync(entry.current)) {
        await rename(entry.current, entry.backup);
        backedUp.push(entry);
      }
    }
    for (const entry of entries) {
      await rename(entry.staged, entry.current);
      installed.push(entry);
    }
  } catch (error) {
    for (const entry of installed.reverse()) await rm(entry.current, { recursive: true, force: true });
    for (const entry of backedUp.reverse()) {
      if (existsSync(entry.backup)) await rename(entry.backup, entry.current);
    }
    throw error;
  }
}

if (!apply) {
  const mode = referenceOnly ? 'upstream reference snapshot only' : 'engine and complete upstream reference snapshot';
  console.log(`Hexa upstream update preview\n\nRemote: ${remote}\nRef:    ${requestedRef}\nMode:   ${mode}\nEngine: ${currentTree}\nReference: ${referenceTree}\n\nNo files changed. Re-run with --apply to fetch this exact ref and install ignored-backup-protected replacements.`);
  process.exit(0);
}

const temporary = await mkdtemp(path.join(os.tmpdir(), 'hexa-engine-upstream-'));
const checkout = path.join(temporary, 'checkout');
const stagedTree = path.join(repoRoot, '.hexa-upstream-stage');
const stagedReferenceTree = path.join(repoRoot, '.hexa-upstream-reference-stage');
try {
  // Patch anchors are defined against upstream's committed LF content. Do not
  // let a contributor's global core.autocrlf setting rewrite the staged tree.
  await run('git', ['-c', 'core.autocrlf=false', 'clone', '--filter=blob:none', '--no-checkout', remote, checkout], repoRoot);
  await run('git', ['config', 'core.autocrlf', 'false'], checkout);
  await run('git', ['fetch', '--depth=1', 'origin', requestedRef], checkout);
  await run('git', ['checkout', '--detach', 'FETCH_HEAD'], checkout);
  const revision = await run('git', ['rev-parse', 'HEAD'], checkout, true);

  await rm(stagedReferenceTree, { recursive: true, force: true });
  await cp(checkout, stagedReferenceTree, {
    recursive: true,
    force: true,
    filter(source) {
      const relative = path.relative(checkout, source);
      if (!relative) return true;
      const rootEntry = relative.split(path.sep, 1)[0];
      return rootEntry !== '.git' && rootEntry !== 'codex-rs';
    },
  });
  // Upstream tracks these workspace recommendations while also ignoring the
  // directory. Once nested inside Hexa that would make a normal `git add -A`
  // silently omit them, so keep the upstream files and make the mirror
  // commit-friendly for every contributor.
  await appendFile(
    path.join(stagedReferenceTree, '.gitignore'),
    '\n# Hexa downstream mirror: keep upstream-tracked editor recommendations tracked.\n!/.vscode/\n!/.vscode/**\n',
    'utf8',
  );
  await writeFile(
    path.join(stagedReferenceTree, 'UPSTREAM_SOURCE.json'),
    `${JSON.stringify({ remote, ref: requestedRef, revision }, null, 2)}\n`,
    'utf8',
  );

  let patches;
  const entries = [{ current: referenceTree, backup: referenceBackupTree, staged: stagedReferenceTree, requireCurrent: false }];
  if (!referenceOnly) {
    await rm(stagedTree, { recursive: true, force: true });
    const upstreamTree = path.join(checkout, 'codex-rs');
    for (const relative of requiredEnginePaths) {
      if (!existsSync(path.join(upstreamTree, relative))) {
        throw new Error(`Upstream layout changed: missing codex-rs/${relative}`);
      }
    }
    await cp(upstreamTree, stagedTree, { recursive: true, force: true });
    patches = await applyHexaEnginePatches(stagedTree);
    entries.unshift({ current: currentTree, backup: backupTree, staged: stagedTree });
  }

  await installStagedTrees(entries);
  if (referenceOnly) {
    console.log(`Updated complete inert upstream reference from ${remote} at ${revision}.\nPrevious reference: ${referenceBackupTree}`);
  } else {
    console.log(`Updated engine and complete inert upstream reference from ${remote} at ${revision}.\nPrevious engine: ${backupTree}\nPrevious reference: ${referenceBackupTree}\nApplied Hexa adapter: branding (${patches.brandingFilesChanged} files) + Cargo/package/process rebrand (${patches.cargoPackagesRenamed} packages, ${patches.cargoSourceDirectoriesRenamed} directories) + runtime/state isolation (${patches.runtimeIsolationFilesChanged} files) + local-provider/resume compatibility + ${patches.bazelFilesChanged} Bazel path files.\n\nRun npm run hexa:engine-check and npm run hexa:build before deleting the backups.`);
  }
} finally {
  await rm(stagedTree, { recursive: true, force: true });
  await rm(stagedReferenceTree, { recursive: true, force: true });
  await rm(temporary, { recursive: true, force: true });
}
