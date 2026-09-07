import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(shellRoot, '..');
export const engineRoot = path.join(repoRoot, 'engine');
export const engineManifest = path.join(engineRoot, 'Cargo.toml');
export const engineReleaseDir = path.join(engineRoot, 'target', 'release');
export const versionsRoot = path.join(repoRoot, 'versions');

export const requiredEnginePaths = [
  'Cargo.toml',
  'app-server/Cargo.toml',
  'app-server-protocol/Cargo.toml',
  'cli/Cargo.toml',
  'core/Cargo.toml',
];
