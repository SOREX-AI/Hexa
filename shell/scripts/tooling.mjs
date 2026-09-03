import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function packageBin(packageName, binName) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  return readFile(packageJsonPath, 'utf8').then((text) => {
    const pkg = JSON.parse(text);
    const relative = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName];
    if (!relative) throw new Error(`${packageName} does not expose a ${binName} binary.`);
    return path.resolve(path.dirname(packageJsonPath), relative);
  });
}

export function run(command, args = [], options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });
}

export async function runNodeBin(packageName, binName, args = [], options = {}) {
  const cli = await packageBin(packageName, binName);
  return run(process.execPath, [cli, ...args], options);
}

export function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed${code == null ? ` (${signal ?? 'terminated'})` : ` (${code})`}`));
    });
  });
}

function where(command, env = process.env) {
  if (process.platform !== 'win32') return null;
  const result = spawnSync('where.exe', [command], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env,
  });
  if (result.status !== 0) return null;
  return result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;
}

function isX64Compiler(filePath) {
  return Boolean(filePath && /[\\/]x64[\\/]cl\.exe$/i.test(filePath));
}

function findVsWhere() {
  const candidates = [
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? where('vswhere.exe');
}

function findPowerShell() {
  return where('powershell.exe') || where('pwsh.exe');
}

function visualStudioInstallationPath() {
  const vswhere = findVsWhere();
  if (!vswhere) return null;
  const result = spawnSync(
    vswhere,
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ],
    { encoding: 'utf8', shell: false, windowsHide: true },
  );
  if (result.status !== 0) return null;
  const installPath = result.stdout.trim().split(/\r?\n/).find(Boolean)?.trim();
  return installPath || null;
}

function loadVisualStudioEnvironment(installPath) {
  const powershell = findPowerShell();
  if (!powershell) return null;

  const modulePath = path.join(
    installPath,
    'Common7',
    'Tools',
    'Microsoft.VisualStudio.DevShell.dll',
  );
  if (!existsSync(modulePath)) return null;

  // Keep the Visual Studio path out of the PowerShell source text. Passing it as
  // an environment variable avoids command-line quoting problems when either the
  // repository path or Visual Studio itself lives under a directory with spaces.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$install = $env:HEXA_VS_INSTALL",
    "$module = Join-Path $install 'Common7\\Tools\\Microsoft.VisualStudio.DevShell.dll'",
    'Import-Module $module',
    "Enter-VsDevShell -VsInstallPath $install -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null",
    '$vars = @{}',
    'Get-ChildItem Env: | ForEach-Object { $vars[$_.Name] = $_.Value }',
    '[Console]::Out.Write(($vars | ConvertTo-Json -Compress))',
  ].join('; ');

  const result = spawnSync(
    powershell,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      env: { ...process.env, HEXA_VS_INSTALL: installPath },
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.status !== 0 || !result.stdout.trim()) return null;

  try {
    const parsed = JSON.parse(result.stdout.trim());
    const env = { ...process.env };
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') continue;
      const existing = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      if (existing && existing !== key) delete env[existing];
      env[key] = value;
    }
    return env;
  } catch {
    return null;
  }
}

/**
 * Return an environment suitable for native Hexa Engine builds.
 *
 * On Windows a regular terminal often does not contain Visual Studio's compiler,
 * linker, INCLUDE, LIB, or Windows SDK variables. We discover the installed VS
 * C++ workload and load its x64 developer environment ourselves. On macOS/Linux
 * the current process environment is already the correct build environment.
 */
export function resolveNativeBuildEnvironment() {
  if (process.platform !== 'win32') {
    return { env: { ...process.env }, msvcPath: null, source: 'process' };
  }

  const direct = where('cl.exe');
  if (isX64Compiler(direct)) {
    return { env: { ...process.env }, msvcPath: direct, source: 'process' };
  }

  const installPath = visualStudioInstallationPath();
  if (!installPath) {
    return { env: { ...process.env }, msvcPath: direct, source: direct ? 'x86-process' : 'missing' };
  }

  const env = loadVisualStudioEnvironment(installPath);
  if (!env) {
    return { env: { ...process.env }, msvcPath: direct, source: direct ? 'x86-process' : 'missing' };
  }

  const compiler = where('cl.exe', env);
  if (!isX64Compiler(compiler)) {
    return { env, msvcPath: compiler, source: compiler ? 'visual-studio-non-x64' : 'missing' };
  }

  return { env, msvcPath: compiler, source: 'visual-studio' };
}
