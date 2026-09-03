import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, session, shell } from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions, OpenDialogOptions } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { BinaryManager } from './engine/BinaryManager.js';
import { AppServerClient, type AppServerExitEvent } from './engine/AppServerClient.js';
import { UpdateManager } from './update/UpdateManager.js';
import type { AppPreferences, HexaEngineStatus, ServerEvent, ServerRequest, ShellUpdateState } from '../shared/types.js';

let mainWindow: BrowserWindow | null = null;
let authWindow: BrowserWindow | null = null;
let aboutWindow: BrowserWindow | null = null;
let status: HexaEngineStatus = { phase: 'idle', message: 'Waiting to start Hexa Engine' };
let startupPromise: Promise<void> | null = null;
let startupFailure: Error | null = null;
let reconnecting = false;
let quitting = false;
let activeAppMenuId = 0;

type AppMenuName = 'file' | 'edit' | 'view' | 'help';

function sendMenuAction(action: string) {
  mainWindow?.webContents.send('shell:app-menu-action', action);
}

async function openAboutWindow() {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }
  const dark = nativeTheme.shouldUseDarkColors;
  const iconData = await readFile(path.join(app.getAppPath(), 'resources', 'branding', dark ? 'hexa-dark.png' : 'hexa-light.png')).catch(() => null);
  const icon = iconData ? `data:image/png;base64,${iconData.toString('base64')}` : '';
  const palette = dark
    ? { bg: '#181b19', text: '#e7eae8', muted: '#a7ada9', panel: '#191c1a', border: '#303632', button: '#262b28', hover: '#303632', link: '#8fc4ed' }
    : { bg: '#f6f8f6', text: '#1f2822', muted: '#647069', panel: '#ffffff', border: '#cbd3cd', button: '#e8ece8', hover: '#dce3dd', link: '#176da2' };
  const initialUpdateState = JSON.stringify(updateManager.getState()).replace(/</g, '\\u003c');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>About Hexa</title><style>
    :root{color-scheme:${dark ? 'dark' : 'light'};font-family:Inter,Segoe UI,sans-serif;background:${palette.bg};color:${palette.text}}*{box-sizing:border-box}html,body{height:100%;overflow:hidden}body{margin:0;display:grid;grid-template-rows:minmax(0,1fr) auto;background:${palette.bg}}main{min-height:0;overflow:auto;scrollbar-width:none;-ms-overflow-style:none;padding:25px 34px 19px;text-align:center}main::-webkit-scrollbar{display:none}img{width:58px;height:58px;object-fit:contain;filter:drop-shadow(0 6px 14px #0005)}h1{margin:10px 0 5px;font-size:23px}p{margin:0;color:${palette.muted};font-size:13px;line-height:1.5}.meta{margin:15px 0 12px;padding:10px 14px;border:1px solid ${palette.border};border-radius:10px;background:${palette.panel};text-align:left}.meta div{display:flex;justify-content:space-between;padding:4px 0;font-size:12px}.meta span{color:${palette.muted}}.update{margin:0 0 13px;padding:10px 12px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;border:1px solid ${palette.border};border-radius:10px;background:${palette.panel};text-align:left}.update-copy{min-width:0}.update-status{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:650}.update-status::before{content:'';width:8px;height:8px;border-radius:50%;background:#8c938e}.update-status.up-to-date::before{background:#57b879;box-shadow:0 0 0 3px #57b87922}.update-status.available::before,.update-status.downloaded::before{background:#68a7e0;box-shadow:0 0 0 3px #68a7e022}.update-status.error::before{background:#d9766d}.update small{display:block;margin-top:3px;color:${palette.muted};font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.credit{font-size:11.5px;color:${palette.text};text-align:left}.credit+.credit{margin-top:7px}.credit a{color:${palette.link};text-decoration:none}.credit a:hover{text-decoration:underline}footer{border-top:1px solid ${palette.border};padding:10px 14px;display:flex;justify-content:flex-end;gap:8px;background:${palette.bg}}button{min-width:82px;padding:7px 12px;border:1px solid ${palette.border};border-radius:7px;background:${palette.button};color:${palette.text};font:inherit;font-size:12px}button:hover:not(:disabled){background:${palette.hover}}button:disabled{opacity:.55}</style></head><body><main>${icon ? `<img src="${icon}" alt="Hexa">` : ''}<h1>Hexa</h1><p>Your Open Agentic workspace</p><section class="meta"><div><span>Version</span><b>v${app.getVersion()}</b></div><div><span>Built by</span><b>SOREX AI</b></div></section><section class="update"><div class="update-copy"><div id="update-status" class="update-status">Updates</div><small id="update-message"></small></div><button id="check-update">Check</button></section><p class="credit">Copyright © 2026 SOREX AI.</p><p class="credit">This project is made possible by the open source Codex repository, of which you can find <a href="https://github.com/openai/codex">here</a>.</p></main><footer><button onclick="window.close()">Done</button></footer><script>const button=document.getElementById('check-update');const status=document.getElementById('update-status');const message=document.getElementById('update-message');window.setUpdateState=(state)=>{status.className='update-status '+state.phase;status.textContent=state.phase==='up-to-date'?'Up to date':state.phase==='available'?'Update available':state.phase==='downloading'?'Downloading update':state.phase==='downloaded'?'Ready to install':state.phase==='checking'?'Checking for updates':state.phase==='error'?'Update check failed':state.phase==='unsupported'?'Development build':'Updates';message.textContent=state.message||'';button.disabled=state.phase==='checking'||state.phase==='downloading';button.textContent=state.phase==='checking'?'Checking…':'Check again';};button.addEventListener('click',()=>{location.href='hexa-update://check';});window.setUpdateState(${initialUpdateState});</script></body></html>`;
  aboutWindow = new BrowserWindow({ width: 490, height: 500, resizable: false, maximizable: false, minimizable: false, modal: true, parent: mainWindow ?? undefined, title: 'About Hexa', backgroundColor: palette.bg, icon: themedIconPath(), autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  aboutWindow.setMenuBarVisibility(false);
  aboutWindow.setMenu(null);
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/github\.com\/openai\/codex\/?$/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  aboutWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== 'hexa-update://check') return;
    event.preventDefault();
    void updateManager.checkForUpdates(true);
  });
  aboutWindow.on('closed', () => { aboutWindow = null; });
  await aboutWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function updateAboutWindowStatus(state: ShellUpdateState): void {
  if (!aboutWindow || aboutWindow.isDestroyed()) return;
  const serialized = JSON.stringify(state).replace(/</g, '\\u003c');
  void aboutWindow.webContents.executeJavaScript(`window.setUpdateState?.(${serialized})`).catch(() => undefined);
}

function appMenuTemplate(name: AppMenuName): MenuItemConstructorOptions[] {
  const action = (label: string, value: string, accelerator?: string): MenuItemConstructorOptions => ({ label, accelerator, click: () => sendMenuAction(value) });
  if (name === 'file') return [
    action('New chat', 'new-chat', 'CommandOrControl+N'),
    action('Choose workspace…', 'choose-workspace', 'CommandOrControl+O'),
    { type: 'separator' },
    action('Settings…', 'settings', 'CommandOrControl+,'),
    { type: 'separator' },
    { role: 'close', label: 'Close window', accelerator: 'CommandOrControl+W' },
    { role: 'quit', label: 'Quit Hexa', accelerator: 'CommandOrControl+Q' },
  ];
  if (name === 'edit') return [
    { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
    { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'delete' },
    { type: 'separator' }, { role: 'selectAll' }, { type: 'separator' },
    action('Settings…', 'settings', 'CommandOrControl+,'),
  ];
  if (name === 'view') return [
    action('Toggle sidebar', 'toggle-sidebar', 'CommandOrControl+B'),
    action('Toggle bottom panel', 'toggle-bottom-panel', 'CommandOrControl+J'),
    action('Toggle work panel', 'toggle-work-panel', 'Alt+CommandOrControl+B'),
    { type: 'separator' },
    action('Back', 'back', 'Alt+Left'), action('Forward', 'forward', 'Alt+Right'),
    { type: 'separator' },
    { role: 'zoomIn', label: 'Zoom in' }, { role: 'zoomOut', label: 'Zoom out' }, { role: 'resetZoom', label: 'Actual size' },
    { type: 'separator' }, { role: 'togglefullscreen', label: 'Toggle full screen' },
  ];
  return [
    action('Keyboard shortcuts', 'keyboard-shortcuts', 'CommandOrControl+/'),
    { type: 'separator' },
    { label: 'About Hexa', click: () => void openAboutWindow() },
  ];
}

function resolveHexaHome(): string {
  const override = process.env.HEXA_ENGINE_HOME?.trim() || process.env.HEXA_HOME?.trim();
  return override ? path.resolve(override) : path.join(app.getPath('home'), '.hexashell');
}

function safeExternalUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeWebviewUrl(value: string): boolean {
  return value === 'about:blank' || safeExternalUrl(value) !== null;
}

async function openExternalUrl(value: string): Promise<void> {
  const safe = safeExternalUrl(value);
  if (!safe) throw new Error('Only HTTP and HTTPS links can be opened externally.');
  await shell.openExternal(safe);
}

function assertMainRenderer(event: IpcMainInvokeEvent): void {
  const contents = mainWindow?.webContents;
  if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) {
    throw new Error('This operation is only available to the Hexa application renderer.');
  }
}

app.setName('Hexa');
app.setPath('userData', path.join(resolveHexaHome(), 'app-data'));

const appServer = new AppServerClient();
const updateManager = new UpdateManager(
  (next) => {
    broadcast('shell:update:state', next);
    updateAboutWindowStatus(next);
  },
  async () => {
    quitting = true;
    await appServer.stop();
  },
);
const execFileAsync = promisify(execFile);

function contextWindowFrom(value: unknown): number | undefined {
  const candidates: Array<{ value: number; priority: number }> = [];
  const visit = (current: unknown, path: string[], depth: number) => {
    if (depth > 7 || !current || typeof current !== 'object') return;
    for (const [key, raw] of Object.entries(current as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normalizedPath = [...path, normalizedKey].join('.');
      const direct = Number(raw);
      if (Number.isFinite(direct) && direct >= 256) {
        let priority = 0;
        if (normalizedKey === 'contextlength' || normalizedKey === 'contextwindow') priority = 300;
        else if (normalizedKey === 'loadedcontextlength') priority = 350;
        else if (normalizedKey === 'numctx' || normalizedKey === 'nctx') priority = 325;
        else if (normalizedKey.startsWith('maxcontext')) priority = 100;
        else if (normalizedKey.endsWith('contextlength') || normalizedKey.endsWith('contextwindow')) priority = 200;
        // A provider's loaded-instance configuration is authoritative over the
        // model's theoretical maximum advertised elsewhere in the payload.
        if (priority && /loadedinstances|loadconfig|\.config\./.test(normalizedPath)) priority += 200;
        if (priority && /modelinfo/.test(normalizedPath)) priority -= 75;
        if (priority > 0) candidates.push({ value: Math.floor(direct), priority });
      }
      if (typeof raw === 'string') {
        const match = raw.match(/(?:^|\s)num_ctx\s+(\d+)/im);
        const parsed = Number(match?.[1]);
        if (Number.isFinite(parsed) && parsed >= 256) candidates.push({ value: Math.floor(parsed), priority: 325 });
      }
      visit(raw, [...path, normalizedKey], depth + 1);
    }
  };
  visit(value, [], 0);
  candidates.sort((left, right) => right.priority - left.priority);
  return candidates[0]?.value;
}

function localModelName(entry: any, provider: 'ollama' | 'lmstudio'): string {
  return String(provider === 'lmstudio'
    ? entry?.key ?? entry?.id ?? entry?.loaded_instances?.[0]?.id ?? ''
    : entry?.name ?? entry?.model ?? '');
}

function localModelMatches(entry: any, provider: 'ollama' | 'lmstudio', model: string): boolean {
  const names = provider === 'lmstudio'
    ? [entry?.key, entry?.id, ...(Array.isArray(entry?.loaded_instances) ? entry.loaded_instances.map((instance: any) => instance?.id) : [])]
    : [entry?.name, entry?.model];
  return names.some((name) => String(name ?? '') === model);
}

function runGitWithInput(args: string[], cwd: string, input = ''): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('error', (error) => resolve({ output: error.message, exitCode: 1 }));
    child.on('close', (code) => resolve({ output, exitCode: code ?? 1 }));
    child.stdin.end(input);
  });
}
const defaultPreferences: AppPreferences = {
  themeMode: 'auto',
  compactSidebar: false,
  showReasoningSummaries: true,
  showRawReasoningForLocalModels: true,
  autoOpenToolDetails: false,
  privacyMode: false,
  onboardingComplete: false,
  accountMode: 'openai',
  localModelMode: false,
  localModelProvider: 'ollama',
  localModel: undefined,
  localModelContextWindows: {},
  browserToolEnabled: true,
  sandboxSetupComplete: false,
  composerDraft: '',
  threadComposerDrafts: {},
  savedModel: undefined,
  savedReasoningEffort: undefined,
  threadModelSelections: {},
};

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function setStatus(next: HexaEngineStatus): void {
  status = next;
  broadcast('hexa-engine:status', status);
}

