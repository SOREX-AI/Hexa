import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, copyFile, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolveNativeBuildEnvironment } from './tooling.mjs';
import { engineManifest as manifest, engineReleaseDir as outputDir, repoRoot, shellRoot } from './engine-layout.mjs';

const suffix = process.platform === 'win32' ? '.exe' : '';
const binaries = [
  { cargoBin: 'hexa-engine', sourceName: `hexa-engine${suffix}`, fileName: process.platform === 'win32' ? 'HexaEngine.exe' : 'hexa-engine' },
  { cargoBin: 'hexa-app-server', sourceName: `hexa-app-server${suffix}`, fileName: process.platform === 'win32' ? 'HexaAppServer.exe' : 'hexa-app-server' },
  { cargoBin: 'hexa-code-mode-host', sourceName: `hexa-code-mode-host${suffix}`, fileName: process.platform === 'win32' ? 'HexaCodeModeHost.exe' : 'hexa-code-mode-host' },
];
if (process.platform === 'win32') {
  binaries.push(
    { cargoBin: 'hexa-command-runner', sourceName: 'hexa-command-runner.exe', fileName: 'HexaCommandRunner.exe' },
    { cargoBin: 'hexa-windows-sandbox-setup', sourceName: 'hexa-windows-sandbox-setup.exe', fileName: 'HexaSandboxSetup.exe' },
  );
} else if (process.platform === 'linux') {
  binaries.push({ cargoBin: 'bwrap', fileName: 'bwrap' });
}

const destinationDir = path.join(shellRoot, 'resources', 'bin');

async function checksumMatches(filePath, checksum) {
  const contents = await readFile(filePath).catch(() => null);
  return contents ? createHash('sha256').update(contents).digest('hex') === checksum : false;
}

