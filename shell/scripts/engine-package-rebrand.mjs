import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RUNTIME_BIN_RENAMES = new Map([
  ['codex', 'hexa-engine'],
  ['codex-app-server', 'hexa-app-server'],
  ['codex-code-mode-host', 'hexa-code-mode-host'],
  ['codex-command-runner', 'hexa-command-runner'],
  ['codex-windows-sandbox-setup', 'hexa-windows-sandbox-setup'],
]);

const SOURCE_DIRECTORY_RENAMES = new Map([
  ['codex-api', 'hexa-api'],
  ['codex-backend-openapi-models', 'hexa-backend-openapi-models'],
  ['codex-client', 'hexa-client'],
  ['codex-experimental-api-macros', 'hexa-experimental-api-macros'],
  ['codex-home', 'hexa-home'],
  ['codex-mcp', 'hexa-mcp'],
]);

async function walk(root) {
  const files = [];
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'target') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  return files;
}

function packageNameFromManifest(text) {
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) section = trimmed;
    if (section !== '[package]') continue;
    const match = /^name\s*=\s*"(codex-[^"]+)"/.exec(trimmed);
    if (match) return match[1];
  }
  return null;
}

function addPackageAlias(line, oldName, newName) {
  if (!line.includes('{') || line.includes('package =')) return line;
  const open = line.indexOf('{');
  return `${line.slice(0, open + 1)} package = "${newName}",${line.slice(open + 1)}`;
}

function rewriteManifest(text, packageMap, binMap, isRootManifest) {
  const lines = text.split(/\r?\n/);
  let section = '';
  const output = [];
  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) section = trimmed;

    if (section === '[package]') {
      const match = /^(\s*name\s*=\s*)"(codex-[^"]+)"/.exec(line);
      if (match && packageMap.has(match[2])) {
        line = line.replace(`"${match[2]}"`, `"${packageMap.get(match[2])}"`);
      }
    }

    if (section === '[[bin]]') {
      const match = /^(\s*name\s*=\s*)"([^"]+)"/.exec(line);
      if (match && binMap.has(match[2])) {
        line = line.replace(`"${match[2]}"`, `"${binMap.get(match[2])}"`);
      }
    }

    if (line.includes('default-run = "codex"')) {
      line = line.replace('default-run = "codex"', 'default-run = "hexa-engine"');
    }

    for (const [oldName, newName] of packageMap) {
      if (line.includes(`package = "${oldName}"`)) {
        line = line.replaceAll(`package = "${oldName}"`, `package = "${newName}"`);
      }
    }

    const dependency = /^(\s*)(codex-[A-Za-z0-9_-]+)(\s*=\s*\{.*\}\s*)$/.exec(line);
    if (dependency && packageMap.has(dependency[2])) {
      const oldName = dependency[2];
      const newName = packageMap.get(oldName);
      const isWorkspaceDefinition = isRootManifest && section === '[workspace.dependencies]';
      const isDirectPath = line.includes('path =') && !line.includes('workspace = true');
      if (isWorkspaceDefinition || isDirectPath) line = addPackageAlias(line, oldName, newName);
    }

    for (const [oldDir, newDir] of SOURCE_DIRECTORY_RENAMES) {
      line = line.replaceAll(`path = "${oldDir}"`, `path = "${newDir}"`);
      line = line.replaceAll(`path = "../${oldDir}"`, `path = "../${newDir}"`);
      line = line.replaceAll(`"${oldDir}",`, `"${newDir}",`);
    }

    output.push(line);
  }
  return output.join('\n');
}

function replaceExactPackageNames(text, packageMap) {
  let next = text;
  for (const [oldName, newName] of packageMap) next = next.replaceAll(oldName, newName);
  return next;
}

