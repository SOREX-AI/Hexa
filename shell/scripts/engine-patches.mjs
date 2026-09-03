import { copyFile, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyHexaCargoPackageRebrand } from './engine-package-rebrand.mjs';
import { applyHexaRuntimeIsolation } from './engine-runtime-isolation.mjs';

const resumeSource = path.join('app-server', 'src', 'request_processors', 'thread_lifecycle.rs');
const resumeAnchor = `            Ok(cursors) => cursors,
            Err(error) => {
`;
const resumePatch = `            Ok(cursors) => cursors,
            // Rollout-backed and some local-provider thread stores predate the
            // paginated history API. Backwards cursors are an optimization for
            // incremental history loading, not a requirement for resuming the
            // live thread, so keep the resume usable when that optional store
            // capability is unavailable.
            Err(error) if error.code == -32601 => (None, None),
            Err(error) => {
`;

const cliSource = path.join('cli', 'src', 'main.rs');
const cliIdentityAnchor = `#[clap(
    author,
    version,`;
const cliIdentityPatch = `#[clap(
    name = "HexaEngine",
    author,
    version,`;
const cliUsageAnchor = `    // the generic \`codex\` command name that users run.
    bin_name = "codex",
    override_usage = "codex [OPTIONS] [PROMPT]\\n       codex [OPTIONS] <COMMAND> [ARGS]"`;
const cliUsagePatch = `    // Hexa stages this upstream-compatible binary under a product-specific
    // process name on every platform.
    bin_name = "hexa-engine",
    override_usage = "hexa-engine [OPTIONS] [PROMPT]\\n       hexa-engine [OPTIONS] <COMMAND> [ARGS]"`;
const cliDescriptionAnchor = '/// Codex CLI';
const cliDescriptionPatch = '/// Hexa Engine';

const localProviderSource = path.join('core', 'src', 'client.rs');
const toolSpecSource = path.join('core', 'src', 'tools', 'spec_plan.rs');
const sessionSource = path.join('core', 'src', 'session', 'mod.rs');
const sandboxSetupSource = path.join('windows-sandbox-rs', 'src', 'bin', 'setup_main', 'win.rs');
const sandboxUsersSource = path.join('windows-sandbox-rs', 'src', 'bin', 'setup_main', 'win', 'sandbox_users.rs');
const localProviderImportAnchor = 'use codex_protocol::models::ResponseItem;';
const localProviderImportPatch = `use codex_protocol::models::ContentItem;
use codex_protocol::models::ResponseItem;`;
const localProviderEffectiveMethodAnchor = '    fn prompt_cache_key(&self, responses_metadata: &CodexResponsesMetadata) -> String {';
const localProviderEffectiveMethodPatch = `    /// Responses Lite is an OpenAI transport dialect. Model metadata can be
    /// reused for local/fallback providers, but those providers must stay on
    /// the standard Responses shape or developer-role prefix items can become
    /// multiple system messages in OpenAI-compatible servers.
    fn use_responses_lite_for_provider(&self, model_info: &ModelInfo) -> bool {
        model_info.use_responses_lite && self.state.provider.info().is_openai()
    }

    fn prompt_cache_key(&self, responses_metadata: &CodexResponsesMetadata) -> String {`;
const localProviderPreludeAnchor = `        let mut input = prompt.get_formatted_input_for_request(model_info.use_responses_lite);
        let is_openai = self.state.provider.info().is_openai();`;
const localProviderPreludePatch = `        let is_openai = self.state.provider.info().is_openai();
        let use_responses_lite = self.use_responses_lite_for_provider(model_info);
        let mut input = prompt.get_formatted_input_for_request(use_responses_lite);`;
const localProviderBindingAnchor = '        let (instructions, tools) = if model_info.use_responses_lite {';
const localProviderBindingPatch = '        let (mut instructions, tools) = if use_responses_lite {';
const localProviderPriorBinding = `        let use_responses_lite = model_info.use_responses_lite && is_openai;
`;
const localProviderParallelAnchor =
  '            parallel_tool_calls: prompt.parallel_tool_calls && !model_info.use_responses_lite,';
const localProviderParallelPatch =
  '            parallel_tool_calls: prompt.parallel_tool_calls && !use_responses_lite,';
const localProviderRequestAnchor = `        if !is_openai {
            for item in &mut input {`;
const localProviderRequestPatch = `        if !is_openai {
            instructions = fold_developer_messages_into_instructions(&mut input, instructions);
            for item in &mut input {`;
const localProviderHelperAnchor = 'impl Drop for ModelClientSession {';
const localProviderHelperPatch = `fn fold_developer_messages_into_instructions(
    input: &mut Vec<ResponseItem>,
    base_instructions: String,
) -> String {
    let mut instruction_blocks = Vec::new();
    if !base_instructions.trim().is_empty() {
        instruction_blocks.push(base_instructions);
    }
    input.retain(|item| match item {
        // AdditionalTools is Responses-Lite transport metadata. A resumed local
        // thread can contain this item even after switching the current request
        // back to standard Responses. Local compatibility layers commonly map
        // its developer role to another system message, so never forward it.
        ResponseItem::AdditionalTools { .. } => false,
        ResponseItem::Message { role, content, .. }
            if role == "developer" || role == "system" =>
        {
            let text = content
                .iter()
                .filter_map(|part| match part {
                    ContentItem::InputText { text } | ContentItem::OutputText { text } => {
                        Some(text.as_str())
                    }
                    ContentItem::InputImage { .. } | ContentItem::InputAudio { .. } => None,
                })
                .collect::<Vec<_>>()
                .join("\\n");
            if !text.trim().is_empty() {
                instruction_blocks.push(text);
            }
            false
        }
        _ => true,
    });
    instruction_blocks.join("\\n\\n")
}

impl Drop for ModelClientSession {`;
const localProviderOldHelperBody = `    input.retain(|item| {
        let ResponseItem::Message { role, content, .. } = item else {
            return true;
        };
        if role != "developer" && role != "system" {
            return true;
        }
        let text = content
            .iter()
            .filter_map(|part| match part {
                ContentItem::InputText { text } | ContentItem::OutputText { text } => {
                    Some(text.as_str())
                }
                ContentItem::InputImage { .. } | ContentItem::InputAudio { .. } => None,
            })
            .collect::<Vec<_>>()
            .join("\\n");
        if !text.trim().is_empty() {
            instruction_blocks.push(text);
        }
        false
    });`;
const localProviderNewHelperBody = `    input.retain(|item| match item {
        // AdditionalTools is Responses-Lite transport metadata. A resumed local
        // thread can contain this item even after switching the current request
        // back to standard Responses. Local compatibility layers commonly map
        // its developer role to another system message, so never forward it.
        ResponseItem::AdditionalTools { .. } => false,
        ResponseItem::Message { role, content, .. }
            if role == "developer" || role == "system" =>
        {
            let text = content
                .iter()
                .filter_map(|part| match part {
                    ContentItem::InputText { text } | ContentItem::OutputText { text } => {
                        Some(text.as_str())
                    }
                    ContentItem::InputImage { .. } | ContentItem::InputAudio { .. } => None,
                })
                .collect::<Vec<_>>()
                .join("\\n");
            if !text.trim().is_empty() {
                instruction_blocks.push(text);
            }
            false
        }
        _ => true,
    });`;
const localProviderReasoningSignatureAnchor = `        summary: ReasoningSummaryConfig,
    ) -> Reasoning {`;
const localProviderReasoningSignaturePatch = `        summary: ReasoningSummaryConfig,
        use_responses_lite: bool,
    ) -> Reasoning {`;
const localProviderReasoningContextAnchor = `            context: model_info
                .use_responses_lite
                .then_some(ReasoningContext::AllTurns),`;
const localProviderReasoningContextPatch =
  '            context: use_responses_lite.then_some(ReasoningContext::AllTurns),';
const localProviderReasoningCallAnchor =
  '        let reasoning = self.build_reasoning(model_info, effort, summary);';
const localProviderReasoningCallPatch =
  '        let reasoning = self.build_reasoning(model_info, effort, summary, use_responses_lite);';
const localProviderCompactHeaderAnchor =
  '        add_responses_lite_header(&mut extra_headers, model_info.use_responses_lite);';
const localProviderCompactHeaderPatch = `        add_responses_lite_header(
            &mut extra_headers,
            self.use_responses_lite_for_provider(model_info),
        );`;
const localProviderStreamOptionsAnchor = `            let compression = self.responses_request_compression(client_setup.auth.as_ref());
            let mut options = self
                .build_responses_options(
                    responses_metadata,
                    compression,
                    model_info.use_responses_lite,
                )
                .await;`;
const localProviderStreamOptionsPatch = `            let compression = self.responses_request_compression(client_setup.auth.as_ref());
            let use_responses_lite = self.client.use_responses_lite_for_provider(model_info);
            let mut options = self
                .build_responses_options(responses_metadata, compression, use_responses_lite)
                .await;`;
const localProviderWsMetadataAnchor = `            let mut client_metadata = self
                .client
                .build_ws_client_metadata(responses_metadata, model_info.use_responses_lite);`;
const localProviderWsMetadataPatch = `            let use_responses_lite = self.client.use_responses_lite_for_provider(model_info);
            let mut client_metadata = self
                .client
                .build_ws_client_metadata(responses_metadata, use_responses_lite);`;


function replaceRequired(text, anchor, replacement, description) {
  if (!text.includes(anchor)) throw new Error(`Engine compatibility patch no longer applies: ${description}.`);
  return text.replace(anchor, replacement);
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'target') continue;
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(candidate));
    else files.push(candidate);
  }
  return files;
}

async function replaceFileLiterals(engineRoot, relative, replacements) {
  const file = path.join(engineRoot, relative);
  let text = await readFile(file, 'utf8');
  let changes = 0;
  for (const [from, to] of replacements) {
    if (!text.includes(from)) continue;
    const before = text;
    text = text.replaceAll(from, to);
    if (text !== before) changes += 1;
  }
  if (changes) await writeFile(file, text);
  return changes;
}

async function replaceRustTreeLiterals(engineRoot, relativeDir, replacements) {
  let filesChanged = 0;
  for (const file of await walk(path.join(engineRoot, relativeDir))) {
    if (path.extname(file) !== '.rs') continue;
    let text = await readFile(file, 'utf8');
    let next = text;
    for (const [from, to] of replacements) next = next.replaceAll(from, to);
    if (next !== text) {
      await writeFile(file, next);
      filesChanged += 1;
    }
  }
  return filesChanged;
}

async function replaceTextTreeLiterals(engineRoot, relativeDir, replacements) {
  const extensions = new Set(['.rs', '.md', '.txt', '.toml', '.json', '.snap']);
  let filesChanged = 0;
  for (const file of await walk(path.join(engineRoot, relativeDir))) {
    if (!extensions.has(path.extname(file))) continue;
    let text = await readFile(file, 'utf8');
    let next = text;
    for (const [from, to] of replacements) next = next.replaceAll(from, to);
    if (next !== text) {
      await writeFile(file, next);
      filesChanged += 1;
    }
  }
  return filesChanged;
}

