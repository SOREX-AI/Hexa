#!/usr/bin/env node
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './engine-layout.mjs';

const fixedTargets = [
  '.hexa-upstream-stage',
  '.hexa-upstream-reference-stage',
  'engine.before-update',
  path.join('vendor', 'upstream-engine-reference'),
  path.join('vendor', 'upstream-engine-reference.before-update'),
];
const rootEntries = await readdir(repoRoot, { withFileTypes: true });
const rollbackTargets = rootEntries
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('engine.before-update-'))
  .map((entry) => entry.name);
const targets = [...new Set([...fixedTargets, ...rollbackTargets])];

function resolveInsideRepo(relative) {
  const resolved = path.resolve(repoRoot, relative);
  const boundary = `${path.resolve(repoRoot)}${path.sep}`;
  if (!resolved.startsWith(boundary)) throw new Error(`Refusing to clean path outside the Hexa repository: ${resolved}`);
  return resolved;
}

for (const relative of targets) {
  const resolved = resolveInsideRepo(relative);
  await rm(resolved, { recursive: true, force: true });
  console.log(`Removed ${path.relative(repoRoot, resolved)}`);
}

console.log('Hexa upstream working trees are clean. The tracked engine/ source tree was preserved.');
