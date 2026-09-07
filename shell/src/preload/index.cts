import { contextBridge, ipcRenderer } from 'electron';
import type { AppPreferences, HexaBridge, HexaEngineStatus, ServerEvent, ServerRequest, ShellUpdateState } from '../shared/types.js';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const bridge: HexaBridge = {
  request: <T,>(method: string, params?: unknown) => ipcRenderer.invoke('hexa-engine:request', method, params) as Promise<T>,
  respond: (id, result) => ipcRenderer.invoke('hexa-engine:respond', id, result),
  respondError: (id, code, message) => ipcRenderer.invoke('hexa-engine:respond-error', id, code, message),
  onNotification: (listener) => subscribe<ServerEvent>('hexa-engine:notification', listener),
  onServerRequest: (listener) => subscribe<ServerRequest>('hexa-engine:server-request', listener),
  onStatus: (listener) => subscribe<HexaEngineStatus>('hexa-engine:status', listener),
  getStatus: () => ipcRenderer.invoke('hexa-engine:get-status'),
  rebuildEngine: () => ipcRenderer.invoke('hexa-engine:rebuild'),
  restartEngine: () => ipcRenderer.invoke('hexa-engine:restart'),
  deleteThread: (threadId) => ipcRenderer.invoke('shell:delete-thread', threadId),
  chooseDirectory: () => ipcRenderer.invoke('shell:choose-directory'),
  chooseFiles: () => ipcRenderer.invoke('shell:choose-files'),
  readClipboardImage: () => ipcRenderer.invoke('shell:read-clipboard-image'),
  openAuthWindow: (url) => ipcRenderer.invoke('shell:open-auth-window', url),
  openResource: (target) => ipcRenderer.invoke('shell:open-resource', target),
  verifyFilePaths: (paths, cwd) => ipcRenderer.invoke('shell:verify-file-paths', paths, cwd) as Promise<Record<string, boolean>>,
  getPreferences: () => ipcRenderer.invoke('shell:get-preferences') as Promise<AppPreferences>,
  setPreferences: (next) => ipcRenderer.invoke('shell:set-preferences', next) as Promise<AppPreferences>,
  detectLocalModels: (provider) => ipcRenderer.invoke('shell:detect-local-models', provider),
  detectLocalModelContext: (input) => ipcRenderer.invoke('shell:detect-local-model-context', input),
  pluginIcon: (source) => ipcRenderer.invoke('shell:plugin-icon', source) as Promise<string | null>,
  runTerminal: (command, cwd) => ipcRenderer.invoke('shell:run-terminal', command, cwd) as Promise<{ output: string; exitCode: number }>,
  applyWorkspaceDiff: (input) => ipcRenderer.invoke('shell:apply-workspace-diff', input) as Promise<{ ok: boolean; error?: string }>,
  readConfigToml: () => ipcRenderer.invoke('shell:read-config-toml') as Promise<{ path: string; content: string }>,
  writeConfigToml: (content) => ipcRenderer.invoke('shell:write-config-toml', content) as Promise<{ path: string }>,
  listSkills: () => ipcRenderer.invoke('shell:list-skills'),
  saveSkill: (input) => ipcRenderer.invoke('shell:save-skill', input),
  showAppMenu: (name, position) => ipcRenderer.invoke('shell:show-app-menu', name, position),
  onAppMenuState: (listener) => subscribe<{ name: 'file' | 'edit' | 'view' | 'help'; open: boolean }>('shell:app-menu-state', listener),
  onAppMenuAction: (listener) => subscribe<string>('shell:app-menu-action', listener),
  getUpdateState: () => ipcRenderer.invoke('shell:update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('shell:update:check'),
  downloadUpdate: () => ipcRenderer.invoke('shell:update:download'),
  installUpdate: () => ipcRenderer.invoke('shell:update:install'),
  onUpdateState: (listener) => subscribe<ShellUpdateState>('shell:update:state', listener),
  platform: process.platform,
  // `app` is not available in the isolated preload sandbox. Electron exposes
  // `defaultApp` on the preload process instead; packaged apps have it unset.
  isPackaged: process.defaultApp !== true,
};

contextBridge.exposeInMainWorld('hexa', bridge);
