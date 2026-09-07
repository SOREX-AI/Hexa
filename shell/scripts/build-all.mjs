import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNodeBin, waitForExit } from './tooling.mjs';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const main = await runNodeBin('typescript', 'tsc', ['-p', 'tsconfig.main.json'], { cwd: shellRoot });
await waitForExit(main, 'Electron TypeScript build');

const renderer = await runNodeBin('vite', 'vite', ['build'], { cwd: shellRoot });
await waitForExit(renderer, 'Renderer build');
