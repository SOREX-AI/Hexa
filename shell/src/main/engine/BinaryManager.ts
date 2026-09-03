import { app } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import type { HexaEngineStatus } from '../../shared/types.js';
import { resolveNativeBuildEnvironment } from './NativeBuildEnvironment.js';

export type StatusReporter = (status: HexaEngineStatus) => void;

type RuntimeBinary = {
  cargoBin: string;
  sourceName?: string;
  fileName: string;
};

const executableSuffix = process.platform === 'win32' ? '.exe' : '';
const sourceEngineExecutableName = `hexa-engine${executableSuffix}`;
const executableName = process.platform === 'win32' ? 'HexaEngine.exe' : 'hexa-engine';
// Bump when a required runtime helper changes. This makes a source checkout
// refresh its cached runtime instead of continuing to run a stale helper.
const runtimeRevision = 'sandbox-sid-retry-v1';
const runtimeRevisionFile = '.hexa-runtime-revision';
const installedAppVersionFile = '.hexa-installed-app-version';

// These binaries are required for the normal shell and its sandboxed tool calls.
function runtimeBinaries(): RuntimeBinary[] {
  const binaries: RuntimeBinary[] = [
    { cargoBin: 'hexa-engine', sourceName: sourceEngineExecutableName, fileName: executableName },
    { cargoBin: 'hexa-app-server', sourceName: `hexa-app-server${executableSuffix}`, fileName: process.platform === 'win32' ? 'HexaAppServer.exe' : 'hexa-app-server' },
    { cargoBin: 'hexa-code-mode-host', sourceName: `hexa-code-mode-host${executableSuffix}`, fileName: process.platform === 'win32' ? 'HexaCodeModeHost.exe' : 'hexa-code-mode-host' },
  ];

  if (process.platform === 'win32') {
    binaries.push(
      { cargoBin: 'hexa-command-runner', sourceName: 'hexa-command-runner.exe', fileName: 'HexaCommandRunner.exe' },
      { cargoBin: 'hexa-windows-sandbox-setup', sourceName: 'hexa-windows-sandbox-setup.exe', fileName: 'HexaSandboxSetup.exe' },
    );
  } else if (process.platform === 'linux') {
    binaries.push({ cargoBin: 'bwrap', fileName: 'bwrap' });
  }

  return binaries;
}