function replaceBetweenRequired(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(label);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(label);
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

async function validateHexaPackageLayer(engineRoot) {
  const violations = [];
  const allFiles = await walk(engineRoot);
  for (const file of allFiles) {
    if (path.basename(file) !== 'Cargo.toml') continue;
    const text = await readFile(file, 'utf8');
    let section = '';
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[')) section = trimmed;
      if ((section === '[package]' || section === '[[bin]]') && /^name\s*=\s*"codex(?:-|\")/.test(trimmed)) {
        violations.push(`${path.relative(engineRoot, file)} still exposes a codex package/bin name: ${trimmed}`);
      }
    }
  }

  const cliManifest = await readFile(path.join(engineRoot, 'cli', 'Cargo.toml'), 'utf8');
  const appServerManifest = await readFile(path.join(engineRoot, 'app-server', 'Cargo.toml'), 'utf8');
  const codeModeHostManifest = await readFile(path.join(engineRoot, 'code-mode-host', 'Cargo.toml'), 'utf8');
  const sandboxManifest = await readFile(path.join(engineRoot, 'windows-sandbox-rs', 'Cargo.toml'), 'utf8');
  const loginStorage = await readFile(path.join(engineRoot, 'login', 'src', 'auth', 'storage.rs'), 'utf8');
  const mcpOauth = await readFile(path.join(engineRoot, 'rmcp-client', 'src', 'oauth.rs'), 'utf8');
  const appServerLib = await readFile(path.join(engineRoot, 'app-server', 'src', 'lib.rs'), 'utf8');
  const secretsLib = await readFile(path.join(engineRoot, 'secrets', 'src', 'lib.rs'), 'utf8');
  const sleepInhibitor = await readFile(path.join(engineRoot, 'utils', 'sleep-inhibitor', 'src', 'linux_inhibitor.rs'), 'utf8');
  const configLoader = await readFile(path.join(engineRoot, 'config', 'src', 'loader', 'mod.rs'), 'utf8');
  const macosConfigLoader = await readFile(path.join(engineRoot, 'config', 'src', 'loader', 'macos.rs'), 'utf8');
  const homeDir = await readFile(path.join(engineRoot, 'utils', 'home-dir', 'src', 'lib.rs'), 'utf8');
  const installContext = await readFile(path.join(engineRoot, 'install-context', 'src', 'lib.rs'), 'utf8');
  const appServerTransport = await readFile(path.join(engineRoot, 'app-server-transport', 'src', 'transport', 'mod.rs'), 'utf8');
  const daemonLib = await readFile(path.join(engineRoot, 'app-server-daemon', 'src', 'lib.rs'), 'utf8');
  const daemonClient = await readFile(path.join(engineRoot, 'app-server-daemon', 'src', 'client.rs'), 'utf8');
  const initializeProcessor = await readFile(path.join(engineRoot, 'app-server', 'src', 'request_processors', 'initialize_processor.rs'), 'utf8');

  if (!cliManifest.includes('name = "hexa-cli"') || !cliManifest.includes('name = "hexa-engine"')) violations.push('Hexa CLI Cargo package/bin identity');
  if (!appServerManifest.includes('name = "hexa-app-server"')) violations.push('Hexa app-server Cargo package/bin identity');
  if (!codeModeHostManifest.includes('name = "hexa-code-mode-host"')) violations.push('Hexa code-mode-host Cargo identity');
  if (!sandboxManifest.includes('name = "hexa-command-runner"') || !sandboxManifest.includes('name = "hexa-windows-sandbox-setup"')) violations.push('Hexa Windows helper Cargo identities');
  if (!loginStorage.includes('const KEYRING_SERVICE: &str = "Hexa Auth";')) violations.push('Hexa auth keyring namespace');
  if (!mcpOauth.includes('const KEYRING_SERVICE: &str = "Hexa MCP Credentials";')) violations.push('Hexa MCP keyring namespace');
  if (!appServerLib.includes('const OTEL_SERVICE_NAME: &str = "hexa-app-server";')) violations.push('Hexa app-server telemetry/process identity');
  if (!secretsLib.includes('const KEYRING_SERVICE: &str = "hexa";')) violations.push('Hexa secrets keyring namespace');
  if (!sleepInhibitor.includes('const APP_ID: &str = "hexa";')) violations.push('Hexa OS application identity');
  if (!configLoader.includes('dir.join(".hexa")') || configLoader.includes('dir.join(".codex")')) violations.push('Hexa project config directory isolation');
  if (!configLoader.includes('program_data.join("Hexa").join("Engine")')) violations.push('Hexa Windows managed-config namespace');
  if (!macosConfigLoader.includes('const MANAGED_PREFERENCES_APPLICATION_ID: &str = "com.hexa.engine";')) violations.push('Hexa macOS managed-preferences namespace');
  if (!homeDir.includes('std::env::var("HEXA_ENGINE_HOME")') || !homeDir.includes('p.push(".hexashell")') || homeDir.includes('CODEX_HOME')) violations.push('Hexa global home namespace');
  if (!installContext.includes('hexa-package.json') || !installContext.includes('hexa-resources') || !installContext.includes('hexa-path') || installContext.includes('codex-package.json') || installContext.includes('codex-resources') || installContext.includes('codex-path')) violations.push('Hexa packaged-runtime resource namespace');
  if (!appServerTransport.includes('"hexa-app-server-control"') || !appServerTransport.includes('"hexa-app-server-control.sock"') || !appServerTransport.includes('"hexa-app-server-startup.lock"')) violations.push('Hexa app-server control socket namespace');
  if (!daemonLib.includes('const STATE_DIR_NAME: &str = "hexa-app-server-daemon";')) violations.push('Hexa app-server daemon state namespace');
  if (!daemonClient.includes('const CLIENT_NAME: &str = "hexa_app_server_daemon";')) violations.push('Hexa app-server daemon client identity');
  if (!initializeProcessor.includes('"hexa_app_server_daemon"') || initializeProcessor.includes('"codex_app_server_daemon"')) violations.push('Hexa app-server daemon initialization identity');

  for (const file of allFiles) {
    const extension = path.extname(file);
    if (!['.rs', '.md', '.toml', '.json', '.txt', '.py', '.js', '.mjs', '.ts', '.tsx', '.html', '.snap'].includes(extension)) continue;
    const text = await readFile(file, 'utf8').catch(() => '');
    const relative = path.relative(engineRoot, file);
    if (text.includes('CODEX_HOME') || text.includes('CODEX_SQLITE_HOME')) violations.push(`${relative} still references the official Codex home environment namespace`);
    if (/~\/\.codex|["`]\.codex(?:[\/"]|`)|\/\.codex\//.test(text)) violations.push(`${relative} still references the official Codex filesystem namespace`);
    if (/codex-(?:package\.json|resources|path|arg0-session|bwrap-synthetic-mount-targets)/.test(text)) violations.push(`${relative} still references a Codex local runtime resource namespace`);
  }

  for (const legacyDir of ['codex-api', 'codex-backend-openapi-models', 'codex-client', 'codex-experimental-api-macros', 'codex-home', 'codex-mcp']) {
    try {
      await readFile(path.join(engineRoot, legacyDir, 'Cargo.toml'), 'utf8');
      violations.push(`legacy engine directory ${legacyDir}`);
    } catch {
      // Expected after package rebrand.
    }
  }

  if (violations.length) throw new Error(`Hexa package/process rebrand validation failed: ${violations.join(', ')}`);
}

export async function applyHexaEnginePatches(engineRoot) {
  // Upstream still ships the legacy filename; keep the rebranded build
  // manifest present before Cargo's Windows linker step.
  try {
    await copyFile(
      path.join(engineRoot, 'windows-sandbox-rs', 'codex-windows-sandbox-setup.manifest'),
      path.join(engineRoot, 'windows-sandbox-rs', 'hexa-windows-sandbox-setup.manifest'),
    );
  } catch {
    // A future upstream may already provide the Hexa filename.
  }
  // Always apply the local namespace isolation layer first. This deliberately
  // runs even on an already-rebranded tree so older Hexa stages can be upgraded
  // without first restoring a raw upstream snapshot.
  const runtimeIsolation = await applyHexaRuntimeIsolation(engineRoot);
  // Windows can report a newly-created local sandbox account as unknown for a
  // short period while its account database update propagates. Retrying the
  // offline account lookup keeps both cloud and local sessions sandboxed rather
  // than failing the entire setup during that transient window.
  const sandboxUsers = path.join(engineRoot, sandboxUsersSource);
  let sandboxUsersText = await readFile(sandboxUsers, 'utf8');
  const sandboxRetryImportAnchor = 'use std::path::PathBuf;';
  const sandboxRetryImportPatch = 'use std::path::PathBuf;\nuse std::thread::sleep;\nuse std::time::Duration;';
  const sandboxRetryAnchor = 'fn well_known_sid_str(name: &str) -> Option<&\'static str> {';
  const sandboxRetryPatch = `pub fn resolve_sid_after_provisioning(name: &str) -> Result<Vec<u8>> {
    let mut last_error = None;
    for attempt in 1..=5 {
        match resolve_sid(name) {
            Ok(sid) => return Ok(sid),
            Err(error) => {
                last_error = Some(error);
                if attempt < 5 {
                    sleep(Duration::from_millis(250 * attempt));
                }
            }
        }
    }
    Err(last_error.expect("SID lookup attempts always record an error"))
}

fn well_known_sid_str(name: &str) -> Option<&'static str> {`;
  if (!sandboxUsersText.includes('pub fn resolve_sid_after_provisioning')) {
    sandboxUsersText = replaceRequired(sandboxUsersText, sandboxRetryImportAnchor, sandboxRetryImportPatch, `${sandboxUsersSource} changed around imports`);
    sandboxUsersText = replaceRequired(sandboxUsersText, sandboxRetryAnchor, sandboxRetryPatch, `${sandboxUsersSource} changed around SID resolution`);
    await writeFile(sandboxUsers, sandboxUsersText);
  }
  const sandboxSetup = path.join(engineRoot, sandboxSetupSource);
  let sandboxSetupText = await readFile(sandboxSetup, 'utf8');
  if (!sandboxSetupText.includes('use sandbox_users::resolve_sid_after_provisioning;')) {
    sandboxSetupText = replaceRequired(
      sandboxSetupText,
      'use sandbox_users::resolve_sid;\n',
      'use sandbox_users::resolve_sid;\nuse sandbox_users::resolve_sid_after_provisioning;\n',
      `${sandboxSetupSource} changed around SID imports`,
    );
    sandboxSetupText = sandboxSetupText.replaceAll(
      'let offline_sid = resolve_sid(&payload.offline_username).map_err(|err| {',
      'let offline_sid = resolve_sid_after_provisioning(&payload.offline_username).map_err(|err| {',
    );
    await writeFile(sandboxSetup, sandboxSetupText);
  }
  const rootCargo = await readFile(path.join(engineRoot, 'Cargo.toml'), 'utf8');
  const alreadyPackageRebranded = rootCargo.includes('package = "hexa-core"') && rootCargo.includes('package = "hexa-app-server"');
  if (alreadyPackageRebranded) {
    await validateHexaPackageLayer(engineRoot);
    return {
      bazelFilesChanged: 0,
      brandingFilesChanged: 0,
      cliIdentity: true,
      localProviderCompatibility: true,
      resumeCompatibility: true,
      cargoPackagesRenamed: 0,
      cargoManifestsChanged: 0,
      cargoAncillaryFilesChanged: 0,
      cargoSecondaryBinReferencesChanged: 0,
      cargoRuntimeReferencesChanged: 0,
      cargoSourceDirectoriesRenamed: 0,
      ...runtimeIsolation,
    };
  }
  const lifecycle = path.join(engineRoot, resumeSource);
  const lifecycleText = await readFile(lifecycle, 'utf8');
  if (!lifecycleText.includes('Err(error) if error.code == -32601')) {
    if (!lifecycleText.includes(resumeAnchor)) {
      throw new Error(`Engine compatibility patch no longer applies: ${resumeSource} changed around the resume cursor handler.`);
    }
    await writeFile(lifecycle, lifecycleText.replace(resumeAnchor, resumePatch));
  }

  const cli = path.join(engineRoot, cliSource);
  let cliText = await readFile(cli, 'utf8');
  if (!cliText.includes(cliDescriptionPatch)) {
    if (!cliText.includes(cliDescriptionAnchor)) {
      throw new Error(`Engine identity patch no longer applies: ${cliSource} changed around its description.`);
    }
    cliText = cliText.replace(cliDescriptionAnchor, cliDescriptionPatch);
  }
  if (!cliText.includes('name = "HexaEngine"')) {
    if (!cliText.includes(cliIdentityAnchor)) {
      throw new Error(`Engine identity patch no longer applies: ${cliSource} changed around its CLI declaration.`);
    }
    cliText = cliText.replace(cliIdentityAnchor, cliIdentityPatch);
  }
  if (!cliText.includes('bin_name = "hexa-engine"')) {
    if (!cliText.includes(cliUsageAnchor)) {
      throw new Error(`Engine identity patch no longer applies: ${cliSource} changed around its usage declaration.`);
    }
    cliText = cliText.replace(cliUsageAnchor, cliUsagePatch);
  }
  await writeFile(cli, cliText);

  const localProvider = path.join(engineRoot, localProviderSource);
  let localProviderText = await readFile(localProvider, 'utf8');
  if (!localProviderText.includes('use codex_protocol::models::ContentItem;')) {
    localProviderText = replaceRequired(localProviderText, localProviderImportAnchor, localProviderImportPatch, `${localProviderSource} changed around its protocol imports`);
  }
  if (!localProviderText.includes('fn use_responses_lite_for_provider')) {
    localProviderText = replaceRequired(localProviderText, localProviderEffectiveMethodAnchor, localProviderEffectiveMethodPatch, `${localProviderSource} changed around ModelClient request metadata`);
  }
  if (!localProviderText.includes('get_formatted_input_for_request(use_responses_lite)')) {
    localProviderText = replaceRequired(localProviderText, localProviderPreludeAnchor, localProviderPreludePatch, `${localProviderSource} changed around request construction`);
  }
  // Upgrade an earlier Hexa compatibility patch if this staged tree already contains it.
  localProviderText = localProviderText.replace(localProviderPriorBinding, '');
  if (!localProviderText.includes('let (mut instructions, tools) = if use_responses_lite')) {
    localProviderText = replaceRequired(localProviderText, localProviderBindingAnchor, localProviderBindingPatch, `${localProviderSource} changed around Responses Lite request construction`);
  }
  if (!localProviderText.includes('parallel_tool_calls: prompt.parallel_tool_calls && !use_responses_lite')) {
    localProviderText = replaceRequired(localProviderText, localProviderParallelAnchor, localProviderParallelPatch, `${localProviderSource} changed around Responses Lite tool configuration`);
  }
  if (!localProviderText.includes('instructions = fold_developer_messages_into_instructions')) {
    localProviderText = replaceRequired(localProviderText, localProviderRequestAnchor, localProviderRequestPatch, `${localProviderSource} changed around non-OpenAI request cleanup`);
  }
  if (!localProviderText.includes('fn fold_developer_messages_into_instructions')) {
    localProviderText = replaceRequired(localProviderText, localProviderHelperAnchor, localProviderHelperPatch, `${localProviderSource} changed around ModelClientSession`);
  } else if (!localProviderText.includes('AdditionalTools is Responses-Lite transport metadata')) {
    localProviderText = replaceRequired(localProviderText, localProviderOldHelperBody, localProviderNewHelperBody, `${localProviderSource} changed around local history sanitization`);
  }
  if (!localProviderText.includes('summary: ReasoningSummaryConfig,\n        use_responses_lite: bool,')) {
    localProviderText = replaceRequired(localProviderText, localProviderReasoningSignatureAnchor, localProviderReasoningSignaturePatch, `${localProviderSource} changed around reasoning request construction`);
  }
  if (!localProviderText.includes('context: use_responses_lite.then_some(ReasoningContext::AllTurns)')) {
    localProviderText = replaceRequired(localProviderText, localProviderReasoningContextAnchor, localProviderReasoningContextPatch, `${localProviderSource} changed around Responses Lite reasoning context`);
  }
  if (!localProviderText.includes('build_reasoning(model_info, effort, summary, use_responses_lite)')) {
    localProviderText = replaceRequired(localProviderText, localProviderReasoningCallAnchor, localProviderReasoningCallPatch, `${localProviderSource} changed around reasoning invocation`);
  }
  if (!localProviderText.includes('self.use_responses_lite_for_provider(model_info),\n        );')) {
    localProviderText = replaceRequired(localProviderText, localProviderCompactHeaderAnchor, localProviderCompactHeaderPatch, `${localProviderSource} changed around compact request headers`);
  }
  if (!localProviderText.includes('let use_responses_lite = self.client.use_responses_lite_for_provider(model_info);')) {
    localProviderText = replaceRequired(localProviderText, localProviderStreamOptionsAnchor, localProviderStreamOptionsPatch, `${localProviderSource} changed around stream request headers`);
  }
  if (!localProviderText.includes('let use_responses_lite = self.client.use_responses_lite_for_provider(model_info);\n            let mut client_metadata')) {
    localProviderText = replaceRequired(localProviderText, localProviderWsMetadataAnchor, localProviderWsMetadataPatch, `${localProviderSource} changed around WebSocket client metadata`);
  }
  await writeFile(localProvider, localProviderText);

  const toolSpec = path.join(engineRoot, toolSpecSource);
  let toolSpecText = await readFile(toolSpec, 'utf8');
  if (!toolSpecText.includes('fn responses_lite_enabled(turn_context: &TurnContext')) {
    toolSpecText = replaceRequired(
      toolSpecText,
      'const IMAGEGEN_TOOL_NAME: &str = "imagegen";\n',
      `const IMAGEGEN_TOOL_NAME: &str = "imagegen";\n\nfn responses_lite_enabled(turn_context: &TurnContext, model_info: &ModelInfo) -> bool {\n    model_info.use_responses_lite && turn_context.provider.info().is_openai()\n}\n`,
      `${toolSpecSource} changed around tool-plan constants`,
    );
  }
  toolSpecText = toolSpecText.replace(
    '        && model_info.use_responses_lite;',
    '        && responses_lite_enabled(turn_context, model_info);',
  );
  toolSpecText = toolSpecText.replace(
    '    if model_info.use_responses_lite\n        || crate::guardian::is_basic_session_source(&turn_context.session_source)',
    '    if responses_lite_enabled(turn_context, model_info)\n        || crate::guardian::is_basic_session_source(&turn_context.session_source)',
  );
  toolSpecText = toolSpecText.replace(
    '        && (model_info.use_responses_lite\n            || turn_context',
    '        && (responses_lite_enabled(turn_context, model_info)\n            || turn_context',
  );
  await writeFile(toolSpec, toolSpecText);

  const session = path.join(engineRoot, sessionSource);
  let sessionText = await readFile(session, 'utf8');
  const sessionLiteAnchor = `            && turn_context.model_info().use_responses_lite\n        {`;
  if (!sessionText.includes('&& turn_context.model_info().use_responses_lite\n            && turn_context.provider.info().is_openai()')) {
    sessionText = replaceRequired(
      sessionText,
      sessionLiteAnchor,
      `            && turn_context.model_info().use_responses_lite\n            && turn_context.provider.info().is_openai()\n        {`,
      `${sessionSource} changed around Responses Lite turn metadata`,
    );
  }
  await writeFile(session, sessionText);

  // Product branding is applied as part of every upstream stage. Keep upstream
  // crate/package/protocol identifiers intact, but make the executable surface,
  // helper filenames, user-facing messages, and generated runtime identity Hexa.
  let brandingFilesChanged = 0;
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('install-context', 'src', 'lib.rs'), [
    ['codex-code-mode-host.exe', 'HexaCodeModeHost.exe'],
    ['"codex-code-mode-host"', '"hexa-code-mode-host"'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, 'windows-sandbox-rs', [
    ['codex-command-runner.exe', 'HexaCommandRunner.exe'],
    ['codex-windows-sandbox-setup.exe', 'HexaSandboxSetup.exe'],
    ['Codex Windows Sandbox', 'Hexa Windows Sandbox'],
    ['Codex sandbox', 'Hexa sandbox'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('windows-sandbox-rs', 'src', 'wfp_setup.rs'), [
    ['"codex-windows-sandbox-setup"', '"hexa-windows-sandbox-setup"'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('code-mode-host', 'src'), [
    ['codex-code-mode-host', 'hexa-code-mode-host'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'tools', 'code_mode', 'mod.rs'), [
    ['install `codex-code-mode-host`', 'install `hexa-code-mode-host`'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('exec', 'src', 'event_processor_with_human_output.rs'), [
    ['OpenAI Codex v{VERSION}', 'Hexa Engine v{VERSION}'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('rmcp-client', 'src', 'oauth_client_registration.rs'), [
    ['.with_client_name("Codex")', '.with_client_name("Hexa")'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('rmcp-client', 'src', 'oauth_http_client_security_tests.rs'), [
    ['{"client_name":"Codex"}', '{"client_name":"Hexa"}'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('ext', 'skills', 'src', 'render.rs'), [
    ['Codex can still see every skill', 'Hexa Engine can still see every skill'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('ext', 'skills', 'src', 'render_tests.rs'), [
    ['Codex can still see every skill', 'Hexa Engine can still see every skill'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('app-server', 'src', 'lib.rs'), [
    ['Codex rebuilt its local database.', 'Hexa Engine rebuilt its local database.'],
    ['Codex local database at {} appears damaged.', 'Hexa Engine local database at {} appears damaged.'],
    ['Moved damaged Codex local database file {} to {}', 'Moved damaged Hexa Engine local database file {} to {}'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'guardian', 'prompt.rs'), [
    ['The following is the Codex agent history', 'The following is the Hexa Engine agent history'],
    ['The Codex agent has requested', 'The Hexa Engine agent has requested'],
    ['Reviewed Codex session id:', 'Reviewed Hexa Engine session id:'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'guardian', 'tests.rs'), [
    ['The following is the Codex agent history', 'The following is the Hexa Engine agent history'],
    ['The Codex agent has requested', 'The Hexa Engine agent has requested'],
    ['Reviewed Codex session id:', 'Reviewed Hexa Engine session id:'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'unified_exec', 'process_manager.rs'), [
    ['Network access was denied by the Codex sandbox network proxy.', 'Network access was denied by the Hexa sandbox network proxy.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'unified_exec', 'process_manager_tests.rs'), [
    ['Network access was denied by the Codex sandbox network proxy.', 'Network access was denied by the Hexa sandbox network proxy.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('git-utils', 'src', 'baseline.rs'), [
    ['Initialize Codex git baseline', 'Initialize Hexa git baseline'],
    ['Co-authored-by: Codex <noreply@openai.com>', 'Co-authored-by: Hexa <noreply@localhost>'],
    ['name: "Codex".into()', 'name: "Hexa".into()'],
    ['email: "noreply@openai.com".into()', 'email: "noreply@localhost".into()'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('git-utils', 'src', 'apply.rs'), [
    ['"git", "config", "user.name", "Codex"', '"git", "config", "user.name", "Hexa"'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'config', 'mod.rs'), [
    ['notify = ["notify-send", "Codex"]', 'notify = ["notify-send", "Hexa"]'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'session', 'handlers.rs'), [
    ['Codex will continue retrying.', 'Hexa Engine will continue retrying.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'session', 'session.rs'), [
    ['Directory containing all Codex state for this session.', 'Directory containing all Hexa Engine state for this session.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'session', 'mod.rs'), [
    ['Codex performance.', 'Hexa Engine performance.'],
    ['cwd native to the Codex host', 'cwd native to the Hexa Engine host'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'tools', 'handlers', 'request_permissions.rs'), [
    ['not native to the Codex host', 'not native to the Hexa Engine host'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'tools', 'handlers', 'dynamic.rs'), [
    ['Tools provided by the current Codex thread.', 'Tools provided by the current Hexa Engine thread.'],
  ]);

  // Model-facing identity and interactive CLI/TUI copy must be Hexa-owned even
  // though the underlying crates and wire schema retain upstream names.
  for (const relative of [
    path.join('core', 'gpt_5_codex_prompt.md'),
    path.join('core', 'gpt-5.1-codex-max_prompt.md'),
    path.join('core', 'gpt-5.2-codex_prompt.md'),
    path.join('core', 'templates', 'model_instructions', 'gpt-5.2-codex_instructions_template.md'),
    path.join('prompts', 'templates', 'realtime', 'backend_prompt.md'),
  ]) {
    brandingFilesChanged += await replaceFileLiterals(engineRoot, relative, [
      ['You are Codex', 'You are Hexa Engine'],
      ['in the Codex CLI', 'inside Hexa'],
    ]);
  }
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('models-manager', 'src', 'model_info.rs'), [
    ['You are Codex, a coding agent based on GPT-5.', 'You are Hexa Engine, a coding agent based on GPT-5.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('models-manager', 'models.json'), [
    ['Codex', 'Hexa Engine'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'realtime_prompt.rs'), [
    ['You are Codex, an OpenAI general-purpose agentic assistant', 'You are Hexa Engine, an OpenAI general-purpose agentic assistant'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('app-server', 'tests'), [
    ['You are Codex, a coding agent based on GPT-5.', 'You are Hexa Engine, a coding agent based on GPT-5.'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('tui', 'src'), [
    ['OpenAI Codex', 'Hexa Engine'],
    ['Ask Codex', 'Ask Hexa'],
    ['## My request for Codex:', '## My request for Hexa:'],
    ['## Referenced chats with Codex:', '## Referenced chats with Hexa:'],
    ['Codex tasks', 'Hexa tasks'],
    ['Codex task', 'Hexa task'],
    ['Codex will', 'Hexa Engine will'],
    ['Codex could', 'Hexa Engine could'],
    ['Codex can', 'Hexa Engine can'],
    ['Codex may', 'Hexa may'],
    ['Codex wants', 'Hexa wants'],
    ['Codex uses', 'Hexa uses'],
    ['Codex just', 'Hexa just'],
    ['Codex is currently', 'Hexa Engine is currently'],
    ['Codex is included', 'Hexa is included'],
    ['Codex conversation', 'Hexa conversation'],
    ['Codex compaction', 'Hexa Engine compaction'],
    ['Codex network access', 'Hexa network access'],
    ['Codex application version', 'Hexa Engine version'],
    ['Codex app name', 'Hexa app name'],
    ['Codex plugins', 'Hexa plugins'],
    ['Codex session', 'Hexa session'],
    ['Codex home', 'Hexa Engine home'],
    ['Codex docs', 'Hexa docs'],
    ['Codex extension active', 'Hexa-compatible extension active'],
    ['Codex agent sandbox', 'Hexa agent sandbox'],
    ['Codex approval presets', 'Hexa approval presets'],
    ['Codex goal', 'Hexa goal'],
    ['Codex repo skill', 'Hexa repo skill'],
    ['Codex-optimized', 'Hexa-optimized'],
    ['instructions for Codex', 'instructions for Hexa'],
    ['what Codex is allowed to do', 'what Hexa is allowed to do'],
    ['what Codex receives', 'what Hexa receives'],
    ['key Codex detects', 'key Hexa detects'],
    ['grant Codex', 'grant Hexa'],
    ['Codex to proceed', 'Hexa to proceed'],
    ['Codex to do differently', 'Hexa what to do differently'],
    ['Sent by Codex', 'Sent by Hexa'],
    ['from Codex', 'from Hexa'],
    ['to Codex', 'to Hexa'],
    ['while Codex', 'while Hexa Engine'],
    ['Start Codex', 'Start Hexa'],
    ['Run Codex', 'Run Hexa'],
    ['run Codex', 'run Hexa'],
    ['restart Codex', 'restart Hexa'],
    ['starting Codex', 'starting Hexa'],
    ['Exit Codex', 'Exit Hexa'],
    ['exit Codex', 'exit Hexa'],
    ['stay in Codex', 'stay in Hexa'],
    ['using Codex', 'using Hexa'],
    ['use Codex', 'use Hexa'],
    ['Update Codex', 'Update Hexa Engine through Hexa'],
    ['Welcome to Codex', 'Welcome to Hexa'],
    ['Build faster with Codex', 'Build faster with Hexa'],
    ['reload Codex', 'reload Hexa'],
    ['When Codex runs', 'When Hexa runs'],
    ['Right before Codex ends its turn', 'Right before Hexa ends its turn'],
    ['Choose how Codex uses and creates memories', 'Choose how Hexa uses and creates memories'],
    ['Choose how you\'d like Codex to proceed', 'Choose how you\'d like Hexa to proceed'],
    ['Choose a communication style for Codex', 'Choose a communication style for Hexa'],
    ['This removes the configured marketplace from Codex', 'This removes the configured marketplace from Hexa'],
    ['Add Codex files alongside your existing project files', 'Add Hexa files alongside your existing project files'],
    ['Codex timed out', 'Hexa Engine timed out'],
    ['Codex lost the IDE connection', 'Hexa Engine lost the IDE connection'],
    ['Codex received an unexpected IDE context response', 'Hexa Engine received an unexpected IDE context response'],
    ['started this login in Codex', 'started this login in Hexa'],
    ['how Codex performs specific tasks', 'how Hexa performs specific tasks'],
    ['communication style for Codex', 'communication style for Hexa'],
    ['log out of Codex', 'log out of Hexa'],
    ['Optimized for Codex', 'Optimized for Hexa'],
    ['tell Codex what to do differently', 'tell Hexa what to do differently'],
    ['Use Codex with non-admin sandbox', 'Use Hexa with non-admin sandbox'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('tui', 'src', 'onboarding', 'welcome.rs'), [
    ['"Codex".bold()', '"Hexa".bold()'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('tui', 'src', 'pets', 'catalog.rs'), [
    ['display_name: "Codex"', 'display_name: "Hexa"'],
    ['The original Codex companion', 'The Hexa companion'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('tui', 'src', 'pets', 'picker.rs'), [
    ['"Codex"', '"Hexa"'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('tui', 'src', 'ide_context', 'prompt.rs'), [
    ['## My request for Codex:', '## My request for Hexa:'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('protocol', 'src', 'protocol.rs'), [
    ['pub const USER_MESSAGE_BEGIN: &str = "## My request for Codex:";', 'pub const USER_MESSAGE_BEGIN: &str = "## My request for Hexa:";'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('protocol', 'src', 'models.rs'), [
    ['Codex could not read the local', 'Hexa Engine could not read the local'],
    ['Codex cannot attach image', 'Hexa Engine cannot attach image'],
    ['Codex cannot attach audio', 'Hexa Engine cannot attach audio'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('protocol', 'src', 'error.rs'), [
    ["Codex ran out of room in the model's context window.", "Hexa Engine ran out of room in the model's context window."],
    ['To use Codex with your ChatGPT plan', 'To use Hexa with your ChatGPT plan'],
    ['continue using Codex', 'continue using Hexa'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('utils', 'sleep-inhibitor', 'src', 'windows_inhibitor.rs'), [
    ['Codex is running an active turn', 'Hexa Engine is running an active turn'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('linux-sandbox', 'src', 'launcher.rs'), [
    ['next to the Codex executable', 'next to the Hexa Engine executable'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('exec', 'src', 'lib.rs'), [
    ['what Codex', 'what Hexa Engine'],
    ['Codex initialized with event:', 'Hexa Engine initialized with event:'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('exec', 'src', 'cli.rs'), [
    ['this version of Codex', 'this version of Hexa Engine'],
    ['running Codex outside a Git repository', 'running Hexa Engine outside a Git repository'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('exec', 'src', 'main.rs'), [
    ['non-interactive Codex agent', 'non-interactive Hexa Engine agent'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'session', 'handlers.rs'), [
    ['Shutting down Codex instance', 'Shutting down Hexa Engine instance'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'session_rollout_init_error.rs'), [
    ['Codex cannot access session files', 'Hexa Engine cannot access session files'],
    ['different Codex home', 'different Hexa Engine home'],
    ['so Codex can create sessions', 'so Hexa Engine can create sessions'],
    ['directory Codex can use', 'directory Hexa Engine can use'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'realtime_context.rs'), [
    ['Startup context from Codex.', 'Startup context from Hexa Engine.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'config', 'permissions.rs'), [
    ['this version of Codex', 'this version of Hexa Engine'],
    ['Upgrade Codex', 'Update Hexa Engine through Hexa'],
  ]);

  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'codex_delegate.rs'), [
    ['Codex delegates require', 'Hexa Engine delegates require'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'config', 'mod.rs'), [
    ['Codex would fall back', 'Hexa Engine would fall back'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'tasks', 'user_shell.rs'), [
    ['not native to the Codex host', 'not native to the Hexa Engine host'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'tasks', 'mod.rs'), [
    ['Codex will continue retrying', 'Hexa Engine will continue retrying'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'mcp_openai_file.rs'), [
    ['Codex Apps tools', 'Hexa connected-app tools'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('core', 'src', 'mcp_tool_call.rs'), [
    ['Codex Apps tools', 'Hexa connected-app tools'],
  ]);

  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, 'windows-sandbox-rs', [
    ['CodexSandbox', 'HexaSandbox'],
    ['Codex Sandbox', 'Hexa Sandbox'],
    ['Codex Windows sandbox filters', 'Hexa Windows sandbox filters'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('state', 'src', 'runtime', 'recovery.rs'), [
    ['Codex runtime database', 'Hexa runtime database'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('sandboxing', 'src', 'bwrap.rs'), [
    ['Codex could not find bubblewrap', 'Hexa could not find bubblewrap'],
    ['Codex will use the bundled bubblewrap', 'Hexa will use the bundled bubblewrap'],
    ["Codex's Linux sandbox", "Hexa's Linux sandbox"],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('memories', 'write', 'src'), [
    ['Codex rate limits', 'Hexa rate limits'],
    ['Codex memories', 'Hexa memories'],
    ['Generated by Codex before Phase 2', 'Generated by Hexa before Phase 2'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('feedback', 'src', 'lib.rs'), [
    ['Codex session', 'Hexa session'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('model-provider', 'src', 'amazon_bedrock'), [
    ['restart Codex', 'restart Hexa'],
    ['Codex-managed Amazon Bedrock', 'Hexa-managed Amazon Bedrock'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('thread-store', 'src', 'local', 'rollout_lineage.rs'), [
    ['"Codex home"', '"Hexa Engine home"'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('config', 'src', 'requirements_exec_policy.rs'), [
    ['Codex merges these rules', 'Hexa Engine merges these rules'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('config', 'src', 'loader', 'mod.rs'), [
    ['this is a Codex build error', 'this is a Hexa Engine build error'],
  ]);

  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('ollama', 'src', 'lib.rs'), [
    ['Codex requires Ollama', 'Hexa Engine requires Ollama'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('utils', 'sleep-inhibitor', 'src'), [
    ['Codex is running an active turn', 'Hexa Engine is running an active turn'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('connectors', 'src'), [
    ['Codex Apps', 'Hexa connected apps'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('utils', 'approval-presets', 'src'), [
    ['Codex can', 'Hexa can'],
    ['Codex will', 'Hexa will'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('app-server', 'src', 'request_processors', 'account_processor', 'bedrock_setup.rs'), [
    ['Codex-managed', 'Hexa-managed'],
    ['`codex logout`', '`hexa-engine logout`'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('exec-server', 'src'), [
    ['Codex executable', 'Hexa Engine executable'],
    ['Codex home', 'Hexa Engine home'],
    ['Codex runtime', 'Hexa Engine runtime'],
    ['Codex harness', 'Hexa harness'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('network-proxy', 'src', 'proxy.rs'), [
    ['Codex network sandbox proxy', 'Hexa network sandbox proxy'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('external-agent-migration', 'src', 'rewrite.rs'), [
    ['"Codex"', '"Hexa"'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('cli', 'src', 'state_db_recovery.rs'), [
    ["Codex couldn't start", "Hexa couldn't start"],
    ['so Codex can rebuild it', 'so Hexa can rebuild it'],
    ['Codex rebuilt its local database.', 'Hexa rebuilt its local database.'],
    ['Codex detected a damaged local database', 'Hexa detected a damaged local database'],
    ['another Codex process', 'another Hexa process'],
    ['copies of Codex', 'copies of Hexa'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('cli', 'src', 'sandbox_setup.rs'), [
    ['run Codex after managed deployment', 'run Hexa after managed deployment'],
    ['as the Codex user', 'as the Hexa user'],
    ['for the Codex user', 'for the Hexa user'],
    ["user's Codex config", "user's Hexa config"],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('cli', 'src', 'doctor'), [
    ['Codex Doctor', 'Hexa Doctor'],
    ['Codex exclusions', 'Hexa exclusions'],
    ['Codex application', 'Hexa application'],
    ['Codex app', 'Hexa app'],
    ['Codex CLI', 'Hexa Engine'],
    ['Codex agent', 'Hexa Engine agent'],
    ['Codex helpers', 'Hexa helpers'],
    ['Codex helper', 'Hexa helper'],
    ['Codex sandbox', 'Hexa sandbox'],
    ['running Codex', 'running Hexa'],
    ['for Codex', 'for Hexa'],
    ['repair the bundled Codex package', 'repair the bundled Hexa package'],
    ['Codex config', 'Hexa config'],
    ['Codex credentials', 'Hexa credentials'],
  ]);
  // Doctor must inspect the filenames Hexa actually stages, not upstream helper names.
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('cli', 'src', 'doctor'), [
    ['codex-windows-sandbox-setup.exe', 'HexaSandboxSetup.exe'],
    ['codex-command-runner.exe', 'HexaCommandRunner.exe'],
    ['codex-code-mode-host.exe', 'HexaCodeModeHost.exe'],
  ]);

  // Secondary user/model-facing branding. These paths are easy to miss because
  // many of the remaining upstream identifiers are lowercase strings rather
  // than Rust type/package names. Keep protocol/storage compatibility names,
  // but never let them leak into Hexa-facing help, prompts, auth UI, or labels.
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('app-server-daemon', 'src', 'client.rs'), [
    ['Codex App Server Daemon', 'Hexa App Server Daemon'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('cloud-tasks', 'src', 'cli.rs'), [
    ['Codex Cloud', 'Hexa cloud'],
    ['`codex cloud`', '`hexa-engine cloud`'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('cloud-tasks', 'src', 'lib.rs'), [
    ["'codex login'", "'hexa-engine login'"],
    ["'codex cloud'", "'hexa-engine cloud'"],
    ['`codex cloud`', '`hexa-engine cloud`'],
    ['codex cloud list --cursor=', 'hexa-engine cloud list --cursor='],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('models-manager', 'prompt.md'), [
    ['You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful.', 'You are Hexa Engine, the coding agent running inside Hexa. You are expected to be precise, safe, and helpful.'],
    ['Within this context, Codex refers to the open-source agentic coding interface (not the old Codex language model built by OpenAI).', 'Within this context, Hexa refers to the Hexa shell and Hexa Engine refers to the agent runtime.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('features', 'src', 'lib.rs'), [
    ['Keep your computer awake while Codex is running a thread.', 'Keep your computer awake while Hexa is running a thread.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('login', 'src', 'assets', 'error.html'), [
    ['Codex login', 'Hexa login'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('login', 'src', 'server.rs'), [
    ['Codex is not enabled for your workspace. Contact your workspace administrator to request access to Codex.', 'This workspace does not provide the upstream agent entitlement Hexa Engine requires. Contact your workspace administrator to request access.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('codex-mcp', 'src', 'connection_manager', 'startup.rs'), [
    ['Run `codex mcp login {server_name}`.', 'Run `hexa-engine mcp login {server_name}`.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('codex-mcp', 'src', 'auth_elicitation.rs'), [
    ['to use it in Codex.', 'to use it in Hexa.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('codex-mcp', 'src', 'rmcp_client.rs'), [
    ['.with_title("Codex")', '.with_title("Hexa")'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('codex-mcp', 'src', 'agent_plugin_config.rs'), [
    ['not supported by Codex', 'not supported by Hexa Engine'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('tui', 'src', 'history_cell', 'approvals.rs'), [
    [' codex to run ', ' Hexa to run '],
    [' codex network access to ', ' Hexa network access to '],
    [' for codex to run ', ' for Hexa to run '],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('tui', 'tooltips.txt'), [
    ['Codex asks for confirmation', 'Hexa asks for confirmation'],
    ['ask Codex to use one', 'ask Hexa to use one'],
    ['how Codex communicates', 'how Hexa communicates'],
    ['`codex mcp add openaiDeveloperDocs', '`hexa-engine mcp add openaiDeveloperDocs'],
    ['Visit the Codex community forum: https://community.openai.com/c/codex/37\n', ''],
    ['from Codex using `!`', 'from Hexa using `!`'],
    ['See the Codex keymap documentation for supported actions and examples.', 'See Hexa documentation for supported keymap actions and examples.'],
    ['`codex resume`', '`hexa-engine resume`'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('thread-manager-sample', 'src', 'main.rs'), [
    ['Run one Codex turn through ThreadManager', 'Run one Hexa Engine turn through ThreadManager'],
    ['start Codex thread', 'start Hexa Engine thread'],
    ['shut down Codex thread', 'shut down Hexa Engine thread'],
    ['find Codex home', 'find Hexa Engine home'],
    ['read Codex event', 'read Hexa Engine event'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('rollout-trace', 'src'), [
    ['Codex turn', 'Hexa Engine turn'],
    ['codex turn', 'Hexa Engine turn'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('skills', 'src', 'assets', 'samples', 'imagegen', 'SKILL.md'), [
    ['when Codex should create', 'when Hexa Engine should create'],
    ['Codex saves generated images', 'Hexa Engine saves generated images'],
  ]);

  brandingFilesChanged += await replaceFileLiterals(engineRoot, cliSource, [
    ['`printenv OPENAI_API_KEY | codex login --with-api-key`', '`printenv OPENAI_API_KEY | hexa-engine login --with-api-key`'],
    ['`printenv CODEX_ACCESS_TOKEN | codex login --with-access-token`', '`printenv CODEX_ACCESS_TOKEN | hexa-engine login --with-access-token`'],
    ['run `codex login` or set CODEX_API_KEY', 'run `hexa-engine login` or set CODEX_API_KEY'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('cli', 'src', 'login.rs'), [
    ['`codex login --device-auth`', '`hexa-engine login --device-auth`'],
    ['`printenv OPENAI_API_KEY | codex login --with-api-key`', '`printenv OPENAI_API_KEY | hexa-engine login --with-api-key`'],
    ['`printenv CODEX_ACCESS_TOKEN | codex login --with-access-token`', '`printenv CODEX_ACCESS_TOKEN | hexa-engine login --with-access-token`'],
    ['Direct `codex login`', 'Direct `hexa-engine login`'],
    ['`codex login` working', '`hexa-engine login` working'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('cli', 'src', 'doctor'), [
    ['Run codex login', 'Run hexa-engine login'],
    ['run codex login', 'run hexa-engine login'],
    ['Run `codex login`', 'Run `hexa-engine login`'],
    ['brew upgrade --cask codex', 'Hexa staged upstream updater'],
    ['npm install -g @openai/codex', 'Hexa staged upstream updater'],
    ['bun install -g @openai/codex', 'Hexa staged upstream updater'],
    ['pnpm add -g @openai/codex', 'Hexa staged upstream updater'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('chatgpt', 'src'), [
    ['re-run codex login', 're-run hexa-engine login'],
    ['re-run `codex login`', 're-run `hexa-engine login`'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('mcp-server', 'src', 'exec_approval.rs'), [
    ['Allow Codex to run', 'Allow Hexa to run'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('mcp-server', 'tests'), [
    ['Allow Codex to run', 'Allow Hexa to run'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('tui', 'src'), [
    ['codex to run', 'Hexa to run'],
    ['codex network access', 'Hexa network access'],
    ['run codex login', 'run hexa-engine login'],
    ['Run codex login', 'Run hexa-engine login'],
    ['Run `codex login`', 'Run `hexa-engine login`'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('tui', 'tests'), [
    ['OpenAI Codex', 'Hexa Engine'],
    ['codex to run', 'Hexa to run'],
    ['codex network access', 'Hexa network access'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('cli', 'src', 'doctor.rs'), [
    ['Run codex login again', 'Run hexa-engine login again'],
    ['Run codex login or', 'Run hexa-engine login or'],
    ['run codex login again', 'run hexa-engine login again'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('cli', 'src', 'login.rs'), [
    ['direct `codex login` flows', 'direct `hexa-engine login` flows'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('cli', 'tests'), [
    ['`codex cloud`', '`hexa-engine cloud`'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('mcp-server', 'src', 'patch_approval.rs'), [
    ['Allow Codex to apply proposed code changes?', 'Allow Hexa to apply proposed code changes?'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('mcp-server', 'tests'), [
    ['Allow Codex to apply proposed code changes?', 'Allow Hexa to apply proposed code changes?'],
    ['Codex App Server Daemon', 'Hexa App Server Daemon'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('features', 'src', 'lib.rs'), [
    ['Allow Codex Computer Use.', 'Allow Hexa Computer Use.'],
  ]);

  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('cli', 'src', 'mcp_cmd.rs'), [
    ['codex mcp ', 'hexa-engine mcp '],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('tui', 'src', 'app', 'thread_goal_actions.rs'), [
    ['codex resume', 'hexa-engine resume'],
  ]);

  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('exec-server', 'README.md'), [
    ['run `codex login` first', 'run `hexa-engine login` first'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('app-server', 'README.md'), [
    ['`codex login --with-access-token`', '`hexa-engine login --with-access-token`'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('default.nix'), [
    ['OpenAI Codex command‑line interface rust implementation', 'Hexa Engine Rust implementation'],
  ]);

  // Final interactive-command and fallback-prompt branding. Upstream command
  // names may remain as Cargo targets/build identifiers, but any command a user
  // is told to type must use the Hexa-staged executable name.
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('cli', 'src'), [
    ['`codex`', '`hexa-engine`'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('tui', 'src'), [
    ['`codex`', '`hexa-engine`'],
    ['Codex CLI', 'Hexa Engine'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('utils', 'cli', 'src'), [
    ['codex resume', 'hexa-engine resume'],
    ['Codex CLI', 'Hexa Engine'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('app-server', 'src'), [
    ['`codex unarchive', '`hexa-engine unarchive'],
    ['Run `codex unarchive', 'Run `hexa-engine unarchive'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('app-server', 'tests'), [
    ['Codex-managed', 'Hexa-managed'],
    ['`codex logout`', '`hexa-engine logout`'],
    ['Codex App Server Daemon', 'Hexa App Server Daemon'],
    ['`codex unarchive', '`hexa-engine unarchive'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('codex-mcp', 'src'), [
    ['Run `codex mcp login', 'Run `hexa-engine mcp login'],
  ]);

  for (const [relative, replacements] of [
    [path.join('protocol', 'src', 'prompts', 'base_instructions', 'default.md'), [
      ['You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful.', 'You are Hexa Engine, the coding agent running inside Hexa. You are expected to be precise, safe, and helpful.'],
    ]],
    [path.join('core', 'prompt_with_apply_patch_instructions.md'), [
      ['You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful.', 'You are Hexa Engine, the coding agent running inside Hexa. You are expected to be precise, safe, and helpful.'],
    ]],
    [path.join('core', 'gpt_5_1_prompt.md'), [
      ['You are GPT-5.1 running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful.', 'You are GPT-5.1 running as Hexa Engine inside Hexa. You are expected to be precise, safe, and helpful.'],
    ]],
    [path.join('core', 'gpt_5_2_prompt.md'), [
      ['You are GPT-5.2 running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful.', 'You are GPT-5.2 running as Hexa Engine inside Hexa. You are expected to be precise, safe, and helpful.'],
    ]],
    [path.join('README.md'), [
      ['# Codex CLI', '# Hexa Engine'],
      ['[**Codex CLI Documentation**]', '[**Upstream engine documentation reference**]'],
    ]],
    [path.join('protocol', 'README.md'), [
      ['Codex CLI', 'Hexa Engine'],
      ['`codex app-server`', '`hexa-engine app-server`'],
    ]],
    [path.join('linux-sandbox', 'README.md'), [
      ['Codex CLI', 'Hexa Engine'],
      ['`codex sandbox', '`hexa-engine sandbox'],
    ]],
    [path.join('responses-api-proxy', 'README.md'), [
      ['Codex CLI expectations', 'Hexa Engine expectations'],
    ]],
    [path.join('execpolicy', 'README.md'), [
      ['Codex CLI', 'Hexa Engine'],
      ['`codex execpolicy', '`hexa-engine execpolicy'],
    ]],
    [path.join('arg0', 'src', 'lib.rs'), [
      ['Codex CLI', 'Hexa Engine'],
    ]],
    [path.join('exec-server', 'testing', 'exec_server.rs'), [
      ['full Codex CLI binary', 'full Hexa Engine binary'],
    ]],
    [path.join('login', 'src', 'server.rs'), [
      ['Codex CLI Hydra redirect URI allow-list', 'upstream Hydra redirect URI allow-list'],
    ]],
    [path.join('model-provider-info', 'src', 'lib.rs'), [
      ['bundled with Codex CLI', 'bundled with Hexa Engine'],
    ]],
    [path.join('tui', 'src', 'version.rs'), [
      ['current Codex CLI version', 'current Hexa Engine version'],
    ]],
    [path.join('utils', 'cargo-bin', 'src', 'lib.rs'), [
      ['Codex CLI is a', 'Hexa Engine is a'],
    ]],
  ]) {
    brandingFilesChanged += await replaceFileLiterals(engineRoot, relative, replacements);
  }

  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('windows-sandbox-rs', 'sandbox_smoketests.py'), [
    ['via the Codex CLI', 'via Hexa Engine'],
    ['Resolve the Codex CLI to invoke `codex sandbox windows`.', 'Resolve the Hexa Engine/upstream CLI binary used to invoke `hexa-engine sandbox windows`.'],
    ['Returns the argv prefix to run Codex.', 'Returns the argv prefix used to run the Hexa Engine-compatible CLI.'],
    ['Codex CLI not found.', 'Hexa Engine-compatible CLI not found.'],
    ['# Map policy to codex CLI overrides.', '# Map policy to Hexa Engine CLI overrides.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('app-server-protocol', 'src', 'protocol', 'common.rs'), [
    ['Used by Codex Cloud.', 'Used by the upstream cloud-task service.'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('app-server-protocol', 'src', 'protocol', 'v2', 'thread.rs'), [
    ['(e.g. Codex Cloud).', '(e.g. the upstream cloud-task service).'],
  ]);

  // Keep tests, diagnostics comments, and developer-facing examples aligned
  // with the Hexa command surface. Deliberate external upstream URL/query
  // fixtures are left untouched and documented as compatibility references.
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('cli', 'tests'), [
    ['codex mcp ', 'hexa-engine mcp '],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('core', 'tests'), [
    ['Run `codex mcp login', 'Run `hexa-engine mcp login'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('app-server', 'tests'), [
    ['codex unarchive', 'hexa-engine unarchive'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('exec', 'src', 'cli.rs'), [
    ['"codex resume --last <prompt>"', '"hexa-engine resume --last <prompt>"'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('feedback', 'src', 'lib.rs'), [
    ['`codex doctor --json`', '`hexa-engine doctor --json`'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('app-server', 'src', 'request_processors', 'feedback_doctor_report.rs'), [
    ['`codex doctor --json --feedback`', '`hexa-engine doctor --json --feedback`'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('rmcp-client', 'src', 'bin', 'test_stdio_server.rs'), [
    ['`codex mcp add mcpimg', '`hexa-engine mcp add mcpimg'],
  ]);

  // Hexa must not consume OpenAI Codex product announcements or advertise the
  // upstream desktop app. The parser stays for compatibility/tests, but the
  // network prewarm is a no-op and all static promo copy is Hexa-owned.
  {
    const tooltipPath = path.join(engineRoot, 'tui', 'src', 'tooltips.rs');
    let tooltipText = await readFile(tooltipPath, 'utf8');
    const tooltipBefore = tooltipText;
    tooltipText = tooltipText.replace(
      'const ANNOUNCEMENT_TIP_URL: &str =\n    "https://raw.githubusercontent.com/openai/codex/main/announcement_tip.toml";',
      'const ANNOUNCEMENT_TIP_URL: &str = "about:blank";',
    );
    tooltipText = tooltipText.replace(
      'const APP_TOOLTIP: &str = "Try the **Desktop app**. Run \'codex app\' or visit https://chatgpt.com/codex?app-landing-page=true";',
      'const APP_TOOLTIP: &str = "Hexa Engine is managed by the Hexa desktop shell.";',
    );
    tooltipText = tooltipText.replace(
      '    "Run `codex app` to open the Desktop app (it installs on macOS if needed).";',
      '    "Hexa Engine is managed by the Hexa desktop shell.";',
    );
    tooltipText = tooltipText.replace(
      'const LINUX_APP_TOOLTIP: &str = "Try the **Desktop app** on Linux: install it from https://learn.chatgpt.com/docs/linux/linux-app and run \'chatgpt\'.";',
      'const LINUX_APP_TOOLTIP: &str = "Hexa Engine is managed by the Hexa desktop shell.";',
    );
    tooltipText = tooltipText.replace(
      'const OTHER_TOOLTIP: &str = "*New* Build faster with the **Desktop app**. Run \'codex app\' or visit https://chatgpt.com/codex?app-landing-page=true";',
      'const OTHER_TOOLTIP: &str = "*Tip* Hexa Engine is managed by the Hexa desktop shell.";',
    );
    tooltipText = tooltipText.replaceAll('Run `codex app` to open the Desktop app (it installs on macOS if needed).', 'Hexa Engine is managed by the Hexa desktop shell.');
    tooltipText = tooltipText.replaceAll("Try the **Desktop app**. Run 'hexa-engine app' or visit https://chatgpt.com/codex?app-landing-page=true", 'Hexa Engine is managed by the Hexa desktop shell.');
    tooltipText = tooltipText.replaceAll('Run `hexa-engine app` to open the Desktop app (it installs on macOS if needed).', 'Hexa Engine is managed by the Hexa desktop shell.');
    tooltipText = tooltipText.replaceAll("*New* Build faster with the **Desktop app**. Run 'hexa-engine app' or visit https://chatgpt.com/codex?app-landing-page=true", '*Tip* Hexa Engine is managed by the Hexa desktop shell.');
    tooltipText = tooltipText.replaceAll('Try the **Desktop app** on Linux: install it from https://learn.chatgpt.com/docs/linux/linux-app and run \'chatgpt\'.', 'Hexa Engine is managed by the Hexa desktop shell.');
    tooltipText = tooltipText.replace('Codex currently publishes CLI builds for macOS, Windows, and Linux.', 'Hexa supports macOS, Windows, and Linux engine targets.');
    if (tooltipText.includes('let announcement_tip = fetch_announcement_tip_text(http_client_factory).await;')) {
      tooltipText = replaceBetweenRequired(
        tooltipText,
        '    pub(crate) fn prewarm(http_client_factory: HttpClientFactory) {',
        '\n\n    /// Fetch the announcement tip',
        '    pub(crate) fn prewarm(_http_client_factory: HttpClientFactory) {\n        // Hexa deliberately does not consume upstream product announcement feeds.\n    }',
        'tui/src/tooltips.rs changed around upstream announcement prewarm',
      );
    }
    if (tooltipText !== tooltipBefore) {
      await writeFile(tooltipPath, tooltipText);
      brandingFilesChanged += 1;
    }
  }

  brandingFilesChanged += await replaceFileLiterals(engineRoot, cliSource, [
    ['Run Codex non-interactively.', 'Run Hexa Engine non-interactively.'],
    ["Codex's interactive TUI", "Hexa's interactive TUI"],
    ['not recognized by this version of Codex', 'not recognized by this version of Hexa Engine'],
    ['`codex agents`', '`hexa-engine agents`'],
    ['Launch the Desktop app (opens the app installer if missing).', 'Legacy upstream desktop launcher (disabled in Hexa).'],
    ['Manage external MCP servers for Codex.', 'Manage external MCP servers for Hexa Engine.'],
    ['Manage Codex plugins.', 'Manage Hexa Engine plugins.'],
    ['Start Codex as an MCP server (stdio).', 'Start Hexa Engine as an MCP server (stdio).'],
    ['Update Codex to the latest version.', 'Show Hexa Engine update guidance.'],
    ['Diagnose local Codex installation, config, auth, and runtime health.', 'Diagnose local Hexa Engine config, auth, and runtime health.'],
    ['Run commands within a Codex-provided sandbox.', 'Run commands within a Hexa-provided sandbox.'],
    ['Apply the latest diff produced by Codex agent', 'Apply the latest diff produced by Hexa Engine'],
    ['Browse tasks from Codex Cloud', 'Browse cloud tasks'],
    ['Generate internal JSON Schema artifacts for Codex tooling.', 'Generate internal JSON Schema artifacts for Hexa Engine tooling.'],
    ['Updating Codex via `{cmd_str}`...', 'Hexa Engine does not self-update through upstream package managers (`{cmd_str}`).'],
    ['Please restart Codex.', 'Please restart Hexa.'],
    ['`codex update` is not available in debug builds. Install a release build of Codex to use this command.', '`hexa-engine update` is managed by Hexa. Use the repository updater instead.'],
    ['Could not detect the Codex installation method. Please update manually: https://developers.openai.com/codex/cli/', 'Hexa Engine updates are managed by `npm run hexa:upstream -- <ref> --apply`.'],
    ['Codex executable path is not configured', 'Hexa Engine executable path is not configured'],
    ['damaged Codex local database', 'damaged Hexa Engine local database'],
  ]);

  // Hexa owns engine lifecycle updates. Remove the upstream desktop-app
  // launcher and package-manager self-updater from the compiled CLI surface;
  // updates must flow through Hexa's guarded staging adapter.
  {
    const cliPath = path.join(engineRoot, cliSource);
    let cliText = await readFile(cliPath, 'utf8');
    const before = cliText;

    cliText = cliText.replace('use codex_tui::UpdateAction;\n', '');
    cliText = cliText.replace(
      '#[cfg(any(target_os = "macos", target_os = "windows"))]\nmod app_cmd;\n',
      '',
    );
    cliText = cliText.replace(
      '    if let Some(action) = update_action {\n        run_update_action(action)?;\n    }',
      '    if update_action.is_some() {\n        eprintln!("Hexa Engine updates are installed through Hexa: `npm run hexa:upstream -- <ref> --apply`.");\n    }',
    );

    if (cliText.includes('    /// Legacy upstream desktop launcher (disabled in Hexa).')) {
      cliText = replaceBetweenRequired(
        cliText,
        '    /// Legacy upstream desktop launcher (disabled in Hexa).',
        '    /// Generate shell completion scripts.',
        '',
        `${cliSource} changed around the legacy desktop-app subcommand`,
      );
    }
    if (cliText.includes('        Some(Subcommand::App(app_cli)) => {')) {
      cliText = replaceBetweenRequired(
        cliText,
        '        #[cfg(any(target_os = "macos", target_os = "windows"))]\n        Some(Subcommand::App(app_cli)) => {',
        '        Some(Subcommand::Resume(',
        '',
        `${cliSource} changed around the legacy desktop-app dispatch`,
      );
    }
    if (cliText.includes('/// Run the update action and print the result.\nfn run_update_action(')) {
      cliText = replaceBetweenRequired(
        cliText,
        '/// Run the update action and print the result.\nfn run_update_action(',
        '\nfn run_update_command() -> anyhow::Result<()> {',
        '',
        `${cliSource} changed around the upstream self-updater`,
      );
    }
    cliText = replaceBetweenRequired(
      cliText,
      'fn run_update_command() -> anyhow::Result<()> {',
      '\nfn run_execpolicycheck',
      'fn run_update_command() -> anyhow::Result<()> {\n    anyhow::bail!("Hexa Engine updates are managed by Hexa. Use `npm run hexa:upstream -- <ref> --apply`.")\n}\n',
      `${cliSource} changed around run_update_command`,
    );

    if (cliText.includes('fn windows_update_command_resolution_ignores_relative_path_entries()')) {
      cliText = replaceBetweenRequired(
        cliText,
        '    #[cfg(windows)]\n    #[test]\n    fn windows_update_command_resolution_ignores_relative_path_entries() {',
        '    #[tokio::test]\n    async fn updater_http_client_factory_honors_respect_system_proxy()',
        '',
        `${cliSource} changed around the removed upstream updater resolution test`,
      );
    }

    if (cliText.includes('app_cmd::') || cliText.includes('mod app_cmd;')) {
      throw new Error(`${cliSource} still contains the upstream desktop-app launcher after Hexa branding patches`);
    }
    if (cliText.includes('run_update_action(') || cliText.includes('fn resolve_windows_update_command_from_path')) {
      throw new Error(`${cliSource} still contains the upstream package-manager self-updater after Hexa patches`);
    }

    if (cliText !== before) {
      await writeFile(cliPath, cliText);
      brandingFilesChanged += 1;
    }
  }

  // The upstream standalone daemon contains a second, independent self-update
  // system that periodically downloads and executes chatgpt.com/codex/install.sh.
  // Hexa has one update authority: stage an upstream commit/version, apply this
  // adapter, validate, then atomically install the staged engine. Strip that
  // network updater from every staged snapshot so it cannot compete with Hexa.
  {
    const cliPath = path.join(engineRoot, cliSource);
    let text = await readFile(cliPath, 'utf8');
    const before = text;
    text = text.replace(
      `\n    /// [internal] Run the detached pid-backed standalone updater loop.\n    #[clap(hide = true)]\n    PidUpdateLoop,`,
      '',
    );
    if (text.includes('                    AppServerDaemonSubcommand::PidUpdateLoop => {')) {
      text = replaceBetweenRequired(
        text,
        '                    AppServerDaemonSubcommand::PidUpdateLoop => {',
        '                },\n                Some(AppServerSubcommand::Proxy(proxy_cli)) => {',
        '',
        `${cliSource} changed around the daemon updater dispatch`,
      );
    }
    text = text.replace(
      '            AppServerDaemonSubcommand::PidUpdateLoop => "app-server daemon pid-update-loop",\n',
      '',
    );
    if (text.includes('fn updater_http_client_factory(')) {
      text = replaceBetweenRequired(
        text,
        'fn updater_http_client_factory(',
        '\nasync fn print_app_server_remote_control_output(',
        '',
        `${cliSource} changed around daemon updater HTTP configuration`,
      );
    }
    if (text.includes('    #[tokio::test]\n    async fn updater_http_client_factory_honors_respect_system_proxy()')) {
      text = replaceBetweenRequired(
        text,
        '    #[tokio::test]\n    async fn updater_http_client_factory_honors_respect_system_proxy()',
        '    #[test]\n    fn exec_server_remote_auth_accepts_api_key_auth()',
        '',
        `${cliSource} changed around daemon updater tests`,
      );
    }
    if (text.includes('PidUpdateLoop') || text.includes('updater_http_client_factory(')) {
      throw new Error(`${cliSource} still exposes the upstream daemon self-updater after Hexa patches`);
    }
    if (text !== before) {
      await writeFile(cliPath, text);
      brandingFilesChanged += 1;
    }
  }

  {
    const daemonSource = path.join('app-server-daemon', 'src', 'lib.rs');
    const daemonPath = path.join(engineRoot, daemonSource);
    let text = await readFile(daemonPath, 'utf8');
    const before = text;
    text = text.replace('mod update_loop;\n', '');
    text = text.replace('const UPDATE_PID_FILE_NAME: &str = "app-server-updater.pid";\n', '');
    if (text.includes('pub(crate) enum RestartIfRunningOutcome')) {
      text = replaceBetweenRequired(
        text,
        '#[cfg(unix)]\n#[derive(Debug, Clone, Copy, PartialEq, Eq)]\npub(crate) enum RestartIfRunningOutcome',
        'pub async fn run(command: LifecycleCommand)',
        '',
        `${daemonSource} changed around updater-only restart types`,
      );
    }
    if (text.includes('pub async fn run_pid_update_loop(')) {
      text = replaceBetweenRequired(
        text,
        'pub async fn run_pid_update_loop(',
        '\n#[cfg(unix)]\nfn ensure_supported_platform()',
        '',
        `${daemonSource} changed around run_pid_update_loop`,
      );
    }
    text = text.replace('    update_pid_file: PathBuf,\n', '');
    text = text.replace('            update_pid_file: state_dir.join(UPDATE_PID_FILE_NAME),\n', '');
    if (text.includes('    pub(crate) async fn try_restart_if_running(')) {
      text = replaceBetweenRequired(
        text,
        '    #[cfg(unix)]\n    pub(crate) async fn try_restart_if_running(',
        '    async fn stop(&self) -> Result<LifecycleOutput> {',
        '',
        `${daemonSource} changed around updater-driven daemon restart`,
      );
    }
    text = text.replace(
      `        let updater = backend::pid_update_loop_backend(self.backend_paths(&settings));\n        if updater.is_starting_or_running().await? {\n            updater.stop().await?;\n        }\n        updater.start().await?;\n\n`,
      '',
    );
    text = text.replace('            auto_update_enabled: true,', '            auto_update_enabled: false,');
    if (text.includes('    async fn is_bootstrapped(&self, settings: &DaemonSettings) -> Result<bool> {')) {
      text = replaceBetweenRequired(
        text,
        '    async fn is_bootstrapped(&self, settings: &DaemonSettings) -> Result<bool> {',
        '\n    fn ensure_managed_codex_bin(&self) -> Result<()> {',
        `    async fn is_bootstrapped(&self, _settings: &DaemonSettings) -> Result<bool> {\n        Ok(self.managed_codex_bin.is_file())\n    }\n`,
        `${daemonSource} changed around daemon bootstrap detection`,
      );
    }
    text = text.replace('            update_pid_file: self.update_pid_file.clone(),\n', '');
    if (text.includes('#[cfg(unix)]\nfn restart_decision(')) {
      text = replaceBetweenRequired(
        text,
        '#[cfg(unix)]\nfn restart_decision(',
        '#[cfg(unix)]\nfn try_lock_file(',
        '',
        `${daemonSource} changed around updater-only restart decisions`,
      );
    }
    text = text.replace('    use super::RestartDecision;\n', '');
    text = text.replace('    use super::RestartIfRunningOutcome;\n', '');
    text = text.replace('    use super::RestartMode;\n', '');
    text = text.replace('    use super::UpdaterRefreshMode;\n', '');
    text = text.replace('    use super::restart_decision;\n', '');
    text = text.replace('    use super::should_reexec_updater;\n', '');
    text = text.replace('    use crate::client::ProbeInfo;\n', '');
    if (text.includes('    #[test]\n    fn updater_reexec_waits_for_validated_restart()')) {
      text = replaceBetweenRequired(
        text,
        '    #[test]\n    fn updater_reexec_waits_for_validated_restart()',
        '    #[test]\n    fn remote_control_start_output_serializes_inner_output_without_tag()',
        '',
        `${daemonSource} changed around daemon updater tests`,
      );
    }
    text = text.replace('            auto_update_enabled: true,', '            auto_update_enabled: false,');
    text = text.replace('                "autoUpdateEnabled": true,', '                "autoUpdateEnabled": false,');
    if (text.includes('        let managed_codex_path = self.managed_codex_bin.display();')) {
      text = replaceBetweenRequired(
        text,
        '        let managed_codex_path = self.managed_codex_bin.display();',
        `
    #[cfg(unix)]
    async fn managed_codex_version_best_effort(&self) -> Option<String> {`,
        String.raw`        let managed_engine_path = self.managed_codex_bin.display();
        Err(anyhow!(
            "managed Hexa-compatible engine install not found at {managed_engine_path}\n\n\
             This experimental daemon command requires a compatible managed engine at that fixed path. \
             Hexa desktop does not use the upstream standalone installer or a daemon self-updater.\n\n\
             Provision the managed engine through your Hexa deployment workflow, then rerun this command."
        ))
    }
`,
        `${daemonSource} changed around managed-engine guidance`,
      );
    }
    text = text.replaceAll('app server is running but is not managed by codex app-server daemon', 'app server is running but is not managed by Hexa app-server daemon');
    text = text.replace('"codex app-server daemon lifecycle is only supported on Unix platforms"', '"Hexa app-server daemon lifecycle is only supported on Unix platforms"');
    if (text.includes('update_loop::') || text.includes('pid_update_loop_backend') || text.includes('run_pid_update_loop')) {
      throw new Error(`${daemonSource} still invokes the upstream standalone updater after Hexa patches`);
    }
    if (text !== before) {
      await writeFile(daemonPath, text);
      brandingFilesChanged += 1;
    }

    const backendSource = path.join('app-server-daemon', 'src', 'backend', 'mod.rs');
    const backendPath = path.join(engineRoot, backendSource);
    let backendText = await readFile(backendPath, 'utf8');
    const backendBefore = backendText;
    backendText = backendText.replace('    pub(crate) update_pid_file: PathBuf,\n', '');
    backendText = backendText.replace(/\npub\(crate\) fn pid_update_loop_backend\([\s\S]*?\n}\n/, '\n');
    if (backendText !== backendBefore) {
      await writeFile(backendPath, backendText);
      brandingFilesChanged += 1;
    }

    const pidSource = path.join('app-server-daemon', 'src', 'backend', 'pid.rs');
    const pidPath = path.join(engineRoot, pidSource);
    let pidText = await readFile(pidPath, 'utf8');
    const pidBefore = pidText;
    pidText = pidText.replace('    UpdateLoop,\n', '');
    pidText = pidText.replace(/\n    pub\(crate\) fn new_update_loop\([\s\S]*?\n    }\n/, '\n');
    pidText = pidText.replace('            PidCommandKind::UpdateLoop => vec!["app-server", "daemon", "pid-update-loop"],\n', '');
    pidText = pidText.replace('            }\n            | PidCommandKind::UpdateLoop => None,', '            } => None,');
    pidText = pidText.replace('            PidCommandKind::UpdateLoop => terminate_process(pid),\n', '');
    pidText = pidText.replace('            PidCommandKind::UpdateLoop => force_terminate_process_group(pid),\n', '');
    if (pidText.includes('PidCommandKind::UpdateLoop') || pidText.includes('pid-update-loop')) {
      throw new Error(`${pidSource} still contains the upstream updater process mode after Hexa patches`);
    }
    if (pidText !== pidBefore) {
      await writeFile(pidPath, pidText);
      brandingFilesChanged += 1;
    }

    const daemonManifest = path.join(engineRoot, 'app-server-daemon', 'Cargo.toml');
    let manifestText = await readFile(daemonManifest, 'utf8');
    const manifestBefore = manifestText;
    manifestText = manifestText.replace('codex-http-client = { workspace = true }\n', '');
    manifestText = manifestText.replace('    "signal",\n', '');
    if (manifestText !== manifestBefore) {
      await writeFile(daemonManifest, manifestText);
      brandingFilesChanged += 1;
    }

    await rm(path.join(engineRoot, 'app-server-daemon', 'src', 'update_loop.rs'), { force: true });
    await rm(path.join(engineRoot, 'app-server-daemon', 'src', 'update_loop_tests.rs'), { force: true });

    const daemonReadmePath = path.join(engineRoot, 'app-server-daemon', 'README.md');
    const daemonReadme = `# Hexa app-server daemon

This crate is retained from the upstream engine for Unix app-server lifecycle and remote-control compatibility. Hexa deliberately disables the upstream standalone self-updater.

## Update authority

Hexa has one engine update path: an upstream commit or saved engine version is copied into a staging directory, \`shell/scripts/engine-patches.mjs\` is applied, structural checks run, and only then is the staged tree installed. The daemon does not download or execute the upstream standalone installer, does not run a pid update loop, and reports \`autoUpdateEnabled: false\`.

The remaining upstream backend/wire identifiers are compatibility contracts, not Hexa local process or storage identities. Hexa does not share the official Codex home, project-config, keyring, resource, or app-server namespaces; see \`UPSTREAM_COMPATIBILITY.md\` at the repository root.
`;
    const oldDaemonReadme = await readFile(daemonReadmePath, 'utf8');
    if (oldDaemonReadme !== daemonReadme) {
      await writeFile(daemonReadmePath, daemonReadme);
      brandingFilesChanged += 1;
    }
  }

  // Rebrand command-shaped user guidance without touching broad protocol/error
  // strings. These replacements contain an actual subcommand and therefore do
  // not rewrite Rust identifiers or backend compatibility tokens.
  const commandBranding = [
    ['codex doctor', 'hexa-engine doctor'],
    ['codex resume', 'hexa-engine resume'],
    ['codex fork', 'hexa-engine fork'],
    ['codex archive', 'hexa-engine archive'],
    ['codex delete', 'hexa-engine delete'],
    ['codex unarchive', 'hexa-engine unarchive'],
    ['codex agents', 'hexa-engine agents'],
    ['codex queue', 'hexa-engine queue'],
    ['codex mcp', 'hexa-engine mcp'],
    ['codex execpolicy', 'hexa-execpolicy'],
    ['codex sandbox', 'hexa-engine sandbox'],
    ['codex remote-control', 'hexa-engine remote-control'],
    ['codex exec-server', 'hexa-engine exec-server'],
  ];
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('cli', 'src'), commandBranding);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('tui', 'src'), commandBranding);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('utils', 'cli', 'src'), commandBranding);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('execpolicy'), [
    ['codex execpolicy', 'hexa-execpolicy'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('app-server-test-client'), [
    ['codex app-server', 'hexa-app-server'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('app-server', 'README.md'), [
    ['`codex app-server`', '`hexa-app-server`'],
    ['codex app-server generate-ts', 'hexa-app-server generate-ts'],
    ['codex app-server generate-json-schema', 'hexa-app-server generate-json-schema'],
    ['codex app-server proxy', 'hexa-app-server proxy'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('mcp-server', 'src', 'message_processor.rs'), [
    ['.with_title("Codex")', '.with_title("Hexa")'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('mcp-server', 'src', 'codex_tool_config.rs'), [
    ['.with_title("Codex")', '.with_title("Hexa")'],
  ]);

  // Runtime isolation must be reapplied to every imported upstream snapshot.
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('login', 'src', 'auth', 'storage.rs'), [
    ['const KEYRING_SERVICE: &str = "Codex Auth";', 'const KEYRING_SERVICE: &str = "Hexa Auth";'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('rmcp-client', 'src', 'oauth.rs'), [
    ['const KEYRING_SERVICE: &str = "Codex MCP Credentials";', 'const KEYRING_SERVICE: &str = "Hexa MCP Credentials";'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('app-server', 'src', 'lib.rs'), [
    ['const OTEL_SERVICE_NAME: &str = "codex-app-server";', 'const OTEL_SERVICE_NAME: &str = "hexa-app-server";'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('secrets', 'src', 'lib.rs'), [
    ['const KEYRING_SERVICE: &str = "codex";', 'const KEYRING_SERVICE: &str = "hexa";'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('utils', 'sleep-inhibitor', 'src', 'linux_inhibitor.rs'), [
    ['const APP_ID: &str = "codex";', 'const APP_ID: &str = "hexa";'],
  ]);

  // Keep repository-local config separate from real Codex. Variable/struct
  // names such as dot_codex_folder are retained as source-compatibility details;
  // only the filesystem namespace changes from .codex to .hexa.
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('config', 'src'), [
    ['".codex"', '".hexa"'],
    ['/.codex/', '/.hexa/'],
    ['/.codex"', '/.hexa"'],
    ['program_data.join("OpenAI").join("Codex")', 'program_data.join("Hexa").join("Engine")'],
    ['Path::new("OpenAI").join("Codex")', 'Path::new("Hexa").join("Engine")'],
    ['%ProgramData%\\OpenAI\\Codex', '%ProgramData%\\Hexa\\Engine'],
    ['com.openai.codex', 'com.hexa.engine'],
  ]);
  brandingFilesChanged += await replaceTextTreeLiterals(engineRoot, path.join('core', 'src', 'config'), [
    ['".codex"', '".hexa"'],
    ['/.codex/', '/.hexa/'],
    ['/.codex"', '/.hexa"'],
    ['com.openai.codex', 'com.hexa.engine'],
  ]);
  // Cargo dependency keys are rebranded to `hexa-*`; Rust 2018 uses those
  // keys as crate identifiers, so keep aliases in refreshed upstream sources
  // in sync (the underlying lib name remains upstream-compatible).
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('rollout', 'src', 'list.rs'), [
    ['use codex_file_search as file_search;', 'use hexa_file_search as file_search;'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('app-server', 'src'), [['codex_file_search', 'hexa_file_search']]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('tui', 'src'), [['codex_file_search', 'hexa_file_search']]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('cloud-tasks', 'src'), [['codex_tui', 'hexa_tui']]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('cli', 'src'), [
    ['codex_exec', 'hexa_exec'], ['codex_responses_api_proxy', 'hexa_responses_api_proxy'],
    ['codex_tui', 'hexa_tui'], ['codex_install_context::CodexPackageLayout', 'codex_install_context::HexaPackageLayout'],
    ['CodexPackageLayout', 'HexaPackageLayout'], ['codex_mcp_server', 'hexa_mcp_server'], ['codex_stdio_to_uds', 'hexa_stdio_to_uds'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('cli', 'src', 'main.rs'), [['        #[cfg(any(target_os = "macos", target_os = "windows"))]\n        Some(Subcommand::App(_)) => Some("app"),\n', '']]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('exec-server', 'src'), [
    ['codex_exec_server_protocol', 'hexa_exec_server_protocol'],
  ]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('utils', 'plugins', 'src'), [['codex_exec_server', 'hexa_exec_server']]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('apply-patch', 'src'), [['codex_exec_server', 'hexa_exec_server']]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('rmcp-client', 'src'), [['codex_exec_server', 'hexa_exec_server']]);
  brandingFilesChanged += await replaceRustTreeLiterals(engineRoot, path.join('arg0', 'src'), [['codex_linux_sandbox', 'hexa_linux_sandbox']]);

  // Repair the two historical variables that an older broad branding pass could
  // turn into the invalid token `hexa-engine`. Keep them neutral identifiers.
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('tui', 'src', 'status', 'rate_limits.rs'), [
    ['let codex = RateLimitSnapshotDisplay {', 'let primary = RateLimitSnapshotDisplay {'],
    ['let hexa-engine = RateLimitSnapshotDisplay {', 'let primary = RateLimitSnapshotDisplay {'],
    ['compose_rate_limit_data_many(&[codex, other], now)', 'compose_rate_limit_data_many(&[primary, other], now)'],
  ]);
  brandingFilesChanged += await replaceFileLiterals(engineRoot, path.join('tui', 'src', 'chatwidget', 'tests', 'status_and_layout.rs'), [
    ['let codex = chat', 'let primary = chat'],
    ['let hexa-engine = chat', 'let primary = chat'],
    ['codex.primary', 'primary.primary'],
    ['codex.credits', 'primary.credits'],
  ]);

  let bazelFilesChanged = 0;
  for (const file of await walk(engineRoot)) {
    if (path.basename(file) !== 'BUILD.bazel' && path.extname(file) !== '.bzl') continue;
    const text = await readFile(file, 'utf8');
    const next = text.replaceAll('//codex-rs', '//engine');
    if (next !== text) {
      await writeFile(file, next);
      bazelFilesChanged += 1;
    }
  }
  // Fail closed before an upstream stage can be installed. Literal branding
  // replacements intentionally tolerate text disappearing upstream, so verify
  // the critical Hexa runtime contract explicitly here.
  const finalCli = await readFile(path.join(engineRoot, cliSource), 'utf8');
  const finalInstallContext = await readFile(path.join(engineRoot, 'install-context', 'src', 'lib.rs'), 'utf8');
  const finalExecOutput = await readFile(path.join(engineRoot, 'exec', 'src', 'event_processor_with_human_output.rs'), 'utf8');
  const finalClient = await readFile(path.join(engineRoot, localProviderSource), 'utf8');
  const finalSandboxHelpers = await readFile(path.join(engineRoot, 'windows-sandbox-rs', 'src', 'helper_materialization.rs'), 'utf8');
  const finalModelPrompt = await readFile(path.join(engineRoot, 'core', 'gpt_5_codex_prompt.md'), 'utf8');
  const finalProtocol = await readFile(path.join(engineRoot, 'protocol', 'src', 'protocol.rs'), 'utf8');
  const finalDaemon = await readFile(path.join(engineRoot, 'app-server-daemon', 'src', 'lib.rs'), 'utf8');
  const finalDaemonClient = await readFile(path.join(engineRoot, 'app-server-daemon', 'src', 'client.rs'), 'utf8');
  const finalModelsManagerPrompt = await readFile(path.join(engineRoot, 'models-manager', 'prompt.md'), 'utf8');
  const finalTooltips = await readFile(path.join(engineRoot, 'tui', 'src', 'tooltips.rs'), 'utf8');
  const finalTooltipText = await readFile(path.join(engineRoot, 'tui', 'tooltips.txt'), 'utf8');
  const finalCloudCli = await readFile(path.join(engineRoot, 'cloud-tasks', 'src', 'cli.rs'), 'utf8');
  const finalCloudLib = await readFile(path.join(engineRoot, 'cloud-tasks', 'src', 'lib.rs'), 'utf8');
  const finalLoginError = await readFile(path.join(engineRoot, 'login', 'src', 'assets', 'error.html'), 'utf8');
  const finalMcpExecApproval = await readFile(path.join(engineRoot, 'mcp-server', 'src', 'exec_approval.rs'), 'utf8');
  const finalMcpPatchApproval = await readFile(path.join(engineRoot, 'mcp-server', 'src', 'patch_approval.rs'), 'utf8');
  const finalCliLogin = await readFile(path.join(engineRoot, 'cli', 'src', 'login.rs'), 'utf8');
  const finalStatusCard = await readFile(path.join(engineRoot, 'tui', 'src', 'status', 'card.rs'), 'utf8');
  const finalBaseInstructions = await readFile(path.join(engineRoot, 'protocol', 'src', 'prompts', 'base_instructions', 'default.md'), 'utf8');
  const finalGpt51Prompt = await readFile(path.join(engineRoot, 'core', 'gpt_5_1_prompt.md'), 'utf8');
  const finalGpt52Prompt = await readFile(path.join(engineRoot, 'core', 'gpt_5_2_prompt.md'), 'utf8');
  const finalResumeHints = await readFile(path.join(engineRoot, 'utils', 'cli', 'src', 'resume_command.rs'), 'utf8');
  const finalMcpCmd = await readFile(path.join(engineRoot, 'cli', 'src', 'mcp_cmd.rs'), 'utf8');
  const finalThreadActions = await readFile(path.join(engineRoot, 'tui', 'src', 'app', 'thread_goal_actions.rs'), 'utf8');
  const violations = [];
  if (!finalCli.includes('name = "HexaEngine"') || !finalCli.includes('bin_name = "hexa-engine"')) violations.push('CLI identity');
  if (finalCli.includes('mod app_cmd;') || finalCli.includes('app_cmd::') || finalCli.includes('run_update_action(') || finalCli.includes('fn resolve_windows_update_command_from_path') || finalCli.includes('PidUpdateLoop') || finalCli.includes('updater_http_client_factory(')) violations.push('upstream CLI self-update/app launcher removal');
  if (!finalCli.includes('Hexa Engine updates are managed by Hexa. Use `npm run hexa:upstream -- <ref> --apply`.')) violations.push('Hexa update guidance');
  if (!finalInstallContext.includes('HexaCodeModeHost.exe') || !finalInstallContext.includes('hexa-code-mode-host')) violations.push('Code Mode helper identity');
  if (!finalSandboxHelpers.includes('HexaCommandRunner.exe') || !finalSandboxHelpers.includes('HexaSandboxSetup.exe')) violations.push('Windows helper identity');
  if (!finalExecOutput.includes('Hexa Engine v{VERSION}') || finalExecOutput.includes('OpenAI Codex v{VERSION}')) violations.push('execution banner');
  if (!finalClient.includes('fold_developer_messages_into_instructions') || !finalClient.includes('use_responses_lite_for_provider')) violations.push('local-provider compatibility');
  if (!finalModelPrompt.startsWith('You are Hexa Engine')) violations.push('model-facing identity');
  if (!finalProtocol.includes('pub const USER_MESSAGE_BEGIN: &str = "## My request for Hexa:";')) violations.push('model request marker');
  if (finalDaemon.includes('update_loop::') || finalDaemon.includes('pid_update_loop_backend') || finalDaemon.includes('run_pid_update_loop') || finalDaemon.includes('auto_update_enabled: true')) violations.push('daemon self-updater removal');
  if (!finalDaemonClient.includes('Hexa App Server Daemon') || finalDaemonClient.includes('title: Some("Codex App Server Daemon"')) violations.push('daemon client branding');
  if (!finalModelsManagerPrompt.startsWith('You are Hexa Engine') || finalModelsManagerPrompt.includes('running in the Codex CLI')) violations.push('models-manager identity');
  if (finalTooltips.includes('raw.githubusercontent.com/openai/codex') || finalTooltips.includes("Run 'codex app'") || finalTooltips.includes('chatgpt.com/codex?app-landing-page')) violations.push('upstream TUI product promotion');
  if (finalTooltipText.includes('ask Codex') || finalTooltipText.includes('codex resume') || finalTooltipText.includes('Codex community forum')) violations.push('TUI tooltip branding');
  if (finalCloudCli.includes('Codex Cloud') || finalCloudLib.includes("'codex login'") || finalCloudLib.includes('`codex cloud`')) violations.push('cloud CLI branding');
  if (!finalLoginError.includes('Hexa login') || finalLoginError.includes('Codex login')) violations.push('login page branding');
  if (finalMcpExecApproval.includes('Allow Codex') || finalMcpPatchApproval.includes('Allow Codex')) violations.push('MCP approval branding');
  if (finalCli.includes('printenv OPENAI_API_KEY | codex login') || finalCliLogin.includes('codex login --device-auth') || finalStatusCard.includes('run codex login')) violations.push('login command branding');
  if (!finalBaseInstructions.startsWith('You are Hexa Engine') || finalGpt51Prompt.includes('Codex CLI') || finalGpt52Prompt.includes('Codex CLI')) violations.push('fallback model prompt branding');
  if (finalResumeHints.includes('codex resume') || finalThreadActions.includes('`codex`') || finalThreadActions.includes('codex resume')) violations.push('resume/session command branding');
  if (finalMcpCmd.includes('codex mcp login') || finalMcpCmd.includes('codex mcp add') || finalMcpCmd.includes('codex mcp remove')) violations.push('MCP CLI command branding');
  if (violations.length) throw new Error(`Hexa engine stage failed post-patch validation: ${violations.join(', ')}`);

  const cargoRebrand = await applyHexaCargoPackageRebrand(engineRoot);
  await validateHexaPackageLayer(engineRoot);

  return {
    bazelFilesChanged,
    brandingFilesChanged,
    cliIdentity: true,
    localProviderCompatibility: true,
    resumeCompatibility: true,
    ...cargoRebrand,
    ...runtimeIsolation,
  };
}
