import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '.rs', '.md', '.toml', '.json', '.txt', '.py', '.js', '.mjs', '.ts', '.tsx', '.nix', '.bazel', '.bzl', '.html', '.snap',
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

function rebrandLocalNamespaces(text) {
  let next = text;

  // Hexa must never inherit the real Codex data roots from a parent shell.
  // These are local environment interfaces, not OpenAI wire/API contracts.
  next = next.replaceAll('CODEX_SQLITE_HOME', 'HEXA_SQLITE_HOME');
  next = next.replaceAll('CODEX_HOME', 'HEXA_ENGINE_HOME');

  // Package/runtime resource names are owned by this fork and must not share
  // the names used by an official Codex installation.
  const localNames = [
    ['codex-package.json', 'hexa-package.json'],
    ['codex-resources', 'hexa-resources'],
    ['codex-path', 'hexa-path'],
    ['codex-test-helper', 'hexa-test-helper'],
    ['codex-bwrap-synthetic-mount-targets', 'hexa-bwrap-synthetic-mount-targets'],
    ['codex-arg0-session', 'hexa-arg0-session'],
    ['codex-arg0-other-session', 'hexa-arg0-other-session'],
  ];
  for (const [before, after] of localNames) next = next.replaceAll(before, after);

  // Global user-home examples belong to Hexa's private global state root.
  next = next.replaceAll('~/.codex', '~/.hexashell');
  next = next.replace(/(\/Users\/[^/\s"'`]+)\/\.codex\b/g, '$1/.hexashell');
  next = next.replace(/(\/home\/[^/\s"'`]+)\/\.codex\b/g, '$1/.hexashell');
  next = next.replace(/(file:\/\/\/C:\/Users\/[^/\s"'`]+)\/\.codex\b/gi, '$1/.hexashell');
  next = next.replace(/(C:\\\\Users\\\\[^\\\s"'`]+)\\\\\.codex\b/gi, '$1\\\\.hexashell');
  next = next.replaceAll('home.join(".codex")', 'home.join(".hexashell")');
  next = next.replace(/(home_dir\(\)[^\n;]*?\.join\()"\.codex"(\))/g, '$1".hexashell"$2');
  next = next.replaceAll('user_profile.path().join(".codex/plugins/cache")', 'user_profile.path().join(".hexashell/plugins/cache")');

  // Remaining exact/project-relative .codex paths are repository-local Hexa
  // configuration, skills, hooks, rules, and trust state.
  next = next.replaceAll('".codex"', '".hexa"');
  next = next.replaceAll('".codex/', '".hexa/');
  next = next.replaceAll('/.codex/', '/.hexa/');
  next = next.replaceAll('/.codex"', '/.hexa"');
  next = next.replaceAll('`.codex`', '`.hexa`');
  next = next.replaceAll('`.codex/', '`.hexa/');
  next = next.replaceAll(' .codex/', ' .hexa/');

  // OS-managed local configuration identities are also fork-owned.
  next = next.replaceAll('%ProgramData%\\OpenAI\\Codex', '%ProgramData%\\Hexa\\Engine');
  next = next.replaceAll('C:\\ProgramData\\OpenAI\\Codex', 'C:\\ProgramData\\Hexa\\Engine');
  next = next.replaceAll('com.openai.codex', 'com.hexa.engine');

  return next;
}

function specializeRuntimeFiles(relative, text) {
  let next = text;

  if (relative === path.join('utils', 'home-dir', 'src', 'lib.rs')) {
    next = next.replace('Returns the path to the Codex configuration directory', 'Returns the path to the Hexa Engine configuration directory');
    next = next.replace('If not set, defaults to\n/// `~/.hexashell`.', 'If not set, defaults to\n/// `~/.hexashell`.');
    next = next.replace(
      `    let codex_home_env = std::env::var("HEXA_ENGINE_HOME")\n        .ok()\n        .filter(|val| !val.is_empty());`,
      `    let codex_home_env = std::env::var("HEXA_ENGINE_HOME")\n        .ok()\n        .filter(|val| !val.is_empty());`,
    );
    // Raw upstream reaches this module before the generic CODEX_HOME rename;
    // the generic pass above converts it to HEXA_ENGINE_HOME. Keep the default
    // private even when no environment override exists.
    next = next.replace('p.push(".hexa");', 'p.push(".hexashell");');
    next = next.replace('p.push(".codex");', 'p.push(".hexashell");');
    next = next.replace('expected.push(".hexa");', 'expected.push(".hexashell");');
    next = next.replace('expected.push(".codex");', 'expected.push(".hexashell");');
    next = next.replaceAll('Hexa home override points to', 'HEXA_ENGINE_HOME points to');
    next = next.replaceAll('failed to read Hexa home override', 'failed to read HEXA_ENGINE_HOME');
    next = next.replaceAll('failed to canonicalize Hexa home override', 'failed to canonicalize HEXA_ENGINE_HOME');
  }

  if (relative === path.join('app-server-transport', 'src', 'transport', 'mod.rs')) {
    next = next.replace('const APP_SERVER_CONTROL_SOCKET_DIR_NAME: &str = "app-server-control";', 'const APP_SERVER_CONTROL_SOCKET_DIR_NAME: &str = "hexa-app-server-control";');
    next = next.replace('const APP_SERVER_CONTROL_SOCKET_FILE_NAME: &str = "app-server-control.sock";', 'const APP_SERVER_CONTROL_SOCKET_FILE_NAME: &str = "hexa-app-server-control.sock";');
    next = next.replace('const APP_SERVER_STARTUP_LOCK_FILE_NAME: &str = "app-server-startup.lock";', 'const APP_SERVER_STARTUP_LOCK_FILE_NAME: &str = "hexa-app-server-startup.lock";');
  }

  if (relative === path.join('app-server-daemon', 'src', 'lib.rs')) {
    next = next.replace('const STATE_DIR_NAME: &str = "app-server-daemon";', 'const STATE_DIR_NAME: &str = "hexa-app-server-daemon";');
  }

  if (relative === path.join('app-server-daemon', 'README.md')) {
    next = next.replace(
      'The remaining `managedCodexPath`, `HEXA_ENGINE_HOME`, crate names, and protocol fields are upstream compatibility identifiers. They are not Hexa product branding; see `UPSTREAM_COMPATIBILITY.md` at the repository root.',
      'The remaining upstream backend/wire identifiers are compatibility contracts, not Hexa local process or storage identities. Hexa does not share the official Codex home, project-config, keyring, resource, or app-server namespaces; see `UPSTREAM_COMPATIBILITY.md` at the repository root.',
    );
  }

  if (relative === path.join('app-server-daemon', 'src', 'client.rs')) {
    next = next.replaceAll('codex_app_server_daemon', 'hexa_app_server_daemon');
  }

  if (relative === path.join('app-server', 'src', 'request_processors', 'initialize_processor.rs')
      || relative === path.join('app-server', 'tests', 'suite', 'v2', 'initialize.rs')) {
    next = next.replaceAll('"codex_app_server_daemon"', '"hexa_app_server_daemon"');
  }

  if (relative === path.join('install-context', 'src', 'lib.rs')) {
    next = next.replaceAll('Codex', 'Hexa');
    next = next.replaceAll('codex.js', 'hexa-engine');
  }

  if (relative === path.join('linux-sandbox', 'README.md')) {
    next = next.replaceAll('Codex', 'Hexa');
    next = next.replaceAll('Node.js version of the Hexa CLI', 'Hexa Engine');
    next = next.replaceAll('`codex` multitool CLI', '`hexa-engine` multitool CLI');
  }

  if (relative === path.join('process-hardening', 'src', 'lib.rs')) {
    next = next.replace('Official Codex releases', 'Upstream engine releases');
  }

  if (relative === path.join('thread-manager-sample', 'README.md')) {
    next = next.replaceAll('Codex', 'Hexa');
  }

  if (relative === path.join('thread-manager-sample', 'src', 'main.rs')) {
    next = next.replaceAll('codex-thread-manager-sample', 'hexa-thread-manager-sample');
  }

  return next;
}

export async function applyHexaRuntimeIsolation(engineRoot) {
  let filesChanged = 0;
  for (const file of await walk(engineRoot)) {
    const extension = path.extname(file);
    if (!TEXT_EXTENSIONS.has(extension) && path.basename(file) !== 'Cargo.toml') continue;
    const text = await readFile(file, 'utf8').catch(() => null);
    if (text == null) continue;
    const relative = path.relative(engineRoot, file);
    let next = rebrandLocalNamespaces(text);
    next = specializeRuntimeFiles(relative, next);
    if (next !== text) {
      await writeFile(file, next);
      filesChanged += 1;
    }
  }
  return { runtimeIsolationFilesChanged: filesChanged };
}