function externalCodeModeHost(): string | null {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const externalHostExecutable = process.platform === 'win32' ? 'HexaCodeModeHost.exe' : 'hexa-code-mode-host';
  const result = spawnSync(command, [externalHostExecutable], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return result.stdout.trim().split(/\r?\n/).find(Boolean)?.trim() || null;
}

function rustyV8Target(): string | null {
  if (process.platform === 'win32' && process.arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'aarch64-apple-darwin';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'x86_64-apple-darwin';
  if (process.platform === 'linux' && process.arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  if (process.platform === 'linux' && process.arch === 'x64') return 'x86_64-unknown-linux-gnu';
  return null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    try {
      await access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

export class BinaryManager {
  private readonly report: StatusReporter;

  constructor(report: StatusReporter) {
    this.report = report;
  }

  get shellRoot(): string {
    return app.isPackaged ? app.getAppPath() : path.resolve(app.getAppPath());
  }

  get repositoryRoot(): string {
    return app.isPackaged ? process.resourcesPath : path.resolve(this.shellRoot, '..');
  }

  get sourceRoot(): string {
    return this.repositoryRoot;
  }

  get bundledRuntimeDir(): string {
    return path.join(process.resourcesPath, 'bin');
  }

  get cachedRuntimeDir(): string {
    return path.join(app.getPath('userData'), 'bin');
  }

  get sourceRuntimeDir(): string {
    return path.join(this.sourceRoot, 'engine', 'target', 'release');
  }

  get bundledBinary(): string {
    return path.join(this.bundledRuntimeDir, executableName);
  }

  get cachedBinary(): string {
    return path.join(this.cachedRuntimeDir, executableName);
  }

  get sourceBinary(): string {
    return path.join(this.sourceRuntimeDir, sourceEngineExecutableName);
  }

  async ensureBinary(forceRebuild = false): Promise<string> {
    this.report({ phase: 'checking', message: 'Checking Hexa Engine…' });

    // Packaged Hexa is intentionally binary-only. Never fall back to a Cargo
    // source tree (or require Rust to be installed) after distribution. The
    // native runtime staged by build-engine.mjs is the packaged runtime.
    if (app.isPackaged) {
      // The application package itself is the version boundary, so the
      // bundled directory does not need the development cache revision marker.
      if (await this.runtimeUsable(this.bundledRuntimeDir, false, false, false)) {
        this.report({
          phase: 'starting',
          message: 'Using bundled Hexa Engine',
          binaryPath: this.bundledBinary,
        });
        return this.bundledBinary;
      }
      throw new Error(
        `The packaged Hexa Engine runtime is missing or incomplete at ${this.bundledRuntimeDir}. Reinstall Hexa with a complete package.`,
      );
    }

    if (!forceRebuild && (await this.runtimeUsable(this.cachedRuntimeDir))) {
      this.report({
        phase: 'starting',
        message: 'Using locally built Hexa Engine',
        binaryPath: this.cachedBinary,
      });
      return this.cachedBinary;
    }

    // A sandbox-helper-only update should not make a development checkout
    // rebuild the whole Rust workspace. If the cached runtime is otherwise
    // complete, replace the newly-built helper and mark that runtime current.
    if (!forceRebuild
      && (await this.runtimeComplete(this.cachedRuntimeDir))
      && (await this.refreshCachedSandboxSetup())
      && (await this.runtimeUsable(this.cachedRuntimeDir))) {
      this.report({
        phase: 'starting',
        message: 'Updated Hexa sandbox helper',
        binaryPath: this.cachedBinary,
      });
      return this.cachedBinary;
    }

    // A source checkout may already contain a complete release build even when
    // the shell cache has not been populated yet (or was removed by an update).
    // Stage that build directly instead of invoking Cargo again.
    if (!forceRebuild && (await this.runtimeUsable(this.sourceRuntimeDir, true, true, false))) {
      await this.stageRuntime(this.sourceRuntimeDir, this.cachedRuntimeDir);
      this.report({
        phase: 'starting',
        message: 'Using existing Hexa Engine release build',
        detail: this.sourceRuntimeDir,
        binaryPath: this.cachedBinary,
      });
      return this.cachedBinary;
    }

    if (!(await exists(path.join(this.sourceRoot, 'engine', 'Cargo.toml')))) {
      throw new Error(
        `The upstream engine source was not found at ${this.sourceRoot}. In a source checkout shell/ must live directly beside engine.`,
      );
    }

    await this.assertCommand('cargo', ['--version'], 'Rust/Cargo');

    const cargoBins = runtimeBinaries().map((entry) => entry.cargoBin);
    this.report({
      phase: 'building',
      message: 'Building Hexa Engine from source…',
      detail: 'Compiling primary engine and required platform helpers',
      progress: 0.04,
    });

    await this.runCargoBuild(cargoBins);
    await this.stageRuntime(this.sourceRuntimeDir, this.cachedRuntimeDir);

    this.report({
      phase: 'starting',
      message: 'Hexa Engine build complete',
      detail: this.cachedRuntimeDir,
      progress: 1,
      binaryPath: this.cachedBinary,
    });
    return this.cachedBinary;
  }

  async clearCachedBinary(): Promise<void> {
    await rm(this.cachedRuntimeDir, { recursive: true, force: true });
  }

  async prepareForAppVersion(): Promise<void> {
    if (!app.isPackaged) return;
    const marker = path.join(app.getPath('userData'), installedAppVersionFile);
    const installedVersion = (await readFile(marker, 'utf8').catch(() => '')).trim();
    const currentVersion = app.getVersion();
    if (installedVersion !== currentVersion) {
      // These directories contain generated/cached engine artifacts only. A
      // full app update replaces resources/bin atomically; removing old caches
      // prevents any previous engine or helper from being selected afterward.
      await rm(this.cachedRuntimeDir, { recursive: true, force: true });
      // Remove the legacy source cache left by older Hexa builds that bundled
      // the Cargo workspace. New packages never recreate it.
      await rm(path.join(app.getPath('userData'), 'source', 'engine-source'), { recursive: true, force: true });
      await mkdir(path.dirname(marker), { recursive: true });
      await writeFile(marker, `${currentVersion}\n`, 'utf8');
    }
  }

  private async runtimeComplete(directory: string, allowExternalHost = false, sourceLayout = false): Promise<boolean> {
    for (const binary of runtimeBinaries()) {
      const name = sourceLayout ? (binary.sourceName ?? binary.fileName) : binary.fileName;
      if (await exists(path.join(directory, name))) continue;
      if (allowExternalHost && binary.cargoBin === 'hexa-code-mode-host' && externalCodeModeHost()) continue;
      return false;
    }
    return true;
  }

  private async runtimeUsable(directory: string, allowExternalHost = false, sourceLayout = false, requireRevision = true): Promise<boolean> {
    if (!(await this.runtimeComplete(directory, allowExternalHost, sourceLayout))) return false;
    if (requireRevision && !(await this.runtimeRevisionMatches(directory))) return false;
    return new Promise<boolean>((resolve) => {
      const runtimeName = sourceLayout ? sourceEngineExecutableName : executableName;
      const child = spawn(path.join(directory, runtimeName), ['--version'], {
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        child.kill();
        resolve(false);
      }, 5000);
      child.once('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    });
  }

  private async stageRuntime(sourceDir: string, destinationDir: string): Promise<void> {
    await mkdir(destinationDir, { recursive: true });
    for (const binary of runtimeBinaries()) {
      let source = path.join(sourceDir, binary.sourceName ?? binary.fileName);
      if (!(await exists(source)) && binary.cargoBin === 'hexa-code-mode-host') {
        source = externalCodeModeHost() || source;
      }
      const destination = path.join(destinationDir, binary.fileName);
      if (!(await exists(source))) {
        throw new Error(`Cargo finished, but a required engine helper was not produced: ${source}`);
      }
      await copyFile(source, destination);
      if (process.platform !== 'win32') await chmod(destination, 0o755);
    }
    await writeFile(path.join(destinationDir, runtimeRevisionFile), `${runtimeRevision}\n`, 'utf8');
  }

  private async runtimeRevisionMatches(directory: string): Promise<boolean> {
    const revision = await readFile(path.join(directory, runtimeRevisionFile), 'utf8').catch(() => '');
    return revision.trim() === runtimeRevision;
  }

  private async refreshCachedSandboxSetup(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    const source = path.join(this.sourceRuntimeDir, 'hexa-windows-sandbox-setup.exe');
    if (!(await exists(source))) return false;
    await copyFile(source, path.join(this.cachedRuntimeDir, 'HexaSandboxSetup.exe'));
    await writeFile(path.join(this.cachedRuntimeDir, runtimeRevisionFile), `${runtimeRevision}\n`, 'utf8');
    return true;
  }

  private async assertCommand(command: string, args: string[], label: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, { stdio: 'ignore', shell: false });
      child.once('error', () => reject(new Error(`${label} is required but was not found on PATH.`)));
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${label} is installed but failed its version check.`));
      });
    });
  }

  private async checksumMatches(filePath: string, checksum: string): Promise<boolean> {
    const contents = await readFile(filePath).catch(() => null);
    return contents ? createHash('sha256').update(contents).digest('hex') === checksum : false;
  }

  private async cacheBuildAsset(url: string, destination: string, checksum?: string): Promise<void> {
    const existing = await stat(destination).catch(() => null);
    if (existing?.isFile() && existing.size > 0 && (!checksum || await this.checksumMatches(destination, checksum))) return;

    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    await rm(temporary, { force: true });
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Could not download Hexa Engine build asset (${response.status} ${response.statusText}): ${url}`);
      }
      await writeFile(temporary, new Uint8Array(await response.arrayBuffer()));
      if (checksum && !(await this.checksumMatches(temporary, checksum))) {
        throw new Error(`Hexa Engine build asset failed checksum validation: ${url}`);
      }
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private async resolveCargoBuildEnvironment(
    nativeEnv: NodeJS.ProcessEnv,
    manifest: string,
  ): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...nativeEnv, CARGO_TERM_COLOR: 'always' };
    if (env.V8_FROM_SOURCE && ['1', 'true', 'yes'].includes(env.V8_FROM_SOURCE.toLowerCase())) return env;
    if (env.RUSTY_V8_ARCHIVE && env.RUSTY_V8_SRC_BINDING_PATH) return env;
    if (env.RUSTY_V8_ARCHIVE || env.RUSTY_V8_SRC_BINDING_PATH) {
      throw new Error('RUSTY_V8_ARCHIVE and RUSTY_V8_SRC_BINDING_PATH must be set together.');
    }

    const workspaceManifest = await readFile(manifest, 'utf8');
    const v8Version = workspaceManifest.match(/^v8\s*=\s*"=(\d+\.\d+\.\d+)"/m)?.[1];
    if (!v8Version) return env;

    // The code-mode runtime enables rusty_v8's ptr-compression sandbox. Use
    // the matching, checksum-pinned artifact pair published with OpenAI Codex;
    // the generic rusty_v8 release does not publish every required target.
    const releaseRoot = `https://github.com/openai/codex/releases/download/rusty-v8-v${v8Version}`;
    const target = rustyV8Target();
    if (!target) return env;
    const cacheDir = path.join(app.getPath('userData'), 'cache', 'rusty-v8', v8Version);
    const archiveName = process.platform === 'win32'
      ? `rusty_v8_ptrcomp_sandbox_release_${target}.lib.gz`
      : `librusty_v8_ptrcomp_sandbox_release_${target}.a.gz`;
    const bindingName = `src_binding_ptrcomp_sandbox_release_${target}.rs`;
    const checksumName = `rusty_v8_ptrcomp_sandbox_release_${target}.sha256`;
    const archivePath = path.join(cacheDir, archiveName);
    const bindingPath = path.join(cacheDir, bindingName);
    const checksumPath = path.join(cacheDir, checksumName);

    await this.cacheBuildAsset(`${releaseRoot}/${checksumName}`, checksumPath);
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
      this.cacheBuildAsset(`${releaseRoot}/${archiveName}`, archivePath, archiveChecksum),
      this.cacheBuildAsset(`${releaseRoot}/${bindingName}`, bindingPath, bindingChecksum),
    ]);

    env.RUSTY_V8_ARCHIVE = archivePath;
    env.RUSTY_V8_SRC_BINDING_PATH = bindingPath;
    return env;
  }

  private async runCargoBuild(cargoBins: string[]): Promise<void> {
    const manifest = path.join(this.sourceRoot, 'engine', 'Cargo.toml');
    await stat(manifest);

    const native = resolveNativeBuildEnvironment();
    if (process.platform === 'win32' && !native.msvcPath?.match(/[\\/]x64[\\/]cl\.exe$/i)) {
      throw new Error(
        'MSVC x64 build tools are required. Install the Visual Studio Desktop development with C++ workload and a Windows SDK.',
      );
    }

    const args = ['build', '--release', '--manifest-path', manifest];
    for (const cargoBin of cargoBins) args.push('--bin', cargoBin);
    const buildEnvironment = await this.resolveCargoBuildEnvironment(native.env, manifest);

    await new Promise<void>((resolve, reject) => {
      const child = spawn('cargo', args, {
        cwd: this.sourceRoot,
        env: buildEnvironment,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let recent = '';
      let lineCount = 0;
      const consume = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        recent = (recent + text).slice(-8000);
        lineCount += text.split(/\r?\n/).length - 1;
        const heuristic = Math.min(0.94, 0.06 + Math.log10(Math.max(1, lineCount)) / 4);
        const lastLine = text.trim().split(/\r?\n/).at(-1)?.replace(/\x1b\[[0-9;]*m/g, '');
        this.report({
          phase: 'building',
          message: 'Building Hexa Engine from source…',
          detail: lastLine || 'Compiling Rust workspace',
          progress: heuristic,
        });
      };
      child.stdout.on('data', consume);
      child.stderr.on('data', consume);
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Hexa Engine build failed with exit code ${code}.\n${recent}`));
      });
    });
  }
}
