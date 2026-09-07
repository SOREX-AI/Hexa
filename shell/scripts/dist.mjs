import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { run, runNodeBin, waitForExit } from './tooling.mjs';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const here = path.dirname(fileURLToPath(import.meta.url));

for (const script of ['build-all.mjs', 'build-engine.mjs']) {
  const child = run(process.execPath, [path.join(here, script)], { cwd: shellRoot });
  await waitForExit(child, script);
}

const legalNotices = run(process.execPath, [path.join(here, 'generate-third-party-notices.mjs')], { cwd: shellRoot });
await waitForExit(legalNotices, 'third-party notice generation');

// CI publishes the completed cross-platform set in one release job. Building
// each native package must generate update metadata without independently
// racing to create or mutate the GitHub Release.
const args = [...(process.argv.includes('--dir') ? ['--dir'] : []), '--publish', 'never'];
const builder = await runNodeBin('electron-builder', 'electron-builder', args, { cwd: shellRoot });
await waitForExit(builder, 'Electron Builder');

// Always stage the completed package, including unpacked `pack` builds, in the
// root distribution directory. This keeps the command contract consistent for
// CI and local testing and includes the bundled Hexa Engine runtime.
const releaseDir = path.join(shellRoot, 'release');
const distributionDir = path.join(path.resolve(shellRoot, '..'), 'dist-release');
await rm(distributionDir, { recursive: true, force: true });
await mkdir(distributionDir, { recursive: true });
const artifacts = [];
for (const entry of await readdir(releaseDir, { withFileTypes: true })) {
  // Electron Builder writes internal YAML beside the artifacts, but the
  // latest*.yml files are the signed-checksum manifests consumed by packaged
  // clients and must reach the GitHub Release with their installers.
  if (/\.ya?ml$/i.test(entry.name) && !/^latest(?:-mac|-linux)?\.yml$/i.test(entry.name)) continue;
  const source = path.join(releaseDir, entry.name);
  const destination = path.join(distributionDir, entry.name);
  if (entry.isDirectory()) await cp(source, destination, { recursive: true });
  else if (entry.isFile()) await copyFile(source, destination);
  else continue;
  const info = await stat(destination);
  artifacts.push({ file: entry.name, bytes: info.size, directory: entry.isDirectory() });
}
await writeFile(
  path.join(distributionDir, 'release-manifest.json'),
  `${JSON.stringify({ platform: process.platform, arch: process.arch, unpacked: args.includes('--dir'), artifacts }, null, 2)}\n`,
);
console.log(`\n✓ Release artifacts copied to ${distributionDir}`);
