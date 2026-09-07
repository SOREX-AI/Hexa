import process from 'node:process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  resolveNativeBuildEnvironment,
  runNodeBin,
  run,
  waitForExit,
} from './tooling.mjs';

const require = createRequire(import.meta.url);
const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const native = resolveNativeBuildEnvironment();

if (process.platform === 'win32' && !native.msvcPath?.match(/[\\/]x64[\\/]cl\.exe$/i)) {
  throw new Error(
    'MSVC x64 build tools are required. Install the Visual Studio Desktop development with C++ workload and a Windows SDK.',
  );
}

// Compile the Electron main/preload once before starting watchers. Everything is
// launched as a real executable/JS entrypoint with shell:false, so paths containing
// spaces are safe on Windows, macOS, and Linux.
const initial = await runNodeBin('typescript', 'tsc', ['-p', 'tsconfig.main.json'], {
  cwd: shellRoot,
  env: native.env,
});
await waitForExit(initial, 'TypeScript build');

const vite = await runNodeBin('vite', 'vite', ['--host', '127.0.0.1', '--port', '5179'], {
  cwd: shellRoot,
  env: native.env,
});
const tsc = await runNodeBin(
  'typescript',
  'tsc',
  ['-p', 'tsconfig.main.json', '--watch', '--preserveWatchOutput'],
  { cwd: shellRoot, env: native.env },
);

async function waitForVite() {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch('http://127.0.0.1:5179');
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error('Vite dev server did not become ready.');
}

await waitForVite();
const electronExecutable = require('electron');
const electronEnv = {
  ...native.env,
  VITE_DEV_SERVER_URL: 'http://127.0.0.1:5179/',
};
// Some development shells run Node-based tooling with Electron's Node mode
// enabled. Never forward that flag to the desktop process itself, or Electron
// executes the main module as plain Node and the `electron` app API is absent.
delete electronEnv.ELECTRON_RUN_AS_NODE;
const electron = run(electronExecutable, ['.'], {
  cwd: shellRoot,
  env: electronEnv,
});

const children = [vite, tsc, electron];
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
electron.once('exit', (code) => {
  stop();
  process.exit(code ?? 0);
});
