#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const shellRoot = path.join(repoRoot, 'shell');

const action = process.argv[2] ?? 'help';
const forward = process.argv.slice(3);

const actions = {
  check: ['scripts/check-prereqs.mjs'],
  dev: ['scripts/dev.mjs'],
  build: ['scripts/build-all.mjs'],
  typecheck: ['__typecheck__'],
  'engine-build': ['scripts/build-engine.mjs'],
  'engine-check': ['scripts/check-engine-layout.mjs'],
  pack: ['scripts/dist.mjs', '--dir'],
  dist: ['scripts/dist.mjs'],
  'protocol-sync': ['scripts/sync-protocol.mjs'],
  'upstream-update': ['scripts/update-upstream.mjs'],
  'version-import': ['scripts/import-engine-version.mjs'],
  clean: ['scripts/clean.mjs'],
};

function hasShellDependencies() {
  const requiredPackages = ['typescript', 'vite', 'electron'];
  return requiredPackages.every((packageName) =>
    [
      path.join(shellRoot, 'node_modules', packageName, 'package.json'),
      path.join(repoRoot, 'node_modules', packageName, 'package.json'),
    ].some((candidate) => existsSync(candidate)),
  );
}

function printHelp() {
  console.log(`Hexa launcher\n\nUsage:\n  node hexa.mjs <command>\n\nCommands:\n  setup            Install repository + desktop dependencies\n  check            Check native and JavaScript prerequisites\n  dev              Build/watch Hexa and launch Electron\n  build            Build Electron main/preload + production renderer\n  typecheck        Type-check main/preload + renderer\n  engine-check     Validate the engine boundary and upstream layout\n  engine-build     Build and stage the complete Hexa Engine runtime\n  pack             Build an unpacked desktop application\n  dist             Build an installer for the current OS\n  protocol-sync    Snapshot app-server protocol TypeScript definitions\n  upstream-update  Preview/apply a guarded upstream engine refresh\n  version-import   Validate/apply a source snapshot from ./versions\n  clean            Remove generated desktop and engine artifacts\n\nRun every command from the repository root.\nEquivalent package scripts are available as npm run hexa:<command>.`);
}

function wait(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed${code == null ? ` (${signal ?? 'terminated'})` : ` (${code})`}`));
    });
  });
}

function runNode(script, args = [], cwd = shellRoot) {
  return spawn(process.execPath, [path.join(shellRoot, script), ...args], {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
}

function commandAvailable(command) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(locator, [command], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  return result.status === 0;
}

function runPackageManager(command, args, cwd) {
  const tokens = [command, ...args];
  if (!tokens.every((token) => /^[A-Za-z0-9_.:@/+\-]+$/.test(token))) {
    throw new Error('Package-manager bootstrap received an unsafe command token.');
  }

  if (process.platform === 'win32') {
    // npm/pnpm are commonly PATH-resolved *.cmd shims on Windows. Let cmd.exe
    // resolve the shim by command name instead of passing an absolute .cmd path
    // through a second quoting layer. cwd carries filesystem paths separately.
    const comspec = process.env.ComSpec || 'cmd.exe';
    return spawn(comspec, ['/d', '/q', '/c', tokens.join(' ')], {
      cwd,
      stdio: 'inherit',
      shell: false,
      windowsHide: false,
    });
  }

  return spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
  });
}

async function setup() {
  if (commandAvailable('pnpm')) {
    console.log('Installing Hexa desktop dependencies with pnpm…');
    try {
      await wait(runPackageManager('pnpm', ['install', '--filter', 'hexa...'], repoRoot), 'pnpm install');
      return;
    } catch (error) {
      console.warn(`Workspace pnpm install failed; trying the fallback bootstrap path: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (commandAvailable('corepack')) {
    console.log('pnpm is not active; asking Corepack to run the repository-pinned pnpm…');
    try {
      await wait(runPackageManager('corepack', ['pnpm', 'install', '--filter', 'hexa...'], repoRoot), 'corepack pnpm install');
      return;
    } catch (error) {
      console.warn(`Corepack pnpm install failed; trying the fallback bootstrap path: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!commandAvailable('npm')) {
    throw new Error('Neither pnpm/Corepack nor npm could be found. Install Node.js 22.12+ and retry.');
  }

  console.warn('Bootstrapping Hexa dependencies with npm inside shell/.');
  await wait(runPackageManager('npm', ['install'], shellRoot), 'npm install');
}

async function typecheck() {
  const packageJson = JSON.parse(readFileSync(path.join(shellRoot, 'package.json'), 'utf8'));
  const tscCandidates = packageJson.devDependencies?.typescript
    ? [
        path.join(shellRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
        path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      ]
    : [];
  const tscBin = tscCandidates.find((candidate) => existsSync(candidate)) ?? null;
  if (!tscBin || !existsSync(tscBin)) {
    throw new Error('Shell dependencies are not installed. Run: node hexa-launcher.mjs setup');
  }
  await wait(
    spawn(process.execPath, [tscBin, '-p', path.join(shellRoot, 'tsconfig.main.json'), '--noEmit'], {
      cwd: shellRoot,
      stdio: 'inherit',
      shell: false,
    }),
    'main typecheck',
  );
  await wait(
    spawn(process.execPath, [tscBin, '-p', path.join(shellRoot, 'tsconfig.renderer.json'), '--noEmit'], {
      cwd: shellRoot,
      stdio: 'inherit',
      shell: false,
    }),
    'renderer typecheck',
  );
}

try {
  if (action === 'help' || action === '--help' || action === '-h') {
    printHelp();
  } else if (action === 'setup') {
    await setup();
  } else if (action === 'typecheck') {
    await typecheck();
  } else if (actions[action]) {
    const [script, ...defaults] = actions[action];
    if (!hasShellDependencies() && !['check', 'clean', 'engine-check', 'engine-build', 'protocol-sync', 'upstream-update', 'version-import'].includes(action)) {
      console.log('Shell dependencies are missing; running setup first…');
      await setup();
    }
    await wait(runNode(script, [...defaults, ...forward]), `Hexa ${action}`);
  } else {
    printHelp();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`\nHexa: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
