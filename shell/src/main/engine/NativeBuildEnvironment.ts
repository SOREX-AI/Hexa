import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type NativeBuildEnvironment = {
  env: NodeJS.ProcessEnv;
  msvcPath: string | null;
  source: 'process' | 'visual-studio' | 'x86-process' | 'visual-studio-non-x64' | 'missing';
};

function where(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (process.platform !== 'win32') return null;
  const result = spawnSync('where.exe', [command], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env,
  });
  if (result.status !== 0) return null;
  return (
    result.stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function isX64Compiler(filePath: string | null): boolean {
  return Boolean(filePath && /[\\/]x64[\\/]cl\.exe$/i.test(filePath));
}

function findVsWhere(): string | null {
  const candidates = [
    process.env['ProgramFiles(x86)']
      ? path.join(
          process.env['ProgramFiles(x86)'],
          'Microsoft Visual Studio',
          'Installer',
          'vswhere.exe',
        )
      : null,
    process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
      : null,
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) ?? where('vswhere.exe');
}

function findPowerShell(): string | null {
  return where('powershell.exe') || where('pwsh.exe');
}

function visualStudioInstallationPath(): string | null {
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
  return result.stdout.trim().split(/\r?\n/).find(Boolean)?.trim() || null;
}

function loadVisualStudioEnvironment(installPath: string): NodeJS.ProcessEnv | null {
  const powershell = findPowerShell();
  if (!powershell) return null;

  const modulePath = path.join(
    installPath,
    'Common7',
    'Tools',
    'Microsoft.VisualStudio.DevShell.dll',
  );
  if (!existsSync(modulePath)) return null;

  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$install = $env:HEXA_VS_INSTALL',
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
    const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') continue;
      const existing = Object.keys(env).find(
        (candidate) => candidate.toLowerCase() === key.toLowerCase(),
      );
      if (existing && existing !== key) delete env[existing];
      env[key] = value;
    }
    return env;
  } catch {
    return null;
  }
}

export function resolveNativeBuildEnvironment(): NativeBuildEnvironment {
  if (process.platform !== 'win32') {
    return { env: { ...process.env }, msvcPath: null, source: 'process' };
  }

  const direct = where('cl.exe');
  if (isX64Compiler(direct)) {
    return { env: { ...process.env }, msvcPath: direct, source: 'process' };
  }

  const installPath = visualStudioInstallationPath();
  if (!installPath) {
    return {
      env: { ...process.env },
      msvcPath: direct,
      source: direct ? 'x86-process' : 'missing',
    };
  }

  const env = loadVisualStudioEnvironment(installPath);
  if (!env) {
    return {
      env: { ...process.env },
      msvcPath: direct,
      source: direct ? 'x86-process' : 'missing',
    };
  }

  const compiler = where('cl.exe', env);
  if (!isX64Compiler(compiler)) {
    return {
      env,
      msvcPath: compiler,
      source: compiler ? 'visual-studio-non-x64' : 'missing',
    };
  }

  return { env, msvcPath: compiler, source: 'visual-studio' };
}