const binaryManager = new BinaryManager(setStatus);

async function reconnectEngine(error: Error): Promise<void> {
  if (reconnecting || quitting) return;
  reconnecting = true;
  try {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      setStatus({ phase: 'starting', message: `Connecting… ${attempt}/5`, detail: error.message, sqliteHome: resolveEngineSqliteHome() });
      try {
        await ensureAppServer(false, true);
        return;
      } catch (nextError) {
        error = nextError instanceof Error ? nextError : new Error(String(nextError));
        if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, attempt * 700));
      }
    }
    setStatus({ phase: 'error', message: 'Hexa Engine could not reconnect', detail: error.message, sqliteHome: resolveEngineSqliteHome() });
  } finally { reconnecting = false; }
}

function rendererUrl(): string {
  if (process.env.VITE_DEV_SERVER_URL) return process.env.VITE_DEV_SERVER_URL;
  const fileUrl = pathToFileURL(path.join(app.getAppPath(), 'dist/renderer/index.html')).toString();
  return fileUrl;
}

async function loadWindow(win: BrowserWindow): Promise<void> {
  const url = rendererUrl();
  if (url.startsWith('http')) await win.loadURL(url);
  else await win.loadURL(url);
}

function createMainWindow(): BrowserWindow {
  const icon = themedIconPath();
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#181a19' : '#f1f3f1',
    title: 'Hexa',
    icon,
    frame: true,
    titleBarStyle: 'hidden',
    // Keep the native caption buttons, but let the web title bar own the final
    // two pixels so its divider remains visible beneath the button backdrop.
    titleBarOverlay: { color: nativeTheme.shouldUseDarkColors ? '#181a19' : '#f1f3f1', symbolColor: nativeTheme.shouldUseDarkColors ? '#e2e5e3' : '#2c332e', height: 38 },
    trafficLightPosition: { x: 13, y: 11 },
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist/preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    },
  });
  const browserSession = session.fromPartition('persist:hexa-browser');
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    if (params.partition !== 'persist:hexa-browser' || !safeWebviewUrl(params.src)) event.preventDefault();
  });
  win.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      const safe = safeExternalUrl(url);
      if (safe) void shell.openExternal(safe);
      return { action: 'deny' };
    });
    guest.on('will-navigate', (event, url) => {
      if (!safeWebviewUrl(url)) event.preventDefault();
    });
    guest.on('will-redirect', (event, url) => {
      if (!safeWebviewUrl(url)) event.preventDefault();
    });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    const safe = safeExternalUrl(url);
    if (safe) void shell.openExternal(safe);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const expected = rendererUrl();
    const allowed = expected.startsWith('http')
      ? new URL(url).origin === new URL(expected).origin
      : url === expected;
    if (allowed) return;
    event.preventDefault();
    const safe = safeExternalUrl(url);
    if (safe) void shell.openExternal(safe);
  });
  win.webContents.on('console-message', (details) => {
    const location = details.sourceId ? ` (${details.sourceId}:${details.lineNumber})` : '';
    const output = `[renderer:${details.level}] ${details.message}${location}`;
    if (details.level === 'error' || details.level === 'warning') console.error(output);
    else console.log(output);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer:gone] ${details.reason} (exit ${details.exitCode})`);
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    mainWindow = null;
  });
  void loadWindow(win);
  return win;
}

function resolveEngineSqliteHome(): string {
  const override = process.env.HEXA_SQLITE_HOME?.trim() || process.env.HEXA_ENGINE_SQLITE_HOME?.trim();
  if (override) return path.resolve(override);
  return path.join(resolveHexaHome(), 'sqlite');
}

async function ensureWritableDirectory(directory: string, label: string): Promise<void> {
  const existing = await stat(directory).catch(() => null);
  if (existing && !existing.isDirectory()) {
    const backup = `${directory}.invalid-${Date.now()}`;
    await rename(directory, backup);
  }
  await mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.hexa-write-test-${process.pid}-${Date.now()}`);
  try {
    await writeFile(probe, '', 'utf8');
  } catch (error) {
    throw new Error(`${label} is not writable at ${directory}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await rm(probe, { force: true }).catch(() => undefined);
  }
}

async function preferencePath(): Promise<string> {
  const dir = resolveHexaHome();
  await mkdir(dir, { recursive: true });
  return path.join(dir, 'preferences.json');
}

function legacyPreferencePath(): string {
  return path.join(resolveHexaHome(), 'shell-preferences.json');
}

function configTomlPath(): string {
  return path.join(resolveHexaHome(), 'config.toml');
}

async function getPreferences(): Promise<AppPreferences> {
  try {
    const filePath = await preferencePath();
    const contents = await readFile(filePath, 'utf8').catch(() => readFile(legacyPreferencePath(), 'utf8'));
    const raw = JSON.parse(contents) as Partial<AppPreferences>;
    const merged = { ...defaultPreferences, ...raw };
    // Account mode is the source of truth for provider mode. Older builds
    // allowed these values to drift apart, which left the UI in a local
    // account while the engine still behaved like a hosted account (or vice
    // versa).
    merged.localModelMode = merged.accountMode === 'local';
    return merged;
  } catch {
    return { ...defaultPreferences };
  }
}

async function setPreferences(next: Partial<AppPreferences>): Promise<AppPreferences> {
  const merged = { ...(await getPreferences()), ...next };
  merged.localModelMode = merged.accountMode === 'local';
  await writeFile(await preferencePath(), `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  if (next.themeMode) applyNativeTheme(next.themeMode);
  broadcast('shell:preferences', merged);
  return merged;
}

function applyNativeTheme(themeMode: AppPreferences['themeMode']): void {
  nativeTheme.themeSource = themeMode === 'auto' ? 'system' : themeMode;
  updateNativeWindowColors();
}

function updateNativeWindowColors(): void {
  const dark = nativeTheme.shouldUseDarkColors;
  const icon = nativeImage.createFromPath(themedIconPath());
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(dark ? '#181a19' : '#f1f3f1');
    if (process.platform !== 'darwin' && !icon.isEmpty()) win.setIcon(icon);
    if (process.platform !== 'darwin') {
      win.setTitleBarOverlay({ color: dark ? '#181a19' : '#f1f3f1', symbolColor: dark ? '#e2e5e3' : '#2c332e', height: 38 });
    }
  }
  if (process.platform === 'darwin' && app.dock && !icon.isEmpty()) app.dock.setIcon(icon);
}