async function cacheBuildAsset(url, destination, checksum) {
  const existing = await stat(destination).catch(() => null);
  if (existing?.isFile() && existing.size > 0 && (!checksum || await checksumMatches(destination, checksum))) return;

  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  await rm(temporary, { force: true });
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not download Hexa Engine build asset (${response.status} ${response.statusText}): ${url}`);
    }
    await writeFile(temporary, new Uint8Array(await response.arrayBuffer()));
    if (checksum && !(await checksumMatches(temporary, checksum))) {
      throw new Error(`Hexa Engine build asset failed checksum validation: ${url}`);
    }
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function rustyV8Target() {
  if (process.platform === 'win32' && process.arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'aarch64-apple-darwin';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'x86_64-apple-darwin';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  if (process.platform === 'linux' && process.arch === 'x64') return 'x86_64-unknown-linux-gnu';
  return null;
}

async function resolveHexaEngineBuildEnvironment() {
  const env = { ...native.env, CARGO_TERM_COLOR: 'always' };
  if (env.V8_FROM_SOURCE && ['1', 'true', 'yes'].includes(env.V8_FROM_SOURCE.toLowerCase())) return env;
  if (env.RUSTY_V8_ARCHIVE && env.RUSTY_V8_SRC_BINDING_PATH) return env;
  if (env.RUSTY_V8_ARCHIVE || env.RUSTY_V8_SRC_BINDING_PATH) {
    throw new Error('RUSTY_V8_ARCHIVE and RUSTY_V8_SRC_BINDING_PATH must be set together.');
  }

  const workspaceManifest = await readFile(manifest, 'utf8');
  const v8Version = workspaceManifest.match(/^v8\s*=\s*"=(\d+\.\d+\.\d+)"/m)?.[1];
  if (!v8Version) return env;

  // Keep the sandboxed V8 build and use the matching, checksum-pinned artifact
  // pair published with OpenAI Codex. The generic rusty_v8 release does not
  // publish every ptr-compression+sandbox target used by the code-mode host.
  const releaseRoot = `https://github.com/openai/codex/releases/download/rusty-v8-v${v8Version}`;
  const target = rustyV8Target();
  if (!target) return env;
  const cacheDir = path.join(shellRoot, '.cache', 'rusty-v8', v8Version);
  const archiveName = process.platform === 'win32'
    ? `rusty_v8_ptrcomp_sandbox_release_${target}.lib.gz`
    : `librusty_v8_ptrcomp_sandbox_release_${target}.a.gz`;
  const bindingName = `src_binding_ptrcomp_sandbox_release_${target}.rs`;
  const checksumName = `rusty_v8_ptrcomp_sandbox_release_${target}.sha256`;
  const archivePath = path.join(cacheDir, archiveName);
  const bindingPath = path.join(cacheDir, bindingName);
  const checksumPath = path.join(cacheDir, checksumName);
  await cacheBuildAsset(`${releaseRoot}/${checksumName}`, checksumPath);
  const checksums = new Map(
    (await readFile(checksumPath, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => {
      const [digest, file] = line.trim().split(/\s+/, 2);
      return [file, digest];
    }),
  );
  const archiveChecksum = checksums.get(archiveName);
  const bindingChecksum = checksums.get(bindingName);
  if (!archiveChecksum || !bindingChecksum) throw new Error(`Invalid V8 checksum manifest: ${checksumPath}`);
  await Promise.all([
    cacheBuildAsset(`${releaseRoot}/${archiveName}`, archivePath, archiveChecksum),
    cacheBuildAsset(`${releaseRoot}/${bindingName}`, bindingPath, bindingChecksum),
  ]);
  env.RUSTY_V8_ARCHIVE = archivePath;
  env.RUSTY_V8_SRC_BINDING_PATH = bindingPath;
  return env;
}

await stat(manifest).catch(() => {
  throw new Error(`Missing Hexa Engine workspace at ${manifest}`);
});

const native = resolveNativeBuildEnvironment();
if (process.platform === 'win32' && !native.msvcPath?.match(/[\\/]x64[\\/]cl\.exe$/i)) {
  throw new Error(
    'MSVC x64 build tools are required. Install the Visual Studio Desktop development with C++ workload and a Windows SDK.',
  );
}

console.log('Building the complete Hexa Engine runtime from the repository source tree…');
console.log(`  ${manifest}`);
if (process.platform === 'win32' && native.source === 'visual-studio') {
  console.log(`  MSVC: ${native.msvcPath}`);
}

const args = ['build', '--release', '--manifest-path', manifest];
for (const binary of binaries) args.push('--bin', binary.cargoBin);
const buildEnvironment = await resolveHexaEngineBuildEnvironment();

await new Promise((resolve, reject) => {
  const child = spawn('cargo', args, {
    cwd: repoRoot,
    env: buildEnvironment,
    shell: false,
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`cargo exited with ${code}`))));
});

await mkdir(destinationDir, { recursive: true });
// Keep resources/bin platform-pure. This directory is copied verbatim into
// packaged apps, so stale binaries from a previous build on another OS/arch
// must not survive into the next distribution.
for (const stale of [
  'HexaEngine.exe', 'hexa-engine',
  'HexaAppServer.exe', 'hexa-app-server',
  'HexaCodeModeHost.exe', 'hexa-code-mode-host',
  'HexaCommandRunner.exe',
  'HexaSandboxSetup.exe',
  'bwrap',
  'codex.exe', 'codex',
  'codex-app-server.exe', 'codex-app-server',
  'codex-code-mode-host.exe', 'codex-code-mode-host',
  '.hexa-runtime-revision',
]) {
  await rm(path.join(destinationDir, stale), { force: true });
}
for (const binary of binaries) {
  const output = path.join(outputDir, binary.sourceName ?? binary.fileName);
  const destination = path.join(destinationDir, binary.fileName);
  await stat(output);
  await copyFile(output, destination);
  if (process.platform !== 'win32') await chmod(destination, 0o755);
  console.log(`  ✓ ${binary.fileName}`);
}
console.log(`\n✓ Complete runtime staged at ${destinationDir}`);
