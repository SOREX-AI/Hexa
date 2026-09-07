import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { engineRoot, shellRoot } from './engine-layout.mjs';

const source = path.join(engineRoot, 'app-server-protocol', 'schema', 'typescript');
const destination = path.join(shellRoot, 'docs', 'protocol-types');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
console.log(`Synced generated app-server TypeScript schema to ${destination}`);
