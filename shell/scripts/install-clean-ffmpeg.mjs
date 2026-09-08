import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadArtifact } from '@electron/get';
import extractZip from '@electron-internal/extract-zip';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const libraryNames = {
  win32: 'ffmpeg.dll',
  darwin: 'libffmpeg.dylib',
  linux: 'libffmpeg.so',
};
const archNames = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

async function filesNamed(root, expectedName) {
  const matches = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && entry.name.toLowerCase() === expectedName.toLowerCase()) matches.push(candidate);
    }
  }
  await visit(root);
  return matches;
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

function normalizeArch(arch) {
  if (typeof arch === 'number' && archNames[arch]) return archNames[arch];
  if (typeof arch === 'string' && archNames.includes(arch)) return arch;
  throw new Error(`Unsupported Electron packaging architecture: ${String(arch)}`);
}

export async function installCleanFfmpeg({ appOutDir, platform, arch }) {
  const libraryName = libraryNames[platform];
  if (!libraryName) throw new Error(`Unsupported Electron packaging platform: ${platform}`);
  const normalizedArch = normalizeArch(arch);
  if (normalizedArch === 'universal') {
    throw new Error('Electron does not publish a universal clean FFmpeg artifact; replace it before universalizing the macOS app.');
  }

  const packageJson = JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));
  const electronVersion = packageJson.devDependencies?.electron;
  if (!/^\d+\.\d+\.\d+(?:-.+)?$/.test(electronVersion ?? '')) {
    throw new Error('shell/package.json must pin an exact Electron version before installing clean FFmpeg.');
  }

  const destinations = await filesNamed(appOutDir, libraryName);
  if (destinations.length !== 1) {
    throw new Error(`Expected exactly one packaged ${libraryName} under ${appOutDir}, found ${destinations.length}.`);
  }

  const temporaryDir = await mkdtemp(path.join(os.tmpdir(), 'hexa-clean-ffmpeg-'));
  try {
    const archive = await downloadArtifact({
      version: electronVersion,
      artifactName: 'ffmpeg',
      platform,
      arch: normalizedArch,
      cacheRoot: process.env.ELECTRON_BUILDER_CACHE,
    });
    await extractZip(archive, { dir: temporaryDir });
    const sources = await filesNamed(temporaryDir, libraryName);
    if (sources.length !== 1) {
      throw new Error(`Electron's FFmpeg archive contained ${sources.length} copies of ${libraryName}; refusing an ambiguous replacement.`);
    }

    await copyFile(sources[0], destinations[0]);
    const [sourceInfo, destinationInfo, sourceHash, destinationHash] = await Promise.all([
      stat(sources[0]), stat(destinations[0]), sha256(sources[0]), sha256(destinations[0]),
    ]);
    if (sourceInfo.size !== destinationInfo.size || sourceHash !== destinationHash) {
      throw new Error(`Packaged ${libraryName} does not match Electron's checksum-verified clean artifact.`);
    }

    const receipt = {
      source: 'Electron official ffmpeg release artifact',
      electronVersion,
      platform,
      arch: normalizedArch,
      library: path.relative(appOutDir, destinations[0]),
      bytes: destinationInfo.size,
      sha256: destinationHash,
    };
    await writeFile(path.join(appOutDir, 'resources', 'HEXA_CLEAN_FFMPEG.json'), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    console.log(`✓ Replaced ${libraryName} with Electron ${electronVersion}'s checksum-verified clean FFmpeg (${platform}-${normalizedArch})`);
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
}

export default async function afterPack(context) {
  await installCleanFfmpeg({
    appOutDir: context.appOutDir,
    platform: context.electronPlatformName,
    arch: context.arch,
  });
}
