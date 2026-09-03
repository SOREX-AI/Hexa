#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { engineManifest, engineRoot, repoRoot, requiredEnginePaths, shellRoot } from './engine-layout.mjs';

const errors = [];
for (const relative of requiredEnginePaths) {
  if (!existsSync(path.join(engineRoot, relative))) errors.push(`missing engine/${relative}`);
}
for (const legacy of ['codex-rs', 'codex-cli']) {
  if (existsSync(path.join(repoRoot, legacy))) errors.push(`legacy root folder still exists: ${legacy}/`);
}
if (!errors.length) {
  const manifest = readFileSync(engineManifest, 'utf8');
  const cliManifest = readFileSync(path.join(engineRoot, 'cli', 'Cargo.toml'), 'utf8');
  const appServerManifest = readFileSync(path.join(engineRoot, 'app-server', 'Cargo.toml'), 'utf8');
  if (!cliManifest.includes('name = "hexa-cli"') || !cliManifest.includes('name = "hexa-engine"')) {
    errors.push('Hexa Cargo CLI package/bin identity is missing');
  }
  if (!appServerManifest.includes('name = "hexa-app-server"')) {
    errors.push('Hexa Cargo app-server package/bin identity is missing');
  }
  const cargoStack = [engineRoot];
  while (cargoStack.length) {
    const directory = cargoStack.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'target' || entry.name === '.git') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) cargoStack.push(full);
      else if (entry.isFile() && entry.name === 'Cargo.toml') {
        const cargo = readFileSync(full, 'utf8');
        let section = '';
        for (const line of cargo.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed.startsWith('[')) section = trimmed;
          if ((section === '[package]' || section === '[[bin]]') && /^name\s*=\s*"codex(?:-|")/.test(trimmed)) {
            errors.push(`legacy Codex Cargo package/bin identity remains in ${path.relative(engineRoot, full)}: ${trimmed}`);
          }
        }
      }
    }
  }
  const lifecycle = readFileSync(path.join(engineRoot, 'app-server', 'src', 'request_processors', 'thread_lifecycle.rs'), 'utf8');
  if (!lifecycle.includes('Err(error) if error.code == -32601')) {
    errors.push('Hexa local-provider resume compatibility patch is missing');
  }
  const cli = readFileSync(path.join(engineRoot, 'cli', 'src', 'main.rs'), 'utf8');
  if (!cli.includes('name = "HexaEngine"') || !cli.includes('bin_name = "hexa-engine"') || !cli.includes('/// Hexa Engine')) {
    errors.push('Hexa Engine executable identity patch is missing');
  }
  if (cli.includes('mod app_cmd;') || cli.includes('app_cmd::') || cli.includes('run_update_action(') || cli.includes('fn resolve_windows_update_command_from_path') || cli.includes('PidUpdateLoop') || cli.includes('updater_http_client_factory(')) {
    errors.push('upstream desktop/package-manager/daemon self-update code is still compiled into the Hexa Engine CLI');
  }
  const daemon = readFileSync(path.join(engineRoot, 'app-server-daemon', 'src', 'lib.rs'), 'utf8');
  if (daemon.includes('update_loop::') || daemon.includes('pid_update_loop_backend') || daemon.includes('run_pid_update_loop') || daemon.includes('auto_update_enabled: true')) {
    errors.push('upstream standalone daemon self-updater is still active');
  }
  if (existsSync(path.join(engineRoot, 'app-server-daemon', 'src', 'update_loop.rs')) || existsSync(path.join(engineRoot, 'app-server-daemon', 'src', 'update_loop_tests.rs'))) {
    errors.push('upstream standalone daemon updater source was not stripped from the staged Hexa engine');
  }
  if (!cli.includes('Hexa Engine updates are managed by Hexa. Use `npm run hexa:upstream -- <ref> --apply`.')) {
    errors.push('Hexa Engine update guidance is missing');
  }
  if (cli.includes('codex login') || !cli.includes('hexa-engine login')) {
    errors.push('Hexa Engine CLI login guidance still exposes Codex branding');
  }
  const client = readFileSync(path.join(engineRoot, 'core', 'src', 'client.rs'), 'utf8');
  if (!client.includes('fold_developer_messages_into_instructions')) {
    errors.push('Hexa local-provider instruction compatibility patch is missing');
  }
  const installContext = readFileSync(path.join(engineRoot, 'install-context', 'src', 'lib.rs'), 'utf8');
  if (!installContext.includes('HexaCodeModeHost.exe') || !installContext.includes('"hexa-code-mode-host"')) {
    errors.push('Hexa Code Mode helper branding patch is missing');
  }
  const sandboxHelpers = readFileSync(path.join(engineRoot, 'windows-sandbox-rs', 'src', 'helper_materialization.rs'), 'utf8');
  if (!sandboxHelpers.includes('HexaCommandRunner.exe') || !sandboxHelpers.includes('HexaSandboxSetup.exe')) {
    errors.push('Hexa Windows sandbox helper branding patch is missing');
  }
  const execOutput = readFileSync(path.join(engineRoot, 'exec', 'src', 'event_processor_with_human_output.rs'), 'utf8');
  const modelsManagerPrompt = readFileSync(path.join(engineRoot, 'models-manager', 'prompt.md'), 'utf8');
  const tooltips = readFileSync(path.join(engineRoot, 'tui', 'src', 'tooltips.rs'), 'utf8');
  const tooltipText = readFileSync(path.join(engineRoot, 'tui', 'tooltips.txt'), 'utf8');
  const cloudCli = readFileSync(path.join(engineRoot, 'cloud-tasks', 'src', 'cli.rs'), 'utf8');
  const cloudLib = readFileSync(path.join(engineRoot, 'cloud-tasks', 'src', 'lib.rs'), 'utf8');
  const loginError = readFileSync(path.join(engineRoot, 'login', 'src', 'assets', 'error.html'), 'utf8');
  const mcpExecApproval = readFileSync(path.join(engineRoot, 'mcp-server', 'src', 'exec_approval.rs'), 'utf8');
  const mcpPatchApproval = readFileSync(path.join(engineRoot, 'mcp-server', 'src', 'patch_approval.rs'), 'utf8');
  const daemonClient = readFileSync(path.join(engineRoot, 'app-server-daemon', 'src', 'client.rs'), 'utf8');
  if (!execOutput.includes('Hexa Engine v{VERSION}') || execOutput.includes('OpenAI Codex v{VERSION}')) {
    errors.push('Hexa Engine execution banner branding patch is missing');
  }
  if (!modelsManagerPrompt.startsWith('You are Hexa Engine') || modelsManagerPrompt.includes('running in the Codex CLI')) {
    errors.push('Hexa models-manager prompt identity patch is missing');
  }
  if (tooltips.includes('raw.githubusercontent.com/openai/codex') || tooltips.includes("Run 'codex app'") || tooltips.includes('chatgpt.com/codex?app-landing-page')) {
    errors.push('Hexa TUI still consumes or advertises upstream Codex product surfaces');
  }
  if (tooltipText.includes('ask Codex') || tooltipText.includes('codex resume') || tooltipText.includes('Codex community forum')) {
    errors.push('Hexa TUI tooltip text still exposes Codex branding');
  }
  if (cloudCli.includes('Codex Cloud') || cloudLib.includes("'codex login'") || cloudLib.includes('`codex cloud`')) {
    errors.push('Hexa cloud-task CLI still exposes Codex branding');
  }
  if (!loginError.includes('Hexa login') || loginError.includes('Codex login')) {
    errors.push('Hexa login page branding patch is missing');
  }
  if (mcpExecApproval.includes('Allow Codex') || mcpPatchApproval.includes('Allow Codex')) {
    errors.push('Hexa MCP approval prompts still expose Codex branding');
  }
  if (!daemonClient.includes('Hexa App Server Daemon') || daemonClient.includes('title: Some("Codex App Server Daemon"')) {
    errors.push('Hexa app-server daemon title patch is missing');
  }
  const loginStorage = readFileSync(path.join(engineRoot, 'login', 'src', 'auth', 'storage.rs'), 'utf8');
  const mcpOauth = readFileSync(path.join(engineRoot, 'rmcp-client', 'src', 'oauth.rs'), 'utf8');
  const appServerLib = readFileSync(path.join(engineRoot, 'app-server', 'src', 'lib.rs'), 'utf8');
  const secretsLib = readFileSync(path.join(engineRoot, 'secrets', 'src', 'lib.rs'), 'utf8');
  const sleepInhibitor = readFileSync(path.join(engineRoot, 'utils', 'sleep-inhibitor', 'src', 'linux_inhibitor.rs'), 'utf8');
  const configLoader = readFileSync(path.join(engineRoot, 'config', 'src', 'loader', 'mod.rs'), 'utf8');
  const macosConfigLoader = readFileSync(path.join(engineRoot, 'config', 'src', 'loader', 'macos.rs'), 'utf8');
  const homeDir = readFileSync(path.join(engineRoot, 'utils', 'home-dir', 'src', 'lib.rs'), 'utf8');
  const appServerTransport = readFileSync(path.join(engineRoot, 'app-server-transport', 'src', 'transport', 'mod.rs'), 'utf8');
  const initializeProcessor = readFileSync(path.join(engineRoot, 'app-server', 'src', 'request_processors', 'initialize_processor.rs'), 'utf8');
  if (!loginStorage.includes('const KEYRING_SERVICE: &str = "Hexa Auth";')) {
    errors.push('Hexa auth keyring is not isolated from Codex');
  }
  if (!mcpOauth.includes('const KEYRING_SERVICE: &str = "Hexa MCP Credentials";')) {
    errors.push('Hexa MCP credential keyring is not isolated from Codex');
  }
  if (!appServerLib.includes('const OTEL_SERVICE_NAME: &str = "hexa-app-server";')) {
    errors.push('Hexa app-server telemetry/process identity is missing');
  }
  if (!secretsLib.includes('const KEYRING_SERVICE: &str = "hexa";')) {
    errors.push('Hexa generic secrets keyring is not isolated from Codex');
  }
  if (!sleepInhibitor.includes('const APP_ID: &str = "hexa";')) {
    errors.push('Hexa OS application identity is not isolated');
  }
  if (!configLoader.includes('dir.join(".hexa")') || configLoader.includes('dir.join(".codex")')) {
    errors.push('Hexa repository-local config still shares the .codex namespace');
  }
  if (!configLoader.includes('program_data.join("Hexa").join("Engine")')) {
    errors.push('Hexa Windows managed configuration still shares the Codex namespace');
  }
  if (!macosConfigLoader.includes('const MANAGED_PREFERENCES_APPLICATION_ID: &str = "com.hexa.engine";')) {
    errors.push('Hexa macOS managed preferences still share the Codex namespace');
  }
  if (!homeDir.includes('std::env::var("HEXA_ENGINE_HOME")') || !homeDir.includes('p.push(".hexashell")') || homeDir.includes('CODEX_HOME')) {
    errors.push('Hexa global engine home still shares the official Codex environment/default path');
  }
  if (!installContext.includes('hexa-package.json') || !installContext.includes('hexa-resources') || !installContext.includes('hexa-path') || installContext.includes('codex-package.json') || installContext.includes('codex-resources') || installContext.includes('codex-path')) {
    errors.push('Hexa packaged runtime resources still use Codex-local names');
  }
  if (!appServerTransport.includes('"hexa-app-server-control"') || !appServerTransport.includes('"hexa-app-server-control.sock"') || !appServerTransport.includes('"hexa-app-server-startup.lock"')) {
    errors.push('Hexa app-server control socket/lock namespace is not isolated');
  }
  if (!daemon.includes('const STATE_DIR_NAME: &str = "hexa-app-server-daemon";')) {
    errors.push('Hexa app-server daemon state directory is not isolated');
  }
  if (!daemonClient.includes('const CLIENT_NAME: &str = "hexa_app_server_daemon";')) {
    errors.push('Hexa app-server daemon client identity is not isolated');
  }
  if (!initializeProcessor.includes('"hexa_app_server_daemon"') || initializeProcessor.includes('"codex_app_server_daemon"')) {
    errors.push('Hexa app-server still recognizes the daemon under the Codex local client identity');
  }

  const namespaceScan = [engineRoot];
  while (namespaceScan.length) {
    const directory = namespaceScan.pop();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'target' || entry.name === '.git') continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        namespaceScan.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name);
      if (!['.rs', '.md', '.toml', '.json', '.txt', '.py', '.js', '.mjs', '.ts', '.tsx', '.html', '.snap'].includes(extension)) continue;
      const text = readFileSync(full, 'utf8');
      const relative = path.relative(engineRoot, full);
      if (text.includes('CODEX_HOME') || text.includes('CODEX_SQLITE_HOME')) errors.push(`${relative} still references the official Codex home environment namespace`);
      if (/~\/\.codex|["`]\.codex(?:[\/"]|`)|\/\.codex\//.test(text)) errors.push(`${relative} still references the official Codex filesystem namespace`);
      if (/codex-(?:package\.json|resources|path|arg0-session|bwrap-synthetic-mount-targets)/.test(text)) errors.push(`${relative} still references a Codex local runtime resource namespace`);
    }
  }
  const binaryManager = readFileSync(path.join(shellRoot, 'src', 'main', 'engine', 'BinaryManager.ts'), 'utf8');
  const appServerClient = readFileSync(path.join(shellRoot, 'src', 'main', 'engine', 'AppServerClient.ts'), 'utf8');
  const shellPackage = JSON.parse(readFileSync(path.join(shellRoot, 'package.json'), 'utf8'));
  const extraResources = shellPackage?.build?.extraResources ?? [];
  if (extraResources.some((entry) => entry?.from === '../engine' || String(entry?.to ?? '').startsWith('engine-source'))) {
    errors.push('desktop packaging still bundles the Cargo engine source tree');
  }
  if (!binaryManager.includes('Packaged Hexa is intentionally binary-only') || binaryManager.includes('stagePackagedSource()')) {
    errors.push('packaged runtime can still fall back to bundled Cargo source instead of resources/bin');
  }
  if (!binaryManager.includes("cargoBin: 'hexa-app-server'") || !binaryManager.includes('HexaAppServer.exe')) {
    errors.push('Hexa build/staging flow does not produce a dedicated Hexa app-server executable');
  }
  if (!appServerClient.includes('HexaAppServer.exe') || !appServerClient.includes("HEXA_PROCESS_NAMESPACE: 'hexa'") || !appServerClient.includes('HEXA_ENGINE_HOME') || !appServerClient.includes('HEXA_SQLITE_HOME') || appServerClient.includes('CODEX_HOME') || appServerClient.includes('CODEX_SQLITE_HOME')) {
    errors.push('Hexa app-server process/state isolation is missing or still exports Codex state variables');
  }
  if (appServerClient.includes("spawn(binaryPath, ['app-server'")) {
    errors.push('Hexa still launches app-server inside the primary engine process');
  }
  const packageRebrand = readFileSync(path.join(shellRoot, 'scripts', 'engine-package-rebrand.mjs'), 'utf8');
  const patchAdapter = readFileSync(path.join(shellRoot, 'scripts', 'engine-patches.mjs'), 'utf8');
  if (!patchAdapter.includes("import { applyHexaCargoPackageRebrand } from './engine-package-rebrand.mjs';") || !patchAdapter.includes('applyHexaCargoPackageRebrand(engineRoot)')) {
    errors.push('Hexa update adapter no longer applies the Cargo/process rebrand layer');
  }
  if (!patchAdapter.includes("import { applyHexaRuntimeIsolation } from './engine-runtime-isolation.mjs';") || !patchAdapter.includes('applyHexaRuntimeIsolation(engineRoot)')) {
    errors.push('Hexa update adapter no longer applies the runtime/state isolation layer');
  }
  if (!packageRebrand.includes("['codex-app-server', 'hexa-app-server']") || !packageRebrand.includes("['codex', 'hexa-engine']")) {
    errors.push('Hexa Cargo/process rebrand map is incomplete');
  }
  const preload = readFileSync(path.join(shellRoot, 'src', 'preload', 'index.cts'), 'utf8');
  if (!preload.includes("exposeInMainWorld('hexa'") || preload.includes("'codex:")) {
    errors.push('Hexa preload bridge still exposes legacy Codex branding');
  }
  const sharedTypes = readFileSync(path.join(shellRoot, 'src', 'shared', 'types.ts'), 'utf8');
  if (sharedTypes.includes('CodexBridge') || sharedTypes.includes('CodexStatus') || !sharedTypes.includes('HexaBridge')) {
    errors.push('Hexa renderer bridge types still expose legacy Codex branding');
  }
  for (const updaterScript of ['update-upstream.mjs', 'import-engine-version.mjs']) {
    const updater = readFileSync(path.join(shellRoot, 'scripts', updaterScript), 'utf8');
    if (!updater.includes("import { applyHexaEnginePatches } from './engine-patches.mjs';") || !updater.includes('applyHexaEnginePatches(')) {
      errors.push(`${updaterScript} no longer routes staged engine trees through the Hexa patch adapter`);
    }
  }
}
if (!errors.length && process.env.HEXA_SKIP_CARGO_METADATA !== '1') {
  const metadata = spawnSync('cargo', ['metadata', '--manifest-path', engineManifest, '--no-deps', '--format-version', '1'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (metadata.error) {
    errors.push(`cargo metadata could not start: ${metadata.error.message}`);
  } else if (metadata.status !== 0) {
    const detail = String(metadata.stderr || metadata.stdout || 'unknown cargo metadata failure').trim();
    errors.push(`cargo metadata failed: ${detail}`);
  }
}
if (errors.length) {
  console.error(`Hexa Engine structure check failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(`✓ Hexa Engine structure is compatible\n  workspace: ${engineRoot}\n  product runtime: HexaEngine + isolated HexaAppServer + Hexa-branded helper executables`);
