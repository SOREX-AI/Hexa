import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { resolveNativeBuildEnvironment } from './tooling.mjs';
import { engineRoot, repoRoot, shellRoot } from './engine-layout.mjs';

function run(command, args, env = process.env) {
  return spawnSync(command, args, {
    shell: false,
    encoding: 'utf8',
    windowsHide: true,
    env,
  });
}

let failed = false;
const nodeVersion = process.version;
const [major = 0, minor = 0] = nodeVersion.replace(/^v/, '').split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  failed = true;
  console.log(`✗ Node.js 22.12+: found ${nodeVersion}`);
} else {
  console.log(`✓ Node.js 22.12+: ${nodeVersion}`);
}

const native = resolveNativeBuildEnvironment();
const buildEnv = native.env;

const checks = [
  ['cargo', ['--version'], 'Rust/Cargo'],
  ['rustc', ['--version'], 'Rust compiler'],
  ['git', ['--version'], 'Git'],
];

for (const [cmd, args, label] of checks) {
  const result = run(cmd, args, buildEnv);
  if (result.status === 0) {
    const firstLine = (result.stdout || result.stderr).trim().split(/\r?\n/)[0];
    console.log(`✓ ${label}: ${firstLine}`);
  } else {
    failed = true;
    console.log(`✗ ${label}: not available on PATH`);
  }
}

if (process.platform === 'win32') {
  if (native.msvcPath && /[\\/]x64[\\/]cl\.exe$/i.test(native.msvcPath)) {
    const suffix = native.source === 'visual-studio' ? ' (x64 environment resolved automatically)' : '';
    console.log(`✓ MSVC x64 compiler (Visual Studio Build Tools): ${native.msvcPath}${suffix}`);
  } else {
    failed = true;
    if (native.msvcPath) {
      console.log(`✗ MSVC x64 compiler: found non-x64 compiler at ${native.msvcPath}`);
    } else {
      console.log('✗ MSVC x64 compiler (Visual Studio Build Tools): not found');
    }
  }
}

console.log(`\nRepository root: ${repoRoot}`);
console.log(`Engine source:   ${engineRoot}`);
console.log(`Hexa source:     ${shellRoot}`);
if (failed) {
  console.error('\nOne or more prerequisites are missing. See shell/docs/BUILDING.md.');
  process.exitCode = 1;
}