export async function applyHexaCargoPackageRebrand(engineRoot) {
  const allFiles = await walk(engineRoot);
  const manifests = allFiles.filter((file) => path.basename(file) === 'Cargo.toml');
  const packageMap = new Map();
  const binMap = new Map(RUNTIME_BIN_RENAMES);
  for (const manifest of manifests) {
    const text = await readFile(manifest, 'utf8');
    const oldName = packageNameFromManifest(text);
    if (oldName) packageMap.set(oldName, `hexa-${oldName.slice('codex-'.length)}`);

    let section = '';
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[')) section = trimmed;
      if (section !== '[[bin]]') continue;
      const match = /^name\s*=\s*"(codex-[^"]+)"/.exec(trimmed);
      if (match) binMap.set(match[1], `hexa-${match[1].slice('codex-'.length)}`);
    }
  }

  let manifestsChanged = 0;
  for (const manifest of manifests) {
    const text = await readFile(manifest, 'utf8');
    const next = rewriteManifest(text, packageMap, binMap, path.resolve(manifest) === path.resolve(path.join(engineRoot, 'Cargo.toml')));
    if (next !== text) {
      await writeFile(manifest, next);
      manifestsChanged += 1;
    }
  }

  // Cargo.lock records real package names rather than dependency aliases.
  const lockPath = path.join(engineRoot, 'Cargo.lock');
  if (await stat(lockPath).then(() => true, () => false)) {
    const text = await readFile(lockPath, 'utf8');
    const next = replaceExactPackageNames(text, packageMap);
    if (next !== text) await writeFile(lockPath, next);
  }

  // Bazel target labels and docs should display the Hexa package identity, but
  // Rust crate_name values intentionally remain upstream-compatible so source
  // imports and wire/schema identifiers are not rewritten.
  let ancillaryFilesChanged = 0;
  for (const file of allFiles) {
    if (path.basename(file) === 'Cargo.toml' || file === lockPath) continue;
    const extension = path.extname(file);
    if (!['.bazel', '.bzl', '.md'].includes(extension)) continue;
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text == null) continue;
    const next = replaceExactPackageNames(text, packageMap);
    if (next !== text) {
      await writeFile(file, next);
      ancillaryFilesChanged += 1;
    }
  }

  // Secondary executable names are Hexa-owned process/client identities. It is
  // safe to replace these exact names throughout engine text. The two ambiguous
  // names `codex` and `codex-app-server` are deliberately excluded because they
  // also occur in upstream API/auth compatibility contracts.
  const globallySafeBinRenames = new Map(
    [...binMap].filter(([oldName]) => oldName !== 'codex' && oldName !== 'codex-app-server'),
  );
  let secondaryBinReferencesChanged = 0;
  for (const file of allFiles) {
    const extension = path.extname(file);
    if (!['.rs', '.md', '.toml', '.json', '.js', '.mjs', '.ts', '.txt', '.nix'].includes(extension)) continue;
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text == null) continue;
    let next = text;
    for (const [oldName, newName] of globallySafeBinRenames) {
      next = next.replaceAll(oldName, newName);
    }
    if (next !== text) {
      await writeFile(file, next);
      secondaryBinReferencesChanged += 1;
    }
  }

  // Update only references that are unequivocally executable lookups for the
  // ambiguous primary/app-server names. Do not rewrite semantic strings such
  // as the OpenAI JWT audience "codex-app-server".
  let runtimeReferencesChanged = 0;
  for (const file of allFiles) {
    if (path.extname(file) !== '.rs') continue;
    const text = await readFile(file, 'utf8');
    let next = text;
    next = next.replaceAll('cargo_bin("codex")', 'cargo_bin("hexa-engine")');
    next = next.replaceAll('cargo_bin("codex-app-server")', 'cargo_bin("hexa-app-server")');
    next = next.replaceAll('cargo_bin("codex-code-mode-host")', 'cargo_bin("hexa-code-mode-host")');
    next = next.replaceAll('PathBuf::from("codex")', 'PathBuf::from("hexa-engine")');
    next = next.replaceAll('bin_dir.join("codex-app-server")', 'bin_dir.join("hexa-app-server")');
    next = next.replaceAll('CARGO_BIN_EXE_codex-windows-sandbox-setup', 'CARGO_BIN_EXE_hexa-windows-sandbox-setup');
    next = next.replaceAll('CARGO_BIN_EXE_codex_windows_sandbox_setup', 'CARGO_BIN_EXE_hexa_windows_sandbox_setup');
    next = next.replaceAll('["codex-app-server", "--code-mode-host"', '["hexa-app-server", "--code-mode-host"');
    if (next !== text) {
      await writeFile(file, next);
      runtimeReferencesChanged += 1;
    }
  }

  let directoriesRenamed = 0;
  for (const [oldDir, newDir] of SOURCE_DIRECTORY_RENAMES) {
    const source = path.join(engineRoot, oldDir);
    const destination = path.join(engineRoot, newDir);
    const sourceExists = await stat(source).then(() => true, () => false);
    const destinationExists = await stat(destination).then(() => true, () => false);
    if (!sourceExists) continue;
    if (destinationExists) throw new Error(`Cannot rebrand engine directory ${oldDir}: ${newDir} already exists.`);
    await rename(source, destination);
    directoriesRenamed += 1;
  }

  return {
    cargoPackagesRenamed: packageMap.size,
    cargoManifestsChanged: manifestsChanged,
    cargoAncillaryFilesChanged: ancillaryFilesChanged,
    cargoSecondaryBinReferencesChanged: secondaryBinReferencesChanged,
    cargoRuntimeReferencesChanged: runtimeReferencesChanged,
    cargoSourceDirectoriesRenamed: directoriesRenamed,
  };
}