function themedIconPath(): string {
  const file = nativeTheme.shouldUseDarkColors ? 'hexa-dark.png' : 'hexa-light.png';
  return path.join(app.getAppPath(), 'resources', 'branding', file);
}

async function ensureAppServer(forceRebuild = false, retryAfterFailure = false): Promise<void> {
  if (appServer.isReady() && !forceRebuild) return;
  if (startupPromise) return startupPromise;
  if (startupFailure && !forceRebuild && !retryAfterFailure) throw startupFailure;

  if (retryAfterFailure || forceRebuild) startupFailure = null;

  startupPromise = (async () => {
    const sqliteHome = resolveEngineSqliteHome();
    let binaryPath: string | undefined;
    try {
      await ensureWritableDirectory(sqliteHome, 'Hexa SQLite state directory');
      if (forceRebuild) {
        await appServer.stop();
        await binaryManager.clearCachedBinary();
      }
      binaryPath = await binaryManager.ensureBinary(forceRebuild);
      setStatus({
        phase: 'starting',
        message: 'Starting Hexa Engine…',
        binaryPath,
        sqliteHome,
      });
      const engineHome = resolveHexaHome();
      await ensureWritableDirectory(engineHome, 'Hexa Engine home');
      await appServer.start(binaryPath, { sqliteHome, engineHome });
      startupFailure = null;
      setStatus({
        phase: 'ready',
        message: 'Hexa Engine is ready',
        binaryPath,
        detail: `Hexa Engine state: ${sqliteHome}`,
        engineHome: appServer.metadata.engineHome,
        sqliteHome,
        progress: 1,
      });
    } catch (error) {
      await appServer.stop().catch(() => undefined);
      const failure = error instanceof Error ? error : new Error(String(error));
      startupFailure = failure;
      setStatus({
        phase: 'error',
        message: 'Hexa Engine could not start',
        detail: failure.message,
        binaryPath,
        sqliteHome,
      });
      throw failure;
    } finally {
      startupPromise = null;
    }
  })();
  return startupPromise;
}

