export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface HexaEngineStatus {
  phase: 'idle' | 'checking' | 'building' | 'starting' | 'ready' | 'error' | 'stopped';
  message: string;
  detail?: string;
  progress?: number;
  binaryPath?: string;
  engineHome?: string;
  sqliteHome?: string;
}

export interface RpcError {
  code: number;
  message: string;
  data?: JsonValue;
}

export interface RpcResponse<T = unknown> {
  id: number | string;
  result?: T;
  error?: RpcError;
}

export interface ServerEvent {
  method: string;
  params?: unknown;
}

export interface ServerRequest extends ServerEvent {
  id: number | string;
}

export interface AppPreferences {
  themeMode: 'auto' | 'light' | 'dark';
  compactSidebar: boolean;
  showReasoningSummaries: boolean;
  showRawReasoningForLocalModels: boolean;
  autoOpenToolDetails: boolean;
  privacyMode: boolean;
  onboardingComplete: boolean;
  accountMode: 'openai' | 'local';
  localModelMode: boolean;
  localModelProvider: 'ollama' | 'lmstudio';
  localModel?: string;
  localModelContextWindows: Record<string, number>;
  browserToolEnabled: boolean;
  sandboxSetupComplete: boolean;
  composerDraft: string;
  threadComposerDrafts: Record<string, string>;
  savedModel?: string;
  savedReasoningEffort?: string;
  threadModelSelections: Record<string, { model: string; reasoningEffort: string; provider?: string }>;
}

export type ShellUpdatePhase = 'unsupported' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error';

export interface ShellUpdateState {
  phase: ShellUpdatePhase;
  currentVersion: string;
  availableVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  message: string;
  checkedAt?: number;
  progress?: number;
  transferred?: number;
  total?: number;
  error?: string;
}

export interface ShellSettingsSnapshot {
  config: Record<string, unknown>;
  requirements: Record<string, unknown> | null;
  preferences: AppPreferences;
  engineHome?: string;
  configFilePath?: string;
}

export interface HexaSkillSummary {
  name: string;
  description: string;
  path: string;
  content: string;
  source: 'personal' | 'workspace';
}

export interface HexaBridge {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  respond(id: number | string, result: unknown): Promise<void>;
  respondError(id: number | string, code: number, message: string): Promise<void>;
  onNotification(listener: (event: ServerEvent) => void): () => void;
  onServerRequest(listener: (request: ServerRequest) => void): () => void;
  onStatus(listener: (status: HexaEngineStatus) => void): () => void;
  getStatus(): Promise<HexaEngineStatus>;
  rebuildEngine(): Promise<void>;
  restartEngine(): Promise<void>;
  deleteThread(threadId: string): Promise<{ ok: boolean; error?: string }>;
  chooseDirectory(): Promise<string | null>;
  chooseFiles(): Promise<string[]>;
  readClipboardImage(): Promise<{ path: string; name: string; kind: 'image' } | null>;
  openAuthWindow(url: string): Promise<void>;
  openResource(target: string): Promise<void>;
  verifyFilePaths(paths: string[], cwd?: string): Promise<Record<string, boolean>>;
  getPreferences(): Promise<AppPreferences>;
  setPreferences(next: Partial<AppPreferences>): Promise<AppPreferences>;
  detectLocalModels(provider: 'ollama' | 'lmstudio'): Promise<{ provider: 'ollama' | 'lmstudio'; baseUrl: string; models: string[]; contextWindows: Record<string, number>; error?: string }>;
  detectLocalModelContext(input: { provider: 'ollama' | 'lmstudio'; model: string }): Promise<{ contextWindow?: number }>;
  pluginIcon(source: string): Promise<string | null>;
  runTerminal(command: string, cwd?: string): Promise<{ output: string; exitCode: number }>;
  applyWorkspaceDiff(input: { cwd: string; diff: string; reverse: boolean }): Promise<{ ok: boolean; error?: string }>;
  readConfigToml(): Promise<{ path: string; content: string }>;
  writeConfigToml(content: string): Promise<{ path: string }>;
  listSkills(): Promise<HexaSkillSummary[]>;
  saveSkill(input: { name: string; content: string; path?: string }): Promise<HexaSkillSummary>;
  showAppMenu(name: 'file' | 'edit' | 'view' | 'help', position: { x: number; y: number }): Promise<void>;
  onAppMenuState(listener: (state: { name: 'file' | 'edit' | 'view' | 'help'; open: boolean }) => void): () => void;
  onAppMenuAction(listener: (action: string) => void): () => void;
  getUpdateState(): Promise<ShellUpdateState>;
  checkForUpdates(): Promise<ShellUpdateState>;
  downloadUpdate(): Promise<ShellUpdateState>;
  installUpdate(): Promise<{ accepted: boolean }>;
  onUpdateState(listener: (state: ShellUpdateState) => void): () => void;
  // Keep the renderer-facing bridge free of Node-only ambient types.
  // process.platform is serialized as a plain string by the preload bridge.
  platform: string;
  isPackaged: boolean;
}