function wireAppServerEvents(): void {
  appServer.on('notification', (event: ServerEvent) => {
    if (event.method === 'account/login/completed') authWindow?.close();
    broadcast('hexa-engine:notification', event);
  });
  appServer.on('request', (request: ServerRequest) => broadcast('hexa-engine:server-request', request));
  appServer.on('stderr', (line: string) => broadcast('hexa-engine:stderr', line));
  appServer.on('protocolError', (error: Error) =>
    broadcast('hexa-engine:notification', { method: 'shell/protocolError', params: { message: error.message } }),
  );
  appServer.on('exit', (event: AppServerExitEvent) => {
    if (event.intentional) {
      if (status.phase !== 'building' && status.phase !== 'starting' && status.phase !== 'error') {
        setStatus({ phase: 'stopped', message: 'Hexa Engine stopped' });
      }
      return;
    }
    startupFailure = event.error;
    void reconnectEngine(event.error);
  });
}

function registerIpc(): void {
  ipcMain.handle('hexa-engine:request', async (_event, method: string, params?: unknown) => {
    if (!appServer.isReady()) await ensureAppServer();
    return appServer.request(method, params ?? {});
  });
  ipcMain.handle('hexa-engine:respond', (_event, id: number | string, result: unknown) => {
    appServer.respond(id, result);
  });
  ipcMain.handle(
    'hexa-engine:respond-error',
    (_event, id: number | string, code: number, message: string) => {
      appServer.respondError(id, code, message);
    },
  );
  ipcMain.handle('hexa-engine:get-status', () => status);
  ipcMain.handle('hexa-engine:rebuild', async () => {
    startupFailure = null;
    await ensureAppServer(true, true);
  });
  ipcMain.handle('hexa-engine:restart', async () => {
    startupFailure = null;
    await appServer.stop();
    await ensureAppServer(false, true);
  });
  ipcMain.handle('shell:delete-thread', async (_event, threadId: string) => {
    const remove = () => appServer.request('thread/delete', { threadId });
    try {
      await remove();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('no rollout found')) return { ok: true };
      if (!message.includes('active writer')) return { ok: false, error: message };
      try {
        await appServer.stop();
        startupFailure = null;
        await ensureAppServer(false, true);
        await remove();
        return { ok: true };
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
        return { ok: retryMessage.includes('no rollout found'), error: retryMessage };
      }
    }
  });
  ipcMain.handle('shell:choose-directory', async () => {
    const options: OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose working directory',
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('shell:choose-files', async () => {
    const options: OpenDialogOptions = {
      properties: ['openFile', 'multiSelections'],
      title: 'Attach files to Hexa',
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('shell:read-clipboard-image', async () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    const directory = path.join(app.getPath('temp'), 'hexa-clipboard-attachments');
    await mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `clipboard-${Date.now()}.png`);
    await writeFile(filePath, image.toPNG());
    return { path: filePath, name: 'Clipboard image.png', kind: 'image' as const };
  });
  ipcMain.handle('shell:show-app-menu', (event, name: AppMenuName, position: { x?: number; y?: number }) => {
    if (!['file', 'edit', 'view', 'help'].includes(name)) return;
    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!owner) return;
    const menuId = ++activeAppMenuId;
    event.sender.send('shell:app-menu-state', { name, open: true });
    Menu.buildFromTemplate(appMenuTemplate(name)).popup({
      window: owner,
      x: Math.round(Number(position?.x) || 0),
      y: Math.round(Number(position?.y) || 0),
      callback: () => {
        if (menuId === activeAppMenuId) event.sender.send('shell:app-menu-state', { name, open: false });
      },
    });
  });
  ipcMain.handle('shell:open-auth-window', (event, url: string) => {
    assertMainRenderer(event);
    if (!/^https:\/\//i.test(url)) throw new Error('Refusing to open a non-HTTPS authentication URL.');
    authWindow?.close();
    authWindow = new BrowserWindow({
      width: 940,
      height: 760,
      minWidth: 720,
      minHeight: 560,
      title: 'Sign in to OpenAI',
      parent: mainWindow ?? undefined,
      backgroundColor: '#181a19',
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    authWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
      const safe = safeExternalUrl(nextUrl);
      if (safe) void shell.openExternal(safe);
      return { action: 'deny' };
    });
    authWindow.on('closed', () => { authWindow = null; });
    void authWindow.loadURL(url);
  });
  ipcMain.handle('shell:get-preferences', () => getPreferences());
  ipcMain.handle('shell:set-preferences', (_event, next: Partial<AppPreferences>) =>
    setPreferences(next),
  );
  ipcMain.handle('shell:update:get-state', () => updateManager.getState());
  ipcMain.handle('shell:update:check', () => updateManager.checkForUpdates(true));
  ipcMain.handle('shell:update:download', () => updateManager.downloadUpdate());
  ipcMain.handle('shell:update:install', () => updateManager.installUpdate());
  ipcMain.handle('shell:detect-local-models', async (_event, provider: 'ollama' | 'lmstudio') => {
    const selected = provider === 'lmstudio'
      ? { baseUrl: 'http://127.0.0.1:1234/v1', endpoint: 'http://127.0.0.1:1234/v1/models' }
      : { baseUrl: 'http://127.0.0.1:11434/v1', endpoint: 'http://127.0.0.1:11434/api/tags' };
    try {
      const response = await fetch(selected.endpoint, { signal: AbortSignal.timeout(1800) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const body = await response.json() as any;
      const entries = provider === 'lmstudio'
        ? (Array.isArray(body?.models) ? body.models : Array.isArray(body?.data) ? body.data : [])
        : (Array.isArray(body?.models) ? body.models : []);
      let runningEntries: any[] = [];
      if (provider === 'ollama') {
        const runningResponse = await fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(1800) }).catch(() => null);
        if (runningResponse?.ok) {
          const runningBody = await runningResponse.json() as any;
          runningEntries = Array.isArray(runningBody?.models) ? runningBody.models : [];
        }
      } else {
        // LM Studio's OpenAI-compatible /v1/models endpoint is the authority
        // for IDs we can send to completions, while /api/v1/models tells us
        // which of those models currently have loaded instances. Use both so
        // account switching selects what is actually running rather than an
        // arbitrary catalog entry.
        const runningResponse = await fetch('http://127.0.0.1:1234/api/v1/models', { signal: AbortSignal.timeout(1800) }).catch(() => null);
        if (runningResponse?.ok) {
          const runningBody = await runningResponse.json() as any;
          runningEntries = (Array.isArray(runningBody?.models) ? runningBody.models : [])
            .filter((entry: any) => Array.isArray(entry?.loaded_instances) && entry.loaded_instances.length > 0);
        }
      }
      const contextWindows: Record<string, number> = {};
      const discoveredModels = entries.map((entry: any) => {
        const model = localModelName(entry, provider);
        const running = runningEntries.find((candidate) => localModelMatches(candidate, provider, model));
        const contextWindow = contextWindowFrom(running ?? entry);
        if (model && contextWindow) contextWindows[model] = contextWindow;
        return model;
      }).filter(Boolean);
      const runningModels = runningEntries.map((entry: any) =>
        discoveredModels.find((model: string) => localModelMatches(entry, provider, model))
          ?? localModelName(entry, provider),
      ).filter(Boolean);
      // Put models that are actually loaded/running first. Account switching
      // uses the first model as its automatic choice, while Settings still
      // receives the complete installed/available list afterward.
      const models = [...new Set<string>([...runningModels, ...discoveredModels])];
      return { provider, baseUrl: selected.baseUrl, models, contextWindows };
    } catch (error) {
      return { provider, baseUrl: selected.baseUrl, models: [], contextWindows: {}, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('shell:detect-local-model-context', async (_event, input: { provider: 'ollama' | 'lmstudio'; model: string }) => {
    const provider = input?.provider;
    const model = String(input?.model || '').trim();
    if (!model || (provider !== 'ollama' && provider !== 'lmstudio')) return {};
    try {
      if (provider === 'ollama') {
        const runningResponse = await fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(1800) }).catch(() => null);
        if (runningResponse?.ok) {
          const runningBody = await runningResponse.json() as any;
          const running = (Array.isArray(runningBody?.models) ? runningBody.models : [])
            .find((entry: any) => localModelMatches(entry, provider, model));
          const runningContextWindow = contextWindowFrom(running);
          if (runningContextWindow) return { contextWindow: runningContextWindow };
        }
        const response = await fetch('http://127.0.0.1:11434/api/show', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: model }),
          signal: AbortSignal.timeout(2500),
        });
        if (!response.ok) return {};
        return { contextWindow: contextWindowFrom(await response.json()) };
      }
      const listResponse = await fetch('http://127.0.0.1:1234/api/v1/models', { signal: AbortSignal.timeout(1800) }).catch(() => null);
      if (listResponse?.ok) {
        const listBody = await listResponse.json() as any;
        const entry = (Array.isArray(listBody?.models) ? listBody.models : [])
          .find((candidate: any) => localModelMatches(candidate, provider, model));
        const contextWindow = contextWindowFrom(entry);
        if (contextWindow) return { contextWindow };
      }
      for (const endpoint of [
        `http://127.0.0.1:1234/api/v0/models/${encodeURIComponent(model)}`,
        `http://127.0.0.1:1234/v1/models/${encodeURIComponent(model)}`,
      ]) {
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(1800) }).catch(() => null);
        if (!response?.ok) continue;
        const contextWindow = contextWindowFrom(await response.json());
        if (contextWindow) return { contextWindow };
      }
    } catch {
      // Keep local model selection available when the provider omits context metadata.
    }
    return {};
  });
  ipcMain.handle('shell:read-config-toml', async () => {
    const filePath = configTomlPath();
    const content = await readFile(filePath, 'utf8').catch(() => '');
    return { path: filePath, content };
  });
  ipcMain.handle('shell:write-config-toml', async (_event, content: string) => {
    const filePath = configTomlPath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
    return { path: filePath };
  });
  ipcMain.handle('shell:list-skills', async () => {
    const personalRoot = path.join(resolveHexaHome(), 'skills');
    const workspaceRoot = path.join(app.getAppPath(), '.hexa', 'skills');
    const found: Array<{ name: string; description: string; path: string; content: string; source: 'personal' | 'workspace' }> = [];
    const scan = async (root: string, source: 'personal' | 'workspace') => {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const filePath = path.join(root, entry.name, 'SKILL.md');
        const content = await readFile(filePath, 'utf8').catch(() => '');
        if (!content) continue;
        const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
        const field = (name: string) => frontmatter?.[1].match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
        found.push({ name: field('name') || entry.name, description: field('description'), path: filePath, content, source });
      }
    };
    await Promise.all([scan(personalRoot, 'personal'), scan(workspaceRoot, 'workspace')]);
    return found.sort((a, b) => a.name.localeCompare(b.name));
  });
  ipcMain.handle('shell:save-skill', async (_event, input: { name: string; content: string; path?: string }) => {
    const name = String(input.name || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new Error('Skill names must use lowercase letters, numbers, and hyphens.');
    const personalRoot = path.resolve(resolveHexaHome(), 'skills');
    const workspaceRoot = path.resolve(app.getAppPath(), '.hexa', 'skills');
    const filePath = input.path ? path.resolve(input.path) : path.join(personalRoot, name, 'SKILL.md');
    const allowed = [personalRoot, workspaceRoot].some((root) => filePath.startsWith(`${root}${path.sep}`) && path.basename(filePath).toLowerCase() === 'skill.md');
    if (!allowed) throw new Error('Skills can only be saved inside a configured Hexa skills directory.');
    if (!/^---\s*\r?\n[\s\S]*?^name:\s*.+$/m.test(input.content) || !/^description:\s*.+$/m.test(input.content)) throw new Error('SKILL.md requires YAML frontmatter with name and description.');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.content, 'utf8');
    const description = input.content.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
    return { name, description, path: filePath, content: input.content, source: filePath.startsWith(workspaceRoot) ? 'workspace' : 'personal' };
  });
  ipcMain.handle('shell:plugin-icon', async (_event, source: string) => {
    if (/^https:\/\//i.test(source)) return source;
    const resolved = path.resolve(source);
    const roots = [app.getAppPath(), appServer.metadata.engineHome, status.engineHome]
      .filter((root): root is string => Boolean(root))
      .map((root) => path.resolve(root));
    if (!roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) return null;
    const extension = path.extname(resolved).toLowerCase();
    const mime = extension === '.svg' ? 'image/svg+xml'
      : extension === '.png' ? 'image/png'
        : extension === '.webp' ? 'image/webp'
          : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
            : null;
    if (!mime) return null;
    const data = await readFile(resolved);
    return `data:${mime};base64,${data.toString('base64')}`;
  });
  ipcMain.handle('shell:run-terminal', async (event, command: string, cwd?: string) => {
    assertMainRenderer(event);
    const normalizedCommand = String(command || '').trim();
    if (!normalizedCommand) return { output: '', exitCode: 0 };
    if (normalizedCommand.length > 32_768) throw new Error('The terminal command is too long.');
    const normalizedCwd = cwd ? path.resolve(String(cwd)) : undefined;
    const owner = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    const confirmation = owner
      ? await dialog.showMessageBox(owner, {
        type: 'warning',
        title: 'Run terminal command?',
        message: 'Allow Hexa to run this command?',
        detail: `${normalizedCwd ? `Working directory: ${normalizedCwd}\n\n` : ''}${normalizedCommand.slice(0, 4_000)}`,
        buttons: ['Cancel', 'Run command'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      : { response: 0 };
    if (confirmation.response !== 1) return { output: 'Command cancelled by user.', exitCode: 130 };
    const executable = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/sh';
    const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile', '-Command', normalizedCommand] : ['-lc', normalizedCommand];
    try {
      const result = await execFileAsync(executable, args, { cwd: normalizedCwd, maxBuffer: 4 * 1024 * 1024 });
      return { output: `${result.stdout}${result.stderr}`, exitCode: 0 };
    } catch (error: any) {
      return { output: `${error.stdout || ''}${error.stderr || error.message || ''}`, exitCode: Number(error.code) || 1 };
    }
  });
  ipcMain.handle('shell:apply-workspace-diff', async (_event, input: { cwd?: string; diff?: string; reverse?: boolean }) => {
    const cwd = String(input?.cwd || '').trim();
    const diff = String(input?.diff || '');
    const fail = async (message: string) => {
      const options = { type: 'error' as const, title: 'Unable to update changes', message };
      if (mainWindow) await dialog.showMessageBox(mainWindow, options);
      else await dialog.showMessageBox(options);
      return { ok: false, error: message };
    };
    if (!cwd || !diff.trim()) return fail('The workspace or saved change set is unavailable.');
    // `git apply` can apply a unified patch to an ordinary directory; it does
    // not require a repository unless index-specific options are used. Requiring
    // `git init` here made perfectly valid Hexa file changes impossible to undo
    // or reapply in normal folders.
    const args = ['apply', '--whitespace=nowarn', ...(input.reverse ? ['--reverse'] : [])];
    const check = await runGitWithInput([...args, '--check', '-'], cwd, diff);
    if (check.exitCode !== 0) return fail(check.output.trim() || `The changes could not be ${input.reverse ? 'undone' : 'reapplied'}.`);
    const result = await runGitWithInput([...args, '-'], cwd, diff);
    if (result.exitCode !== 0) return fail(result.output.trim() || `The changes could not be ${input.reverse ? 'undone' : 'reapplied'}.`);
    return { ok: true };
  });
  ipcMain.handle('shell:open-external', (event, url: string) => {
    assertMainRenderer(event);
    return openExternalUrl(url);
  });
  ipcMain.handle('shell:open-resource', async (event, target: string) => {
    assertMainRenderer(event);
    const external = safeExternalUrl(target);
    if (external) return shell.openExternal(external);
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^file:/i.test(target)) {
      throw new Error('Unsupported resource URL scheme.');
    }
    const normalized = /^file:/i.test(target) ? fileURLToPath(target) : target;
    const dangerous = new Set(['.app', '.bat', '.cmd', '.com', '.desktop', '.exe', '.hta', '.lnk', '.msi', '.ps1', '.scr', '.sh', '.url']);
    if (dangerous.has(path.extname(normalized).toLowerCase())) {
      throw new Error('Executable resources cannot be opened from chat content.');
    }
    return shell.openPath(normalized);
  });
  ipcMain.handle('shell:verify-file-paths', async (_event, paths: string[], cwd?: string) => {
    const results: Record<string, boolean> = {};
    const base = cwd ? path.resolve(cwd) : undefined;
    for (const target of Array.isArray(paths) ? paths.slice(0, 200) : []) {
      const normalized = String(target || '').trim();
      if (!normalized) continue;
      // App-server file-change paths may be workspace-relative. Resolving them
      // against Electron's process.cwd() produced false "No file was written"
      // failures even when the engine had successfully created the file.
      const resolved = path.isAbsolute(normalized) ? path.normalize(normalized) : base ? path.resolve(base, normalized) : path.resolve(normalized);
      results[normalized] = await stat(resolved).then(() => true).catch(() => false);
    }
    return results;
  });
}

app.whenReady().then(async () => {
  applyNativeTheme((await getPreferences()).themeMode);
  nativeTheme.on('updated', updateNativeWindowColors);
  wireAppServerEvents();
  registerIpc();
  mainWindow = createMainWindow();
  await binaryManager.prepareForAppVersion();
  void ensureAppServer().catch(() => undefined);
  updateManager.startPeriodicChecks();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  void appServer.stop();
});
