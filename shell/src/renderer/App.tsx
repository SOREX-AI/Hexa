import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  ArchiveRestore,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Clock3,
  Code2,
  Copy,
  FileCode2,
  FileText,
  Folder,
  Forklift,
  GitBranch,
  Globe2,
  Hand,
  Hammer,
  Image,
  Link2,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Play,
  PlugZap,
  Puzzle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  SquareTerminal,
  Trash2,
  ThumbsDown,
  ThumbsUp,
  User,
  Wrench,
  Wifi,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { AppPreferences, HexaSkillSummary, HexaEngineStatus, ServerEvent, ServerRequest, ShellUpdateState } from '../shared/types';
import { applyServerEvent, mergeThread, normalizeThread, normalizeTurn, type ThreadView } from './lib/hexaState';
import { commandLabel, relativeTime, shortenPath, titleFromThread } from './lib/format';

type Model = {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  supportedReasoningEfforts?: { reasoningEffort: string; description?: string }[];
  defaultReasoningEffort?: string;
  isDefault?: boolean;
};

type PermissionProfile = { id: string; description?: string | null; allowed: boolean };

type ThreadListResponse = { data: any[]; nextCursor?: string | null };

type ApprovalState = ServerRequest & { receivedAt: number };

type PluginSummary = {
  id: string;
  name: string;
  installed: boolean;
  enabled: boolean;
  availability?: string;
  installPolicy?: string;
  interface?: {
    displayName?: string | null;
    shortDescription?: string | null;
    longDescription?: string | null;
    brandColor?: string | null;
    composerIconUrl?: string | null;
    composerIcon?: string | null;
    logoDark?: string | null;
    logo?: string | null;
    logoUrlDark?: string | null;
    logoUrl?: string | null;
  } | null;
  marketplaceName: string;
  marketplacePath?: string | null;
};

export function App() {
  return <><ChatApp /><ShellTooltip /></>;
}

function useShellTheme(themeMode: AppPreferences['themeMode'] | undefined) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = themeMode === 'auto' || !themeMode ? (media.matches ? 'dark' : 'light') : themeMode; };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [themeMode]);
}

function HexaLogo({ className = '', alt = 'Hexa' }: { className?: string; alt?: string }) {
  return <span className={`hexa-logo ${className}`} role={alt ? 'img' : undefined} aria-label={alt || undefined}><img className="hexa-logo-dark" src="./hexa-dark.png" alt="" /><img className="hexa-logo-light" src="./hexa-light.png" alt="" /></span>;
}

function ShellTooltip() {
  const [tip, setTip] = useState<{ text: string; shortcut?: string; x: number; y: number; above: boolean } | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const show = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>('[title], [data-shell-tooltip]');
      if (!target) return;
      const text = target.dataset.shellTooltip || target.getAttribute('title');
      if (!text) return;
      target.dataset.shellTooltip = text;
      target.removeAttribute('title');
      const rect = target.getBoundingClientRect();
      const shortcut = target.dataset.shortcut;
      const estimatedWidth = Math.min(440, Math.max(160, text.length * 6.4 + (shortcut ? shortcut.length * 6 + 42 : 20)));
      const x = Math.min(window.innerWidth - estimatedWidth / 2 - 10, Math.max(estimatedWidth / 2 + 10, rect.left + rect.width / 2));
      const above = rect.bottom + 74 > window.innerHeight;
      setTip({ text, shortcut, x, y: above ? rect.top - 9 : rect.bottom + 9, above });
    };
    const hide = () => setTip(null);
    document.addEventListener('pointerover', show);
    document.addEventListener('pointerout', hide);
    return () => { document.removeEventListener('pointerover', show); document.removeEventListener('pointerout', hide); };
  }, []);

  useLayoutEffect(() => {
    const node = tooltipRef.current;
    if (!node || !tip) return;
    const margin = 8;
    const rect = node.getBoundingClientRect();
    let left = tip.x;
    let top = tip.y;
    if (rect.left < margin) left += margin - rect.left;
    if (rect.right > window.innerWidth - margin) left -= rect.right - (window.innerWidth - margin);
    if (rect.top < margin) top += margin - rect.top;
    if (rect.bottom > window.innerHeight - margin) top -= rect.bottom - (window.innerHeight - margin);
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
  }, [tip]);

  return tip ? <div ref={tooltipRef} className={`shell-tooltip ${tip.above ? 'above' : ''}`} style={{ left: tip.x, top: tip.y }}><span>{tip.text}</span>{tip.shortcut && <kbd>{tip.shortcut}</kbd>}</div> : null;
}

type BuiltInBrowserController = { run: (action: string, args: Record<string, unknown>) => Promise<string> };

const BUILT_IN_BROWSER_TOOL = {
  type: 'namespace',
  name: 'shell_browser',
  description: 'Control the browser built directly into Hexa. This browser is available even when Chrome is not installed. Use it for navigation, page inspection, clicking, typing, scrolling, and local web-app verification.',
  tools: [{
    type: 'function',
    name: 'control',
    description: 'Operate the in-app browser and return its current URL, title, and visible page text after the action.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['open', 'inspect', 'click', 'type', 'scroll', 'back', 'forward', 'reload'] },
        url: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    deferLoading: false,
  }],
};

function ChatApp() {
  const [status, setStatus] = useState<HexaEngineStatus>({ phase: 'idle', message: 'Starting Hexa Engine…' });
  const [threads, setThreads] = useState<ThreadView[]>([]);
  const [threadCursor, setThreadCursor] = useState<string | null>(null);
  const [activeThread, setActiveThread] = useState<ThreadView | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [permissionProfiles, setPermissionProfiles] = useState<PermissionProfile[]>([]);
  const [selectedPermission, setSelectedPermission] = useState(':workspace');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [reasoningEffort, setReasoningEffort] = useState<string>('low');
  const [cwd, setCwd] = useState<string>('');
  const [composer, setComposer] = useState('');
  const [attachments, setAttachments] = useState<{ path: string; name: string; kind: 'image' | 'audio' | 'file' }[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageStats, setUsageStats] = useState<any>(null);
  const [liveLocalContextWindow, setLiveLocalContextWindow] = useState<number | undefined>();
  const [liveTools, setLiveTools] = useState<Record<string, any>>({});
  const [showArchived, setShowArchived] = useState(false);
  const [config, setConfig] = useState<Record<string, any>>({});
  const [approvals, setApprovals] = useState<ApprovalState[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
  const [fullAccessWarningOpen, setFullAccessWarningOpen] = useState(false);
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [pluginMentions, setPluginMentions] = useState<PluginSummary[]>([]);
  const [composerModes, setComposerModes] = useState<Array<'goal' | 'plan'>>([]);
  const [activityReview, setActivityReview] = useState<'goal' | 'plan' | null>(null);
  const [navigation, setNavigation] = useState<string[]>([]);
  const [navigationIndex, setNavigationIndex] = useState(-1);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
  const [workPanelKind, setWorkPanelKind] = useState<'browser' | 'terminal'>('terminal');
  const [account, setAccount] = useState<any>(null);
  const [pendingDelete, setPendingDelete] = useState<ThreadView | null>(null);
  const [chatNotice, setChatNotice] = useState<{ kind: 'success' | 'error'; action: 'delete' | 'archive' | 'restore' | 'chat'; message: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<ThreadView | null>(null);
  const [sending, setSending] = useState(false);
  const [presentationPaused, setPresentationPaused] = useState(false);
  const [pausedThread, setPausedThread] = useState<ThreadView | null>(null);
  const [imagePreview, setImagePreview] = useState<{ src: string; name: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  useShellTheme(preferences?.themeMode);
  const [booting, setBooting] = useState(true);
  // Account selection can restart the engine, which temporarily unmounts the
  // ready-only onboarding overlay. Keep its page in the parent so that restart
  // does not send a first-time user back to the welcome page.
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [welcomeCycle, setWelcomeCycle] = useState(0);
  const [sandboxSetup, setSandboxSetup] = useState(false);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const activeThreadRef = useRef<ThreadView | null>(null);
  const navigationRef = useRef<string[]>([]);
  const navigationIndexRef = useRef(-1);
  const threadComposerDraftsRef = useRef<Record<string, string>>({});
  const tokenUsageByThreadRef = useRef<Record<string, any>>({});
  const liveToolQueuesRef = useRef<Record<string, any[]>>({});
  const liveToolTimersRef = useRef<Record<string, number>>({});
  const sandboxPreflightIdsRef = useRef<Record<string, string>>({});
  const rawCustomToolIdsRef = useRef<Record<string, string>>({});
  const hostedContextCleanupRef = useRef(false);
  const polledToolIdsRef = useRef(new Set<string>());
  const browserControllerRef = useRef<BuiltInBrowserController | null>(null);
  const pauseClickTimerRef = useRef<number | null>(null);
  const receiveBrowserController = useCallback((controller: BuiltInBrowserController | null) => { browserControllerRef.current = controller; }, []);

  useEffect(() => {
    if (!chatNotice) return;
    const timer = window.setTimeout(() => setChatNotice(null), chatNotice.kind === 'error' ? 6500 : 3200);
    return () => window.clearTimeout(timer);
  }, [chatNotice]);

  const showNextLiveTool = useCallback((turnId: string) => {
    const next = liveToolQueuesRef.current[turnId]?.[0];
    setLiveTools((current) => {
      if (next) return { ...current, [turnId]: next };
      if (!current[turnId]) return current;
      const updated = { ...current };
      delete updated[turnId];
      return updated;
    });
  }, []);

  useEffect(() => window.hexa.onAppMenuAction((action) => {
    if (action === 'new-chat') {
      threadComposerDraftsRef.current[activeThreadRef.current?.id ?? '__new__'] = composer;
      activeThreadRef.current = null;
      setActiveThread(null);
      setComposer(threadComposerDraftsRef.current.__new__ ?? '');
      setAttachments([]);
      setPluginMentions([]);
      setComposerModes([]);
      setApprovals([]);
      const current = navigationRef.current;
      if (current[navigationIndexRef.current] !== '__new__') {
        const next = [...current.slice(0, navigationIndexRef.current + 1), '__new__'];
        navigationRef.current = next;
        navigationIndexRef.current = next.length - 1;
        setNavigation(next);
        setNavigationIndex(next.length - 1);
      }
    } else if (action === 'choose-workspace') void chooseFolder();
    else if (action === 'settings') setSettingsOpen(true);
    else if (action === 'toggle-sidebar') setSidebarOpen((value) => !value);
    else if (action === 'toggle-bottom-panel') setBottomPanelOpen((value) => !value);
    else if (action === 'toggle-work-panel') setRightPanelOpen((value) => !value);
    else if (action === 'back') void navigateHistory(-1);
    else if (action === 'forward') void navigateHistory(1);
    else if (action === 'keyboard-shortcuts') setChatNotice({ kind: 'success', action: 'chat', message: 'Shortcuts: Ctrl/Cmd+B sidebar · Alt+←/→ history · Ctrl/Cmd+J bottom panel.' });
  }), [composer]);

  const presentLiveTool = useCallback((turnId: string, item: any) => {
    const queue = liveToolQueuesRef.current[turnId] ?? [];
    const existing = queue.findIndex((candidate) => candidate.id === item.id);
    if (existing >= 0) queue[existing] = { ...queue[existing], ...item };
    else queue.push({ ...item, _shellStartedAt: undefined });
    liveToolQueuesRef.current[turnId] = queue;
    if (queue.length === 1) {
      queue[0]._shellStartedAt ??= performance.now();
      showNextLiveTool(turnId);
    }
  }, [showNextLiveTool]);

  const completeLiveTool = useCallback((turnId: string, itemId?: string) => {
    const queue = liveToolQueuesRef.current[turnId] ?? [];
    const index = itemId ? queue.findIndex((candidate) => candidate.id === itemId) : 0;
    if (index < 0) return;
    queue[index]._shellCompleted = true;
    if (index > 0) return;
    const shownFor = performance.now() - (queue[0]._shellStartedAt ?? performance.now());
    window.clearTimeout(liveToolTimersRef.current[turnId]);
    liveToolTimersRef.current[turnId] = window.setTimeout(() => {
      const latest = liveToolQueuesRef.current[turnId] ?? [];
      latest.shift();
      liveToolQueuesRef.current[turnId] = latest;
      // Move directly from one queued tool to the next. Briefly clearing this
      // slot made Thinking flash while a real tool was already running and hid
      // fast calls behind the queue.
      if (latest[0]) latest[0]._shellStartedAt = performance.now();
      showNextLiveTool(turnId);
      if (latest[0]?._shellCompleted) completeLiveTool(turnId, latest[0].id);
    // Fast commands should remain legible before the next item replaces them.
    }, Math.max(0, 1_250 - shownFor));
  }, [showNextLiveTool]);

  const beginSandboxPreflight = useCallback((turnId: string, afterItemId?: string) => {
    if (sandboxPreflightIdsRef.current[turnId]) return;
    const id = `local-sandbox-preflight-${turnId}`;
    sandboxPreflightIdsRef.current[turnId] = id;
    const item = { id, type: 'guardianPermissionReview', toolName: 'Sandbox permission check', status: 'inProgress', afterItemId, _shellPreflight: true };
    setActiveThread((current) => {
      const base = current ?? activeThreadRef.current;
      if (!base) return current;
      const turns = (base.turns ?? []).map((turn: any) => {
        if (turn.id !== turnId) return turn;
        const items = [...(turn.items ?? [])];
        const anchor = afterItemId == null ? -1 : items.findIndex((entry: any) => entry.id === afterItemId);
        items.splice(anchor >= 0 ? anchor + 1 : items.length, 0, item);
        return { ...turn, items };
      });
      const next = { ...base, turns };
      rememberSandboxPreflight(base.id, { ...item, turnId });
      activeThreadRef.current = next;
      return next;
    });
    presentLiveTool(turnId, item);
  }, [presentLiveTool]);

  const beginDeclaredSkillRead = useCallback((turnId: string, dialog: any) => {
    const skill = declaredSkillFromText(String(dialog?.text ?? dialog?.content ?? ''));
    if (!skill) return;
    const id = `local-skill-read-${turnId}-${skill.slug}`;
    const item = {
      id,
      type: 'dynamicToolCall',
      tool: 'skill',
      arguments: `skills/${skill.slug}/SKILL.md`,
      status: 'inProgress',
      afterItemId: dialog?.id,
      _shellDeclaredSkill: skill.slug,
      _shellRawCustomTool: true,
    };
    setActiveThread((current) => {
      const base = current ?? activeThreadRef.current;
      if (!base) return current;
      const turns = (base.turns ?? []).map((turn: any) => {
        if (turn.id !== turnId || (turn.items ?? []).some((entry: any) => entry.id === id)) return turn;
        const items = [...(turn.items ?? [])];
        const anchor = items.findIndex((entry: any) => entry.id === dialog?.id);
        items.splice(anchor >= 0 ? anchor + 1 : items.length, 0, item);
        return { ...turn, items };
      });
      const next = { ...base, turns };
      activeThreadRef.current = next;
      return next;
    });
    presentLiveTool(turnId, item);
  }, [presentLiveTool]);

  const finishDeclaredSkillReads = useCallback((turnId: string, itemId?: string) => {
    setActiveThread((current) => {
      const base = current ?? activeThreadRef.current;
      if (!base) return current;
      const turns = (base.turns ?? []).map((turn: any) => {
        if (turn.id !== turnId) return turn;
        return {
          ...turn,
          items: (turn.items ?? []).map((item: any) => {
            if (!item._shellDeclaredSkill || (itemId && item.id !== itemId)) return item;
            rememberRawCustomTool(base.id, turnId, { ...item, id: item.id, status: 'completed' });
            return { ...item, status: 'completed' };
          }),
        };
      });
      const next = { ...base, turns };
      activeThreadRef.current = next;
      return next;
    });
    const queue = liveToolQueuesRef.current[turnId] ?? [];
    const filtered = queue.filter((item) => !item._shellDeclaredSkill || (itemId && item.id !== itemId));
    if (filtered.length === queue.length) return;
    window.clearTimeout(liveToolTimersRef.current[turnId]);
    liveToolQueuesRef.current[turnId] = filtered;
    if (filtered[0]) filtered[0]._shellStartedAt ??= performance.now();
    showNextLiveTool(turnId);
  }, [showNextLiveTool]);

  const finishSandboxPreflight = useCallback((turnId: string) => {
    const id = sandboxPreflightIdsRef.current[turnId];
    if (!id) return;
    setActiveThread((current) => {
      const base = current ?? activeThreadRef.current;
      if (!base) return current;
      const turns = (base.turns ?? []).map((turn: any) => turn.id === turnId
        ? { ...turn, items: (turn.items ?? []).map((item: any) => item.id === id ? { ...item, status: 'completed' } : item) }
        : turn);
      const next = { ...base, turns };
      rememberSandboxPreflight(base.id, { id, status: 'completed' });
      activeThreadRef.current = next;
      return next;
    });
    // A preflight is only a bridge into real execution. Do not leave its live
    // row in the queue for the normal legibility delay: that duplicates the
    // completed transcript row and leaves an already-finished check labeled
    // "Running" beside the real tool.
    const queue = liveToolQueuesRef.current[turnId] ?? [];
    const index = queue.findIndex((item) => item.id === id);
    if (index >= 0) {
      window.clearTimeout(liveToolTimersRef.current[turnId]);
      queue.splice(index, 1);
      liveToolQueuesRef.current[turnId] = queue;
      if (queue[0]) queue[0]._shellStartedAt ??= performance.now();
      showNextLiveTool(turnId);
    }
  }, [showNextLiveTool]);

  const presentSandboxPreflightForNativeTool = useCallback((turnId: string) => {
    if (sandboxPreflightIdsRef.current[turnId]) {
      finishSandboxPreflight(turnId);
      return;
    }
    const activeTurn = (activeThreadRef.current?.turns ?? []).find((turn: any) => turn.id === turnId);
    const inspectionDialog = (activeTurn?.items ?? []).find((item: any) => item.type === 'agentMessage' && Boolean(String(item.text ?? '').trim()) && shouldShowSandboxPreflight(item));
    if (!inspectionDialog) return;
    // The engine does not persist preflight as a transcript item. Start this
    // renderer representation only after a native tool lifecycle signal, so
    // it replaces Thinking at the real execution boundary rather than early.
    beginSandboxPreflight(turnId, inspectionDialog.id);
    window.setTimeout(() => finishSandboxPreflight(turnId), 900);
  }, [beginSandboxPreflight, finishSandboxPreflight]);

  const handleBuiltInBrowserCall = useCallback(async (params: any) => {
    if (params?.namespace !== 'shell_browser' || params?.tool !== 'control') throw new Error(`Unsupported shell tool: ${params?.namespace ?? ''}/${params?.tool ?? ''}`);
    setWorkPanelKind('browser');
    setRightPanelOpen(true);
    for (let attempt = 0; attempt < 40 && !browserControllerRef.current; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (!browserControllerRef.current) throw new Error('The built-in browser did not become ready.');
    const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
    return browserControllerRef.current.run(String(args.action || 'inspect'), args);
  }, []);

  useEffect(() => {
    activeThreadRef.current = activeThread;
  }, [activeThread]);

  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), 2600);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (booting || status.phase !== 'ready') return;
    setWelcomeCycle((value) => value + 1);
    const replay = window.setInterval(() => setWelcomeCycle((value) => value + 1), 20_000);
    return () => window.clearInterval(replay);
  }, [booting, status.phase]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'b') { event.preventDefault(); setSidebarOpen((value) => !value); }
      else if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); void navigateHistory(-1); }
      else if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); void navigateHistory(1); }
      else if (event.ctrlKey && event.key === '`') { event.preventDefault(); setBottomPanelOpen((value) => !value); }
      else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); setRightPanelOpen((value) => !value); }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest('[data-menu-root]')) return;
      setModelMenuOpen(false);
      setPermissionMenuOpen(false);
      setCommandMenuOpen(false);
      setAccountMenuOpen(false);
      setAddMenuOpen(false);
      setUsageOpen(false);
      setPendingDelete(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setModelMenuOpen(false);
      setPermissionMenuOpen(false);
      setCommandMenuOpen(false);
      setAddMenuOpen(false);
      setAccountMenuOpen(false);
      setUsageOpen(false);
    };
    document.addEventListener('pointerdown', closeMenus);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenus);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const customProvider = preferences?.accountMode === 'local';
  const selectedHostedModel = models.find((entry) => entry.model === selectedModel || entry.id === selectedModel)?.model;
  const configuredHostedModel = models.find((entry) => entry.model === config.model || entry.id === config.model)?.model;
  const effectiveModel = customProvider
    ? preferences?.localModel || ''
    : selectedHostedModel || configuredHostedModel || models.find((model) => model.isDefault)?.model || models[0]?.model || '';
  const effectiveLocalProvider = preferences?.localModelProvider ?? 'ollama';
  const desiredModelProvider = customProvider ? effectiveLocalProvider : 'openai';
  const effectiveLocalContextWindow = localContextWindowFor(preferences, effectiveLocalProvider, effectiveModel);
  useEffect(() => {
    if (!customProvider || !effectiveModel) {
      setLiveLocalContextWindow(undefined);
      return;
    }
    let cancelled = false;
    let checking = false;
    setLiveLocalContextWindow(undefined);
    const refreshProviderWindow = async () => {
      if (checking) return;
      checking = true;
      try {
        const { contextWindow } = await window.hexa.detectLocalModelContext({ provider: effectiveLocalProvider, model: effectiveModel });
        if (cancelled || !contextWindow) return;
        setLiveLocalContextWindow(contextWindow);
        if (contextWindow === effectiveLocalContextWindow && contextWindow === Number(config?.model_context_window)) return;
        const key = localContextPreferenceKey(effectiveLocalProvider, effectiveModel);
        const next = await window.hexa.setPreferences({
          localModelContextWindows: { ...(preferences?.localModelContextWindows ?? {}), [key]: contextWindow },
        });
        if (cancelled) return;
        setPreferences(next);
        await window.hexa.request('config/batchWrite', {
          edits: [{ keyPath: 'model_context_window', value: contextWindow, mergeStrategy: 'replace' }],
          reloadUserConfig: true,
        });
        if (!cancelled) setConfig((current: any) => ({ ...current, model_context_window: contextWindow }));
      } catch {
        // Keep the last confirmed live value during a transient provider read
        // failure; never substitute a cloud/configured context window.
      } finally {
        checking = false;
      }
    };
    void refreshProviderWindow();
    const timer = window.setInterval(() => void refreshProviderWindow(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [customProvider, effectiveModel, effectiveLocalProvider, effectiveLocalContextWindow, config?.model_context_window]);
  useEffect(() => {
    if (customProvider || config?.model_context_window == null || hostedContextCleanupRef.current) return;
    let cancelled = false;
    hostedContextCleanupRef.current = true;
    void window.hexa.request('config/batchWrite', {
      edits: [{ keyPath: 'model_context_window', value: null, mergeStrategy: 'replace' }],
      reloadUserConfig: true,
    }).then(async () => {
      if (cancelled) return;
      setConfig((current: any) => {
        const { model_context_window: _localContextWindow, ...hostedConfig } = current;
        return hostedConfig;
      });
      setActiveThread((current) => {
        if (!current) return current;
        delete tokenUsageByThreadRef.current[current.id];
        const next = { ...current, tokenUsage: undefined };
        activeThreadRef.current = next;
        return next;
      });
      await window.hexa.restartEngine();
    }).catch(() => undefined).finally(() => {
      hostedContextCleanupRef.current = false;
    });
    return () => { cancelled = true; };
  }, [customProvider, config?.model_context_window]);
  const activeModel = customProvider ? undefined : models.find((entry) => entry.model === effectiveModel || entry.id === effectiveModel);
  const rawCatalogEfforts = (activeModel as any)?.supportedReasoningEfforts ?? (activeModel as any)?.supported_reasoning_efforts ?? [];
  const catalogEfforts = rawCatalogEfforts.map((entry: any) => entry.reasoningEffort ?? entry.reasoning_effort ?? entry).filter(Boolean);
  // Hosted OpenAI models expose the native `none` effort as Light in the
  // first-party selector even when model/list omits it. Keep every other
  // effort catalog-driven and restore only that shared native option.
  const effectiveCatalogEfforts = activeModel && !catalogEfforts.includes('none')
    ? ['none', ...catalogEfforts]
    : catalogEfforts;
  // Never advertise guessed reasoning levels for a catalog-backed model (or
  // for local providers whose catalog reports none).
  const effortOptions = activeModel
    ? effectiveCatalogEfforts
    : customProvider
      ? ['minimal', 'low', 'medium', 'high']
      : [];
  const selectedReasoningEffort = resolveReasoningEffort(reasoningEffort, effortOptions);
  const displayModelLabel = customProvider ? 'Custom' : activeModel?.displayName || effectiveModel || 'Model';
  const isTurnRunning = Boolean(activeThread?.turns?.some((turn) => turn.status === 'inProgress'));
  const backgroundAgentItems = (activeThread?.turns ?? []).flatMap((turn: any) => turn.items ?? []).filter((item: any) => ['collabToolCall', 'collabAgentToolCall', 'subAgentActivity'].includes(item?.type) && isItemInProgress(item));
  const refreshPermissionProfiles = useCallback(async (folder?: string) => {
    if (status.phase !== 'ready') return;
    const response = await window.hexa.request<{ data: PermissionProfile[] }>('permissionProfile/list', {
      limit: 100,
      ...(folder ? { cwd: folder } : {}),
    });
    setPermissionProfiles(response.data ?? []);
    if (response.data?.length && !response.data.some((entry) => entry.id === selectedPermission && entry.allowed)) {
      const preferred = response.data.find((entry) => entry.id === ':workspace' && entry.allowed) ?? response.data.find((entry) => entry.allowed);
      if (preferred) setSelectedPermission(preferred.id);
    }
  }, [selectedPermission, status.phase]);

  const refreshThreads = useCallback(async () => {
    if (status.phase !== 'ready') return;
    const response = await window.hexa.request<ThreadListResponse>('thread/list', {
      limit: 100,
      archived: showArchived,
      searchTerm: searchTerm || null,
      sortDirection: 'desc',
    });
    setThreads((current) => {
      const currentById = new Map(current.map((thread) => [thread.id, thread]));
      const refreshed = (response.data ?? []).map(normalizeThread).map((thread) => {
        const existing = currentById.get(thread.id);
        if (!existing) return thread;
        return {
          ...existing,
          ...thread,
          name: thread.name ?? existing.name,
          title: thread.title ?? existing.title,
          preview: thread.preview ?? existing.preview,
        };
      });
      const refreshedIds = new Set(refreshed.map((thread) => thread.id));
      const pending = current.filter((thread) => {
        if (refreshedIds.has(thread.id)) return false;
        if (thread.id.startsWith('local-thread-')) return true;
        return thread.id === activeThreadRef.current?.id
          && Boolean(thread.turns?.some((turn) => turn.status === 'inProgress'));
      });
      return [...pending, ...refreshed];
    });
    setThreadCursor(response.nextCursor ?? null);
  }, [searchTerm, showArchived, status.phase]);

  const loadCanonicalTurns = useCallback(async (threadId: string) => {
    const turns: any[] = [];
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    do {
      const response: { data?: any[]; nextCursor?: string | null } = await window.hexa.request('thread/turns/list', {
        threadId,
        limit: 100,
        sortDirection: 'asc',
        itemsView: 'full',
        ...(cursor ? { cursor } : {}),
      });
      turns.push(...(response.data ?? []).map(normalizeTurn));
      const nextCursor: string | null = response.nextCursor ?? null;
      if (!nextCursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    } while (cursor);
    return turns;
  }, []);

  const loadBootstrap = useCallback(async () => {
    const [threadResult, modelResult, permissionResult, configResult, prefResult] = await Promise.all([
      window.hexa.request<ThreadListResponse>('thread/list', { limit: 100, archived: false, sortDirection: 'desc' }),
      window.hexa.request<{ data: Model[] }>('model/list', { includeHidden: false, limit: 100 }),
      window.hexa.request<{ data: PermissionProfile[] }>('permissionProfile/list', { limit: 100 }),
      window.hexa.request<any>('config/read', { includeLayers: false }),
      window.hexa.getPreferences(),
    ]);
    setThreads((threadResult.data ?? []).map(normalizeThread));
    setThreadCursor(threadResult.nextCursor ?? null);
    setModels(modelResult.data ?? []);
    const availablePermissions = permissionResult.data ?? [];
    setPermissionProfiles(availablePermissions);
    if (!availablePermissions.some((entry) => entry.id === selectedPermission && entry.allowed)) {
      const preferredPermission = availablePermissions.find((entry) => entry.id === ':workspace' && entry.allowed)
        ?? availablePermissions.find((entry) => entry.allowed);
      if (preferredPermission) setSelectedPermission(preferredPermission.id);
    }
    const effective = configResult?.config ?? configResult ?? {};
    setConfig(effective);
    const lowTier = modelResult.data?.find((entry) => /luna/i.test(entry.model || entry.id))
      ?? modelResult.data?.find((entry) => /(mini|nano|low)/i.test(entry.model || entry.id));
    setSelectedModel(prefResult.savedModel ?? effective.model ?? lowTier?.model ?? modelResult.data?.find((entry) => entry.isDefault)?.model ?? '');
    setReasoningEffort(prefResult.savedReasoningEffort ?? effective.model_reasoning_effort ?? lowTier?.defaultReasoningEffort ?? 'low');
    threadComposerDraftsRef.current = prefResult.threadComposerDrafts ?? {};
    setComposer(threadComposerDraftsRef.current.__new__ ?? prefResult.composerDraft ?? '');
    setPreferences(prefResult);
  }, []);

  const refreshPlugins = useCallback(async (forceRefetch = false) => {
    if (status.phase !== 'ready') return;
    try {
      const response = await window.hexa.request<any>('plugin/list', {
        cwds: cwd ? [cwd] : null,
        marketplaceKinds: ['local', 'vertical'],
        forceRefetch,
      });
      const flattened: PluginSummary[] = (response.marketplaces ?? []).flatMap((marketplace: any) =>
        (marketplace.plugins ?? []).map((plugin: any) => ({
          ...plugin,
          marketplaceName: marketplace.name,
          marketplacePath: marketplace.path ?? null,
        })),
      );
      setPlugins([...new Map(flattened.map((plugin) => [plugin.id, plugin])).values()]);
    } catch {
      // Plugin catalogs can be unavailable for signed-out/local accounts. Keep
      // the rest of the shell usable and allow an explicit refresh later.
    }
  }, [cwd, status.phase]);

  useEffect(() => {
    let unsubStatus = () => {};
    let unsubNotification = () => {};
    let unsubRequest = () => {};
    void window.hexa.getStatus().then(setStatus);
    unsubStatus = window.hexa.onStatus(setStatus);
    unsubNotification = window.hexa.onNotification((event) => {
      const eventParams: any = event.params ?? {};
      if (event.method === 'thread/tokenUsage/updated') {
        const usageThreadId = eventParams.threadId ?? eventParams.thread_id;
        if (usageThreadId) tokenUsageByThreadRef.current[usageThreadId] = eventParams.tokenUsage ?? eventParams.usage ?? eventParams;
      }
      if (event.method === 'serverRequest/resolved') {
        const requestId = eventParams.requestId ?? eventParams.request_id;
        if (requestId != null) setApprovals((current) => current.filter((entry) => String(entry.id) !== String(requestId)));
      }
      const inferredTurnId = [...(activeThreadRef.current?.turns ?? [])].reverse().find((turn) => turn.status === 'inProgress')?.id;
      const eventTurnId = eventParams.turnId ?? eventParams.turn_id ?? eventParams.turn?.id ?? eventParams.item?.turnId ?? eventParams.item?.turn_id ?? inferredTurnId;
      if (eventTurnId && event.method.startsWith('item/reasoning/')) finishDeclaredSkillReads(eventTurnId);
      if (event.method === 'rawResponseItem/completed' && eventTurnId) {
        const rawItem = eventParams.item ?? {};
        const rawType = String(rawItem.type ?? '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
        if (rawType === 'custom_tool_call') {
          const callId = String(rawItem.callId ?? rawItem.call_id ?? rawItem.id ?? '');
          if (callId) {
            const eventTurn = activeThreadRef.current?.turns?.find((turn) => turn.id === eventTurnId);
            const afterItemId = [...(eventTurn?.items ?? [])].reverse().find((entry: any) => entry.type === 'agentMessage')?.id;
            const skillSlug = skillSlugFromToolInput(rawItem.input ?? rawItem.arguments ?? '');
            const declaredItem = skillSlug
              ? (eventTurn?.items ?? []).find((entry: any) => entry._shellDeclaredSkill === skillSlug)
              : null;
            const displayId = declaredItem?.id ?? callId;
            const item = {
              id: displayId,
              type: 'dynamicToolCall',
              namespace: rawItem.namespace ?? null,
              tool: rawItem.name ?? rawItem.tool ?? 'tool',
              arguments: rawItem.input ?? rawItem.arguments ?? '',
              status: 'inProgress',
              afterItemId,
              _shellRawCallId: callId,
              _shellRawCustomTool: true,
            };
            rawCustomToolIdsRef.current[callId] = displayId;
            const eventThreadId = eventParams.threadId ?? eventParams.thread_id ?? activeThreadRef.current?.id;
            if (eventThreadId) rememberRawCustomTool(eventThreadId, eventTurnId, item);
            presentSandboxPreflightForNativeTool(eventTurnId);
            presentLiveTool(eventTurnId, item);
          }
        } else if (rawType === 'custom_tool_call_output') {
          const callId = String(rawItem.callId ?? rawItem.call_id ?? '');
          if (callId) {
            const displayId = rawCustomToolIdsRef.current[callId] ?? callId;
            const eventThreadId = eventParams.threadId ?? eventParams.thread_id ?? activeThreadRef.current?.id;
            if (eventThreadId) rememberRawCustomTool(eventThreadId, eventTurnId, { id: displayId, status: rawItem.error || rawItem.success === false ? 'failed' : 'completed' });
            if (String(displayId).startsWith('local-skill-read-')) finishDeclaredSkillReads(eventTurnId, displayId);
            else completeLiveTool(eventTurnId, displayId);
            delete rawCustomToolIdsRef.current[callId];
          }
        }
      } else if (eventTurnId && isGuardianPermissionReviewEvent(event.method)) {
        const review = guardianPermissionReviewItem(event, isGuardianPermissionReviewComplete(event.method) ? 'completed' : 'inProgress');
        if (isGuardianPermissionReviewComplete(event.method)) completeLiveTool(eventTurnId, review.id);
        else presentLiveTool(eventTurnId, review);
      } else if (event.method === 'item/started' && eventTurnId) {
        const startedItem = { ...(eventParams.item ?? eventParams), status: 'inProgress', _shellStartedAt: performance.now() };
        if (startedItem.type === 'reasoning' || startedItem.type === 'agentMessage') {
          finishDeclaredSkillReads(eventTurnId);
        }
        // A subsequent assistant dialog means the short preflight has already
        // returned, even when the following tool only reports progress rather
        // than a standard item/started lifecycle event.
        if (startedItem.type === 'agentMessage' && sandboxPreflightIdsRef.current[eventTurnId]) {
          finishSandboxPreflight(eventTurnId);
        }
        if (isToolItem(startedItem)) {
          presentSandboxPreflightForNativeTool(eventTurnId);
          presentLiveTool(eventTurnId, startedItem);
        }
      } else if (eventTurnId && isToolProgressEvent(event.method)) {
        presentSandboxPreflightForNativeTool(eventTurnId);
        presentLiveTool(eventTurnId, { ...toolFromProgressEvent(event), status: 'inProgress' });
      } else if (event.method === 'item/completed' && eventTurnId) {
        const completedItem = eventParams.item;
        const completedId = completedItem?.id ?? eventParams.itemId;
        const completedSkillSlug = completedItem?.type === 'dynamicToolCall' ? skillSlugFromToolInput(completedItem.arguments) : null;
        const completedTurn = activeThreadRef.current?.turns?.find((turn) => turn.id === eventTurnId);
        const declaredSkillItem = completedSkillSlug
          ? (completedTurn?.items ?? []).find((entry: any) => entry._shellDeclaredSkill === completedSkillSlug)
          : null;
        const displayCompletedId = declaredSkillItem?.id ?? rawCustomToolIdsRef.current[String(completedId ?? '')] ?? completedId;
        const displayCompletedItem = declaredSkillItem ? { ...completedItem, id: displayCompletedId } : completedItem;
        if (completedItem?.type === 'agentMessage') {
          if (sandboxPreflightIdsRef.current[eventTurnId]) {
            // Some providers only send completed dialogs. A follow-up dialog
            // is the native completion boundary for the preceding preflight.
            finishSandboxPreflight(eventTurnId);
          }
          const showSandboxPreflight = shouldShowSandboxPreflight(completedItem);
          // Commit the dialog through applyServerEvent first, then enqueue the
          // related live activity in deterministic visual order. Previously the
          // skill row could beat the zero-delay sandbox insertion into the queue.
          window.setTimeout(() => {
            if (showSandboxPreflight) beginSandboxPreflight(eventTurnId, completedItem.id);
            beginDeclaredSkillRead(eventTurnId, completedItem);
            if (showSandboxPreflight) window.setTimeout(() => finishSandboxPreflight(eventTurnId), 900);
          }, 0);
        }
        if (isToolItem(displayCompletedItem)) {
          presentSandboxPreflightForNativeTool(eventTurnId);
          // Some integrations only emit the completed lifecycle item. Present
          // it as active first so fast file writes are still visible in the
          // Thinking slot before settling into transcript history.
          presentLiveTool(eventTurnId, {
            ...displayCompletedItem,
            status: 'inProgress',
            _shellCompletedStatus: displayCompletedItem.status ?? 'completed',
          });
        }
        if (declaredSkillItem) finishDeclaredSkillReads(eventTurnId, displayCompletedId);
        else completeLiveTool(eventTurnId, displayCompletedId);
        if (completedItem?.type === 'fileChange' && completedItem.status === 'completed' && Array.isArray(completedItem.changes)) {
          // Deleted files are supposed to be absent. Only verify files that the
          // engine says should exist, and resolve relative paths from the thread cwd.
          const paths = completedItem.changes
            .filter((change: any) => fileChangeAction(change) !== 'Deleted')
            .map((change: any) => {
              const kind = change?.kind;
              const movePath = kind && typeof kind === 'object' && kind.type === 'update'
                ? (kind.move_path ?? kind.movePath)
                : null;
              return String(movePath ?? change?.path ?? '');
            })
            .filter(Boolean);
          void window.hexa.verifyFilePaths(paths, activeThreadRef.current?.cwd || cwd).then((verified) => {
            const missing = paths.filter((filePath: string) => !verified[filePath]);
            if (!missing.length) return;
            setActiveThread((current) => {
              if (!current) return current;
              const turns = (current.turns ?? []).map((turn: any) => turn.id !== eventTurnId ? turn : {
                ...turn,
                items: (turn.items ?? []).map((item: any) => item.id !== completedId ? item : {
                  ...item,
                  status: 'failed',
                  error: `No file was written: ${missing.join(', ')}`,
                  changes: (item.changes ?? []).map((change: any) => ({ ...change, verified: Boolean(verified[change.path]) })),
                }),
              });
              const next = { ...current, turns };
              activeThreadRef.current = next;
              return next;
            });
          }).catch(() => undefined);
        }
      } else if (event.method === 'turn/completed' && eventTurnId) {
        finishSandboxPreflight(eventTurnId);
        // A declared skill read is shell-owned and may not receive a matching
        // engine item/completed event. Finalize it with the turn so it moves
        // from the live row into the persistent "Worked" history.
        finishDeclaredSkillReads(eventTurnId);
        window.clearTimeout(liveToolTimersRef.current[eventTurnId]);
        delete liveToolTimersRef.current[eventTurnId];
        delete liveToolQueuesRef.current[eventTurnId];
        setLiveTools((current) => {
          if (!current[eventTurnId]) return current;
          const next = { ...current };
          delete next[eventTurnId];
          return next;
        });
      }
      setActiveThread((current) => {
        const base = current ?? activeThreadRef.current;
        if (!base) return current;
        const next = applyServerEvent(base, event);
        activeThreadRef.current = next;
        return next;
      });
      if (event.method === 'turn/completed') {
        const params: any = event.params ?? {};
        const threadId = params.threadId ?? params.thread?.id;
        if (threadId) {
          window.setTimeout(() => {
            void window.hexa.request<any>('thread/read', { threadId, includeTurns: true }).then((response) => {
              setActiveThread((current) => {
                if (!current || current.id !== threadId) return current;
                // The canonical engine transcript does not contain shell-owned
                // skill checks. Reapply them after the completion refresh so
                // the refresh cannot erase them before CompletedWork renders.
                const next = restoreRawCustomTools(mergeThread(current, response.thread ?? response));
                activeThreadRef.current = next;
                return next;
              });
            }).catch(() => undefined);
          }, 250);
        }
      }
      if (event.method === 'account/login/completed' || event.method === 'account/updated') {
        if (eventParams.account || eventParams.user || eventParams.profile) setAccount(eventParams.account ?? eventParams.user ?? eventParams.profile);
        void refreshAccount();
        if (event.method === 'account/login/completed') setAccountSwitcherOpen(false);
      }
      if (event.method === 'account/rateLimits/updated') {
        const params: any = event.params ?? {};
        const incoming = params.rateLimits ?? params.rate_limits;
        setUsageStats((current: any) => {
          if (!current || !incoming) return current;
          const limits = current.limits ?? {};
          const incomingId = String(incoming.limitId ?? incoming.limit_id ?? '').toLowerCase();
          const isPrimaryBucket = !incomingId || incomingId === 'codex';
          if (isPrimaryBucket) {
            return {
              ...current,
              limits: { ...limits, rateLimits: incoming },
              refreshedAt: Date.now(),
            };
          }
          const byId = limits.rateLimitsByLimitId ?? limits.rate_limits_by_limit_id ?? {};
          return {
            ...current,
            limits: {
              ...limits,
              rateLimitsByLimitId: { ...byId, [incomingId]: incoming },
            },
            refreshedAt: Date.now(),
          };
        });
      }
      if (event.method.startsWith('plugin/')) void refreshPlugins();
      if (event.method === 'windowsSandbox/setupCompleted') {
        setSandboxSetup(false);
        void window.hexa.setPreferences({ sandboxSetupComplete: Boolean(eventParams.success) }).then(setPreferences);
      }
      if (
        event.method === 'thread/started' ||
        event.method === 'thread/archived' ||
        event.method === 'thread/deleted' ||
        event.method === 'thread/unarchived' ||
        event.method === 'thread/name/updated' ||
        event.method === 'thread/status/changed'
      ) {
        window.setTimeout(() => void refreshThreads(), 80);
      }
    });
    unsubRequest = window.hexa.onServerRequest((request) => {
      if (request.method === 'currentTime/read') {
        void window.hexa.respond(request.id, { currentTimeAt: Math.floor(Date.now() / 1000) });
        return;
      }
      if (request.method === 'item/tool/call') {
        void handleBuiltInBrowserCall(request.params).then(
          (text) => window.hexa.respond(request.id, { contentItems: [{ type: 'inputText', text }], success: true }),
          (failure) => window.hexa.respond(request.id, { contentItems: [{ type: 'inputText', text: failure instanceof Error ? failure.message : String(failure) }], success: false }),
        );
        return;
      }
      setApprovals((current) => [...current, { ...request, receivedAt: Date.now() }]);
    });
    return () => {
      unsubStatus();
      unsubNotification();
      unsubRequest();
    };
  }, [beginDeclaredSkillRead, beginSandboxPreflight, completeLiveTool, finishDeclaredSkillReads, finishSandboxPreflight, handleBuiltInBrowserCall, loadCanonicalTurns, presentLiveTool, presentSandboxPreflightForNativeTool, refreshPlugins, refreshThreads]);

  useEffect(() => {
    if (status.phase === 'ready') void loadBootstrap();
  }, [status.phase, loadBootstrap]);

  useEffect(() => {
    if (window.hexa.platform !== 'win32' || status.phase !== 'ready') return;
    void window.hexa.request<any>('windowsSandbox/readiness').then((readiness) => {
      // The engine is authoritative here. Keep the saved UI state synchronized
      // in both directions so a ready sandbox is not shown as broken and a stale
      // ready flag cannot hide a required setup.
      const ready = String(readiness?.status ?? '').toLowerCase() === 'ready';
      void window.hexa.setPreferences({ sandboxSetupComplete: ready }).then(setPreferences);
    }).catch(() => undefined);
  }, [status.phase]);

  const refreshAccount = useCallback(async () => {
    if (status.phase !== 'ready' || !preferences) return;
    if (preferences.accountMode === 'local') {
      setAccount(null);
      return;
    }
    // Refresh the persisted session on startup so accounts survive app
    // restarts instead of appearing signed out until the user signs in again.
    const response = await window.hexa.request<any>('account/read', { refreshToken: true }).catch(() => null);
    const fallback = response?.account ? response : await window.hexa.request<any>('account/read', { refreshToken: false }).catch(() => null);
    setAccount(normalizeAccountPayload(fallback));
  }, [status.phase, preferences?.accountMode]);

  useEffect(() => { void refreshAccount(); }, [refreshAccount]);

  useEffect(() => { void refreshPlugins(); }, [refreshPlugins]);

  useEffect(() => {
    if (!preferences) return;
    const draftKey = activeThread?.id ?? '__new__';
    threadComposerDraftsRef.current[draftKey] = composer;
    const timer = window.setTimeout(() => {
      void window.hexa.setPreferences({ composerDraft: composer, threadComposerDrafts: { ...threadComposerDraftsRef.current } }).then(setPreferences);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeThread?.id, composer, preferences !== null]);

  useEffect(() => {
    if (status.phase !== 'ready') return;
    const syncConfig = () => {
      void Promise.all([
        window.hexa.request<any>('config/read', { includeLayers: false }),
        window.hexa.getPreferences(),
      ]).then(([read, saved]) => {
        const effective = read?.config ?? read ?? {};
        setConfig(effective);
        const threadSelection = activeThreadRef.current?.id ? saved.threadModelSelections?.[activeThreadRef.current.id] : undefined;
        setSelectedModel(threadSelection?.model ?? saved.savedModel ?? effective.model ?? '');
        setReasoningEffort(threadSelection?.reasoningEffort ?? saved.savedReasoningEffort ?? effective.model_reasoning_effort ?? 'low');
        setPreferences(saved);
      }).catch(() => undefined);
    };
    window.addEventListener('focus', syncConfig);
    return () => window.removeEventListener('focus', syncConfig);
  }, [status.phase]);

  useEffect(() => {
    const timer = setTimeout(() => void refreshThreads(), 180);
    return () => clearTimeout(timer);
  }, [refreshThreads]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (feedRef.current) feedRef.current.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, [activeThread]);

  useEffect(() => {
    const threadId = activeThread?.id;
    if (!threadId || threadId.startsWith('local-thread-') || !isTurnRunning || status.phase !== 'ready') return;
    let disposed = false;
    let requestPending = false;
    const syncActiveTurn = async () => {
      if (requestPending) return;
      requestPending = true;
      try {
        const response = await window.hexa.request<any>('thread/read', { threadId, includeTurns: true });
        if (disposed) return;
        const canonical = normalizeThread(response.thread ?? response);
        const liveTurn = [...(canonical.turns ?? [])].reverse().find((turn: any) => turn.status === 'inProgress');
        if (liveTurn?.id) {
          // Recover lifecycle starts that completed between notification frames.
          // The app-server transcript is authoritative even for very fast disk IO.
          for (const tool of (liveTurn.items ?? []).filter(isToolItem)) {
            const key = `${liveTurn.id}:${tool.id}`;
            if (polledToolIdsRef.current.has(key)) continue;
            polledToolIdsRef.current.add(key);
            presentLiveTool(liveTurn.id, {
              ...tool,
              status: isItemInProgress(tool) ? tool.status : 'inProgress',
              _shellCompletedStatus: isItemInProgress(tool) ? undefined : tool.status,
            });
            if (!isItemInProgress(tool)) completeLiveTool(liveTurn.id, tool.id);
          }
        }
        setActiveThread((current) => {
          if (!current || current.id !== threadId) return current;
          // Polling is only a safety net for lifecycle notifications. Do not
          // replace streaming dialog with a slightly older canonical snapshot;
          // that caused internal/partial message text to flash for one frame.
          const next = mergePolledNativeState(current, canonical);
          activeThreadRef.current = next;
          return next;
        });
      } catch {
        // Live notifications remain authoritative when an active thread cannot
        // be read yet (for example during the first few milliseconds of start).
      } finally {
        requestPending = false;
      }
    };
    void syncActiveTurn();
    const timer = window.setInterval(syncActiveTurn, 300);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeThread?.id, completeLiveTool, isTurnRunning, presentLiveTool, status.phase]);

  async function loadMoreThreads() {
    if (!threadCursor || status.phase !== 'ready') return;
    const response = await window.hexa.request<ThreadListResponse>('thread/list', {
      limit: 100,
      cursor: threadCursor,
      archived: showArchived,
      searchTerm: searchTerm || null,
      sortDirection: 'desc',
    });
    setThreads((current) => {
      const known = new Set(current.map((thread) => thread.id));
      return [...current, ...(response.data ?? []).map(normalizeThread).filter((thread) => !known.has(thread.id))];
    });
    setThreadCursor(response.nextCursor ?? null);
  }

  async function newThread() {
    threadComposerDraftsRef.current[activeThread?.id ?? '__new__'] = composer;
    // There is only one unsent new-chat surface. Clicking New chat again while
    // already there returns to that same draft instead of discarding/recreating it.
    if (!activeThread) return;
    const current = navigationRef.current;
    const currentIndex = navigationIndexRef.current;
    if (current[currentIndex] !== '__new__') {
      const next = [...current.slice(0, currentIndex + 1), '__new__'];
      navigationRef.current = next;
      navigationIndexRef.current = next.length - 1;
      setNavigation(next);
      setNavigationIndex(next.length - 1);
    }
    setActiveThread(null);
    const nextDraft = threadComposerDraftsRef.current.__new__ ?? '';
    setComposer(nextDraft);
    setAttachments([]);
    setPluginMentions([]);
    setComposerModes((['goal', 'plan'] as const).filter((mode) => nextDraft.includes(`$${mode}`)));
    setApprovals([]);
    setCommandMenuOpen(false);
  }

  async function openThread(thread: ThreadView, recordNavigation = true) {
    // A just-sent new chat is already active while thread/start resolves. Its
    // optimistic sidebar row is not resumable until it receives a native ID.
    if (thread.id.startsWith('local-thread-')) return;
    const sourceWasBlank = !activeThread;
    threadComposerDraftsRef.current[activeThread?.id ?? '__new__'] = composer;
    const response = await window.hexa.request<any>('thread/resume', {
      threadId: thread.id,
      excludeTurns: true,
      model: effectiveModel || null,
      modelProvider: desiredModelProvider,
      ...(cwd ? { cwd } : {}),
      permissions: selectedPermission || null,
      approvalPolicy: approvalPolicyForPermission(selectedPermission, config.approval_policy),
    });
    const resumed = normalizeThread(response.thread ?? response);
    const turns = await loadCanonicalTurns(thread.id);
    const restoredUsage = tokenUsageByThreadRef.current[thread.id];
    const restoredThread = restoreRawCustomTools(restoreSandboxPreflights({ ...resumed, turns, ...(restoredUsage ? { tokenUsage: restoredUsage } : {}) }));
    for (const turn of restoredThread.turns ?? []) {
      for (const item of turn.items ?? []) {
        if (item._shellPreflight) sandboxPreflightIdsRef.current[turn.id] = item.id;
      }
    }
    setActiveThread(restoredThread);
    const nextDraft = threadComposerDraftsRef.current[thread.id] ?? '';
    setComposer(nextDraft);
    setComposerModes((['goal', 'plan'] as const).filter((mode) => nextDraft.includes(`$${mode}`)));
    const savedSelection = preferences?.threadModelSelections?.[thread.id];
    const selectionMatchesProvider = !savedSelection?.provider || savedSelection.provider === desiredModelProvider;
    if (!customProvider && selectionMatchesProvider && savedSelection?.model && models.some((entry) => entry.model === savedSelection.model || entry.id === savedSelection.model)) {
      setSelectedModel(savedSelection.model);
    } else if (!customProvider && resumed.model && models.some((entry) => entry.model === resumed.model || entry.id === resumed.model)) {
      setSelectedModel(resumed.model);
    }
    if (selectionMatchesProvider && savedSelection?.reasoningEffort) setReasoningEffort(savedSelection.reasoningEffort);
    const nextCwd = response.thread?.cwd ?? thread.cwd ?? cwd;
    setCwd(nextCwd);
    await refreshPermissionProfiles(nextCwd);
    setApprovals([]);
    if (recordNavigation) {
      const current = navigationRef.current;
      const currentIndex = navigationIndexRef.current;
      if (current[currentIndex] !== thread.id) {
        const base = currentIndex < 0 && sourceWasBlank ? ['__new__'] : current.slice(0, currentIndex + 1);
        const next = [...base, thread.id];
        navigationRef.current = next;
        navigationIndexRef.current = next.length - 1;
        setNavigation(next);
        setNavigationIndex(next.length - 1);
      }
    }
  }

  async function navigateHistory(offset: -1 | 1) {
    const nextIndex = navigationIndexRef.current + offset;
    const threadId = navigationRef.current[nextIndex];
    if (!threadId) return;
    if (threadId === '__new__') {
      threadComposerDraftsRef.current[activeThread?.id ?? '__new__'] = composer;
      setActiveThread(null);
      const nextDraft = threadComposerDraftsRef.current.__new__ ?? '';
      setComposer(nextDraft);
      setAttachments([]);
      setPluginMentions([]);
      setComposerModes((['goal', 'plan'] as const).filter((mode) => nextDraft.includes(`$${mode}`)));
    } else {
      const thread = threads.find((entry) => entry.id === threadId);
      if (!thread) return;
      await openThread(thread, false);
    }
    navigationIndexRef.current = nextIndex;
    setNavigationIndex(nextIndex);
  }

  function removeThreadFromNavigation(threadId: string, moveToBlank: boolean) {
    const currentId = navigationRef.current[navigationIndexRef.current];
    const filtered = navigationRef.current.filter((id) => id !== threadId && id !== '__new__');
    const next = moveToBlank ? [...filtered, '__new__'] : filtered;
    const nextIndex = moveToBlank ? next.length - 1 : next.length ? Math.max(0, next.lastIndexOf(currentId)) : -1;
    navigationRef.current = next;
    navigationIndexRef.current = nextIndex;
    setNavigation(next);
    setNavigationIndex(nextIndex);
    if (moveToBlank) {
      activeThreadRef.current = null;
      setActiveThread(null);
      const draft = threadComposerDraftsRef.current.__new__ ?? '';
      setComposer(draft);
      setComposerModes((['goal', 'plan'] as const).filter((mode) => draft.includes(`$${mode}`)));
      setAttachments([]);
      setPluginMentions([]);
      setApprovals([]);
    }
  }

  async function archiveThread(thread: ThreadView) {
    try {
      await window.hexa.request('thread/archive', { threadId: thread.id });
      const wasActive = activeThread?.id === thread.id;
      removeThreadFromNavigation(thread.id, wasActive);
      await refreshThreads();
      setChatNotice({ kind: 'success', action: 'archive', message: 'Chat archived successfully' });
    } catch (error) {
      setChatNotice({ kind: 'error', action: 'archive', message: `Could not archive chat: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  async function deleteThread(thread: ThreadView) {
    setPendingDelete(null);
    setChatNotice(null);
    try {
      const result = await window.hexa.deleteThread(thread.id);
      if (!result.ok) throw new Error(result.error || 'Unknown deletion error');
      const wasActive = activeThread?.id === thread.id;
      removeThreadFromNavigation(thread.id, wasActive);
      rememberDeletedThread(thread.id);
      setThreads((current) => current.filter((entry) => entry.id !== thread.id));
      setChatNotice({ kind: 'success', action: 'delete', message: 'Chat deleted successfully' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setChatNotice({ kind: 'error', action: 'delete', message: message.includes('forked history still references it')
        ? 'Delete the newer forked chat first, then delete this original chat.'
        : message.includes('active writer')
          ? 'That chat is open in another Shell process. Close it there, then try again.'
          : `Could not delete chat: ${message}` });
    }
  }

  async function unarchiveThread(thread: ThreadView) {
    try {
      await window.hexa.request('thread/unarchive', { threadId: thread.id });
      await refreshThreads();
      setChatNotice({ kind: 'success', action: 'restore', message: 'Chat restored successfully' });
    } catch (error) {
      setChatNotice({ kind: 'error', action: 'restore', message: `Could not restore chat: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  function renameThread() {
    if (!activeThread) return;
    setCommandMenuOpen(false);
    setRenameTarget(activeThread);
  }

  async function saveThreadName(name: string) {
    if (!renameTarget) return;
    await window.hexa.request('thread/name/set', { threadId: renameTarget.id, name });
    setActiveThread((thread) => thread?.id === renameTarget.id ? { ...thread, name } : thread);
    setThreads((current) => current.map((thread) => thread.id === renameTarget.id ? { ...thread, name } : thread));
    setRenameTarget(null);
    await refreshThreads();
  }

  async function chooseFolder() {
    const selected = await window.hexa.chooseDirectory();
    if (selected) {
      setCwd(selected);
      await refreshPermissionProfiles(selected);
    }
  }

  async function attachFiles() {
    const selected = await window.hexa.chooseFiles();
    if (!selected.length) return;
    const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);
    const audioExtensions = new Set(['wav', 'mp3', 'm4a', 'flac', 'ogg', 'aac']);
    const incoming = selected.map((filePath) => {
      const normalized = filePath.replaceAll('\\', '/');
      const name = normalized.split('/').at(-1) || filePath;
      const extension = name.includes('.') ? name.split('.').at(-1)?.toLowerCase() || '' : '';
      const kind: 'image' | 'audio' | 'file' = imageExtensions.has(extension)
        ? 'image'
        : audioExtensions.has(extension)
          ? 'audio'
          : 'file';
      return { path: filePath, name, kind };
    });
    setAttachments((current) => {
      const seen = new Set(current.map((entry) => entry.path));
      return [...current, ...incoming.filter((entry) => !seen.has(entry.path))];
    });
  }

  function choosePermission(profile: PermissionProfile) {
    if (profile.id === ':danger-full-access') {
      setPermissionMenuOpen(false);
      setFullAccessWarningOpen(true);
      return;
    }
    setSelectedPermission(profile.id);
    setPermissionMenuOpen(false);
  }

  function usePlugin(plugin: PluginSummary) {
    setPluginMentions((current) => current.some((entry) => entry.id === plugin.id) ? current : [...current, plugin]);
    setComposer((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}$${plugin.name} `);
    setAddMenuOpen(false);
  }

  function useComposerMode(mode: 'goal' | 'plan') {
    setComposerModes((current) => current.includes(mode) ? current : [...current, mode]);
    setComposer((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}$${mode} `);
    setAddMenuOpen(false);
  }

  async function compactConversation() {
    if (!activeThread || activeThread.id.startsWith('local-thread-') || sending || isTurnRunning) return;
    const commandItem = { id: `local-compact-${crypto.randomUUID()}`, type: 'userMessage', content: [{ type: 'text', text: '/compact' }], createdAt: Date.now(), optimistic: true };
    setActiveThread((current) => {
      if (!current) return current;
      const turns = [...(current.turns ?? [])];
      const last = turns.at(-1);
      if (last) turns[turns.length - 1] = { ...last, items: [...(last.items ?? []), commandItem] };
      const next = { ...current, turns };
      activeThreadRef.current = next;
      return next;
    });
    setSending(true);
    try {
      await window.hexa.request('thread/compact/start', { threadId: activeThread.id });
    } finally {
      setSending(false);
    }
  }

  function rememberModelSelection(model: string, effort: string) {
    const threadId = activeThreadRef.current?.id;
    const threadModelSelections = {
      ...(preferences?.threadModelSelections ?? {}),
      ...(threadId ? { [threadId]: { model, reasoningEffort: effort, provider: desiredModelProvider } } : {}),
    };
    const nextPreferences = customProvider
      ? { threadModelSelections }
      : { savedModel: model, savedReasoningEffort: effort, threadModelSelections };
    void window.hexa.setPreferences(nextPreferences).then(setPreferences);
  }

  async function installPlugin(plugin: PluginSummary) {
    await window.hexa.request('plugin/install', {
      marketplacePath: plugin.marketplacePath ?? null,
      remoteMarketplaceName: plugin.marketplacePath ? null : plugin.marketplaceName,
      installAttemptId: crypto.randomUUID(),
      pluginName: plugin.name,
    });
    await refreshPlugins(true);
  }

  async function uninstallPlugin(plugin: PluginSummary) {
    await window.hexa.request('plugin/uninstall', { pluginId: plugin.id });
    await refreshPlugins(true);
  }

  async function selectAccountMode(mode: 'openai' | 'local'): Promise<any> {
    const changed = preferences?.accountMode !== mode;
    if (mode === 'openai') hostedContextCleanupRef.current = true;
    let next = await window.hexa.setPreferences({ accountMode: mode });

    if (mode === 'local') {
      // Resolve the actual running local provider at the account boundary.
      // Prefer the user's last provider/model, but fall back to the other
      // supported provider when that is the one currently running.
      const preferredProvider = next.localModelProvider;
      const providerOrder: Array<'ollama' | 'lmstudio'> = [
        preferredProvider,
        preferredProvider === 'ollama' ? 'lmstudio' : 'ollama',
      ];
      let detected: Awaited<ReturnType<typeof window.hexa.detectLocalModels>> | null = null;
      for (const candidate of providerOrder) {
        const result = await window.hexa.detectLocalModels(candidate);
        if (!detected || (detected.error && !result.error)) detected = result;
        if (result.models.length) {
          detected = result;
          break;
        }
      }
      if (detected) {
        const provider = detected.provider;
        const model = detected.models.includes(next.localModel ?? '')
          ? next.localModel
          : detected.models[0] ?? (provider === preferredProvider ? next.localModel : undefined);
        const providerWindows = Object.fromEntries(
          Object.entries(detected.contextWindows).map(([modelName, contextWindow]) => [
            localContextPreferenceKey(provider, modelName),
            contextWindow,
          ]),
        );
        next = await window.hexa.setPreferences({
          accountMode: 'local',
          localModelProvider: provider,
          localModel: model,
          localModelContextWindows: { ...(next.localModelContextWindows ?? {}), ...providerWindows },
        });
      }
    }

    setPreferences(next);
    const provider = mode === 'openai' ? 'openai' : next.localModelProvider;
    const cloudModel = models.find((entry) => entry.model === selectedModel || entry.id === selectedModel)?.model
      ?? models.find((entry) => entry.model === next.savedModel || entry.id === next.savedModel)?.model
      ?? models.find((entry) => entry.isDefault)?.model
      ?? models[0]?.model;
    const targetModel = mode === 'local' ? next.localModel : cloudModel;
    const edits: any[] = [{ keyPath: 'model_provider', value: provider, mergeStrategy: 'replace' }];
    if (mode === 'local') {
      edits.push({ keyPath: 'oss_provider', value: provider, mergeStrategy: 'replace' });
      edits.push({ keyPath: 'model', value: targetModel ?? null, mergeStrategy: 'replace' });
      const localWindow = next.localModel ? localContextWindowFor(next, next.localModelProvider, next.localModel) : undefined;
      edits.push({ keyPath: 'model_context_window', value: localWindow ?? null, mergeStrategy: 'replace' });
    } else {
      edits.push({ keyPath: 'model', value: targetModel ?? null, mergeStrategy: 'replace' });
      edits.push({ keyPath: 'model_context_window', value: null, mergeStrategy: 'replace' });
    }
    await window.hexa.request('config/batchWrite', { edits, reloadUserConfig: true });
    setConfig((current: any) => {
      const updated = {
        ...current,
        model_provider: provider,
        model: targetModel,
        ...(mode === 'local' ? { oss_provider: provider } : {}),
      };
      if (mode === 'openai') delete updated.model_context_window;
      else {
        const localWindow = next.localModel ? localContextWindowFor(next, next.localModelProvider, next.localModel) : undefined;
        if (localWindow) updated.model_context_window = localWindow;
        else delete updated.model_context_window;
      }
      return updated;
    });
    if (mode === 'openai' && cloudModel) setSelectedModel(cloudModel);
    if (mode === 'openai') {
      setActiveThread((current) => {
        if (!current) return current;
        delete tokenUsageByThreadRef.current[current.id];
        const updated = { ...current, tokenUsage: undefined };
        activeThreadRef.current = updated;
        return updated;
      });
    }
    const runtimeChanged = changed || config.model_provider !== provider || config.model !== targetModel;
    if (runtimeChanged) await window.hexa.restartEngine();
    if (mode === 'openai') hostedContextCleanupRef.current = false;
    if (mode === 'local') {
      setAccount(null);
      return null;
    }
    const response = await window.hexa.request<any>('account/read', { refreshToken: true }).catch(() => null);
    const detected = normalizeAccountPayload(response);
    setAccount(detected);
    return detected;
  }

  async function signInToOpenAI() {
    if (account && preferences?.accountMode === 'openai') return;
    const detected = await selectAccountMode('openai');
    if (detected) {
      setAccountSwitcherOpen(false);
      return;
    }
    const response = await window.hexa.request<any>('account/login/start', {
      type: 'chatgpt',
      codexStreamlinedLogin: true,
      useHostedLoginSuccessPage: true,
      appBrand: 'codex',
    });
    if (response?.authUrl) await window.hexa.openAuthWindow(response.authUrl);
  }

  async function logoutAccount() {
    await window.hexa.request('account/logout', {});
    setAccount(null);
    setAccountMenuOpen(false);
    setAccountSwitcherOpen(true);
  }

  async function finishOnboarding() {
    const next = await window.hexa.setPreferences({ onboardingComplete: true });
    setPreferences(next);
  }

  async function toggleUsage() {
    const next = !usageOpen;
    setUsageOpen(next);
    if (!next) return;
    setUsageStats(null);
    setUsageStats(await readAccountUsage());
  }

  async function readAccountUsage() {
    const [usage, limits] = await Promise.all([
      window.hexa.request<any>('account/usage/read', {}).catch(() => null),
      window.hexa.request<any>('account/rateLimits/read', {}).catch(() => null),
    ]);
    return { usage, limits, refreshedAt: Date.now() };
  }

  useEffect(() => {
    if (!usageOpen || preferences?.accountMode !== 'openai') return;
    const refresh = () => void readAccountUsage().then(setUsageStats);
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [usageOpen, preferences?.accountMode]);

  async function sendMessage() {
    const draft = composer;
    const draftKey = activeThread?.id ?? '__new__';
    const normalizedComposer = composer.replace(/\$goal\b/g, '/goal').replace(/\$plan\b/g, '/plan');
    const { text, textElements } = serializeComposer(normalizedComposer, pluginMentions);
    if ((!text && !attachments.length) || sending || status.phase !== 'ready') return;
    if (text.trim() === '/compact') {
      if (!activeThread || activeThread.id.startsWith('local-thread-')) return;
      threadComposerDraftsRef.current[draftKey] = '';
      setComposer('');
      try {
        await compactConversation();
      } catch (error) {
        threadComposerDraftsRef.current[draftKey] = draft;
        setComposer(draft);
        throw error;
      }
      return;
    }
    setSending(true);
    threadComposerDraftsRef.current[draftKey] = '';
    setComposer('');
    const input: any[] = [];
    if (text) input.push({ type: 'text', text, textElements });
    for (const attachment of attachments) {
      if (attachment.kind === 'image') input.push({ type: 'localImage', path: attachment.path });
      else if (attachment.kind === 'audio') input.push({ type: 'localAudio', path: attachment.path });
      else input.push({ type: 'mention', name: attachment.name, path: attachment.path });
    }
    const originalThread = activeThread;
    const optimisticTitle = titleFromFirstMessage(draft, attachments);
    const optimisticTurnId = `local-${crypto.randomUUID()}`;
    const optimisticTurn = normalizeTurn({
      id: optimisticTurnId,
      status: 'inProgress',
      items: [{ id: `${optimisticTurnId}-user`, type: 'userMessage', content: input, createdAt: Date.now(), optimistic: true }],
    });
    const initialOptimisticThread: ThreadView = originalThread
      ? { ...originalThread, turns: [...(originalThread.turns ?? []), optimisticTurn] }
      : {
        id: `local-thread-${crypto.randomUUID()}`,
        cwd,
        title: optimisticTitle,
        preview: optimisticTitle,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
        turns: [optimisticTurn],
      };
    activeThreadRef.current = initialOptimisticThread;
    setActiveThread(initialOptimisticThread);
    if (!originalThread) {
      setThreads((current) => [initialOptimisticThread, ...current.filter((thread) => thread.id !== initialOptimisticThread.id)]);
    }
    // Paint the optimistic bubble before dispatching work to the engine so the
    // transition represents sending instead of the first model response.
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      let thread = originalThread;
      if (!thread) {
        const response = await window.hexa.request<any>('thread/start', {
          model: effectiveModel || null,
          modelProvider: desiredModelProvider,
          cwd: cwd || null,
          permissions: selectedPermission || null,
          approvalPolicy: approvalPolicyForPermission(selectedPermission, config.approval_policy),
          dynamicTools: preferences?.browserToolEnabled === false ? [] : [BUILT_IN_BROWSER_TOOL],
        });
        const startedThread = normalizeThread(response.thread ?? response);
        thread = {
          ...startedThread,
          title: startedThread.title ?? optimisticTitle,
          preview: startedThread.preview ?? optimisticTitle,
          turns: [optimisticTurn],
        };
        activeThreadRef.current = thread;
        setActiveThread(thread);
        setThreads((current) => [
          thread as ThreadView,
          ...current.filter((entry) => entry.id !== initialOptimisticThread.id && entry.id !== thread!.id),
        ]);
        const current = navigationRef.current;
        const currentIndex = navigationIndexRef.current;
        const base = currentIndex < 0 ? ['__new__'] : current.slice(0, currentIndex + 1);
        const next = [...base, thread.id];
        navigationRef.current = next;
        navigationIndexRef.current = next.length - 1;
        setNavigation(next);
        setNavigationIndex(next.length - 1);
      } else {
        // turn/start cannot change a thread's provider. Rejoin the thread with
        // the account's provider/model before every continued turn so a thread
        // created under OpenAI cannot silently keep calling the cloud after the
        // user switches to Local (and vice versa).
        const resumedResponse = await window.hexa.request<any>('thread/resume', {
          threadId: thread.id,
          excludeTurns: true,
          model: effectiveModel || null,
          modelProvider: desiredModelProvider,
          ...(cwd ? { cwd } : {}),
          permissions: selectedPermission || null,
          approvalPolicy: approvalPolicyForPermission(selectedPermission, config.approval_policy),
        });
        const resumed = normalizeThread(resumedResponse.thread ?? resumedResponse);
        thread = { ...thread, ...resumed, turns: thread.turns };
        activeThreadRef.current = thread;
        setActiveThread(thread);
      }
      const response = await window.hexa.request<any>('turn/start', {
        threadId: thread.id,
        input,
        model: effectiveModel || null,
        effort: selectedReasoningEffort || (activeModel?.defaultReasoningEffort ?? (activeModel as any)?.default_reasoning_effort ?? effortOptions[0] ?? null),
        cwd: cwd || null,
        permissions: selectedPermission || null,
        approvalPolicy: approvalPolicyForPermission(selectedPermission, config.approval_policy),
      });
      if (response?.turn) {
        const startedTurn = normalizeTurn(response.turn);
        setActiveThread((current) => {
          if (!current || current.id !== thread.id) return current;
          const turns = [...(current.turns ?? [])];
          let index = turns.findIndex((entry) => entry.id === startedTurn.id);
          if (index < 0) index = turns.findIndex((entry) => entry.id === optimisticTurnId);
          if (index >= 0) turns[index] = { ...turns[index], ...startedTurn, items: startedTurn.items?.length ? startedTurn.items : turns[index].items };
          else turns.push(startedTurn);
          return { ...current, turns };
        });
      }
      setAttachments([]);
      setPluginMentions([]);
      setComposerModes([]);
      rememberModelSelection(effectiveModel, selectedReasoningEffort);
      await refreshThreads();
    } catch (error) {
      threadComposerDraftsRef.current[draftKey] = draft;
      setComposer(draft);
      setActiveThread(originalThread);
      activeThreadRef.current = originalThread;
      if (!originalThread) setThreads((current) => current.filter((thread) => thread.id !== initialOptimisticThread.id));
      throw error;
    } finally {
      setSending(false);
    }
  }

  async function interrupt() {
    const turn = [...(activeThread?.turns ?? [])].reverse().find((entry) => entry.status === 'inProgress');
    if (!turn || !activeThread) return;
    await window.hexa.request('turn/interrupt', { threadId: activeThread.id, turnId: turn.id });
    setPresentationPaused(false);
    setPausedThread(null);
  }

  function togglePresentationPause() {
    setPresentationPaused((paused) => {
      if (!paused) {
        const latest = activeThreadRef.current ?? activeThread;
        setPausedThread(latest ? structuredClone(latest) : null);
      }
      else setPausedThread(null);
      return !paused;
    });
  }

  function handleRunningButtonClick() {
    if (pauseClickTimerRef.current != null) window.clearTimeout(pauseClickTimerRef.current);
    pauseClickTimerRef.current = window.setTimeout(() => {
      togglePresentationPause();
      pauseClickTimerRef.current = null;
    }, 210);
  }

  function handleRunningButtonDoubleClick() {
    if (pauseClickTimerRef.current != null) window.clearTimeout(pauseClickTimerRef.current);
    pauseClickTimerRef.current = null;
    void interrupt();
  }

  async function startReview() {
    if (!activeThread) return;
    await window.hexa.request('review/start', {
      threadId: activeThread.id,
      target: { type: 'uncommittedChanges' },
      delivery: 'inline',
    });
    setCommandMenuOpen(false);
  }

  async function forkThread() {
    setCommandMenuOpen(false);
    if (!activeThread || activeThread.id.startsWith('local-thread-')) return;
    try {
      threadComposerDraftsRef.current[activeThread.id] = composer;
      const response = await window.hexa.request<any>('thread/fork', { threadId: activeThread.id });
      const forked = normalizeThread(response.thread ?? response);
      const turns = await loadCanonicalTurns(forked.id);
      const nextThread = { ...forked, turns };
      activeThreadRef.current = nextThread;
      setActiveThread(nextThread);
      setComposer(threadComposerDraftsRef.current[forked.id] ?? '');
      setAttachments([]);
      setPluginMentions([]);
      setComposerModes([]);
      setThreads((current) => [nextThread, ...current.filter((thread) => thread.id !== nextThread.id)]);
      const current = navigationRef.current;
      const currentIndex = navigationIndexRef.current;
      const next = [...current.slice(0, currentIndex + 1), nextThread.id];
      navigationRef.current = next;
      navigationIndexRef.current = next.length - 1;
      setNavigation(next);
      setNavigationIndex(next.length - 1);
      await refreshThreads();
    } catch (error) {
      setChatNotice({ kind: 'error', action: 'chat', message: `Could not fork chat: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  const tokenRing = computeContextRing(activeThread?.tokenUsage, liveLocalContextWindow, customProvider);
  const activePlan = [...(activeThread?.turns ?? [])].reverse().find((turn: any) => Array.isArray(turn.plan) && turn.plan.length && ['inProgress', 'running', 'pending'].includes(String(turn.status ?? '')))?.plan;
  const visibleThreads = threads.filter((thread) => !deletedThreadIds().has(thread.id));
  const mentionMatch = composer.match(/(?:^|\s)@([^\s@]*)$/);
  const mentionQuery = mentionMatch?.[1] ?? null;
  const mentionPlugins = mentionQuery === null ? [] : plugins.filter((plugin) => plugin.installed && plugin.enabled && `${plugin.name} ${plugin.interface?.displayName || ''}`.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8);
  const acceptMention = (plugin: PluginSummary) => {
    setPluginMentions((current) => current.some((entry) => entry.id === plugin.id) ? current : [...current, plugin]);
    setComposer((current) => current.replace(/@[^\s@]*$/, `$${plugin.name} `));
    setAddMenuOpen(false);
  };
  const composerFeatureTokens: PluginSummary[] = composerModes.map((mode) => ({
    id: `shell-${mode}`,
    name: mode,
    installed: true,
    enabled: true,
    marketplaceName: 'Hexa',
    interface: {
      displayName: mode === 'goal' ? 'Goal' : 'Plan mode',
      brandColor: mode === 'goal' ? '#59685f' : '#505e68',
    },
  }));

  if (settingsOpen) return <SettingsApp embedded onClose={() => setSettingsOpen(false)} />;

  return (
    <div className={`shell ${sidebarOpen ? '' : 'sidebar-collapsed'} ${booting ? 'booting' : status.phase === 'ready' ? 'boot-complete' : 'awaiting-runtime'} ${status.phase !== 'ready' ? 'runtime-active' : ''}`}>
      <AppTitleBar showMenus={!booting && status.phase === 'ready'} controls={!booting && status.phase === 'ready' ? (
        <div className="titlebar-navigation chrome-no-drag">
          <button aria-pressed={!sidebarOpen} onClick={() => setSidebarOpen((value) => !value)} title="Toggle chat sidebar" data-shortcut="Ctrl+B"><PanelLeftClose size={15} /></button>
          <button disabled={navigationIndex <= 0} onClick={() => void navigateHistory(-1)} title="Back" data-shortcut="Alt+Left"><ArrowLeft size={15} /></button>
          <button disabled={navigationIndex < 0 || navigationIndex >= navigation.length - 1} onClick={() => void navigateHistory(1)} title="Forward" data-shortcut="Alt+Right"><ArrowRight size={15} /></button>
        </div>
      ) : undefined} />
      <aside className="sidebar">
        <div className="sidebar-top chrome-no-drag">
          <span />
          <div className="sidebar-actions">
            <div className={`sidebar-search-morph ${searchOpen ? 'open' : ''}`}>
              <button className="icon-button" aria-expanded={searchOpen} onClick={() => { setSearchOpen((value) => !value); if (searchOpen) setSearchTerm(''); }} title="Search chats"><Search size={17} /></button>
              <input autoFocus={searchOpen} value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search chats" />
              {searchOpen && searchTerm && <button className="search-clear" onClick={() => setSearchTerm('')}><X size={12} /></button>}
            </div>
            <button className="icon-button" onClick={() => void refreshThreads()} title="Refresh chats"><RefreshCw size={17} /></button>
          </div>
        </div>
        <button className="sidebar-plugin-button sidebar-new-chat-button" onClick={() => void newThread()}>
          <MessageSquarePlus size={16} /><span>New chat</span>
        </button>
        <button className="sidebar-plugin-button sidebar-plugin-top" aria-expanded={pluginManagerOpen} onClick={() => setPluginManagerOpen(true)}>
          <Puzzle size={16} /><span>Plugins</span>
        </button>
        <button className={`archive-toggle archive-top ${showArchived ? 'selected' : ''}`} onClick={() => setShowArchived((value) => !value)}>
          {showArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          <span>{showArchived ? 'Back to chats' : 'Archived'}</span>
        </button>
        <div className="sidebar-heading">Chats</div>
        <div className="thread-list">
          {visibleThreads.map((thread) => (
            <div key={thread.id} className={`thread-row ${activeThread?.id === thread.id ? 'active' : ''}`}>
              <button className="thread-main" onClick={() => void openThread(thread)}>
                <span className="thread-title"><span>{titleFromThread(thread)}</span></span>
                <span className="thread-meta">{relativeTime(thread.updatedAt ?? thread.createdAt)}</span>
              </button>
              <div className="thread-hover-actions">
                {pendingDelete?.id === thread.id ? (
                  <div className="delete-confirm" data-menu-root>
                    <span>Delete?</span>
                    <button title="Cancel" onClick={() => setPendingDelete(null)}><X size={13} /></button>
                    <button className="delete-confirm-action" onClick={() => void deleteThread(thread)}>Continue</button>
                  </div>
                ) : (
                  <>
                    {showArchived ? (
                      <button title="Unarchive" onClick={() => void unarchiveThread(thread)}><ArchiveRestore size={14} /></button>
                    ) : (
                      <button title="Archive" onClick={() => void archiveThread(thread)}><Archive size={14} /></button>
                    )}
                    <button title="Delete" onClick={() => setPendingDelete(thread)}><Trash2 size={14} /></button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!visibleThreads.length && <div className="empty-history">No {showArchived ? 'archived ' : ''}chats</div>}
          {threadCursor && <button className="load-more-history" onClick={() => void loadMoreThreads()}>Load more</button>}
        </div>
        <div className="sidebar-bottom chrome-no-drag">
          <div className={`sidebar-account-row ${account && preferences?.accountMode === 'openai' ? 'has-logout' : ''}`}>
            <div className="account-menu-wrap" data-menu-root>
              <button className="account-pill" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((value) => !value)}>
                <AccountAvatar account={account} mode={preferences?.accountMode} />
                <span>{accountLabel(account, preferences?.accountMode)}</span>
              </button>
              {accountMenuOpen && <AccountPopover account={account} mode={preferences?.accountMode ?? 'openai'} onOpenAI={() => void signInToOpenAI()} onLocal={() => void selectAccountMode('local')} />}
            </div>
            {account && preferences?.accountMode === 'openai' && <button className="bottom-logout-button" onClick={() => void logoutAccount()} title="Log out of OpenAI"><LogOut size={15} /></button>}
            <button className="bottom-settings-button" onClick={() => setSettingsOpen(true)} title="Settings"><Settings size={15} /></button>
          </div>
        </div>
      </aside>

      <main className={`main-panel ${activeThread ? 'has-active-thread' : ''}`}>
        <header className="chat-header chrome-no-drag">
          <div className="chat-heading">
            {activeThread && <span className="chat-title" title={titleFromThread(activeThread)}>{titleFromThread(activeThread)}</span>}
            {activeThread?.status && <span className="status-dot" title="Thread status" />}
          </div>
          <div className="header-actions">
            <div className="folder-chip" title={cwd || 'No folder selected'}>
              <Folder size={15} />
              <span>{shortenPath(cwd || activeThread?.cwd, 44)}</span>
            </div>
            <div className="menu-wrap" data-menu-root>
              <button className="icon-button" aria-expanded={commandMenuOpen} onClick={() => { setCommandMenuOpen((value) => !value); setModelMenuOpen(false); setPermissionMenuOpen(false); }}><MoreHorizontal size={19} /></button>
              {commandMenuOpen && (
                <div className="popover command-popover">
                  <button disabled={!activeThread || isTurnRunning} onClick={() => { setCommandMenuOpen(false); void compactConversation(); }}><FileText size={16} /> Compact conversation</button>
                  <button disabled={!activeThread || activeThread.id.startsWith('local-thread-') || isTurnRunning} onClick={() => void forkThread()}><GitBranch size={16} /> Fork chat</button>
                  <button disabled={!activeThread} onClick={() => void renameThread()}><MessageSquarePlus size={16} /> Rename chat</button>
                  {!sidebarOpen && <><div className="popover-separator" /><button onClick={() => { setCommandMenuOpen(false); setSettingsOpen(true); }}><Settings size={16} /> Settings</button></>}
                </div>
              )}
            </div>
            <button className="icon-button" aria-expanded={bottomPanelOpen} onClick={() => { setWorkPanelKind('terminal'); setBottomPanelOpen((value) => !value); }} title="Toggle terminal" data-shortcut="Ctrl+`"><BottomDockIcon /></button>
            <button className="icon-button" aria-expanded={rightPanelOpen} onClick={() => setRightPanelOpen((value) => !value)} title="Toggle work panel" data-shortcut="Ctrl+Shift+P"><SideDockIcon /></button>
          </div>
        </header>

        <section className={`conversation ${activeThread ? 'has-thread' : 'empty-thread'}`}>
          <div ref={feedRef} className="feed">
            {!activeThread ? (
              <div className="empty-state">
                <HexaLogo className="welcome-logo" />
                <h1>Welcome — what can we create together?</h1>
                {!booting && status.phase === 'ready' && <p className="typing-welcome" key={welcomeCycle}><span>Share an idea, ask a question, or open a project.</span><span>Hexa is ready to help you turn it into something real.</span></p>}
              </div>
            ) : <>
              <ThreadTranscript thread={presentationPaused && pausedThread?.id === activeThread.id ? pausedThread : activeThread} preferences={preferences} liveTools={presentationPaused ? {} : liveTools} activityPaused={presentationPaused} onPreviewImage={setImagePreview} />
              {status.message.startsWith('Connecting…') && <div className="activity-strip connection-strip"><Wifi size={14} /><span>{status.message}</span></div>}
            </>}
          </div>

          <div className={`composer-stage ${activeThread ? '' : 'centered'}`}>
            <ApprovalStack approvals={approvals} onResolve={(id) => setApprovals((items) => items.filter((item) => item.id !== id))} />
            {window.hexa.platform === 'win32' && !preferences?.sandboxSetupComplete && <div className="sandbox-banner"><span>You need to set up Sandboxing</span><button disabled={sandboxSetup} onClick={() => { setSandboxSetup(true); void window.hexa.request('windowsSandbox/setupStart', { mode: 'elevated', cwd: cwd || null }).catch(() => setSandboxSetup(false)); }}>{sandboxSetup ? 'Setting up…' : 'Set Up'}</button></div>}
            {backgroundAgentItems.length > 0 && <BackgroundAgentBar items={backgroundAgentItems} />}
            {activePlan?.length ? <PlanActivityStrip plan={activePlan} /> : null}
            {addMenuOpen && <AddMenu plugins={plugins.filter((plugin) => plugin.installed && plugin.enabled)} account={account} onFiles={() => { setAddMenuOpen(false); void attachFiles(); }} onGoal={() => useComposerMode('goal')} onPlan={() => useComposerMode('plan')} onPlugin={usePlugin} onManage={() => { setAddMenuOpen(false); setPluginManagerOpen(true); }} />}
            {!addMenuOpen && mentionQuery !== null && <MentionMenu plugins={mentionPlugins} onChoose={acceptMention} />}
            {!addMenuOpen && mentionQuery === null && /^\/[^\s]*$/.test(composer.trimStart()) && <CommandMenu query={composer.trimStart().slice(1)} onChoose={(command) => { if (command === 'goal' || command === 'plan') useComposerMode(command); else setComposer(`/${command} `); }} />}
            <div className="composer-shell">
              {attachments.length > 0 && (
                <div className="attachment-strip">
                  {attachments.map((attachment) => (
                    <span className={`attachment-chip ${attachment.kind === 'image' ? 'previewable' : ''}`} key={attachment.path} title={attachment.path}>
                      <button className="attachment-preview-trigger" disabled={attachment.kind !== 'image'} onClick={() => attachment.kind === 'image' && setImagePreview({ src: rendererFileUrl(attachment.path), name: attachment.name })}>{attachment.kind === 'image' ? <Image size={13} /> : attachment.kind === 'audio' ? <Zap size={13} /> : <FileCode2 size={13} />}<span>{attachment.name}</span></button>
                      <button onClick={() => setAttachments((items) => items.filter((item) => item.path !== attachment.path))} title="Remove attachment"><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <StableRichComposer
                value={composer}
                plugins={[...pluginMentions, ...composerFeatureTokens]}
                onChange={setComposer}
                onRemovePlugin={(plugin) => { setComposer((current) => current.replace(`$${plugin.name}`, '').replace(/ {2,}/g, ' ')); setPluginMentions((items) => items.filter((item) => item.id !== plugin.id)); setComposerModes((items) => items.filter((item) => item !== plugin.name)); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  } else if (event.key === ' ' && mentionQuery !== null && mentionPlugins.length === 1) {
                    event.preventDefault();
                    acceptMention(mentionPlugins[0]);
                  }
                }}
                onPaste={async (event) => {
                  const clipboard = event.clipboardData;
                  if (!clipboard.types.includes('Files') && !clipboard.types.includes('image/png') && !clipboard.types.includes('image/jpeg')) return;
                  event.preventDefault();
                  const attachment = await window.hexa.readClipboardImage();
                  if (attachment) setAttachments((items) => items.some((item) => item.path === attachment.path) ? items : [...items, attachment]);
                }}
                placeholder={activeThread ? 'Ask for follow-up changes' : 'Do anything'}
              />
              <div className="composer-toolbar">
                <div className="composer-left">
                  <div className="menu-wrap add-menu-wrap" data-menu-root>
                    <button className="composer-icon" aria-expanded={addMenuOpen} onClick={() => { setAddMenuOpen((value) => !value); setModelMenuOpen(false); setPermissionMenuOpen(false); }} title="Add"><PlusIcon /></button>
                  </div>
                  <div className="menu-wrap" data-menu-root>
                    <button className="permission-button permission-button-left" aria-expanded={permissionMenuOpen} onClick={() => { setPermissionMenuOpen((value) => !value); setModelMenuOpen(false); setCommandMenuOpen(false); setAddMenuOpen(false); }} title="Approvals and permissions">
                      {permissionIcon(selectedPermission, 15)}
                      <span>{friendlyPermission(selectedPermission)}</span>
                      <ChevronDown size={13} />
                    </button>
                    {permissionMenuOpen && (
                      <div className="popover permission-popover permission-popover-left">
                        <div className="approval-menu-heading"><span>How should Shell actions be approved?</span></div>
                        {permissionProfiles.map((profile) => (
                          <button disabled={!profile.allowed} key={profile.id} className={profile.id === selectedPermission ? 'selected' : ''} onClick={() => choosePermission(profile)}>
                            {profile.id === ':danger-full-access' ? <ShieldAlert size={17} /> : profile.id === ':workspace' ? <ShieldCheck size={17} /> : <Hand size={17} />}
                            <span><b>{friendlyPermission(profile.id)}</b><small>{permissionDescription(profile.id, profile.description)}</small></span>
                            {profile.id === selectedPermission && <Check size={14} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="composer-right">
                  {tokenRing.used > 0 && <ContextRing percentage={tokenRing.percent} label={tokenRing.label} />}
                  <div className="menu-wrap" data-menu-root>
                    <button className="model-button" aria-expanded={modelMenuOpen} onClick={() => { setModelMenuOpen((value) => !value); setPermissionMenuOpen(false); setCommandMenuOpen(false); setAddMenuOpen(false); }}>
                      <span className="model-spark"><Sparkles size={14} /></span>
                      <span>{displayModelLabel}</span>
                      <span className="reasoning-badge">{friendlyEffort(selectedReasoningEffort)}</span>
                      <ChevronDown size={14} />
                    </button>
                    {modelMenuOpen && (
                      <ModelPopover
                        models={customProvider ? [] : models}
                        selectedModel={effectiveModel}
                        effort={selectedReasoningEffort}
                        effortOptions={effortOptions}
                        customProvider={customProvider}
                        customProviderId={config.model_provider}
                        onModel={(model) => { setSelectedModel(model); rememberModelSelection(model, selectedReasoningEffort); setModelMenuOpen(false); }}
                        onEffort={(effort) => { setReasoningEffort(effort); rememberModelSelection(effectiveModel, effort); setModelMenuOpen(false); }}
                      />
                    )}
                  </div>
                  <button className="permission-button workspace-button" onClick={() => void chooseFolder()} title={cwd || 'Choose workspace'}>
                    <Folder size={14} />
                    <span>Workspace</span>
                    <ChevronDown size={13} />
                  </button>
                  <button
                    className={`send-button ${isTurnRunning || presentationPaused ? 'pause' : ''} ${presentationPaused ? 'paused' : ''}`}
                    onClick={() => (isTurnRunning || presentationPaused ? handleRunningButtonClick() : void sendMessage())}
                    onDoubleClick={isTurnRunning ? handleRunningButtonDoubleClick : undefined}
                    disabled={!isTurnRunning && !presentationPaused && (!composer.trim() && !attachments.length && !pluginMentions.length || sending || status.phase !== 'ready')}
                    title={isTurnRunning || presentationPaused ? presentationPaused ? 'Resume live updates' : 'Pause live updates · Double-click to stop' : 'Send'}
                  >
                    {isTurnRunning || presentationPaused ? presentationPaused ? <Play size={16} /> : <CircleStop size={17} /> : <ArrowUpIcon />}
                  </button>
                </div>
              </div>
            </div>
            <div className="composer-caption">
              {preferences?.accountMode === 'openai' && <div className="usage-wrap" data-menu-root><button className="usage-button" aria-expanded={usageOpen} onClick={() => void toggleUsage()}><Clock3 size={13} /> Usage</button>{usageOpen && <UsagePopover stats={usageStats} />}</div>}
              <span>{status.phase === 'ready' ? 'Hexa Engine connected' : status.message}</span>
            </div>
          </div>
        </section>
        {rightPanelOpen && <WorkPanel placement="right" kind={workPanelKind} cwd={cwd} onKind={setWorkPanelKind} onClose={() => setRightPanelOpen(false)} onBrowserController={receiveBrowserController} />}
        {bottomPanelOpen && <WorkPanel placement="bottom" kind="terminal" cwd={cwd} onKind={setWorkPanelKind} onClose={() => setBottomPanelOpen(false)} />}
      </main>

      {booting && <BootSplash />}
      {!booting && status.phase !== 'ready' && !activeThread && <RuntimeOverlay status={status} onSettings={() => setSettingsOpen(true)} />}
      {preferences && !preferences.onboardingComplete && status.phase === 'ready' && (
        <Onboarding
          account={account}
          mode={preferences.accountMode}
          cwd={cwd}
          step={onboardingStep}
          onStep={setOnboardingStep}
          onChooseFolder={chooseFolder}
          onOpenAI={signInToOpenAI}
          onLocal={() => selectAccountMode('local')}
          onFinish={finishOnboarding}
        />
      )}
      {preferences?.onboardingComplete && accountSwitcherOpen && (
        <AccountSwitcher account={account} mode={preferences.accountMode} onOpenAI={signInToOpenAI} onLocal={async () => { await selectAccountMode('local'); setAccountSwitcherOpen(false); }} onClose={() => setAccountSwitcherOpen(false)} />
      )}
      {fullAccessWarningOpen && (
        <FullAccessWarning
          onCancel={() => setFullAccessWarningOpen(false)}
          onConfirm={() => { setSelectedPermission(':danger-full-access'); setFullAccessWarningOpen(false); }}
        />
      )}
      {pluginManagerOpen && (
        <PluginManager
          plugins={plugins}
          onClose={() => setPluginManagerOpen(false)}
          onRefresh={() => refreshPlugins(true)}
          onInstall={installPlugin}
          onUninstall={uninstallPlugin}
        />
      )}
      {renameTarget && (
        <RenameChatModal
          currentName={titleFromThread(renameTarget)}
          onCancel={() => setRenameTarget(null)}
          onSave={saveThreadName}
        />
      )}
      {activityReview && <ActivityReviewModal mode={activityReview} text={composer.replace(`$${activityReview}`, '').trim()} onClose={() => setActivityReview(null)} />}
      {imagePreview && <ImageLightbox src={imagePreview.src} name={imagePreview.name} onClose={() => setImagePreview(null)} />}
      {chatNotice && <div className={`shell-toast ${chatNotice.kind} ${sidebarOpen ? 'with-sidebar' : ''}`}><span className="shell-toast-icon">{chatNotice.action === 'delete' ? <Trash2 size={16} /> : chatNotice.action === 'archive' || chatNotice.action === 'restore' ? <Archive size={16} /> : <MessageSquarePlus size={16} />}</span><span>{chatNotice.message}</span><button onClick={() => setChatNotice(null)}><X size={14} /></button></div>}
    </div>
  );
}

function ComposerActivityBar({ modes, onReview }: { modes: Array<'goal' | 'plan'>; onReview: (mode: 'goal' | 'plan') => void }) {
  return <div className="composer-activity-bar">
    {modes.map((mode) => <div className="composer-activity-item" key={mode}>
      <span className="composer-activity-icon">{mode === 'plan' ? <PlanPath /> : <GoalCompass />}</span>
      <span><b>{mode === 'plan' ? 'Planning' : 'Creating goal'}</b><small>{mode === 'plan' ? 'Shell will plan before acting' : 'Shell will keep this objective in focus'}</small></span>
      <button onClick={() => onReview(mode)}>Review</button>
    </div>)}
  </div>;
}

function BackgroundAgentBar({ items }: { items: any[] }) {
  const agents = items.flatMap((item) => {
    const states = item.agentsStates ?? item.agents_states;
    if (states && typeof states === 'object') return Object.entries(states).map(([id, state]: [string, any]) => ({ id, title: state?.taskName ?? state?.task_name ?? state?.name ?? state?.status ?? id }));
    return [{ id: item.id, title: item.taskName ?? item.task_name ?? item.tool ?? 'Background agent' }];
  });
  return <div className="background-agent-bar"><div className="background-agent-label"><Bot size={15} /><span className="shimmer-text">Background agents</span></div><div className="background-agent-list">{agents.map((agent) => <button key={agent.id} title={String(agent.title)}><GitBranch size={13} /><span>{String(agent.title)}</span><i /></button>)}</div></div>;
}

function ActivityReviewModal({ mode, text, onClose }: { mode: 'goal' | 'plan'; text: string; onClose: () => void }) {
  return <div className="modal-backdrop chrome-no-drag" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="activity-review-modal" role="dialog" aria-modal="true">
      <header><span>{mode === 'plan' ? <PlanPath /> : <GoalCompass />}</span><div><h2>{mode === 'plan' ? 'Planning request' : 'Goal request'}</h2><p>Review what Hexa Engine will receive with this message.</p></div><button className="icon-button" onClick={onClose}><X size={17} /></button></header>
      <div className="activity-review-content">{text || 'Add instructions in the composer to describe what you want.'}</div>
      <div className="modal-actions"><button className="rename-chat-confirm" onClick={onClose}>Done</button></div>
    </section>
  </div>;
}

function StableRichComposer({ value, plugins, onChange, onRemovePlugin, onKeyDown, onPaste, placeholder }: {
  value: string;
  plugins: PluginSummary[];
  onChange: (value: string) => void;
  onRemovePlugin: (plugin: PluginSummary) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (event: React.ClipboardEvent<HTMLDivElement>) => void | Promise<void>;
  placeholder: string;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const removeRef = useRef(onRemovePlugin);
  removeRef.current = onRemovePlugin;

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || readStableComposer(editor) === value) return;
    editor.replaceChildren();
    let cursor = 0;
    while (cursor < value.length) {
      let next: { index: number; plugin: PluginSummary } | null = null;
      for (const plugin of plugins) {
        const index = value.indexOf(`$${plugin.name}`, cursor);
        if (index >= 0 && (!next || index < next.index)) next = { index, plugin };
      }
      if (!next) {
        editor.append(document.createTextNode(value.slice(cursor)));
        break;
      }
      if (next.index > cursor) editor.append(document.createTextNode(value.slice(cursor, next.index)));
      const chip = document.createElement('span');
      chip.className = 'inline-plugin-mention';
      chip.contentEditable = 'false';
      chip.dataset.pluginName = next.plugin.name;
      const artwork = document.createElement('span');
      artwork.className = 'inline-plugin-artwork';
      if (next.plugin.id === 'shell-goal') artwork.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.1l2 5.9 5.9 2-5.9 2-2 5.9-2-5.9-5.9-2L8 8l2-5.9z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="1.7" fill="currentColor"/></svg>';
      else if (next.plugin.id === 'shell-plan') artwork.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="5" r="1.7" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="16" cy="15" r="1.7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.8 5h3.7a2 2 0 012 2v6a2 2 0 002 2h.7" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
      else artwork.textContent = (next.plugin.interface?.displayName || next.plugin.name).slice(0, 1).toUpperCase();
      artwork.style.background = next.plugin.interface?.brandColor || '';
      const source = next.plugin.interface?.composerIconUrl || next.plugin.interface?.logoUrlDark || next.plugin.interface?.logoUrl || next.plugin.interface?.composerIcon || next.plugin.interface?.logoDark || next.plugin.interface?.logo;
      if (source) void window.hexa.pluginIcon(source).then((resolved) => {
        if (!resolved || !chip.isConnected) return;
        const image = document.createElement('img');
        image.src = resolved;
        image.alt = '';
        artwork.replaceWith(image);
      }).catch(() => undefined);
      const label = document.createElement('span');
      label.textContent = next.plugin.interface?.displayName || next.plugin.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = `Remove ${label.textContent}`;
      remove.textContent = '×';
      remove.addEventListener('mousedown', (event) => event.preventDefault());
      remove.addEventListener('click', () => removeRef.current(next!.plugin));
      chip.append(artwork, label, remove);
      editor.append(chip);
      cursor = next.index + next.plugin.name.length + 1;
    }
    const selection = window.getSelection();
    if (document.activeElement === editor && selection) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }, [plugins, value]);

  return <div ref={editorRef} className="composer-editor" contentEditable role="textbox" aria-multiline="true" data-placeholder={placeholder} data-empty={value.length === 0} suppressContentEditableWarning onInput={(event) => onChange(readStableComposer(event.currentTarget))} onKeyDown={onKeyDown} onPaste={onPaste} />;
}

function readStableComposer(root: HTMLElement): string {
  const read = (node: Node): string => {
    if (node instanceof HTMLElement && node.dataset.pluginName) return `$${node.dataset.pluginName}`;
    if (node.nodeName === 'BR') return '\n';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    const text = [...node.childNodes].map(read).join('');
    return node instanceof HTMLDivElement && node !== root ? `${text}\n` : text;
  };
  return read(root).replace(/\n$/, '');
}

function AddMenu({ plugins, account, onFiles, onGoal, onPlan, onPlugin, onManage }: {
  plugins: PluginSummary[];
  account: any;
  onFiles: () => void;
  onGoal: () => void;
  onPlan: () => void;
  onPlugin: (plugin: PluginSummary) => void;
  onManage: () => void;
}) {
  return (
    <div className="composer-top-panel add-menu" data-menu-root>
      <div className="add-menu-scroll">
        <div className="add-menu-heading">Add</div>
        <button onClick={onFiles}><AttachmentMark /><span><b>Files and folders</b><small>Attach context from your computer</small></span></button>
        <button onClick={onGoal}><GoalCompass /><span><b>Goal</b><small>Set a goal to keep pursuing</small></span></button>
        <button onClick={onPlan}><PlanPath /><span><b>Plan mode</b><small>Turn plan mode on</small></span></button>
        <div className="add-menu-heading section">Plugins</div>
        {plugins.slice(0, 8).map((plugin) => <PluginMenuButton key={plugin.id} plugin={plugin} onClick={() => onPlugin(plugin)} />)}
        {!plugins.length && <div className="add-menu-empty">No installed plugins yet.</div>}
        <button className="manage-plugins-row" onClick={onManage}><Puzzle size={18} /><span><b>Plugin Management</b><small>Discover and manage plugins</small></span></button>
        {account && <><div className="add-menu-heading section">Account</div><div className="add-account-row"><AccountAvatar account={account} mode="openai" /><span>{accountLabel(account, 'openai')}</span></div></>}
      </div>
    </div>
  );
}

function CommandMenu({ query, onChoose }: { query: string; onChoose: (command: string) => void }) {
  const commands = [
    { command: 'goal', label: 'Set goal', detail: 'Keep Shell pursuing a durable objective', icon: <GoalCompass /> },
    { command: 'plan', label: 'Plan mode', detail: 'Plan the work before making changes', icon: <PlanPath /> },
    { command: 'review', label: 'Review changes', detail: 'Inspect the current workspace changes', icon: <ShieldCheck size={18} /> },
    { command: 'compact', label: 'Compact context', detail: 'Summarize the conversation to make room', icon: <Sparkles size={18} /> },
    { command: 'new', label: 'New chat', detail: 'Start a fresh conversation', icon: <MessageSquarePlus size={18} /> },
  ].filter((entry) => `${entry.command} ${entry.label} ${entry.detail}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="composer-top-panel command-menu">
      <div className="composer-panel-title"><span>Commands</span><kbd>/</kbd></div>
      <div className="command-list">
        {commands.map((entry) => <button key={entry.command} onClick={() => onChoose(entry.command)}>{entry.icon}<span><b>/{entry.command}</b><small>{entry.detail}</small></span></button>)}
        {!commands.length && <div className="add-menu-empty">No matching commands.</div>}
      </div>
    </div>
  );
}

function MentionMenu({ plugins, onChoose }: { plugins: PluginSummary[]; onChoose: (plugin: PluginSummary) => void }) {
  return <div className="composer-top-panel mention-menu"><div className="composer-panel-title"><span>Mention a plugin</span><kbd>@</kbd></div><div className="command-list">{plugins.map((plugin) => <button key={plugin.id} onClick={() => onChoose(plugin)}><PluginArtwork plugin={plugin} /><span><b>{plugin.interface?.displayName || plugin.name}</b><small>{plugin.interface?.shortDescription || 'Add this plugin to your message'}</small></span></button>)}{!plugins.length && <div className="add-menu-empty">No matching installed plugins.</div>}</div></div>;
}

function PluginMenuButton({ plugin, onClick }: { plugin: PluginSummary; onClick: () => void }) {
  const name = plugin.interface?.displayName || plugin.name;
  return <button onClick={onClick}><PluginArtwork plugin={plugin} /><span><b>{name}</b><small>{plugin.interface?.shortDescription || 'Use this plugin in your message'}</small></span></button>;
}

function PluginArtwork({ plugin }: { plugin: PluginSummary }) {
  const source = plugin.interface?.composerIconUrl || plugin.interface?.logoUrlDark || plugin.interface?.logoUrl || plugin.interface?.composerIcon || plugin.interface?.logoDark || plugin.interface?.logo;
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    if (!source) { setResolved(null); return; }
    void window.hexa.pluginIcon(source).then((value) => { if (mounted) setResolved(value); }).catch(() => { if (mounted) setResolved(null); });
    return () => { mounted = false; };
  }, [source]);
  return resolved ? <img src={resolved} alt="" /> : <PluginGlyph plugin={plugin} />;
}

function PluginGlyph({ plugin }: { plugin: PluginSummary }) {
  return <span className="plugin-glyph" style={{ background: plugin.interface?.brandColor || undefined }}>{(plugin.interface?.displayName || plugin.name).slice(0, 1).toUpperCase()}</span>;
}

function FullAccessWarning({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop chrome-no-drag" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="danger-modal" role="alertdialog" aria-modal="true" aria-labelledby="full-access-title">
        <div className="danger-icon"><ShieldAlert size={28} /></div>
        <h2 id="full-access-title">Give Shell full access?</h2>
        <p className="danger-lead">This removes the normal workspace boundary and approval protections. Only continue if you understand and trust the task.</p>
        <div className="danger-access-list">
          <span><AlertTriangle size={16} /><b>Read, create, modify, or delete files anywhere your account can access</b></span>
          <span><AlertTriangle size={16} /><b>Run commands and programs without asking for each action</b></span>
          <span><AlertTriangle size={16} /><b>Use available network connections, credentials, and system resources</b></span>
        </div>
        <p className="danger-footnote">A mistaken or malicious instruction could cause data loss, expose private information, or change your system. Proceed at your own risk.</p>
        <div className="modal-actions"><button onClick={onCancel}>Cancel</button><button className="danger-confirm" onClick={onConfirm}>I understand — enable full access</button></div>
      </section>
    </div>
  );
}

function RenameChatModal({ currentName, onCancel, onSave }: { currentName: string; onCancel: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async () => {
    const nextName = name.trim();
    if (!nextName || saving) return;
    if (nextName === currentName) { onCancel(); return; }
    setSaving(true);
    setError('');
    try { await onSave(nextName); }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop chrome-no-drag" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
      <section className="rename-chat-modal" role="dialog" aria-modal="true" aria-labelledby="rename-chat-title">
        <div className="rename-chat-icon"><PencilLine size={23} /></div>
        <div className="rename-chat-copy">
          <h2 id="rename-chat-title">Rename chat</h2>
          <p>Choose a clear name so this conversation is easy to find later.</p>
        </div>
        <label className="rename-chat-field">
          <span>Chat name</span>
          <input ref={inputRef} value={name} maxLength={160} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); void submit(); }
            if (event.key === 'Escape' && !saving) onCancel();
          }} />
        </label>
        {error && <div className="rename-chat-error">{error}</div>}
        <div className="modal-actions">
          <button disabled={saving} onClick={onCancel}>Cancel</button>
          <button className="rename-chat-confirm" disabled={!name.trim() || saving} onClick={() => void submit()}>{saving ? 'Renaming…' : 'Rename chat'}</button>
        </div>
      </section>
    </div>
  );
}

function PluginManager({ plugins, onClose, onRefresh, onInstall, onUninstall }: {
  plugins: PluginSummary[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onInstall: (plugin: PluginSummary) => Promise<void>;
  onUninstall: (plugin: PluginSummary) => Promise<void>;
}) {
  const [tab, setTab] = useState<'discover' | 'installed'>('discover');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [detail, setDetail] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const visible = plugins.filter((plugin) => (tab === 'installed' ? plugin.installed : true) && `${plugin.name} ${plugin.interface?.displayName || ''} ${plugin.interface?.shortDescription || ''}`.toLowerCase().includes(query.toLowerCase()));
  const changePlugin = async (plugin: PluginSummary) => {
    setBusyId(plugin.id);
    setError('');
    try { await (plugin.installed ? onUninstall(plugin) : onInstall(plugin)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusyId(null); }
  };
  const openDetail = async (plugin: PluginSummary) => {
    setDetailLoading(true);
    setError('');
    try {
      const response = await window.hexa.request<any>('plugin/read', {
        marketplacePath: plugin.marketplacePath ?? null,
        remoteMarketplaceName: plugin.marketplacePath ? null : plugin.marketplaceName,
        pluginName: plugin.name,
      });
      setDetail(response.plugin);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setDetailLoading(false); }
  };
  return (
    <div className="modal-backdrop chrome-no-drag" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="plugin-manager" role="dialog" aria-modal="true" aria-labelledby="plugin-manager-title">
        {detail ? <PluginDetailPage detail={detail} onBack={() => setDetail(null)} onChange={() => { void changePlugin({ ...detail.summary, marketplaceName: detail.marketplaceName, marketplacePath: detail.marketplacePath }).then(() => setDetail(null)); }} busy={busyId === detail.summary.id} /> : <>
          <header><div className="plugin-manager-mark"><PlugZap size={21} /></div><div><h2 id="plugin-manager-title">Plugins</h2><p>Extend Hexa with tools from OpenAI and your configured marketplaces.</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header>
          <div className="plugin-manager-toolbar"><div className="plugin-layout-toggle"><button className={layout === 'list' ? 'selected' : ''} onClick={() => setLayout('list')} title="List view"><ListViewIcon /></button><button className={layout === 'grid' ? 'selected' : ''} onClick={() => setLayout('grid')} title="Grid view"><GridViewIcon /></button></div><div className="plugin-tabs"><button className={tab === 'discover' ? 'selected' : ''} onClick={() => setTab('discover')}>Discover</button><button className={tab === 'installed' ? 'selected' : ''} onClick={() => setTab('installed')}>Installed <span>{plugins.filter((plugin) => plugin.installed).length}</span></button></div><button className="icon-button" onClick={() => void onRefresh()} title="Refresh plugins"><RefreshCw size={15} /></button></div>
          <label className="plugin-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plugins" /></label>
          {error && <div className="plugin-error">{error}</div>}
          <div className={`plugin-grid ${layout}`}>{visible.map((plugin) => <article className="plugin-card" key={plugin.id} onClick={() => void openDetail(plugin)}><div className="plugin-card-icon"><PluginArtwork plugin={plugin} /></div><div className="plugin-card-copy"><b>{plugin.interface?.displayName || plugin.name}</b><small>{plugin.interface?.shortDescription || `From ${plugin.marketplaceName}`}</small><em>{plugin.marketplaceName}</em></div><button disabled={busyId === plugin.id || (!plugin.installed && (plugin.availability === 'DISABLED_BY_ADMIN' || plugin.installPolicy === 'NOT_AVAILABLE'))} className={plugin.installed ? 'installed' : ''} onClick={(event) => { event.stopPropagation(); void changePlugin(plugin); }}>{busyId === plugin.id ? 'Working…' : plugin.installed ? 'Remove' : 'Install'}</button></article>)}</div>
          {detailLoading && <div className="plugin-detail-loading">Loading plugin…</div>}
          {!visible.length && <div className="plugin-empty"><Puzzle size={26} /><b>{tab === 'installed' ? 'No installed plugins' : 'No plugins found'}</b><span>{query ? 'Try a different search.' : 'Refresh to load the latest catalog.'}</span></div>}
        </>}
      </section>
    </div>
  );
}

function WorkPanel({ placement, kind, cwd, onKind, onClose, onBrowserController }: { placement: 'right' | 'bottom'; kind: 'browser' | 'terminal'; cwd: string; onKind: (kind: 'browser' | 'terminal') => void; onClose: () => void; onBrowserController?: (controller: BuiltInBrowserController | null) => void }) {
  const [address, setAddress] = useState('');
  const browserRef = useRef<any>(null);
  const [browserNavigation, setBrowserNavigation] = useState({ back: false, forward: false });
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalLines, setTerminalLines] = useState<string[]>([`PowerShell`, cwd || 'No workspace selected']);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const runCommand = async () => {
    const command = terminalInput.trim();
    if (!command || terminalBusy) return;
    setTerminalInput('');
    setTerminalBusy(true);
    setTerminalLines((lines) => [...lines, `› ${command}`]);
    const result = await window.hexa.runTerminal(command, cwd || undefined);
    setTerminalLines((lines) => [...lines, result.output || `(exited ${result.exitCode})`]);
    setTerminalBusy(false);
  };
  useEffect(() => {
    const browser = browserRef.current;
    if (!browser || kind !== 'browser') return;
    const sync = () => {
      setAddress(browser.getURL() === 'about:blank' ? '' : browser.getURL());
      setBrowserNavigation({ back: browser.canGoBack(), forward: browser.canGoForward() });
    };
    browser.addEventListener('did-navigate', sync);
    browser.addEventListener('did-navigate-in-page', sync);
    browser.addEventListener('did-stop-loading', sync);
    return () => {
      browser.removeEventListener('did-navigate', sync);
      browser.removeEventListener('did-navigate-in-page', sync);
      browser.removeEventListener('did-stop-loading', sync);
    };
  }, [kind]);
  useEffect(() => {
    if (kind !== 'browser' || !browserRef.current || !onBrowserController) return;
    const browser = browserRef.current;
    onBrowserController({
      run: async (action, args) => {
        if (action === 'open') {
          const target = String(args.url || '').trim();
          if (!target) throw new Error('A URL is required.');
          await browser.loadURL(/^https?:\/\//i.test(target) ? target : `https://${target}`);
        } else if (action === 'back') browser.goBack();
        else if (action === 'forward') browser.goForward();
        else if (action === 'reload') browser.reload();
        else if (action === 'click') {
          await browser.executeJavaScript(`(() => { const q=${JSON.stringify(String(args.selector || ''))}; const t=${JSON.stringify(String(args.text || ''))}; const els=[...document.querySelectorAll('a,button,input,[role="button"]')]; const el=q?document.querySelector(q):els.find(e => (e.innerText||e.value||'').trim().includes(t)); if(!el) throw new Error('Element not found'); el.click(); return true; })()`);
        } else if (action === 'type') {
          await browser.executeJavaScript(`(() => { const el=document.querySelector(${JSON.stringify(String(args.selector || 'input'))}); if(!el) throw new Error('Field not found'); el.focus(); el.value=${JSON.stringify(String(args.text || ''))}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
        } else if (action === 'scroll') {
          await browser.executeJavaScript(`window.scrollBy({left:${Number(args.x || 0)},top:${Number(args.y || 640)},behavior:'smooth'})`);
        }
        const snapshot = await browser.executeJavaScript(`({ url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, 12000), links: [...document.querySelectorAll('a[href]')].slice(0,80).map((a,i)=>({index:i,text:(a.innerText||a.getAttribute('aria-label')||'').trim().slice(0,160),href:a.href})).filter(x=>x.text), images: [...document.images].map((img,i)=>({index:i,alt:(img.alt||img.getAttribute('aria-label')||'').trim().slice(0,160),src:img.currentSrc||img.src,width:img.naturalWidth,height:img.naturalHeight})).filter(x=>x.src&&x.width>=80&&x.height>=60).slice(0,80), controls: [...document.querySelectorAll('button,input,select,textarea,[role="button"]')].slice(0,80).map((e,i)=>({index:i,tag:e.tagName.toLowerCase(),text:(e.innerText||e.value||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').trim().slice(0,120)})).filter(x=>x.text) })`);
        return JSON.stringify(snapshot);
      },
    });
    return () => onBrowserController(null);
  }, [kind, onBrowserController]);
  return (
    <section className={`work-panel work-panel-${placement} chrome-no-drag`}>
      <header><div className="work-panel-tabs"><button className={kind === 'browser' ? 'selected' : ''} onClick={() => onKind('browser')}><Globe2 size={14} /> Browser</button><button className={kind === 'terminal' ? 'selected' : ''} onClick={() => onKind('terminal')}><SquareTerminal size={14} /> Terminal</button></div><button className="icon-button" onClick={onClose} title="Close panel"><X size={15} /></button></header>
      {kind === 'browser' ? <div className="embedded-browser"><form onSubmit={(event) => { event.preventDefault(); const target = address.trim(); if (target) void browserRef.current?.loadURL(/^https?:\/\//i.test(target) ? target : `https://${target}`); }}><div className="browser-nav"><button type="button" disabled={!browserNavigation.back} onClick={() => browserRef.current?.goBack()} title="Back"><ArrowLeft size={14} /></button><button type="button" disabled={!browserNavigation.forward} onClick={() => browserRef.current?.goForward()} title="Forward"><ArrowRight size={14} /></button><button type="button" onClick={() => browserRef.current?.reload()} title="Reload"><RefreshCw size={13} /></button></div><input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Search or enter address" /><button type="submit">Go</button></form><webview ref={browserRef} src="about:blank" partition="persist:hexa-browser" /></div> : <div className="embedded-terminal"><div className="terminal-output">{terminalLines.map((line, index) => <pre key={index}>{line}</pre>)}</div><form onSubmit={(event) => { event.preventDefault(); void runCommand(); }}><b>›</b><input autoFocus spellCheck={false} disabled={terminalBusy} value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} placeholder={terminalBusy ? 'Running…' : 'Type a command…'} /></form></div>}
    </section>
  );
}

function PluginDetailPage({ detail, onBack, onChange, busy }: { detail: any; onBack: () => void; onChange: () => void; busy: boolean }) {
  const plugin: PluginSummary = { ...detail.summary, marketplaceName: detail.marketplaceName, marketplacePath: detail.marketplacePath };
  return <div className="plugin-detail-page"><header><button className="icon-button" onClick={onBack} title="Back to plugins"><ArrowLeft size={18} /></button><div className="plugin-detail-identity"><div className="plugin-card-icon"><PluginArtwork plugin={plugin} /></div><div><h2>{plugin.interface?.displayName || plugin.name}</h2><p>{plugin.interface?.shortDescription || detail.marketplaceName}</p></div></div><button className={plugin.installed ? 'plugin-detail-remove' : 'plugin-detail-install'} disabled={busy} onClick={onChange}>{busy ? 'Working…' : plugin.installed ? 'Remove' : 'Install'}</button></header><div className="plugin-detail-body"><section><h3>About</h3><div className="plugin-readme">{detail.description || plugin.interface?.longDescription || 'No README information was provided for this plugin.'}</div></section>{detail.skills?.length > 0 && <section><h3>Skills</h3><div className="detail-capabilities">{detail.skills.map((skill: any) => <div key={skill.name}><Sparkles size={15} /><span><b>{skill.interface?.displayName || skill.name}</b><small>{skill.description}</small></span></div>)}</div></section>}<section><h3>Includes</h3><div className="plugin-detail-facts"><span>{detail.apps?.length || 0} apps</span><span>{detail.mcpServers?.length || 0} MCP servers</span><span>{detail.hooks?.length || 0} hooks</span></div></section></div></div>;
}

function mergePolledNativeState(current: ThreadView, canonical: ThreadView): ThreadView {
  const canonicalTurns = new Map((canonical.turns ?? []).map((turn: any) => [turn.id, turn]));
  return {
    ...current,
    turns: (current.turns ?? []).map((turn: any) => {
      const snapshot: any = canonicalTurns.get(turn.id);
      if (!snapshot) return turn;
      const currentItems: any[] = turn.items ?? [];
      const snapshotItems: any[] = snapshot.items ?? [];
      if (!snapshotItems.length) return { ...turn, status: snapshot.status ?? turn.status };
      const currentById = new Map(currentItems.map((item: any) => [item.id, item]));
      const mergedIds = new Set<string>();
      const mergedItems: any[] = [];

      // Canonical polling is a safety net for lifecycle notifications. Recover
      // both tools and native assistant dialogs in canonical rollout order,
      // but never manufacture dialog text from reasoning records. When the
      // polled dialog trails the live delta stream, keep the longer live text.
      for (const snapshotItem of snapshotItems) {
        const existing = currentById.get(snapshotItem.id);
        const recoverable = isToolItem(snapshotItem) || snapshotItem.type === 'agentMessage';
        if (!existing && !recoverable) continue;
        let mergedItem = existing ?? snapshotItem;
        if (existing && recoverable) {
          mergedItem = { ...existing, ...snapshotItem };
          if (
            snapshotItem.type === 'agentMessage' &&
            String(existing.text ?? '').length > String(snapshotItem.text ?? '').length
          ) mergedItem.text = existing.text;
        }
        mergedItems.push(mergedItem);
        mergedIds.add(String(mergedItem.id));
      }
      for (const item of currentItems) {
        if (!mergedIds.has(String(item.id))) {
          const afterIndex = item.afterItemId == null
            ? -1
            : mergedItems.findIndex((entry: any) => entry.id === item.afterItemId);
          if (afterIndex >= 0) mergedItems.splice(afterIndex + 1, 0, item);
          else mergedItems.push(item);
        }
      }
      return {
        ...turn,
        status: snapshot.status ?? turn.status,
        items: mergedItems,
      };
    }),
  };
}

type ImagePreview = { src: string; name: string };

function ThreadTranscript({ thread, preferences, liveTools, activityPaused, onPreviewImage }: { thread: ThreadView; preferences: AppPreferences | null; liveTools: Record<string, any>; activityPaused: boolean; onPreviewImage: (image: ImagePreview) => void }) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const pageSize = 32;
  const [visibleCount, setVisibleCount] = useState(() => Math.min(pageSize, turns.length));
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<{ height: number; top: number } | null>(null);
  useEffect(() => setVisibleCount(Math.min(pageSize, turns.length)), [thread.id]);
  useEffect(() => {
    setVisibleCount((count) => Math.min(turns.length, Math.max(count, Math.min(pageSize, turns.length))));
  }, [turns.length]);
  const loadOlder = useCallback(() => {
    const scroller = transcriptRef.current?.closest<HTMLElement>('.feed');
    if (scroller) restoreRef.current = { height: scroller.scrollHeight, top: scroller.scrollTop };
    setVisibleCount((count) => Math.min(turns.length, count + pageSize));
  }, [turns.length]);
  useLayoutEffect(() => {
    const restore = restoreRef.current;
    const scroller = transcriptRef.current?.closest<HTMLElement>('.feed');
    if (!restore || !scroller) return;
    scroller.scrollTop = restore.top + scroller.scrollHeight - restore.height;
    restoreRef.current = null;
  }, [visibleCount]);
  useEffect(() => {
    const scroller = transcriptRef.current?.closest<HTMLElement>('.feed');
    if (!scroller || visibleCount >= turns.length) return;
    const onScroll = () => { if (scroller.scrollTop < 180) loadOlder(); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [loadOlder, turns.length, visibleCount]);
  const hiddenCount = Math.max(0, turns.length - visibleCount);
  const visibleTurns = hiddenCount ? turns.slice(hiddenCount) : turns;
  const latestInProgressId = [...turns].reverse().find((turn) => turn.status === 'inProgress')?.id;
  const latestLiveTool = Object.values(liveTools).at(-1);
  return (
    <div className="transcript" ref={transcriptRef}>
      {hiddenCount > 0 && <button className="transcript-load-older" onClick={loadOlder}>Load {Math.min(pageSize, hiddenCount)} earlier messages <span>{hiddenCount} remaining</span></button>}
      {visibleTurns.map((turn) => (
        <TurnView key={turn.id} turn={turn} cwd={thread.cwd || ''} preferences={preferences} liveTool={liveTools[turn.id] ?? (turn.id === latestInProgressId ? latestLiveTool : undefined)} activityPaused={activityPaused} onPreviewImage={onPreviewImage} />
      ))}
    </div>
  );
}

function TurnView({ turn, cwd, preferences, liveTool, activityPaused, onPreviewImage }: { turn: any; cwd: string; preferences: AppPreferences | null; liveTool?: any; activityPaused: boolean; onPreviewImage: (image: ImagePreview) => void }) {
  const items = Array.isArray(turn?.items)
    ? turn.items.filter((item: unknown) => Boolean(item) && typeof item === 'object')
    : [];
  const visibleAgentItems = items.filter((item: any) => item.type === 'agentMessage' && Boolean(String(item.text ?? '').trim()));
  // Async delivery is still a native, user-facing assistant message. It is
  // mid-turn even when the engine stamps FinalAnswer, so render it without
  // allowing it to become the terminal response for the turn.
  const terminalAgentItems = visibleAgentItems.filter((item: any) => item.delivery !== 'async');
  const turnSettled = !['inProgress', 'running', 'pending'].includes(String(turn.status ?? ''));
  const turnCompleted = ['completed', 'complete', 'succeeded', 'success'].includes(String(turn.status ?? '').toLowerCase());
  const semanticFinal = [...terminalAgentItems].reverse().find((item: any) => ['finalAnswer', 'final_answer'].includes(item.phase));
  const finalAgent = semanticFinal ?? (turnCompleted ? terminalAgentItems.at(-1) : undefined);
  const completedWorkItems = items.filter((item: any) =>
    (item.type === 'plan' || isToolItem(item) || item.type === 'agentMessage') && item.id !== finalAgent?.id,
  );
  const compactionItems = items.filter((item: any) => item.type === 'contextCompaction');
  const generatedImages = items.filter((item: any) => item.type === 'imageGeneration' && Boolean(generatedImageSource(item)));
  const turnDiff = turn.diff || collectFileChangeDiff(items);
  const turnChangeFiles = collectFileChangeFiles(items);
  if (turnSettled && compactionItems.length && !finalAgent) {
      return <article className="turn"><div className="assistant-turn completed-turn-settled">{items.filter((item: any) => item.type === 'userMessage').map((item: any) => <UserMessage key={item.id} item={item} onPreviewImage={onPreviewImage} />)}<ToolItem item={compactionItems.at(-1)} /></div></article>;
  }
  if (finalAgent && completedWorkItems.some(isToolItem) && turnCompleted) {
    return (
      <article className="turn">
        <div className="assistant-turn completed-turn-settled">
          {items.map((item: any) => {
            const work = item.id === finalAgent.id
              ? <CompletedWork key={`completed-${turn.id}`} items={completedWorkItems} durationMs={turn.durationMs ?? turn.duration_ms} showRaw={preferences?.showRawReasoningForLocalModels ?? false} plan={turn.plan} />
              : null;
            if (item.type === 'reasoning' || isToolItem(item) || item.type === 'plan') return null;
            if (item.type === 'agentMessage' && item.id !== finalAgent.id) return null;
            if (item.type === 'userMessage') return <React.Fragment key={item.id}>{work}<UserMessage item={item} onPreviewImage={onPreviewImage} /></React.Fragment>;
            if (item.type === 'agentMessage') {
              const text = String(item.text ?? '');
              return <React.Fragment key={item.id}>{work}<AgentMessage item={item} final /><GeneratedImageResults items={generatedImages} onPreviewImage={onPreviewImage} />{(turnDiff || turnChangeFiles.length) ? <DiffSummary diff={turnDiff} cwd={cwd} filesOverride={turnChangeFiles} /> : null}<FinalMessageActions text={text} completedAt={item.completedAt ?? item.completed_at ?? turn.completedAt ?? turn.completed_at ?? turn.updatedAt ?? turn.updated_at} /></React.Fragment>;
            }
            return work;
          })}
        </div>
      </article>
    );
  }
  const nodes: React.ReactNode[] = [];
  let completedTools: any[] = [];
  const lastVisibleDialogIndex = items.findLastIndex((item: any) => item.type === 'agentMessage' && Boolean(String(item.text ?? '').trim()));
  const activeTool = liveTool ?? [...items].reverse().find((item: any) => isToolItem(item) && isItemInProgress(item));
  const flushCompletedTools = () => {
    if (completedTools.length === 1) {
      const tool = completedTools[0];
      nodes.push(<div className="transcript-row transcript-tool-row" key={`tool-${tool.id}`}><div className="tool-single"><ToolItem item={tool} /></div></div>);
    } else if (completedTools.length > 1) {
      nodes.push(<div className="transcript-row transcript-tool-row" key={`tools-${completedTools[0].id}`}><ToolCluster items={completedTools} defaultOpen={false} /></div>);
    }
    completedTools = [];
  };

  for (const [itemIndex, item] of items.entries()) {
    if (isToolItem(item)) {
      // A completed event does not close a batch. Keep trailing calls represented
      // by the live strip until a later assistant dialog establishes the phase
      // boundary, then promote the whole batch into its permanent cluster.
      // Completed calls belong to the permanent transcript immediately.  Do
      // not hold trailing calls behind a synthetic thinking row; this caused
      // some calls to disappear until a later refresh/paragraph boundary.
      if (!isItemInProgress(item)) completedTools.push(item);
      continue;
    }
    // A new visible dialog closes the tool phase initiated by the previous
    // assistant dialog. Reasoning items do not split a phase because the engine can
    // reason between several related tool calls.
    if (['userMessage', 'agentMessage', 'plan'].includes(item.type)) flushCompletedTools();
    if (item.type === 'userMessage') nodes.push(<UserMessage key={item.id} item={item} onPreviewImage={onPreviewImage} allowEdit={activityPaused && !turnSettled} />);
    else if (item.type === 'reasoning') continue;
    else if (item.type === 'agentMessage') {
      const final = turnCompleted && item.id === terminalAgentItems.at(-1)?.id;
      const text = String(item.text ?? '');
      nodes.push(<div className="transcript-row transcript-dialog-row" key={item.id}><AgentMessage item={item} final />{final && <FinalMessageActions text={text} completedAt={item.completedAt ?? item.completed_at ?? turn.completedAt ?? turn.completed_at ?? turn.updatedAt ?? turn.updated_at} />}</div>);
    }
    else if (item.type === 'plan') nodes.push(<div className="transcript-row transcript-dialog-row" key={item.id}><div className="agent-message selectable">{item.text || ''}</div></div>);
  }
  flushCompletedTools();
  if (turn.status === 'inProgress' && !activityPaused) {
    if (activeTool) nodes.push(<div className="transcript-row transcript-tool-row" key={`active-${activeTool.id}`}><ActiveToolStrip item={activeTool} /></div>);
    else {
      // Keep a visible thinking state while a slow model transitions between
      // streamed reasoning and the next tool event; never leave a blank gap.
      nodes.push(<div className="transcript-row transcript-tool-row" key="thinking-tail"><ThinkingStrip /></div>);
    }
  }

  return (
    <article className="turn">
      <div className="assistant-turn">
        {nodes}
        {turnSettled && turn.error?.message ? <div className="turn-error"><AlertTriangle size={15} /><span>{turn.error.message}</span></div> : null}
        {turnSettled && turn.plan?.length ? <PlanView plan={turn.plan} /> : null}
        {turnCompleted && (turnDiff || turnChangeFiles.length) ? <DiffSummary diff={turnDiff} cwd={cwd} filesOverride={turnChangeFiles} /> : null}
      </div>
    </article>
  );
}

function CompletedWork({ items, durationMs, showRaw, plan }: { items: any[]; durationMs?: number; showRaw: boolean; plan?: any[] }) {
  const [open, setOpen] = useState(false);
  const transcript: React.ReactNode[] = [];
  let toolGroup: any[] = [];
  let reasoningGroup: any[] = [];
  const flushTools = () => {
    if (!toolGroup.length) return;
    transcript.push(toolGroup.length === 1
      ? <div className="tool-single" key={`worked-tool-${toolGroup[0].id}`}><ToolItem item={toolGroup[0]} /></div>
      : <ToolCluster items={toolGroup} defaultOpen key={`worked-tools-${toolGroup[0].id}`} />);
    toolGroup = [];
  };
  const flushPhase = () => {
    flushTools();
    for (const reasoning of reasoningGroup) {
      transcript.push(<ReasoningBlock key={reasoning.id} item={reasoning} showRaw={showRaw} />);
    }
    reasoningGroup = [];
  };
  for (const item of items) {
    if (isToolItem(item)) {
      toolGroup.push(item);
      continue;
    }
    if (item.type === 'reasoning') {
      reasoningGroup.push(item);
      continue;
    }
    flushPhase();
    if (item.type === 'agentMessage' && item.text) {
      transcript.push(<AgentMessage key={item.id} item={item} />);
    }
    else if (item.type === 'plan') transcript.push(<div className="agent-message selectable" key={item.id}>{item.text || ''}</div>);
  }
  flushPhase();
  return (
    <div className="completed-work">
      <button className="completed-work-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Sparkles size={14} />
        <span>Worked{durationMs ? ` for ${formatWorkDuration(durationMs)}` : ''}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && <div className="completed-work-detail">{transcript}{plan?.length ? <PlanView plan={plan} /> : null}</div>}
    </div>
  );
}

function formatWorkDuration(durationMs: number) {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function UserMessage({ item, onPreviewImage, allowEdit = false }: { item: any; onPreviewImage: (image: ImagePreview) => void; allowEdit?: boolean }) {
  const content = Array.isArray(item?.content)
    ? item.content
    : typeof item?.content === 'string'
      ? [{ type: 'text', text: item.content }]
      : [];
  const text = content.filter((part: any) => part?.type === 'text' || (!part?.type && part?.text)).map((part: any) => String(part?.text || '')).filter(Boolean).join('\n');
  const attachments = content.filter((part: any) => part.type !== 'text' && (part.path || part.url || part.name));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 420 || text.split('\n').length > 7;
  useEffect(() => { if (!editing) setDraft(text); }, [text, editing]);
  useEffect(() => { setExpanded(false); }, [text]);
  const preventAttachmentPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.clipboardData.types.includes('Files') || event.clipboardData.types.includes('image/png') || event.clipboardData.types.includes('image/jpeg')) event.preventDefault();
  };
  return <div className={`user-message-wrap ${item.optimistic ? 'user-message-sending' : ''}`}>
    {attachments.length > 0 && <SentAttachments attachments={attachments} onPreviewImage={onPreviewImage} />}
    <div className="user-message-line">
      <div className="user-message">
        {editing
          ? <div className="user-message-edit"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onPaste={preventAttachmentPaste} autoFocus /><div><button onClick={() => { setDraft(text); setEditing(false); }}>Cancel</button><button onClick={() => setEditing(false)}>Done</button></div></div>
          : text && <div className="user-message-bubble"><div className={`user-message-content selectable ${isLong && !expanded ? 'collapsed' : ''}`}>{draft}</div>{isLong && <button className="user-message-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show less' : 'Show more'}</button>}</div>}
      </div>
      <div className="user-message-actions"><span>{formatMessageClock(item.createdAt ?? item.created_at ?? item.timestamp)}</span><button title="Copy message" onClick={() => void navigator.clipboard.writeText(editing ? draft : text)}><Copy size={14} /></button>{allowEdit && <button title="Edit paused message" onClick={() => setEditing((value) => !value)}><PencilLine size={14} /></button>}</div>
    </div>
  </div>;
}

function SentAttachments({ attachments, onPreviewImage }: { attachments: any[]; onPreviewImage: (image: ImagePreview) => void }) {
  const images = attachments.filter((part) => ['localImage', 'image', 'inputImage'].includes(part.type));
  const files = attachments.filter((part) => !images.includes(part));
  return <div className="sent-attachments">
    {images.length > 0 && <div className={`sent-image-stack count-${Math.min(images.length, 3)}`}>{images.map((part, index) => <button key={`${part.path || part.url}-${index}`} onClick={() => onPreviewImage({ src: rendererFileUrl(part.path || part.url), name: part.name || fileNameFromPath(part.path) || 'Attached image' })}><img src={rendererFileUrl(part.path || part.url)} alt={part.name || 'Attached image'} /></button>)}</div>}
    {files.map((part, index) => <div className="sent-file-card" key={`${part.path || part.name}-${index}`}><FileCode2 size={17} /><span><b>{part.name || fileNameFromPath(part.path) || 'Attachment'}</b><small>{attachmentTextPreview(part)}</small></span></div>)}
  </div>;
}

function ImageLightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const clampScale = (value: number) => Math.min(6, Math.max(.2, value));
  const zoom = (next: number) => setScale(clampScale(next));
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);
  return <div className="image-lightbox-backdrop chrome-no-drag" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="image-lightbox" role="dialog" aria-modal="true" aria-label={`Preview ${name}`}>
      <header><div><Image size={17} /><span title={name}>{name}</span></div><div><button title="Zoom out" onClick={() => zoom(scale - .2)}><ZoomOut size={16} /></button><span>{Math.round(scale * 100)}%</span><button title="Zoom in" onClick={() => zoom(scale + .2)}><ZoomIn size={16} /></button><button onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}>Reset</button><button className="icon-button" title="Close image" onClick={onClose}><X size={17} /></button></div></header>
      <div className="image-lightbox-canvas" onWheel={(event) => { event.preventDefault(); zoom(scale + (event.deltaY < 0 ? .15 : -.15)); }} onPointerDown={(event) => { dragRef.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { const drag = dragRef.current; if (drag) setOffset({ x: drag.originX + event.clientX - drag.x, y: drag.originY + event.clientY - drag.y }); }} onPointerUp={(event) => { dragRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}>
        <img draggable={false} src={src} alt={name} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} />
      </div>
    </section>
  </div>;
}

function rendererFileUrl(pathOrUrl: string) {
  if (!pathOrUrl || /^(https?:|data:|blob:|file:)/i.test(pathOrUrl)) return pathOrUrl;
  return encodeURI(`file:///${pathOrUrl.replace(/\\/g, '/')}`);
}

function fileNameFromPath(filePath?: string) {
  return filePath?.split(/[\\/]/).at(-1) || '';
}

function attachmentTextPreview(part: any) {
  const value = part.text ?? part.content ?? part.path ?? '';
  if (Array.isArray(value)) return value.map((entry) => typeof entry === 'string' ? entry : entry?.text || '').join(' ').slice(0, 180);
  return String(value).replace(/\s+/g, ' ').slice(0, 180);
}

function AgentMessage({ item, final = false }: { item: any; final?: boolean }) {
  const text: string = typeof item?.text === 'string' ? item.text : item?.text == null ? '' : JSON.stringify(item.text);
  if (!text.trim()) return null;
  // Models commonly terminate short progress dialogs with "\n\n". Those
  // boundary newlines are stream framing, not intentional paragraph spacing;
  // rendering them as blank Markdown rows adds space before the next tool or
  // dialog. Preserve blank lines inside the message while removing only empty
  // boundary lines for both live and completed transcripts.
  const displayText = text
    .replace(/\r\n/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '');
  return <MarkdownMessage text={displayText} />;
}

function FinalMessageActions({ text, completedAt }: { text: string; completedAt?: number | string }) {
  return <div className="final-message-actions"><button title="Copy response" onClick={() => void navigator.clipboard.writeText(text)}><Copy size={15} /></button><button title="Helpful"><ThumbsUp size={15} /></button><button title="Not helpful"><ThumbsDown size={15} /></button><span>{formatMessageClock(completedAt)}</span></div>;
}

function formatMessageClock(value?: number | string): string {
  if (value == null) return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date());
  const numeric = typeof value === 'number' ? value : Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function MarkdownMessage({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/(```[\s\S]*?```)/g).filter(Boolean);
  return <div className="agent-message agent-markdown selectable agent-message-reveal">{blocks.map((block, index) => {
    if (block.startsWith('```')) {
      const match = block.match(/^```([^\n]*)\n?([\s\S]*?)```$/);
      return <div className="markdown-code" key={index}><div><Code2 size={13} /><span>{match?.[1]?.trim() || 'code'}</span><button title="Copy code" onClick={() => void navigator.clipboard.writeText(match?.[2] || '')}><Copy size={13} /></button></div><pre><code>{match?.[2] || ''}</code></pre></div>;
    }
    return <MarkdownTextBlock text={block} key={index} />;
  })}<WebReferenceCards text={text} /></div>;
}

type WebReference = { title: string; url: string; image?: string };

function WebReferenceCards({ text }: { text: string }) {
  const links = [...text.matchAll(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)].map((match) => ({ title: match[1], url: match[2] }));
  const markdownImages = [...text.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g)].map((match) => ({ alt: match[1], url: match[2] }));
  const bareImages = [...text.matchAll(/https?:\/\/[^\s<>)"']+?\.(?:png|jpe?g|webp|gif)(?:\?[^\s<>)"']*)?/gi)].map((match) => ({ alt: '', url: match[0] }));
  const images = [...markdownImages, ...bareImages].filter((image, index, all) => all.findIndex((candidate) => candidate.url === image.url) === index);
  const unique: WebReference[] = links.filter((link, index) => links.findIndex((candidate) => candidate.url === link.url) === index).slice(0, 8).map((link, index) => {
    const image = images.find((entry) => entry.alt && link.title.toLowerCase().includes(entry.alt.toLowerCase())) ?? images[index];
    return { ...link, image: image?.url };
  });
  const [selected, setSelected] = useState<WebReference | null>(null);
  if (!unique.length) return null;
  return <><div className="web-reference-cards">{unique.map((link, index) => {
    let host = link.url;
    try { host = new URL(link.url).hostname.replace(/^www\./, ''); } catch { /* keep the URL */ }
    return <button key={link.url} onClick={() => setSelected(link)}>{link.image ? <img src={link.image} alt="" /> : <span className="web-card-placeholder"><Globe2 size={22} /></span>}<span><b>{link.title}</b><small>{host}</small></span><ChevronRight size={15} /></button>;
  })}</div>{selected && <div className="web-product-panel-backdrop chrome-no-drag" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><aside className="web-product-panel" role="dialog" aria-modal="true" aria-label={`Details for ${selected.title}`}><header><button className="icon-button" title="More options"><MoreHorizontal size={18} /></button><button className="icon-button" title="Close details" onClick={() => setSelected(null)}><X size={18} /></button></header>{selected.image ? <img className="web-product-hero" src={selected.image} alt={selected.title} /> : <div className="web-product-hero-placeholder"><Globe2 size={34} /><span>Preview unavailable</span></div>}<div className="web-product-copy"><h2>{selected.title}</h2><button className="web-product-visit" onClick={() => void window.hexa.openResource(selected.url)}>Visit site <ArrowRight size={15} /></button><h3>Sources</h3><div className="web-source-list">{unique.map((source) => <button className={source.url === selected.url ? 'selected' : ''} key={source.url} onClick={() => void window.hexa.openResource(source.url)}>{source.image ? <img src={source.image} alt="" /> : <Globe2 size={15} />}<span><b>{source.title}</b><small>{source.url}</small></span><ChevronRight size={14} /></button>)}</div></div></aside></div>}</>;
}

function MarkdownTextBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  return <>{lines.map((line, index) => {
    if (!line.trim()) return <div className="markdown-space" key={index} />;
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) return <div className={`markdown-heading level-${heading[1].length}`} key={index}>{renderInlineMarkdown(heading[2])}</div>;
    const list = line.match(/^\s*[-*]\s+(.+)$/);
    if (list) return <div className="markdown-list-row" key={index}><span>•</span><div>{renderInlineMarkdown(list[1])}</div></div>;
    return <div className="markdown-paragraph" key={index}>{renderInlineMarkdown(line)}</div>;
  })}</>;
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const tokens = text.split(/(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return tokens.map((token, index) => {
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const image = /\.(png|jpe?g|gif|webp|svg)$/i.test(link[2]);
      return <button className="markdown-resource-link" key={index} onClick={() => void window.hexa.openResource(link[2])}>{image ? <Image size={14} /> : isLocalResource(link[2]) ? <FileCode2 size={14} /> : <Link2 size={14} />}<span>{link[1]}</span></button>;
    }
    if (token.startsWith('`')) return <code className="markdown-inline-code" key={index}>{token.slice(1, -1)}</code>;
    if (token.startsWith('**')) return <strong key={index}>{token.slice(2, -2)}</strong>;
    return <React.Fragment key={index}>{token}</React.Fragment>;
  });
}

function isLocalResource(target: string) {
  return /^(file:\/\/|[a-z]:[\\/]|\/)/i.test(target);
}

function ReasoningBlock({ item, showRaw }: { item: any; showRaw: boolean }) {
  const summary = Array.isArray(item.summary) ? item.summary.map(String).join('\n') : String(item.summary || '');
  const raw = Array.isArray(item.content) ? item.content.map(String).join('\n') : String(item.content || '');
  const [open, setOpen] = useState(false);
  if (!summary && !raw) return null;
  return (
    <div className="reasoning-block">
      <button className="reasoning-head" onClick={() => setOpen((value) => !value)}>
        <span className="thinking-dot" />
        <span>{summary ? summary.split('\n')[0] : 'Thinking'}</span>
        {(summary.length > 90 || raw) && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </button>
      {open && <div className="reasoning-detail">{summary}{showRaw && raw ? `\n\n${raw}` : ''}</div>}
    </div>
  );
}

function ThinkingStrip() {
  return (
    <div className="activity-strip thinking-strip">
      <span className="thinking-orb" />
      <span className="shimmer-text">Thinking</span>
    </div>
  );
}

function ActiveToolStrip({ item }: { item: any }) {
  if (item.type === 'webSearch') return <WebSearchActivity item={item} active />;
  const { icon, label } = toolSummary(item);
  const files = item.type === 'fileChange' && Array.isArray(item.changes) ? item.changes : [];
  return (
    <div className={`activity-strip active-tool-strip ${files.length ? 'has-live-files' : ''}`}>
      <div className="active-tool-line">
        <span className="execution-icon">{icon}</span>
        <span className="shimmer-text execution-label">{label}</span>
        <span className="active-pulse" />
        {files.length ? <ChevronDown className="live-files-chevron" size={13} /> : null}
      </div>
      {files.length ? <div className="live-file-dropdown">
        {files.map((file: any, index: number) => {
          const active = !file.status || isItemInProgress(file);
          return <div className={`live-file-entry ${active ? 'active' : 'complete'}`} key={`${file.path ?? index}`}>
            <FileCode2 size={13} />
            <span className={active ? 'shimmer-text' : ''}>{String(file.path || 'File')}</span>
            <small>{active ? fileChangeVerb(file) : 'done'}</small>
          </div>;
        })}
      </div> : null}
      {item.type === 'imageGeneration' ? <GeneratedImageToolPreview item={item} active /> : null}
    </div>
  );
}

function GeneratedImageToolPreview({ item, active }: { item: any; active: boolean }) {
  const source = generatedImageSource(item);
  return <div className={`generated-image-tool-preview ${active ? 'active' : 'complete'}`}>{source ? <img src={source} alt="Generated image" /> : <div className="image-generation-forming"><Image size={24} /><span>Forming image</span></div>}</div>;
}

function generatedImageSource(item: any): string {
  const content = item.contentItems ?? item.content_items ?? item.result?.content ?? [];
  const image = Array.isArray(content) ? content.find((entry: any) => entry?.type === 'inputImage' || entry?.type === 'image' || entry?.imageUrl || entry?.image_url) : null;
  const result = typeof item.result === 'string' ? item.result : item.result?.imageUrl ?? item.result?.image_url ?? item.result?.url;
  const value = String(item.savedPath ?? item.saved_path ?? item.outputPath ?? item.output_path ?? item.path ?? image?.imageUrl ?? image?.image_url ?? result ?? item.imageUrl ?? item.image_url ?? '').trim();
  if (!value) return '';
  if (/^(https?:|data:|blob:|file:)/i.test(value) || /^(?:[a-z]:[\\/]|\/)/i.test(value)) return rendererFileUrl(value);
  const compact = value.replace(/\s+/g, '');
  if (compact.length > 256 && /^[a-z0-9+/]+={0,2}$/i.test(compact)) return `data:image/png;base64,${compact}`;
  return rendererFileUrl(value);
}

function GeneratedImageResults({ items, onPreviewImage }: { items: any[]; onPreviewImage: (image: ImagePreview) => void }) {
  const images = items.map((item, index) => ({ src: generatedImageSource(item), name: item.revisedPrompt ?? item.revised_prompt ?? `Generated image ${index + 1}` })).filter((image, index, all) => image.src && all.findIndex((candidate) => candidate.src === image.src) === index);
  if (!images.length) return null;
  return <div className={`generated-image-results count-${Math.min(images.length, 3)}`}>{images.map((image) => <button key={image.src} onClick={() => onPreviewImage(image)} title="Open generated image"><img src={image.src} alt={image.name} /></button>)}</div>;
}

function ToolCluster({ items, defaultOpen = true }: { items: any[]; defaultOpen?: boolean }) {
  return items.length > 0 && items.every((item) => item.type === 'webSearch')
    ? <WebSearchCluster items={items} defaultOpen={defaultOpen} />
    : <GenericToolCluster items={items} defaultOpen={defaultOpen} />;
}

function GenericToolCluster({ items, defaultOpen }: { items: any[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const groups = summarizeTools(items);
  return (
    <div className="tool-cluster cli-execution">
      <div className="tool-row">
        <button className="cluster-head" onClick={() => setOpen((value) => !value)}>
          <span className="execution-icon tool-row-icon">{toolClusterIcon(items)}</span>
          <span className="cluster-label">{groups.join(', ')}</span>
          <span className="cluster-hint">· transcript</span>
          <span className="cluster-count">{items.length}</span>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>
      {open && (
        <div className="cluster-items">
          {items.map((item) => <ToolItem key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
}

function ToolItem({ item }: { item: any }) {
  return item.type === 'webSearch' ? <WebSearchActivity item={item} /> : <GenericToolItem item={item} />;
}

function GenericToolItem({ item }: { item: any }) {
  const [open, setOpen] = useState(false);
  const summary = toolSummary(item);
  const detail = toolDetail(item);
  const shellCommand = item.type === 'commandExecution' || item.type === 'localShellCall'
    ? commandLabel(item.command).trim()
    : '';
  const hasPanel = Boolean(detail || shellCommand);
  return (
    <div className="tool-row">
      <button onClick={() => setOpen((value) => !value)}>
        <span className="execution-icon tool-row-icon">{summary.icon}</span>
        <span className="tool-row-text">{summary.label}</span>
        <span className={`tool-status ${item.status || 'completed'}`}>{item.status === 'failed' ? 'failed' : 'done'}</span>
        {hasPanel ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
      </button>
      {item.type === 'fileChange' && Array.isArray(item.changes) && item.changes.length > 0 ? <div className="tool-file-paths">{item.changes.map((change: any, index: number) => <button key={`${change.path ?? index}`} onClick={() => void window.hexa.openResource(String(change.path || ''))}><span>{fileChangeAction(change)}</span><b>{String(change.path || 'File')}</b></button>)}</div> : null}
      {item.type === 'imageGeneration' ? <GeneratedImageToolPreview item={item} active={isItemInProgress(item)} /> : null}
      {open && hasPanel ? <ToolExecutionPanel item={item} command={shellCommand} output={detail} /> : null}
    </div>
  );
}

type WebToolReference = {
  url: string;
  title: string;
  host: string;
  favicon?: string;
};

function WebSearchActivity({ item, active = false }: { item: any; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const references = webSearchReferences([item]);
  const currentUrl = webSearchCurrentUrl(item);
  const canExpand = references.length > 0;
  const label = webSearchLabel(item, active);
  const content = (
    <>
      <span className="execution-icon web-execution-icon"><WebActivityIcon url={currentUrl} active={active} /></span>
      <span className={active ? 'shimmer-text execution-label' : 'tool-row-text'}>{label}</span>
      {active ? <span className="active-pulse" /> : <span className={`tool-status ${item.status || 'completed'}`}>{item.status === 'failed' ? 'failed' : 'done'}</span>}
      {canExpand ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
    </>
  );
  return (
    <div className={active ? 'activity-strip active-tool-strip web-search-activity' : 'tool-row web-search-activity'}>
      {active
        ? <button className="active-tool-line web-search-head" disabled={!canExpand} aria-expanded={canExpand ? open : undefined} onClick={() => canExpand && setOpen((value) => !value)}>{content}</button>
        : <button className="web-search-head" disabled={!canExpand} aria-expanded={canExpand ? open : undefined} onClick={() => canExpand && setOpen((value) => !value)}>{content}</button>}
      {open && canExpand ? <WebSearchLinks references={references} /> : null}
    </div>
  );
}

function WebSearchCluster({ items, defaultOpen }: { items: any[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const references = webSearchReferences(items);
  const latest = items.at(-1);
  const currentUrl = [...items].reverse().map(webSearchCurrentUrl).find(Boolean) || '';
  const visitedCount = items.filter((item) => Boolean(webSearchCurrentUrl(item))).length;
  const label = visitedCount
    ? `Viewed ${visitedCount} website${visitedCount === 1 ? '' : 's'}`
    : references.length
      ? `Searched web · ${references.length} result${references.length === 1 ? '' : 's'}`
      : items.length === 1
        ? webSearchLabel(latest, false)
        : `Searched web ${items.length} times`;
  return (
    <div className="tool-cluster web-search-cluster">
      <div className="tool-row">
        <button className="cluster-head web-search-head" onClick={() => setOpen((value) => !value)}>
          <span className="execution-icon tool-row-icon web-execution-icon"><WebActivityIcon url={currentUrl} /></span>
          <span className="cluster-label">{label}</span>
          <span className="cluster-hint">· web</span>
          <span className="cluster-count">{items.length}</span>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>
      {open ? <WebSearchLinks references={references} /> : null}
    </div>
  );
}

function WebActivityIcon({ url, faviconUrl, active = false }: { url?: string; faviconUrl?: string; active?: boolean }) {
  const favicon = /^https?:\/\//i.test(String(faviconUrl || '')) ? String(faviconUrl) : webFaviconUrl(url);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [favicon]);
  return <span className={`web-activity-icon ${favicon && !failed ? 'site' : 'search'} ${active ? 'active' : ''}`}>
    {favicon && !failed ? <img src={favicon} alt="" onError={() => setFailed(true)} /> : <Globe2 size={13} />}
  </span>;
}

function WebSearchLinks({ references }: { references: WebToolReference[] }) {
  if (!references.length) return <div className="web-search-links-empty">No website links were returned.</div>;
  return <div className="web-search-links" aria-label="Websites visited during search">
    {references.map((reference) => <button key={reference.url} title={reference.url} onClick={() => void window.hexa.openResource(reference.url)}>
      <WebActivityIcon url={reference.url} faviconUrl={reference.favicon} />
      <span><b>{reference.title}</b><small>{reference.host}</small></span>
      <ArrowRight size={12} />
    </button>)}
  </div>;
}

function ToolExecutionPanel({ item, command, output }: { item: any; command: string; output: string }) {
  const isShell = item.type === 'commandExecution' || item.type === 'localShellCall';
  const failed = ['failed', 'declined', 'cancelled', 'canceled'].includes(String(item.status || '').toLowerCase());
  const running = isItemInProgress(item);
  const title = isShell ? 'Shell' : item.type === 'fileChange' ? 'File changes' : item.type === 'webSearch' ? 'Web' : 'Tool output';
  return (
    <section className={`tool-execution-panel ${failed ? 'failed' : running ? 'running' : 'success'}`} aria-label={`${title} output`}>
      <header>{title}</header>
      <div className="tool-execution-scroll">
        {command ? <div className="tool-execution-command"><span>$</span><code>{command}</code></div> : null}
        {output ? <pre>{output}</pre> : <div className="tool-execution-empty">No output</div>}
      </div>
      <footer>{failed ? <X size={14} /> : running ? <span className="active-pulse" /> : <Check size={14} />}<span>{failed ? 'Failed' : running ? 'Running' : 'Success'}</span></footer>
    </section>
  );
}

function PlanView({ plan }: { plan: any[] }) {
  const steps = Array.isArray(plan) ? plan : [];
  return (
    <div className="plan-card">
      <div className="plan-title"><Zap size={14} /> Plan</div>
      {steps.map((step, index) => (
        <div className="plan-step" key={`${index}-${String(step?.step ?? '')}`}>
          <span className={`plan-state ${String(step?.status ?? '')}`}>{step?.status === 'completed' ? <Check size={12} /> : index + 1}</span>
          <span>{String(step?.step ?? step ?? '')}</span>
        </div>
      ))}
    </div>
  );
}

function PlanActivityStrip({ plan }: { plan: any[] }) {
  const steps = Array.isArray(plan) ? plan : [];
  const completed = steps.filter((step: any) => step?.status === 'completed').length;
  return (
    <div className="composer-activity-bar plan-activity-strip">
      <div className="plan-activity-checklist">
        <div className="plan-activity-title"><Zap size={14} /> Plan</div>
        {steps.map((step, index) => (
          <div className="plan-step plan-activity-step" key={`${index}-${String(step?.step ?? '')}`}>
            <span className={`plan-state ${String(step?.status ?? '')}`}>{step?.status === 'completed' ? <Check size={12} /> : index + 1}</span>
            <span>{String(step?.step ?? step ?? '')}</span>
          </div>
        ))}
      </div>
      <div className="plan-activity-progress">
        <PlanPath />
        <span><b>Planning</b><small>{completed} of {steps.length} steps complete</small></span>
      </div>
    </div>
  );
}

function DiffSummary({ diff, cwd, filesOverride = [] }: { diff: string; cwd: string; filesOverride?: ParsedDiffFile[] }) {
  const [open, setOpen] = useState(false);
  const [undone, setUndone] = useState(false);
  const [changing, setChanging] = useState(false);
  const text = typeof diff === 'string' ? diff : JSON.stringify(diff, null, 2);
  const files = parseUnifiedDiff(text).length ? parseUnifiedDiff(text) : filesOverride;
  const [showAllFiles, setShowAllFiles] = useState(false);
  const added = files.reduce((total, file) => total + file.added, 0);
  const removed = files.reduce((total, file) => total + file.removed, 0);
  const toggleChanges = async () => {
    if (changing) return;
    setChanging(true);
    try {
      const result = await window.hexa.applyWorkspaceDiff({ cwd, diff: text, reverse: !undone });
      if (result.ok) setUndone((value) => !value);
    } finally {
      setChanging(false);
    }
  };
  return (
    <div className="diff-card rich-diff-card">
      <div className="diff-summary-head">
        <FileCode2 size={16} />
        <b>{diffFileSummary(files)}</b>
        <span className="diff-inline-stats"><em>+{added}</em><i>-{removed}</i></span>
        <button className="diff-undo-button" disabled={changing} onClick={() => void toggleChanges()}>{undone ? <RefreshCw size={14} /> : <ArrowLeft size={14} />}{changing ? 'Working…' : undone ? 'Reapply' : 'Undo'}</button>
        <button className="diff-review-button" onClick={() => setOpen(true)}>Review</button>
      </div>
      <div className="diff-compact-files">{files.slice(0, showAllFiles ? files.length : 4).map((file) => <button key={file.path} onClick={() => void window.hexa.openResource(file.path)}><span>{file.action}</span><b>{file.path}</b><em>+{file.added}</em><i>-{file.removed}</i></button>)}{files.length > 4 && <button className="diff-show-more" onClick={() => setShowAllFiles((value) => !value)}>{showAllFiles ? 'Show fewer files' : `Show ${files.length - 4} more files`}</button>}</div>
      {open && <DiffViewerModal files={files} raw={text} onClose={() => setOpen(false)} />}
    </div>
  );
}

function collectFileChangeDiff(items: any[]): string {
  const chunks = items
    .filter((item) => item?.type === 'fileChange' && item.status !== 'failed')
    .flatMap((item) => {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const changeDiffs = changes.map((change: any) => String(change?.diff ?? change?.patch ?? '')).filter(Boolean);
      return changeDiffs.length ? changeDiffs : [String(item.diff ?? item.patch ?? '')].filter(Boolean);
    });
  return chunks.join('\n').trim();
}

function collectFileChangeFiles(items: any[]): ParsedDiffFile[] {
  const files = items.filter((item) => item?.type === 'fileChange' && item.status !== 'failed').flatMap((item) => Array.isArray(item.changes) ? item.changes : []);
  return files.map((change: any, index: number) => {
    return parseFileChange(change, index);
  }).filter((file, index, all) => all.findIndex((candidate) => candidate.path === file.path) === index);
}

type ParsedDiffFile = { path: string; oldPath: string; action: 'Created' | 'Edited' | 'Deleted'; added: number; removed: number; rows: Array<{ oldNumber?: number; newNumber?: number; oldText?: string; newText?: string; kind: 'same' | 'changed' | 'added' | 'removed' }> };

function parseFileChange(change: any, index: number): ParsedDiffFile {
  const path = String(change?.path ?? change?.filePath ?? `File ${index + 1}`);
  const action = fileChangeAction(change);
  const text = String(change?.diff ?? change?.patch ?? '');
  // The app-server intentionally sends add/delete changes as their complete
  // contents. Updates carry a unified diff. Treating both forms as a Git patch
  // left new files with a real entry but an empty review pane.
  if (action === 'Created' || action === 'Deleted') {
    const lines = splitDiffContent(text);
    const rows = lines.map((line, lineIndex) => action === 'Created'
      ? { newNumber: lineIndex + 1, newText: line, kind: 'added' as const }
      : { oldNumber: lineIndex + 1, oldText: line, kind: 'removed' as const });
    return {
      path,
      oldPath: action === 'Created' ? 'Does not exist' : path,
      action,
      added: action === 'Created' ? rows.length : 0,
      removed: action === 'Deleted' ? rows.length : 0,
      rows,
    };
  }
  const parsed = parseUnifiedDiff(text, path)[0];
  if (parsed) return { ...parsed, path: parsed.path === 'Previous' ? path : parsed.path, oldPath: parsed.oldPath === 'Previous' ? path : parsed.oldPath, action };
  return { path, oldPath: String(change?.oldPath ?? path), action, added: Number(change?.added ?? 0), removed: Number(change?.removed ?? 0), rows: [] };
}

function splitDiffContent(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  return lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

function parseUnifiedDiff(text: string, fallbackPath = 'Previous'): ParsedDiffFile[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const gitSections = normalized.split(/^diff --git /m).slice(1);
  const plainSections = normalized
    .split(/(?=^--- .*\n\+\+\+ )/m)
    .filter((section) => /^--- .*\n\+\+\+ /m.test(section));
  const sections = gitSections.length ? gitSections : plainSections.length ? plainSections : normalized.includes('@@ ') ? [normalized] : [];
  return sections.map((section) => {
    const header = section.match(/^a\/(.*?) b\/(.*)$/m);
    const fileHeaders = section.match(/^---\s+(.+?)\n\+\+\+\s+(.+?)$/m);
    const stripPrefix = (value: string) => value.replace(/^(?:a|b)\//, '').replace(/\t.*$/, '');
    const oldPath = header?.[1] || (fileHeaders ? stripPrefix(fileHeaders[1]) : fallbackPath);
    const path = header?.[2] || (fileHeaders ? stripPrefix(fileHeaders[2]) : fallbackPath);
    const rows: ParsedDiffFile['rows'] = [];
    let oldNumber = 0;
    let newNumber = 0;
    let removedQueue: Array<{ number: number; text: string }> = [];
    const flushRemoved = () => {
      for (const line of removedQueue) rows.push({ oldNumber: line.number, oldText: line.text, kind: 'removed' });
      removedQueue = [];
    };
    for (const line of section.split('\n')) {
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) { flushRemoved(); oldNumber = Number(hunk[1]); newNumber = Number(hunk[2]); continue; }
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) continue;
      if (line.startsWith('-')) { removedQueue.push({ number: oldNumber++, text: line.slice(1) }); continue; }
      if (line.startsWith('+')) {
        const removed = removedQueue.shift();
        rows.push({ oldNumber: removed?.number, newNumber: newNumber++, oldText: removed?.text, newText: line.slice(1), kind: removed ? 'changed' : 'added' });
        continue;
      }
      flushRemoved();
      if (line.startsWith(' ')) rows.push({ oldNumber: oldNumber++, newNumber: newNumber++, oldText: line.slice(1), newText: line.slice(1), kind: 'same' });
    }
    flushRemoved();
    const action = /new file mode|--- \/dev\/null/.test(section) ? 'Created' : /deleted file mode|\+\+\+ \/dev\/null/.test(section) ? 'Deleted' : 'Edited';
    return { path, oldPath, action, rows, added: rows.filter((row) => row.kind === 'added' || row.kind === 'changed').length, removed: rows.filter((row) => row.kind === 'removed' || row.kind === 'changed').length };
  });
}

function diffFileSummary(files: ParsedDiffFile[]): string {
  const actions = new Set(files.map((file) => file.action));
  const count = files.length || 1;
  const label = actions.has('Created') && actions.has('Edited') ? 'Created and edited' : actions.has('Created') ? 'Created' : actions.has('Deleted') && actions.has('Edited') ? 'Edited and deleted' : actions.has('Deleted') ? 'Deleted' : 'Edited';
  return `${label} ${count} file${count === 1 ? '' : 's'}`;
}

function DiffViewerModal({ files, raw, onClose }: { files: ParsedDiffFile[]; raw: string; onClose: () => void }) {
  const [selected, setSelected] = useState(0);
  const file = files[selected] ?? { path: 'Changes', oldPath: 'Previous', action: 'Edited' as const, rows: [], added: 0, removed: 0 };
  return createPortal(<div className="modal-backdrop diff-viewer-backdrop chrome-no-drag" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="diff-viewer" role="dialog" aria-modal="true" aria-label="Review changes">
      <header><div><FileCode2 size={20} /><span><b>Review changes</b><small>{files.length} file{files.length === 1 ? '' : 's'} changed</small></span></div><div className="diff-viewer-actions"><button title="Copy diff" onClick={() => void navigator.clipboard.writeText(raw)}><Copy size={15} /> Copy diff</button><button className="icon-button" title="Close review" onClick={onClose}><X size={17} /></button></div></header>
      <div className="diff-viewer-body">
        <aside>{files.map((entry, index) => <button className={selected === index ? 'selected' : ''} key={`${entry.path}-${index}`} onClick={() => setSelected(index)}><FileCode2 size={14} /><span><b>{entry.path.split(/[\\/]/).at(-1)}</b><small>{entry.path}</small></span><em>+{entry.added}</em><i>-{entry.removed}</i></button>)}</aside>
        <main><div className="diff-file-heading"><span>{file.oldPath}</span><span>{file.path}</span></div><div className="side-by-side-diff"><div className="diff-pane"><div className="diff-pane-label">Before</div>{file.rows.length ? file.rows.map((row, index) => <DiffCodeLine key={`old-${index}`} number={row.oldNumber} text={row.oldText} kind={row.kind === 'added' ? 'empty' : row.kind} />) : <DiffEmptyState action={file.action} side="before" />}</div><div className="diff-pane"><div className="diff-pane-label">After</div>{file.rows.length ? file.rows.map((row, index) => <DiffCodeLine key={`new-${index}`} number={row.newNumber} text={row.newText} kind={row.kind === 'removed' ? 'empty' : row.kind} />) : <DiffEmptyState action={file.action} side="after" />}</div></div></main>
      </div>
    </section>
  </div>, document.body);
}

function DiffCodeLine({ number, text = '', kind }: { number?: number; text?: string; kind: string }) {
  const tokens = text.split(/(\b(?:const|let|var|function|return|if|else|for|while|class|interface|type|import|from|export|async|await|true|false|null|undefined)\b|['"`][^'"`]*['"`]|\/\/.*$|\b\d+(?:\.\d+)?\b)/g);
  return <div className={`diff-code-line ${kind}`}><span className="diff-line-number">{number ?? ''}</span><code>{tokens.map((token, index) => <span className={/^['"`]/.test(token) ? 'syntax-string' : /^\/\//.test(token) ? 'syntax-comment' : /^\d/.test(token) ? 'syntax-number' : /^(const|let|var|function|return|if|else|for|while|class|interface|type|import|from|export|async|await|true|false|null|undefined)$/.test(token) ? 'syntax-keyword' : ''} key={index}>{token}</span>)}</code></div>;
}

function DiffEmptyState({ action, side }: { action: ParsedDiffFile['action']; side: 'before' | 'after' }) {
  const message = action === 'Created' && side === 'before'
    ? 'This file did not exist before this change.'
    : action === 'Deleted' && side === 'after'
      ? 'This file was deleted by this change.'
      : 'Hexa Engine did not provide patch contents for this file.';
  return <div className="diff-empty-state">{message}</div>;
}

function ApprovalStack({ approvals, onResolve }: { approvals: ApprovalState[]; onResolve(id: number | string): void }) {
  if (!approvals.length) return null;
  const request = approvals[0];
  const params: any = request.params ?? {};
  const isPermission = request.method === 'item/permissions/requestApproval';
  const isUserInput = request.method === 'item/tool/requestUserInput';
  const isMcpElicitation = request.method === 'mcpServer/elicitation/request';
  const isV2Command = request.method === 'item/commandExecution/requestApproval';
  const isLegacyCommand = request.method === 'execCommandApproval';
  const isV2File = request.method === 'item/fileChange/requestApproval';
  const isLegacyFile = request.method === 'applyPatchApproval';
  const isCommand = isV2Command || isLegacyCommand;
  const isFile = isV2File || isLegacyFile;
  const title = isPermission
    ? 'Permission request'
    : isUserInput
      ? 'Shell needs input'
      : isMcpElicitation
        ? `${params.serverName || 'MCP'} needs input`
        : isFile
          ? 'Approve file changes?'
          : isCommand
            ? 'Approve command?'
            : 'Shell needs a client response';
  const detail = params.command
    ? commandLabel(params.command)
    : params.reason || params.message || params.cwd || request.method;

  async function resolveKnown(decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel') {
    if (isPermission) {
      const requested = params.permissions ?? {};
      const permissions = decision === 'accept' || decision === 'acceptForSession'
        ? Object.fromEntries(Object.entries(requested).filter(([, value]) => value != null))
        : {};
      await window.hexa.respond(request.id, {
        permissions,
        scope: decision === 'acceptForSession' ? 'session' : 'turn',
      });
    } else if (isUserInput) {
      if (decision === 'decline' || decision === 'cancel') {
        await window.hexa.respond(request.id, { answers: {} });
      } else {
        const answers: Record<string, { answers: string[] }> = {};
        for (const question of params.questions ?? []) {
          const optionText = Array.isArray(question.options) && question.options.length
            ? `\n\nOptions:\n${question.options.map((entry: any) => `• ${entry.label}${entry.description ? ` — ${entry.description}` : ''}`).join('\n')}`
            : '';
          const value = prompt(`${question.header ? `${question.header}\n\n` : ''}${question.question || 'Enter a response'}${optionText}`) ?? '';
          answers[question.id] = { answers: value ? [value] : [] };
        }
        await window.hexa.respond(request.id, { answers });
      }
    } else if (isMcpElicitation) {
      if (decision === 'decline' || decision === 'cancel') {
        await window.hexa.respond(request.id, { action: decision === 'cancel' ? 'cancel' : 'decline', content: null, _meta: null });
      } else if (params.mode === 'url') {
        await window.hexa.respond(request.id, { action: 'accept', content: null, _meta: null });
      } else {
        const raw = prompt(`${params.message || 'MCP requested structured input'}\n\nEnter a JSON object:`) ?? '';
        if (!raw.trim()) {
          await window.hexa.respond(request.id, { action: 'cancel', content: null, _meta: null });
        } else {
          try {
            await window.hexa.respond(request.id, { action: 'accept', content: JSON.parse(raw), _meta: null });
          } catch {
            alert('That MCP response was not valid JSON. The request was left open so you can try again.');
            return;
          }
        }
      }
    } else if (isV2Command || isV2File) {
      // V2 approval methods use accept/decline/cancel. Keep this separate from
      // the legacy methods below: their wire enum is different.
      await window.hexa.respond(request.id, { decision });
    } else if (isLegacyCommand || isLegacyFile) {
      // Legacy app-server approvals use ReviewDecision, not the v2 decision
      // enum. Sending `accept` here is rejected by the protocol and leaves the
      // command/patch unapplied.
      const legacyDecision = decision === 'accept'
        ? 'approved'
        : decision === 'acceptForSession'
          ? 'approved_for_session'
          : decision === 'cancel'
            ? 'abort'
            : { denied: { rejection: 'Denied in Hexa.' } };
      await window.hexa.respond(request.id, { decision: legacyDecision });
    } else {
      await window.hexa.respondError(request.id, -32601, `Hexa has no first-class response renderer for ${request.method}. Use Developer → RPC console or update the Hexa Engine protocol adapter.`);
    }
    onResolve(request.id);
  }

  return (
    <div className="approval-card">
      <div className="approval-icon"><ShieldCheck size={18} /></div>
      <div className="approval-copy">
        <b>{title}</b>
        <span>{detail}</span>
      </div>
      <div className="approval-actions">
        <button className="approval-secondary" onClick={() => void resolveKnown('decline')}>{isUserInput ? 'Skip' : 'Deny'}</button>
        {(isPermission || isLegacyCommand || isLegacyFile || ((isV2Command || isV2File) && (!Array.isArray(params.availableDecisions) || params.availableDecisions.includes('acceptForSession')))) && <button className="approval-secondary" onClick={() => void resolveKnown('acceptForSession')}>Allow for session</button>}
        <button className="approval-primary" onClick={() => void resolveKnown('accept')}>{isUserInput ? 'Answer' : isMcpElicitation ? 'Respond' : 'Allow'}</button>
      </div>
    </div>
  );
}

function ModelPopover({ models, selectedModel, effort, effortOptions, customProvider, customProviderId, onModel, onEffort }: {
  models: Model[];
  selectedModel: string;
  effort: string;
  effortOptions: string[];
  customProvider: boolean;
  customProviderId?: string;
  onModel(model: string): void;
  onEffort(effort: string): void;
}) {
  const [showModels, setShowModels] = useState(false);
  const selected = models.find((model) => model.model === selectedModel || model.id === selectedModel);
  return (
    <div className="popover model-popover">
      <div className="popover-title">Reasoning</div>
      <div className="effort-list">
        {effortOptions.map((option) => (
          <button key={option} className={option === effort ? 'selected' : ''} onClick={() => onEffort(option)}>
            <span>{friendlyEffort(option)}</span>{option === effort && <Check size={17} />}
          </button>
        ))}
      </div>
      <div className="popover-separator" />
      <button className="model-submenu-trigger" onClick={() => setShowModels((value) => !value)}>
        <span>{customProvider ? 'Custom' : selected?.displayName || selectedModel || 'Model'}</span>
        <ChevronRight size={17} className={showModels ? 'rotated' : ''} />
      </button>
      {showModels && (
        <div className="model-list submenu-list">
          {customProvider && (
            <div className="custom-provider-card"><Braces size={16} /><span><b>Custom</b><small>{customProviderId} from config.toml</small></span><Check size={14} /></div>
          )}
          {models.slice(0, 18).map((model) => (
            <button key={model.id} className={model.model === selectedModel ? 'selected' : ''} onClick={() => onModel(model.model)}>
              <span className="model-logo"><Bot size={15} /></span>
              <span><b>{model.displayName}</b><small>{model.description || model.model}</small></span>
              {model.model === selectedModel && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RuntimeOverlay({ status, onSettings }: { status: HexaEngineStatus; onSettings: () => void }) {
  const isError = status.phase === 'error';
  return (
    <div className="runtime-overlay">
      <div className="runtime-card">
        <HexaLogo className="runtime-logo" />
        <h2>{isError ? 'Hexa Engine needs attention' : status.message}</h2>
        <p>{status.detail || (status.phase === 'building' ? 'First launch compiles the included open-source engine. This can take several minutes.' : 'Preparing Hexa Engine…')}</p>
        {typeof status.progress === 'number' && <div className="build-progress"><span style={{ width: `${Math.max(4, status.progress * 100)}%` }} /></div>}
        {isError && (
          <div className="runtime-actions">
            <button onClick={() => void window.hexa.restartEngine()}><RefreshCw size={15} /> Retry Hexa Engine</button>
            <button onClick={() => void window.hexa.rebuildEngine()}><Hammer size={15} /> Rebuild</button>
            <button onClick={onSettings}><Settings size={15} /> Settings</button>
          </div>
        )}
      </div>
    </div>
  );
}

function BootSplash() {
  return <div className="boot-splash"><HexaLogo /></div>;
}

function AppTitleBar({ controls, showMenus = true }: { controls?: React.ReactNode; showMenus?: boolean }) {
  const platform = window.hexa.platform === 'darwin'
    ? 'macos'
    : window.hexa.platform === 'win32'
      ? 'windows'
      : 'linux';
  return (
    <div className={`app-titlebar app-titlebar-${platform}`}>
      {controls}
      {showMenus && <TitlebarMenus />}
      <TitlebarUpdate />
    </div>
  );
}

function TitlebarUpdate() {
  const [state, setState] = useState<ShellUpdateState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let disposed = false;
    void window.hexa.getUpdateState().then((next) => { if (!disposed) setState(next); });
    const unsubscribe = window.hexa.onUpdateState(setState);
    return () => { disposed = true; unsubscribe(); };
  }, []);

  if (!state || !['available', 'downloading', 'downloaded', 'error'].includes(state.phase)) return null;
  const downloaded = state.phase === 'downloaded';
  const downloading = state.phase === 'downloading';
  const failed = state.phase === 'error';
  const label = downloaded
    ? 'Restart to update'
    : downloading
      ? `Downloading ${Math.round(state.progress ?? 0)}%`
      : failed
        ? 'Update check failed'
        : `Update Hexa to ${state.availableVersion ?? 'the latest version'}`;

  const activate = () => {
    if (downloading) return;
    if (failed) {
      void window.hexa.checkForUpdates();
      return;
    }
    setConfirmOpen(true);
  };

  return <>
    <button className={`titlebar-update chrome-no-drag ${state.phase}`} onClick={activate} disabled={downloading} title={state.message}>
      {downloading ? <RefreshCw className="update-spin" size={13} /> : downloaded ? <Check size={13} /> : <Sparkles size={13} />}
      <span>{label}</span>
    </button>
    {confirmOpen && createPortal(
      <div className="update-confirm-backdrop chrome-no-drag" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmOpen(false); }}>
        <section className="update-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="update-confirm-title">
          <div className="update-confirm-icon">{downloaded ? <Check size={23} /> : <Sparkles size={23} />}</div>
          <h2 id="update-confirm-title">{downloaded ? 'Restart and install the update?' : `Download Hexa ${state.availableVersion ?? 'update'}?`}</h2>
          <p>{downloaded
            ? 'Hexa will close, replace the shell and bundled engine runtime together, then reopen on the current version.'
            : 'The update includes the Hexa shell and its complete bundled engine runtime. You can keep working while it downloads.'}</p>
          <div className="update-release-notes">
            <div><Sparkles size={13} /><b>What’s new in {state.availableVersion ?? 'this release'}</b></div>
            <div className="update-release-notes-body">
              {state.releaseNotes?.trim()
                ? <MarkdownMessage text={state.releaseNotes} />
                : <span className="update-release-notes-empty">No release notes were provided for this version.</span>}
            </div>
          </div>
          <div className="update-confirm-actions">
            <button onClick={() => setConfirmOpen(false)}>{downloaded ? 'Later' : 'Not now'}</button>
            <button className="primary" onClick={() => {
              setConfirmOpen(false);
              if (downloaded) void window.hexa.installUpdate();
              else void window.hexa.downloadUpdate();
            }}>{downloaded ? 'Restart and update' : 'Download update'}</button>
          </div>
        </section>
      </div>,
      document.body,
    )}
  </>;
}

function TitlebarMenus() {
  const [openMenu, setOpenMenu] = useState<'file' | 'edit' | 'view' | 'help' | null>(null);

  useEffect(() => window.hexa.onAppMenuState((state) => {
    setOpenMenu(state.open ? state.name : (current) => current === state.name ? null : current);
  }), []);

  function showMenu(name: 'file' | 'edit' | 'view' | 'help', target: HTMLButtonElement) {
    const bounds = target.getBoundingClientRect();
    void window.hexa.showAppMenu(name, { x: bounds.left, y: bounds.bottom });
  }

  return <div className="titlebar-menus chrome-no-drag" aria-label="Application menu">
    {(['file', 'edit', 'view', 'help'] as const).map((name) => <button
      key={name}
      aria-expanded={openMenu === name}
      onClick={(event) => showMenu(name, event.currentTarget)}
      onMouseEnter={(event) => { if (openMenu && openMenu !== name) showMenu(name, event.currentTarget); }}
    >{name[0].toUpperCase() + name.slice(1)}</button>)}
  </div>;
}

function accountLabel(account: any, mode?: 'openai' | 'local'): string {
  if (mode === 'local') return 'Local';
  return account?.name || account?.displayName || account?.email || account?.user?.email || (account ? 'OpenAI account' : 'Sign in');
}

function normalizeAccountPayload(payload: any): any {
  const candidate = payload?.account ?? payload?.user ?? payload?.profile ?? payload;
  return candidate?.type || candidate?.email || candidate?.planType || candidate?.plan_type ? candidate : null;
}

function AccountAvatar({ account, mode }: { account: any; mode?: 'openai' | 'local' }) {
  if (account?.imageUrl) return <img className="account-avatar account-image" src={account.imageUrl} alt="" />;
  const label = accountLabel(account, mode);
  return <span className="account-avatar">{account?.email ? label[0].toUpperCase() : <User size={14} />}</span>;
}

function AccountPopover({ account, mode, onOpenAI, onLocal }: { account: any; mode: 'openai' | 'local'; onOpenAI(): void; onLocal(): void }) {
  return (
    <div className="popover account-popover">
      {mode === 'openai' && <button className="selected" onClick={onOpenAI}><Globe2 size={16} /><span><b>{account?.email || 'OpenAI account'}</b><small>Current OpenAI account</small></span><Check size={14} /></button>}
      {mode === 'local' && <button className="selected" onClick={onLocal}><SquareTerminal size={16} /><span><b>Local</b><small>Current local provider</small></span><Check size={14} /></button>}
      {mode === 'local' && <button onClick={onOpenAI}><Globe2 size={16} /><span><b>Switch account</b><small>Choose an OpenAI account</small></span></button>}
      {mode === 'openai' && <button onClick={onLocal}><SquareTerminal size={16} /><span><b>Switch to Local</b><small>Use a provider on this computer</small></span></button>}
    </div>
  );
}

function UsagePopover({ stats }: { stats: any }) {
  const response = stats?.limits ?? {};
  const byId = response.rateLimitsByLimitId ?? response.rate_limits_by_limit_id;
  const topLevelSnapshot = response.rateLimits ?? response.rate_limits;
  const mappedSnapshots = byId && typeof byId === 'object' ? Object.entries(byId) as [string, any][] : [];
  const mappedPrimary = mappedSnapshots.find(([limitId, snapshot]) => {
    const id = String(snapshot?.limitId ?? snapshot?.limit_id ?? limitId ?? '').toLowerCase();
    return !id || id === 'codex';
  })?.[1];
  // account/rateLimits/read exposes the normal account quota in the top-level
  // backward-compatible bucket. The map can also contain model/feature-specific
  // buckets, which previously caused a second unlabeled "Weekly" row here.
  const primarySnapshot = topLevelSnapshot ?? mappedPrimary ?? mappedSnapshots[0]?.[1];
  const snapshots = primarySnapshot ? [primarySnapshot] : [];
  const windows = snapshots.flatMap((snapshot) => [snapshot?.primary, snapshot?.secondary]
    .filter(Boolean)
    .map((window: any) => ({ snapshot, window })));
  const plan = snapshots.find((snapshot) => snapshot?.planType || snapshot?.plan_type)?.planType
    ?? snapshots.find((snapshot) => snapshot?.planType || snapshot?.plan_type)?.plan_type;
  return (
    <div className="usage-popover popover">
      <div className="usage-popover-head"><span><b>Usage</b><small>{plan ? `${humanizeLabel(plan)} plan` : 'Current plan limits'}</small></span><RefreshCw size={13} /></div>
      {!stats ? <div className="usage-loading">Loading current limits…</div> : windows.length ? (
        <div className="usage-windows">
          {windows.map(({ snapshot, window }, index) => {
            const used = Math.max(0, Math.min(100, Number(window.usedPercent ?? window.used_percent ?? 0)));
            const duration = Number(window.windowDurationMins ?? window.window_duration_mins ?? 0);
            const reset = Number(window.resetsAt ?? window.resets_at ?? 0);
            return <div className="usage-window" key={`${snapshot.limitId ?? snapshot.limit_id ?? 'engine'}-${duration}-${index}`}>
              <div><b>{rateWindowLabel(duration, snapshot.limitName ?? snapshot.limit_name)}</b><span>{Math.max(0, 100 - used)}% remaining</span></div>
              <div className="usage-meter"><span style={{ width: `${Math.max(0, 100 - used)}%` }} /></div>
              <small>{reset ? `Resets ${formatResetTime(reset)}` : 'Reset time unavailable'}</small>
            </div>;
          })}
        </div>
      ) : <div className="usage-loading">No plan limits were reported by the engine.</div>}
      {stats?.refreshedAt && <div className="usage-updated">Updated {new Date(stats.refreshedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>}
    </div>
  );
}

function rateWindowLabel(durationMinutes: number, fallback?: string) {
  if (durationMinutes > 0 && durationMinutes < 60) return `${durationMinutes} minute`;
  if (durationMinutes > 0 && durationMinutes < 1_440) return `${Math.round(durationMinutes / 60)} hour`;
  if (durationMinutes === 10_080) return 'Weekly';
  if (durationMinutes >= 1_440) return `${Math.round(durationMinutes / 1_440)} day`;
  return fallback || 'Plan limit';
}

function formatResetTime(timestampSeconds: number) {
  const date = new Date(timestampSeconds * 1000);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function humanizeLabel(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function AccountSwitcher({ account, mode, onOpenAI, onLocal, onClose }: { account: any; mode: 'openai' | 'local'; onOpenAI(): Promise<void>; onLocal(): Promise<void>; onClose(): void }) {
  return (
    <div className="account-switcher">
      <div className="onboarding-grid" /><div className="onboarding-orbit orbit-one" />
      <div className="account-switcher-card">
        <button className="account-switcher-close" onClick={onClose}><X size={16} /></button>
        <HexaLogo />
        <span className="eyebrow">ACCOUNT SWITCHER</span>
        <h2>Choose how to continue</h2>
        <p>Connect an OpenAI account or keep this shell isolated with a local provider.</p>
        <div className="onboarding-options">
          <button onClick={() => void onOpenAI()}><Globe2 size={21} /><span><b>{account ? accountLabel(account, mode) : 'OpenAI'}</b><small>Sign in securely with OpenAI</small></span><ChevronRight size={16} /></button>
          <button onClick={() => void onLocal()}><SquareTerminal size={21} /><span><b>Local</b><small>Do not use OpenAI credentials</small></span><ChevronRight size={16} /></button>
        </div>
      </div>
    </div>
  );
}

function Onboarding({ account, mode, cwd, step, onStep, onChooseFolder, onOpenAI, onLocal, onFinish }: {
  account: any;
  mode: 'openai' | 'local';
  cwd: string;
  step: number;
  onStep(step: number): void;
  onChooseFolder(): Promise<void>;
  onOpenAI(): Promise<void>;
  onLocal(): Promise<void>;
  onFinish(): Promise<void>;
}) {
  const [leaving, setLeaving] = useState(false);
  const pages = 4;
  async function complete() {
    setLeaving(true);
    await new Promise((resolve) => window.setTimeout(resolve, 460));
    await onFinish();
  }
  return (
    <div className={`onboarding onboarding-step-${step} ${leaving ? 'leaving' : ''}`}>
      <div className="onboarding-grid" />
      <div className="onboarding-orbit orbit-one" /><div className="onboarding-orbit orbit-two" />
      <div className="onboarding-card">
        <div className="onboarding-progress">{Array.from({ length: pages }, (_, index) => <span key={index} className={index <= step ? 'active' : ''} />)}</div>
        {step === 0 && <div className="onboarding-page hero-page"><HexaLogo /><span className="eyebrow">YOUR LOCAL CODING WORKSPACE</span><h1>Welcome to Hexa</h1><p>A focused, technical workspace where ideas become working software.</p></div>}
        {step === 1 && <div className="onboarding-page"><span className="eyebrow">ACCOUNT</span><h2>What account do you want to use?</h2><p>Choose OpenAI for hosted access, or keep the Shell in local-model mode.</p><div className="onboarding-options"><button className={mode === 'openai' ? 'selected' : ''} onClick={() => void onOpenAI()}><Globe2 size={21} /><span><b>{account ? accountLabel(account, mode) : 'OpenAI'}</b><small>{account ? 'Connected through the Shell' : 'Sign in securely in a browser panel'}</small></span>{mode === 'openai' && <Check size={16} />}</button><button className={mode === 'local' ? 'selected' : ''} onClick={() => void onLocal()}><SquareTerminal size={21} /><span><b>Local</b><small>Use a provider running on this computer</small></span>{mode === 'local' && <Check size={16} />}</button></div></div>}
        {step === 2 && <div className="onboarding-page"><span className="eyebrow">WORKSPACE</span><h2>Choose where you’ll build</h2><p>Set a starting workspace now, or choose one per chat later.</p><button className="workspace-setup" onClick={() => void onChooseFolder()}><Folder size={19} /><span><b>{cwd ? shortenPath(cwd, 48) : 'Choose a workspace'}</b><small>Shell will work within the permissions you select</small></span><ChevronRight size={17} /></button><div className="setup-assurance"><ShieldCheck size={16} /> You stay in control of approvals and file access.</div></div>}
        {step === 3 && <div className="onboarding-page ready-page"><div className="ready-mark"><Check size={26} /></div><span className="eyebrow">READY</span><h2>Hexa is ready.</h2><p>Start with an idea, inspect an existing project, or ask the Shell to build something new.</p></div>}
        <div className="onboarding-actions">{step > 0 ? <button className="onboarding-back" onClick={() => onStep(step - 1)}>Back</button> : <span />}<button className="onboarding-next" onClick={() => step === pages - 1 ? void complete() : onStep(step + 1)}>{step === pages - 1 ? 'Enter Hexa' : 'Next'}<ChevronRight size={16} /></button></div>
      </div>
    </div>
  );
}

function ContextRing({ percentage, label }: { percentage: number; label: string }) {
  const radius = 8;
  const circumference = Math.PI * 2 * radius;
  const dash = Math.min(circumference, Math.max(0, circumference * percentage));
  return (
    <div className="context-ring">
      <svg width="22" height="22" viewBox="0 0 22 22">
        <circle cx="11" cy="11" r={radius} className="ring-track" />
        <circle cx="11" cy="11" r={radius} className="ring-value" strokeDasharray={`${dash} ${circumference - dash}`} />
      </svg>
      <div className="context-tooltip">
        <span>Context window:</span>
        <b>{Math.round(percentage * 100)}% used ({Math.round((1 - percentage) * 100)}% left)</b>
        <span>{label}</span>
      </div>
    </div>
  );
}

type SettingsPage = 'general' | 'agent' | 'tools' | 'skills' | 'configure' | 'privacy' | 'permissions' | 'developer';

function SettingsApp({ embedded = false, onClose }: { embedded?: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<HexaEngineStatus>({ phase: 'idle', message: 'Loading…' });
  const [config, setConfig] = useState<Record<string, any>>({});
  const [requirements, setRequirements] = useState<any>(null);
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  const [active, setActive] = useState<SettingsPage>('general');
  const [settingsSidebarOpen, setSettingsSidebarOpen] = useState(true);
  const [settingsHistory, setSettingsHistory] = useState<SettingsPage[]>(['general']);
  const [settingsHistoryIndex, setSettingsHistoryIndex] = useState(0);
  const [skillsTab, setSkillsTab] = useState<'active' | 'create'>('active');
  const [skills, setSkills] = useState<HexaSkillSummary[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<HexaSkillSummary | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillContent, setSkillContent] = useState('');
  const [skillNotice, setSkillNotice] = useState('');
  const [rpcMethod, setRpcMethod] = useState('server/diagnostics');
  const [rpcParams, setRpcParams] = useState('{}');
  const [rpcResult, setRpcResult] = useState('');
  const [saving, setSaving] = useState(false);
  const [compactLimit, setCompactLimit] = useState('');
  const [compactScope, setCompactScope] = useState<'total' | 'body_after_prefix'>('total');
  const [configToml, setConfigToml] = useState('');
  const [configTomlPath, setConfigTomlPath] = useState('');
  const [configSaved, setConfigSaved] = useState(false);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [localDetection, setLocalDetection] = useState('');
  useShellTheme(preferences?.themeMode);

  const reload = useCallback(async () => {
    const [currentStatus, pref] = await Promise.all([
      window.hexa.getStatus(),
      window.hexa.getPreferences(),
    ]);
    setStatus(currentStatus);
    setPreferences(pref);

    if (currentStatus.phase !== 'ready') return;

    const [read, req, installedSkills] = await Promise.all([
      window.hexa.request<any>('config/read', { includeLayers: true }),
      window.hexa.request<any>('configRequirements/read', {}).catch(() => null),
      window.hexa.listSkills().catch(() => []),
    ]);
    const effectiveConfig = read?.config ?? read ?? {};
    setConfig(effectiveConfig);
    setCompactLimit(effectiveConfig.model_auto_compact_token_limit == null ? '' : String(effectiveConfig.model_auto_compact_token_limit));
    setCompactScope(effectiveConfig.model_auto_compact_token_limit_scope === 'body_after_prefix' ? 'body_after_prefix' : 'total');
    setRequirements(req);
    setSkills(installedSkills);
    const rawConfig = await window.hexa.readConfigToml();
    setConfigToml(rawConfig.content);
    setConfigTomlPath(rawConfig.path);
  }, []);

  async function saveConfigToml() {
    setSaving(true);
    try {
      await window.hexa.writeConfigToml(configToml);
      setConfigSaved(true);
      window.setTimeout(() => setConfigSaved(false), 1600);
      await window.hexa.restartEngine();
    } finally { setSaving(false); }
  }

  useEffect(() => {
    void reload();
    return window.hexa.onStatus((next) => {
      setStatus(next);
      if (next.phase === 'ready') void reload();
    });
  }, [reload]);

  useEffect(() => {
    if (preferences?.accountMode === 'local' && preferences.localModelMode) {
      void detectLocalModels(preferences.localModelProvider);
    }
  }, [preferences?.accountMode, preferences?.localModelMode, preferences?.localModelProvider]);

  async function batchWrite(edits: { keyPath: string; value: any }[]) {
    setSaving(true);
    try {
      await window.hexa.request('config/batchWrite', {
        edits: edits.map((edit) => ({ ...edit, mergeStrategy: 'replace' })),
        reloadUserConfig: true,
      });
      await reload();
    } finally { setSaving(false); }
  }

  async function detectLocalModels(provider = preferences?.localModelProvider ?? 'ollama') {
    setLocalDetection('Looking for a running provider…');
    const result = await window.hexa.detectLocalModels(provider);
    setLocalModels(result.models);
    if (Object.keys(result.contextWindows).length) {
      const providerWindows = Object.fromEntries(
        Object.entries(result.contextWindows).map(([model, contextWindow]) => [localContextPreferenceKey(result.provider, model), contextWindow]),
      );
      setPreferences(await window.hexa.setPreferences({
        localModelContextWindows: { ...(preferences?.localModelContextWindows ?? {}), ...providerWindows },
      }));
    }
    setLocalDetection(result.error
      ? `Not detected at ${result.baseUrl}`
      : result.models.length
        ? `${result.models.length} model${result.models.length === 1 ? '' : 's'} detected at ${result.baseUrl}`
        : `Provider detected at ${result.baseUrl}, but it reported no loaded models.`);
    return result;
  }

  async function setLocalProvider(provider: 'ollama' | 'lmstudio') {
    const next = await window.hexa.setPreferences({ localModelProvider: provider, localModel: undefined });
    setPreferences(next);
    const result = await detectLocalModels(provider);
    const model = result.models[0];
    if (model) await setLocalModel(provider, model, result.contextWindows[model]);
  }

  async function setLocalModel(provider: 'ollama' | 'lmstudio', model: string, catalogContextWindow?: number) {
    const detected = catalogContextWindow ? {} : await window.hexa.detectLocalModelContext({ provider, model });
    const contextWindow = catalogContextWindow ?? detected.contextWindow ?? localContextWindowFor(preferences, provider, model);
    const contextKey = localContextPreferenceKey(provider, model);
    const nextWindows = contextWindow
      ? { ...(preferences?.localModelContextWindows ?? {}), [contextKey]: contextWindow }
      : preferences?.localModelContextWindows ?? {};
    setPreferences(await window.hexa.setPreferences({ localModelProvider: provider, localModel: model, localModelContextWindows: nextWindows }));
    const edits: Array<{ keyPath: string; value: any }> = [
      { keyPath: 'model_provider', value: provider },
      { keyPath: 'oss_provider', value: provider },
      { keyPath: 'model', value: model },
    ];
    if (contextWindow) edits.push({ keyPath: 'model_context_window', value: contextWindow });
    await batchWrite(edits);
  }

  async function saveAutoCompact() {
    const trimmed = compactLimit.trim();
    const parsed = trimmed ? Number(trimmed.replaceAll(',', '')) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed))) {
      alert('Auto-compaction token limit must be a positive whole number, or blank to use engine/model defaults.');
      return;
    }
    await batchWrite([
      { keyPath: 'model_auto_compact_token_limit', value: parsed },
      { keyPath: 'model_auto_compact_token_limit_scope', value: compactScope },
    ]);
  }

  async function applyPrivacyPreset() {
    await batchWrite([
      { keyPath: 'analytics.enabled', value: false },
      { keyPath: 'feedback.enabled', value: false },
      { keyPath: 'otel.log_user_prompt', value: false },
      { keyPath: 'otel.exporter', value: 'none' },
      { keyPath: 'otel.trace_exporter', value: 'none' },
      { keyPath: 'otel.metrics_exporter', value: 'none' },
    ]);
    setPreferences(await window.hexa.setPreferences({ privacyMode: true }));
  }

  async function runRpc() {
    try {
      const params = JSON.parse(rpcParams || '{}');
      const result = await window.hexa.request(rpcMethod, params);
      setRpcResult(JSON.stringify(result, null, 2));
    } catch (error) {
      setRpcResult(error instanceof Error ? error.message : String(error));
    }
  }

  function editSkill(skill: HexaSkillSummary) {
    setSelectedSkill(skill);
    setSkillName(skill.name);
    setSkillContent(skill.content);
    setSkillsTab('create');
    setSkillNotice('');
  }

  function beginSkill() {
    setSelectedSkill(null);
    setSkillName('');
    setSkillContent('---\nname: my-skill\ndescription: Explain what this skill does and when Hexa Engine should use it.\n---\n\n# Purpose\n\nAdd concise, task-specific instructions here.\n');
    setSkillsTab('create');
    setSkillNotice('');
  }

  function openSettingsPage(page: SettingsPage) {
    if (page === active) return;
    const next = [...settingsHistory.slice(0, settingsHistoryIndex + 1), page];
    setSettingsHistory(next);
    setSettingsHistoryIndex(next.length - 1);
    setActive(page);
  }

  function navigateSettings(offset: -1 | 1) {
    const nextIndex = settingsHistoryIndex + offset;
    const next = settingsHistory[nextIndex];
    if (!next) return;
    setSettingsHistoryIndex(nextIndex);
    setActive(next);
  }

  async function saveSkill() {
    setSaving(true);
    setSkillNotice('');
    try {
      const saved = await window.hexa.saveSkill({ name: skillName, content: skillContent, path: selectedSkill?.path });
      setSkills((current) => [...current.filter((skill) => skill.path !== saved.path), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedSkill(saved);
      setSkillNotice('Saved. Shell will discover this skill on its next skill refresh.');
    } catch (error) { setSkillNotice(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  }

  return (
    <div className={`settings-window ${embedded ? 'embedded' : ''} ${settingsSidebarOpen ? '' : 'settings-sidebar-collapsed'}`}>
      <AppTitleBar controls={<div className="titlebar-navigation chrome-no-drag"><button aria-pressed={!settingsSidebarOpen} onClick={() => setSettingsSidebarOpen((value) => !value)} title="Toggle settings sidebar"><PanelLeftClose size={15} /></button><button disabled={settingsHistoryIndex <= 0} onClick={() => navigateSettings(-1)} title="Previous settings page"><ArrowLeft size={15} /></button><button disabled={settingsHistoryIndex >= settingsHistory.length - 1} onClick={() => navigateSettings(1)} title="Next settings page"><ArrowRight size={15} /></button></div>} />
      <button className="settings-close-floating chrome-no-drag" onClick={onClose} title="Close settings"><X size={17} /></button>
      <div className="settings-layout">
        <nav className="settings-nav chrome-no-drag">
          <button className={active === 'general' ? 'selected' : ''} onClick={() => openSettingsPage('general')}><Settings size={16} /> General</button>
          <button className={active === 'agent' ? 'selected' : ''} onClick={() => openSettingsPage('agent')}><Bot size={16} /> Agent</button>
          <button className={active === 'tools' ? 'selected' : ''} onClick={() => openSettingsPage('tools')}><Wrench size={16} /> Tools</button>
          <button className={active === 'skills' ? 'selected' : ''} onClick={() => openSettingsPage('skills')}><Sparkles size={16} /> Skills</button>
          <button className={active === 'configure' ? 'selected' : ''} onClick={() => openSettingsPage('configure')}><FileCode2 size={16} /> Configure</button>
          <button className={active === 'privacy' ? 'selected' : ''} onClick={() => openSettingsPage('privacy')}><ShieldCheck size={16} /> Privacy</button>
          <button className={active === 'permissions' ? 'selected' : ''} onClick={() => openSettingsPage('permissions')}><LockKeyhole size={16} /> Permissions</button>
          <button className={active === 'developer' ? 'selected' : ''} onClick={() => openSettingsPage('developer')}><Code2 size={16} /> Developer</button>
          <div className="settings-nav-spacer" />
        </nav>
        <main className="settings-content chrome-no-drag">
          {active === 'general' && (
            <SettingsSection title="General" subtitle="Hexa behavior and the local Hexa Engine.">
              <SettingRow title="Appearance" description="Follow your operating system by default, or keep Hexa in a specific theme.">
                <select className="settings-select" value={preferences?.themeMode ?? 'auto'} onChange={async (event) => setPreferences(await window.hexa.setPreferences({ themeMode: event.target.value as AppPreferences['themeMode'] }))}><option value="auto">Auto</option><option value="light">Light</option><option value="dark">Dark</option></select>
              </SettingRow>
              {!window.hexa.isPackaged && <>
                <SettingRow title="Hexa Engine" description={status.detail || status.message}>
                  <span className={`runtime-badge ${status.phase}`}>{status.phase}</span>
                </SettingRow>
                <SettingRow title="Shell state" description={status.sqliteHome || "Stored in Hexa's isolated runtime directory so other compatible clients can run at the same time."}>
                  <span className="runtime-badge ready">isolated</span>
                </SettingRow>
                <SettingRow title="Rebuild from included source" description="Delete the cached binary, compile the repository ./engine source with Cargo, and restart app-server.">
                  <button className="settings-action" onClick={() => void window.hexa.rebuildEngine()}><Hammer size={15} /> Rebuild</button>
                </SettingRow>
                <SettingRow title="Restart engine" description="Restarts the Shell process without rebuilding upstream Rust source.">
                  <button className="settings-action" onClick={() => void window.hexa.restartEngine()}><RefreshCw size={15} /> Restart</button>
                </SettingRow>
              </>}
              <SettingRow title="Response personality" description="Choose the default voice Hexa Engine uses when it explains work and answers general questions.">
                <select className="settings-select" value={config.personality ?? 'friendly'} onChange={(event) => void batchWrite([{ keyPath: 'personality', value: event.target.value }])}><option value="friendly">Friendly</option><option value="pragmatic">Pragmatic</option><option value="none">Neutral</option></select>
              </SettingRow>
              <SettingRow title="Response detail" description="Set the preferred amount of explanation in final responses.">
                <select className="settings-select" value={config.model_verbosity ?? 'medium'} onChange={(event) => void batchWrite([{ keyPath: 'model_verbosity', value: event.target.value }])}><option value="low">Concise</option><option value="medium">Balanced</option><option value="high">Detailed</option></select>
              </SettingRow>
            </SettingsSection>
          )}
          {active === 'agent' && (
            <SettingsSection title="Agent" subtitle="Reasoning, work presentation, and context behavior for Hexa Engine turns.">
              {preferences?.accountMode === 'local' && <>
                <SettingRow title="Local Model Running mode" description="Connect Hexa directly to a supported model provider running on this computer.">
                  <Toggle checked={preferences.localModelMode} onChange={async (value) => {
                    setPreferences(await window.hexa.setPreferences({ localModelMode: value }));
                    if (value) {
                      const result = await detectLocalModels();
                      if (result.models[0]) await setLocalModel(result.provider, result.models[0], result.contextWindows[result.models[0]]);
                    }
                  }} />
                </SettingRow>
                {preferences.localModelMode && <SettingRow title="Local provider" description={localDetection || 'Hexa checks the provider on this computer and reads its available models.'}>
                  <div className="local-model-controls">
                    <select className="settings-select" value={preferences.localModelProvider} onChange={(event) => void setLocalProvider(event.target.value as 'ollama' | 'lmstudio')}><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option></select>
                    <select className="settings-select" value={preferences.localModel ?? ''} disabled={!localModels.length} onChange={(event) => void setLocalModel(preferences.localModelProvider, event.target.value)}><option value="">{localModels.length ? 'Choose model' : 'No models detected'}</option>{localModels.map((model) => <option key={model} value={model}>{model}</option>)}</select>
                    <button className="settings-action" onClick={() => void detectLocalModels()}><RefreshCw size={14} /> Detect</button>
                  </div>
                </SettingRow>}
              </>}
              <SettingRow title="Automatic compaction" description="Engine-native model_auto_compact_token_limit. Leave blank to inherit the runtime/model default; manual Compact remains available in the chat menu.">
                <div className="compact-setting">
                  <input value={compactLimit} onChange={(event) => setCompactLimit(event.target.value)} inputMode="numeric" placeholder="Model default" />
                  <select value={compactScope} onChange={(event) => setCompactScope(event.target.value as 'total' | 'body_after_prefix')}>
                    <option value="total">Total context</option>
                    <option value="body_after_prefix">Body after prefix</option>
                  </select>
                  <button className="settings-action" disabled={saving} onClick={() => void saveAutoCompact()}>Save</button>
                </div>
              </SettingRow>
              <SettingRow title="Auto-open tool details" description="Expand completed command/edit/tool clusters as they arrive.">
                <Toggle checked={preferences?.autoOpenToolDetails ?? false} onChange={async (value) => setPreferences(await window.hexa.setPreferences({ autoOpenToolDetails: value }))} />
              </SettingRow>
              <SettingRow title="Show raw local-model reasoning" description="Local/open-weight models may emit raw reasoning content in addition to summaries.">
                <Toggle checked={preferences?.showRawReasoningForLocalModels ?? true} onChange={async (value) => setPreferences(await window.hexa.setPreferences({ showRawReasoningForLocalModels: value }))} />
              </SettingRow>
              <SettingRow title="Reasoning summaries" description="Show concise summaries of the agent's working process when the model provides them.">
                <Toggle checked={preferences?.showReasoningSummaries ?? true} onChange={async (value) => setPreferences(await window.hexa.setPreferences({ showReasoningSummaries: value }))} />
              </SettingRow>
            </SettingsSection>
          )}
          {active === 'tools' && (
            <SettingsSection title="Tools" subtitle="Control the engine and shell tools Hexa can offer to an agent. Changes use the engine configuration or the matching shell capability; they are not display-only switches.">
              <SettingRow title="Web search" description="Allow Hexa Engine to use web search for current information.">
                <Toggle checked={config.web_search !== 'disabled'} onChange={(value) => void batchWrite([{ keyPath: 'web_search', value: value ? 'live' : 'disabled' }])} />
              </SettingRow>
              <SettingRow title="Built-in browser" description="Expose Hexa's browser control tool to new chats. Turning it off also prevents the browser from being added as a dynamic tool for future turns.">
                <Toggle checked={preferences?.browserToolEnabled ?? true} onChange={async (value) => setPreferences(await window.hexa.setPreferences({ browserToolEnabled: value }))} />
              </SettingRow>
              <SettingRow title="Browser history access" description="Allow browser-use tools to read history when the engine and provider support browser use.">
                <Toggle checked={config.browser_use?.allow_history_access === true} onChange={(value) => void batchWrite([{ keyPath: 'browser_use.allow_history_access', value }])} />
              </SettingRow>
              <SettingRow title="Browser downloads" description="Allow browser-use tools to download files from approved origins. This remains subject to the current permission profile.">
                <Toggle checked={config.browser_use?.default_origin_policy?.downloads === 'allow'} onChange={(value) => void batchWrite([{ keyPath: 'browser_use.default_origin_policy.downloads', value: value ? 'allow' : 'deny' }])} />
              </SettingRow>
              <SettingRow title="Browser uploads" description="Allow browser-use tools to upload files to approved origins. This remains subject to the current permission profile.">
                <Toggle checked={config.browser_use?.default_origin_policy?.uploads === 'allow'} onChange={(value) => void batchWrite([{ keyPath: 'browser_use.default_origin_policy.uploads', value: value ? 'allow' : 'deny' }])} />
              </SettingRow>
              <SettingRow title="Computer-use app access" description="Allow computer-use tools to control applications when the selected model and engine policy support it.">
                <Toggle checked={config.computer_use?.default_app_access === 'allow'} onChange={(value) => void batchWrite([{ keyPath: 'computer_use.default_app_access', value: value ? 'allow' : 'deny' }])} />
              </SettingRow>
              <InfoCard icon={<SquareTerminal size={18} />} title="Command and file tools" text="Command execution and file edits are controlled by the active permission profile and approval policy. Use Permissions for their workspace and escalation rules." />
              <InfoCard icon={<Sparkles size={18} />} title="Model-provided tools" text="Image generation, plugins, MCP tools, and skills appear only when the selected model or installed extension supports them. Their own configuration remains in Plugins, Skills, and the model catalog." />
            </SettingsSection>
          )}
          {active === 'skills' && (
            <SettingsSection title="Skills" subtitle="Create and manage the real SKILL.md instructions discovered by Hexa Engine.">
              <div className="skills-tabs"><button className={skillsTab === 'active' ? 'selected' : ''} onClick={() => setSkillsTab('active')}>Active skills</button><button className={skillsTab === 'create' ? 'selected' : ''} onClick={beginSkill}>Create & edit</button></div>
              {skillsTab === 'active' && <div className="skill-browser">{skills.map((skill) => <button key={skill.path} onClick={() => editSkill(skill)}><span className="skill-mark"><FileText size={17} /></span><span><b>{skill.name}</b><small>{skill.description || 'No description provided'}</small><em>{skill.source} · {skill.path}</em></span><PencilLine size={15} /></button>)}{!skills.length && <div className="skill-empty"><Sparkles size={24} /><b>No discoverable skills</b><span>Create one to add reusable guidance for Hexa Engine.</span><button className="settings-action primary" onClick={beginSkill}>Create skill</button></div>}</div>}
              {skillsTab === 'create' && <div className="skill-studio"><aside><div className="skill-studio-mark"><Sparkles size={20} /></div><h2>{selectedSkill ? `Editing ${selectedSkill.name}` : 'New Hexa skill'}</h2><p>Use concise frontmatter for discovery and keep the instructions focused on decisions Hexa Engine would not know by itself.</p><label>Skill name<input value={skillName} onChange={(event) => setSkillName(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="my-skill" /></label><div className="skill-anatomy"><b>Skill anatomy</b><span><Check size={13} /> name and description</span><span><Check size={13} /> focused Markdown guidance</span><span><Check size={13} /> optional scripts and references</span></div></aside><main><header><span>{selectedSkill?.path || '~/.hexashell/skills/[name]/SKILL.md'}</span><button className="settings-action primary" disabled={saving} onClick={() => void saveSkill()}>{saving ? 'Saving…' : 'Save skill'}</button></header><textarea spellCheck={false} value={skillContent} onChange={(event) => setSkillContent(event.target.value)} />{skillNotice && <div className="skill-notice">{skillNotice}</div>}</main></div>}
            </SettingsSection>
          )}
          {active === 'privacy' && (
            <SettingsSection title="Privacy" subtitle="Controls are written through Hexa Engine's config/batchWrite API, not hidden shell-only switches.">
              <div className="privacy-callout">
                <ShieldCheck size={20} />
                <div><b>Privacy preset</b><span>One-way safe action: disables engine analytics, feedback, OTEL logs/traces/metrics export, and user-prompt OTEL logging. It never re-enables telemetry automatically.</span></div>
                <button className="settings-action primary" disabled={saving} onClick={() => void applyPrivacyPreset()}>{preferences?.privacyMode ? 'Reapply' : 'Apply'}</button>
              </div>
              <SettingRow title="Analytics" description="Engine [analytics].enabled. App-server already defaults analytics off unless first-party enablement is requested; this makes the choice explicit in config.toml.">
                <Toggle disabled={saving} checked={config.analytics?.enabled === true} onChange={(value) => void batchWrite([{ keyPath: 'analytics.enabled', value }])} />
              </SettingRow>
              <SettingRow title="Feedback collection" description="Engine [feedback].enabled.">
                <Toggle disabled={saving} checked={config.feedback?.enabled === true} onChange={(value) => void batchWrite([{ keyPath: 'feedback.enabled', value }])} />
              </SettingRow>
              <SettingRow title="OpenTelemetry prompt logging" description="Forces otel.log_user_prompt = false when disabled.">
                <Toggle disabled={saving} checked={config.otel?.log_user_prompt === true} onChange={(value) => void batchWrite([{ keyPath: 'otel.log_user_prompt', value }])} />
              </SettingRow>
              <SettingRow title="OTEL export" description="Set log, trace, and metrics exporters to none. Metrics defaults can otherwise use Statsig upstream.">
                <button className="settings-action" disabled={saving} onClick={() => void batchWrite([
                  { keyPath: 'otel.exporter', value: 'none' },
                  { keyPath: 'otel.trace_exporter', value: 'none' },
                  { keyPath: 'otel.metrics_exporter', value: 'none' },
                ])}>Disable all exporters</button>
              </SettingRow>
              <SettingRow title="Local history persistence" description="Set history.persistence = none if you do not want Hexa Engine to keep local transcript history. This also disables normal chat history across launches.">
                <button className="settings-action" disabled={saving} onClick={() => void batchWrite([{ keyPath: 'history.persistence', value: 'none' }])}>Disable history</button>
              </SettingRow>
              <ManagedRequirements requirements={requirements} />
            </SettingsSection>
          )}
          {active === 'configure' && (
            <SettingsSection title="Configure" subtitle="Edit the active Hexa Engine config.toml directly.">
              <div className="toml-editor-head"><span title={configTomlPath}>{configTomlPath || 'config.toml'}</span><button className="settings-action primary" disabled={saving} onClick={() => void saveConfigToml()}>{configSaved ? <Check size={15} /> : <FileCode2 size={15} />}{configSaved ? 'Saved' : 'Save & restart'}</button></div>
              <textarea className="toml-editor" spellCheck={false} value={configToml} onChange={(event) => setConfigToml(event.target.value)} placeholder="# Hexa Engine configuration" />
            </SettingsSection>
          )}
          {active === 'permissions' && (
            <SettingsSection title="Permissions" subtitle="Hexa uses named permission profiles and renders Shell approval requests inline.">
              <InfoCard icon={<LockKeyhole size={18} />} title="Named profiles first" text="The chat composer selects permissionProfile/permissions IDs such as :read-only or :workspace. The shell avoids inventing its own sandbox semantics." />
              <InfoCard icon={<ShieldCheck size={18} />} title="Inline approvals" text="Command, file-change, MCP, user-input, and request_permissions server requests are routed back into the active conversation and answered over JSON-RPC." />
              <pre className="config-preview">{JSON.stringify({ approval_policy: config.approval_policy, sandbox_mode: config.sandbox_mode }, null, 2)}</pre>
            </SettingsSection>
          )}
          {active === 'developer' && (
            <SettingsSection title="Developer" subtitle="Direct app-server access for experimental endpoints that do not yet have a bespoke shell surface.">
              <InfoCard icon={<Braces size={18} />} title="Protocol escape hatch" text="Hexa Engine evolves quickly. Hexa has first-class UI for core chat, history, models, context, permissions, tools, plans, diffs, review and privacy; this RPC console keeps newer endpoints reachable without waiting for a UI release." />
              <label className="rpc-label">Method<input value={rpcMethod} onChange={(event) => setRpcMethod(event.target.value)} /></label>
              <label className="rpc-label">Params<textarea value={rpcParams} onChange={(event) => setRpcParams(event.target.value)} /></label>
              <button className="settings-action primary" onClick={() => void runRpc()}><Play size={15} /> Send RPC</button>
              {rpcResult && <pre className="rpc-result">{rpcResult}</pre>}
              <div className="config-block"><div>Effective config</div><pre>{JSON.stringify(config, null, 2)}</pre></div>
            </SettingsSection>
          )}
        </main>
      </div>
    </div>
  );
}

function SettingsSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="settings-section"><h1>{title}</h1><p>{subtitle}</p><div className="settings-stack">{children}</div></section>;
}
function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="setting-row"><div><b>{title}</b><span>{description}</span></div><div>{children}</div></div>;
}
function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange(value: boolean): void; disabled?: boolean }) {
  return <button disabled={disabled} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span /></button>;
}
function InfoCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <div className="info-card"><span>{icon}</span><div><b>{title}</b><p>{text}</p></div></div>;
}
function ManagedRequirements({ requirements }: { requirements: any }) {
  if (!requirements) return null;
  return <div className="managed-note"><LockKeyhole size={16} /><span>Managed requirements are active. Values enforced by requirements.toml or device management can override shell toggles.</span></div>;
}

function skillSlugFromToolInput(value: unknown): string | null {
  const input = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return input.match(/(?:^|[\\/])skills[\\/]([^\\/'"\\]+)[\\/]SKILL\.md/i)?.[1]?.toLowerCase() ?? null;
}

function declaredSkillFromText(value: string): { slug: string; title: string } | null {
  const text = value.toLowerCase();
  if (/plugin[- ]management|installed plugins?|plugin-management guidance|plugin-management capability/.test(text)) {
    return { slug: 'plugin-management', title: 'Plugin Management' };
  }
  const explicit = value.match(/(?:reading|using|checking)\s+(?:the\s+)?([a-z0-9][a-z0-9 _-]+?)\s+skill\b/i)?.[1];
  if (!explicit) return null;
  const slug = explicit.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) return null;
  return { slug, title: slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) };
}

function customToolDisplayName(item: any): string {
  const skill = item?._shellDeclaredSkill ?? skillSlugFromToolInput(item?.arguments);
  if (skill) {
    const title = skill.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter: string) => letter.toUpperCase());
    return `Reading ${title} skill`;
  }
  const name = `${item?.namespace ? `${item.namespace}.` : ''}${item?.tool || 'tool'}`;
  return `${item?.status === 'inProgress' ? 'Using' : 'Used'} ${name}`;
}

function toolSummary(item: any): { label: string; icon: React.ReactNode } {
  switch (item.type) {
    case 'guardianPermissionReview':
      return { label: item.status === 'inProgress' ? 'Running Sandbox permission check' : 'Ran Sandbox permission check', icon: <ShieldCheck size={14} /> };
    case 'commandExecution': {
      const name = presentedToolName(item);
      return { label: item.status === 'inProgress' ? `Running ${name}` : `Ran ${name}`, icon: <SquareTerminal size={14} /> };
    }
    case 'localShellCall': {
      const name = presentedToolName(item);
      return { label: item.status === 'inProgress' ? `Running ${name}` : `Ran ${name}`, icon: <SquareTerminal size={14} /> };
    }
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      if (item.status === 'failed') return { label: 'File changes were not applied', icon: <FileCode2 size={14} /> };
      return { label: item.status === 'inProgress' ? fileChangeRunningLabel(changes) : fileChangeCompletedLabel(changes), icon: <FileCode2 size={14} /> };
    }
    case 'mcpToolCall': {
      const appName = item.appContext?.appName ?? item.app_context?.app_name;
      const actionName = item.appContext?.actionName ?? item.app_context?.action_name;
      const name = [appName || item.server || 'MCP', actionName || item.tool || 'tool'].filter(Boolean).join(' · ');
      return { label: `${item.status === 'inProgress' ? 'Using' : 'Used'} ${name}`, icon: <Wrench size={14} /> };
    }
    case 'dynamicToolCall': return { label: customToolDisplayName(item), icon: <Wrench size={14} /> };
    case 'functionCallOutput': {
      const name = `${item.namespace ? `${item.namespace}.` : ''}${item.name || 'tool'}`;
      return { label: `Received output from ${name}`, icon: <PlugZap size={14} /> };
    }
    case 'hookPrompt': return { label: 'Loaded hook context', icon: <PlugZap size={14} /> };
    case 'webSearch': return { label: webSearchLabel(item, isItemInProgress(item)), icon: <Globe2 size={14} /> };
    case 'imageGeneration': return { label: item.status === 'inProgress' ? 'Generating image' : 'Generated image', icon: <Image size={14} /> };
    case 'imageView': return { label: `Viewed ${fileNameFromPath(item.path) || 'image'}`, icon: <Image size={14} /> };
    case 'collabToolCall':
    case 'collabAgentToolCall': return { label: `${item.status === 'inProgress' ? 'Running' : 'Ran'} ${item.tool || 'agent task'}`, icon: <GitBranch size={14} /> };
    case 'subAgentActivity': return { label: `Agent ${item.kind || 'activity'}`, icon: <Bot size={14} /> };
    case 'sleep': return { label: 'Waiting', icon: <Clock3 size={14} /> };
    case 'enteredReviewMode': return { label: `Reviewing ${item.review || 'changes'}`, icon: <ShieldAlert size={14} /> };
    case 'exitedReviewMode': return { label: `Reviewed ${item.review || 'changes'}`, icon: <ShieldCheck size={14} /> };
    case 'contextCompaction': return { label: item.status === 'inProgress' ? 'Compacting conversation' : 'Conversation compacted', icon: <FileText size={14} /> };
    default: return { label: item.type || 'Tool activity', icon: <Box size={14} /> };
  }
}
function toolClusterIcon(items: any[]): React.ReactNode {
  if (items.length && items.every((item) => item.type === 'commandExecution' || item.type === 'localShellCall')) return <SquareTerminal size={15} />;
  if (items.length && items.every((item) => item.type === 'fileChange')) return <FileCode2 size={15} />;
  if (items.some((item) => item.type === 'mcpToolCall' || item.type === 'dynamicToolCall' || item.type === 'functionCallOutput' || item.type === 'hookPrompt')) return <Wrench size={15} />;
  if (items.some((item) => item.type === 'collabToolCall' || item.type === 'collabAgentToolCall' || item.type === 'subAgentActivity')) return <GitBranch size={15} />;
  if (items.some((item) => item.type === 'imageGeneration' || item.type === 'imageView')) return <Image size={15} />;
  return <Box size={15} />;
}

function webSearchActionType(item: any): string {
  return String(item?.action?.type ?? item?.action?.kind ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

function webSearchCurrentUrl(item: any): string {
  const actionType = webSearchActionType(item);
  if (actionType === 'open_page' || actionType === 'find_in_page') {
    return String(item?.action?.url ?? item?.url ?? '').trim();
  }
  return '';
}

function webSearchLabel(item: any, active: boolean): string {
  const actionType = webSearchActionType(item);
  const currentUrl = webSearchCurrentUrl(item);
  if (currentUrl) {
    const host = webDisplayHost(currentUrl);
    if (actionType === 'find_in_page' && item?.action?.pattern) return `Viewing ${host} · finding “${String(item.action.pattern).slice(0, 70)}”`;
    return `Viewing ${host}`;
  }
  const query = String(item?.query ?? item?.action?.query ?? '').trim();
  if (active) return query ? `Searching the web · ${query}` : 'Searching the web';
  return query ? `Searched ${query}` : 'Searched the web';
}

function webSearchReferences(items: any[]): WebToolReference[] {
  const references: WebToolReference[] = [];
  const add = (urlValue: unknown, titleValue?: unknown, faviconValue?: unknown) => {
    const url = String(urlValue ?? '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (references.some((entry) => entry.url === url)) return;
    const host = webDisplayHost(url);
    const title = String(titleValue ?? '').trim() || host || url;
    const favicon = String(faviconValue ?? '').trim();
    references.push({ url, title, host, favicon: /^https?:\/\//i.test(favicon) ? favicon : undefined });
  };
  for (const item of items) {
    const actionUrl = webSearchCurrentUrl(item);
    if (actionUrl) add(actionUrl, webDisplayHost(actionUrl));
    const results = Array.isArray(item?.results) ? item.results : [];
    for (const result of results) {
      if (!result || typeof result !== 'object') continue;
      const record: any = result;
      const source = record.source && typeof record.source === 'object' ? record.source : {};
      const metadata = record.metadata && typeof record.metadata === 'object' ? record.metadata : {};
      const url = record.url ?? record.link ?? record.href ?? source.url ?? source.link ?? metadata.url;
      const title = record.title ?? record.name ?? record.pageTitle ?? record.page_title ?? source.title ?? metadata.title;
      const favicon = record.favicon ?? record.faviconUrl ?? record.favicon_url ?? record.icon ?? record.iconUrl ?? record.icon_url ?? source.favicon ?? metadata.favicon;
      add(url, title, favicon);
    }
  }
  return references.slice(0, 40);
}

function webDisplayHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url.replace(/^https?:\/\//i, '').split('/')[0]; }
}

function webFaviconUrl(url?: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return '';
  }
}

function fileChangeAction(change: any): 'Created' | 'Edited' | 'Deleted' {
  // FileUpdateChange.kind is commonly a tagged enum (`{ type: "add" }`).
  // Stringifying it directly produces "[object Object]", which made every
  // created file fall through to Edited.
  const kindValue = change?.kind ?? change?.action ?? change?.operation ?? change?.type ?? change?.status ?? '';
  const kind = typeof kindValue === 'string'
    ? kindValue.toLowerCase()
    : JSON.stringify(kindValue).toLowerCase();
  const diff = String(change?.diff ?? change?.patch ?? '');
  if (kind.includes('create') || kind.includes('add') || /new file mode|--- \/dev\/null/.test(diff)) return 'Created';
  if (kind.includes('delete') || kind.includes('remove') || /deleted file mode|\+\+\+ \/dev\/null/.test(diff)) return 'Deleted';
  return 'Edited';
}
function fileChangeCompletedLabel(changes: any[]): string {
  const actions = new Set(changes.map(fileChangeAction));
  const count = changes.length || 1;
  const verb = actions.has('Created') && actions.has('Edited')
    ? 'Created and edited'
    : actions.has('Created')
      ? 'Created'
      : actions.has('Deleted') && actions.has('Edited')
        ? 'Edited and deleted'
        : actions.has('Deleted')
          ? 'Deleted'
          : 'Edited';
  return `${verb} ${count} file${count === 1 ? '' : 's'}`;
}
function fileChangeRunningLabel(changes: any[]): string {
  const actions = new Set(changes.map(fileChangeAction));
  if (actions.has('Created') && actions.has('Edited')) return 'Creating and editing files';
  if (actions.has('Created')) return 'Creating files';
  if (actions.has('Deleted')) return 'Updating files';
  return 'Editing files';
}
function presentedToolName(item: any): string {
  const explicit = item.toolName ?? item.tool ?? item.name ?? item.scriptPath ?? item.pluginId;
  if (explicit) return String(explicit).split(/[\\/]/).at(-1) || String(explicit);
  const action = Array.isArray(item.commandActions) ? item.commandActions[0] : null;
  if (action?.type === 'read') return `Read ${action.name || 'file'}`;
  if (action?.type === 'listFiles') return 'List files';
  if (action?.type === 'search') return 'Search files';
  const command = commandLabel(item.command).trim();
  return command || 'command';
}
function fileChangeVerb(change: any): string {
  const kind = typeof change?.kind === 'string' ? change.kind : change?.kind?.type;
  if (kind === 'add') return 'creating';
  if (kind === 'delete') return 'deleting';
  return 'editing';
}
function toolDetail(item: any): string {
  if (item.type === 'commandExecution' || item.type === 'localShellCall') return item.aggregatedOutput || item.outputDelta || item.output || item.error || item.cwd || '';
  if (item.type === 'fileChange') return (Array.isArray(item.changes) ? item.changes : []).map((change: any) => `${String(change?.path || '')}\n${String(change?.diff || '')}`).join('\n\n') || String(item.diff || item.patch || item.outputDelta || '');
  if (item.type === 'mcpToolCall') return JSON.stringify(item.result ?? item.arguments ?? item.error ?? {}, null, 2);
  if (item.type === 'dynamicToolCall') return JSON.stringify(item.contentItems ?? item.arguments ?? item.error ?? {}, null, 2);
  if (item.type === 'functionCallOutput') {
    const output = item.output;
    if (typeof output === 'string') return output;
    return output == null ? '' : JSON.stringify(output, null, 2);
  }
  if (item.type === 'hookPrompt') return JSON.stringify(item.fragments ?? [], null, 2);
  if (item.type === 'webSearch') return JSON.stringify(item.results ?? item.action ?? {}, null, 2);
  if (item.type === 'collabAgentToolCall' || item.type === 'collabToolCall') return JSON.stringify(item.agentsStates ?? item.result ?? item.arguments ?? {}, null, 2);
  if (item.type === 'enteredReviewMode' || item.type === 'exitedReviewMode') return String(item.review || '');
  return item.progressText || '';
}
function isToolItem(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  if (['commandExecution', 'localShellCall', 'guardianPermissionReview', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'functionCallOutput', 'hookPrompt', 'webSearch', 'imageGeneration', 'collabToolCall', 'collabAgentToolCall', 'subAgentActivity', 'sleep', 'imageView', 'enteredReviewMode', 'exitedReviewMode', 'contextCompaction'].includes(item.type)) return true;
  // Keep the transcript forward-compatible with new engine tool item types.
  // Message/reasoning/plan items are rendered elsewhere; any other lifecycle
  // item carrying a status should still surface as execution activity instead
  // of silently disappearing from the chat.
  return Boolean(
    item?.type &&
    typeof item.status === 'string' &&
    !['userMessage', 'agentMessage', 'reasoning', 'plan'].includes(item.type),
  );
}
function isGuardianPermissionReviewEvent(method: string): boolean {
  // App-server serializes GuardianApprovalReview as `autoApprovalReview`.
  // Accept both spellings so this remains compatible while that protocol is
  // explicitly marked unstable upstream.
  const normalized = method.toLowerCase();
  return normalized.includes('autoapprovalreview') || normalized.includes('guardianapprovalreview');
}
function isGuardianPermissionReviewComplete(method: string): boolean {
  return /completed|failed|denied|aborted/i.test(method);
}
function guardianPermissionReviewItem(event: ServerEvent, status: 'inProgress' | 'completed') {
  const params: any = event.params ?? {};
  const review = params.review ?? {};
  return {
    id: String(params.reviewId ?? params.review_id ?? params.id ?? `guardian-review-${params.targetItemId ?? params.target_item_id ?? 'active'}`),
    type: 'guardianPermissionReview',
    status,
    toolName: 'Sandbox permission check',
    targetItemId: params.targetItemId ?? params.target_item_id,
    progressText: review.rationale ?? params.rationale ?? '',
    source: 'hexa-engine',
  };
}
function shouldShowSandboxPreflight(item: any): boolean {
  const text = String(item?.text ?? item?.content ?? '').toLowerCase();
  // The preflight occurs after Hexa has announced its first workspace
  // inspection and before the first command/tool item begins.
  return /\b(inspect|checking|check|reading|read|using|workspace|directory|project|files?|plugins?|skills?|guidance)\b/.test(text);
}
function isToolProgressEvent(method: string): boolean {
  return [
    'item/commandExecution/outputDelta',
    'item/commandExecution/terminalInteraction',
    'item/fileChange/outputDelta',
    'item/fileChange/patchUpdated',
    'item/mcpToolCall/progress',
    'item/dynamicToolCall/progress',
    'item/collabAgentToolCall/progress',
    'item/collabToolCall/progress',
  ].includes(method);
}
function toolFromProgressEvent(event: ServerEvent): any {
  const params: any = event.params ?? {};
  const type = event.method.includes('commandExecution')
    ? 'commandExecution'
    : event.method.includes('fileChange')
      ? 'fileChange'
      : event.method.includes('mcpToolCall')
        ? 'mcpToolCall'
        : event.method.includes('dynamicToolCall')
          ? 'dynamicToolCall'
          : event.method.includes('collabAgentToolCall')
            ? 'collabAgentToolCall'
            : 'collabToolCall';
  return {
    id: params.itemId ?? `${params.turnId}-${type}`,
    type,
    status: 'inProgress',
    command: params.command,
    server: params.server,
    tool: params.tool,
    changes: params.changes,
    outputDelta: params.delta,
  };
}
function isItemInProgress(item: any): boolean {
  return ['inProgress', 'in_progress', 'running', 'pending', 'started', 'active'].includes(item?.status);
}
function summarizeTools(items: any[]): string[] {
  const labels: string[] = [];
  const fileChanges = items.filter((item) => item.type === 'fileChange').flatMap((item) => item.changes ?? []);
  const commands = items.filter((item) => item.type === 'commandExecution' || item.type === 'localShellCall').length;
  const externalCalls = items.filter((item) => ['mcpToolCall', 'dynamicToolCall', 'functionCallOutput', 'hookPrompt'].includes(item.type));
  const sandboxChecks = items.filter((item) => item.type === 'guardianPermissionReview').length;
  const searches = items.filter((item) => item.type === 'webSearch').length;
  const agents = items.filter((item) => item.type === 'collabToolCall' || item.type === 'collabAgentToolCall' || item.type === 'subAgentActivity').length;
  if (fileChanges.length) labels.push(fileChangeCompletedLabel(fileChanges));
  if (commands) labels.push(`Ran ${commands} command${commands === 1 ? '' : 's'}`);
  if (sandboxChecks) labels.push(sandboxChecks === 1 ? 'Ran Sandbox permission check' : `Ran ${sandboxChecks} Sandbox permission checks`);
  if (externalCalls.length === 1) {
    const item = externalCalls[0];
    if (item.type === 'dynamicToolCall' && (item._shellDeclaredSkill || skillSlugFromToolInput(item.arguments))) {
      labels.push(customToolDisplayName(item));
    } else {
    const appName = item.appContext?.appName ?? item.app_context?.app_name;
    const name = item.tool || item.name || item.appContext?.actionName || item.app_context?.action_name || 'call';
    labels.push(`Used ${appName ? `${appName} · ` : item.namespace ? `${item.namespace}.` : item.server ? `${item.server}.` : ''}${name}`);
    }
  } else if (externalCalls.length > 1) labels.push(`Used ${externalCalls.length} external calls`);
  if (searches) labels.push(`Searched web`);
  if (agents) labels.push(`Used agents`);
  if (!labels.length) labels.push('Ran activity');
  return labels;
}
function resolveReasoningEffort(value: string, options: string[]): string {
  if (options.includes(value)) return value;
  if (value === 'none' || value === 'minimal') {
    if (options.includes('none')) return 'none';
    if (options.includes('minimal')) return 'minimal';
  }
  return options[0] ?? value;
}

function localContextPreferenceKey(provider: 'ollama' | 'lmstudio', model: string): string {
  return `${provider}:${model}`;
}
function localContextWindowFor(preferences: AppPreferences | null | undefined, provider: 'ollama' | 'lmstudio', model: string): number | undefined {
  const windows = preferences?.localModelContextWindows;
  return windows?.[localContextPreferenceKey(provider, model)] ?? windows?.[model];
}
function computeContextRing(tokenUsage: any, localContextWindow?: number, isLocalProvider = false): { percent: number; label: string; used: number } {
  // Cumulative usage can exceed the context window after several turns. The
  // last request usage is the current context footprint shown by Hexa clients.
  const current = tokenUsage?.lastTokenUsage ?? tokenUsage?.last_token_usage ?? tokenUsage?.last ?? tokenUsage?.total ?? tokenUsage;
  const used = Number(current?.totalTokens ?? current?.total_tokens ?? current?.inputTokens ?? current?.input_tokens ?? 0);
  const reportedWindow = Number(tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window ?? tokenUsage?.contextWindow ?? 0);
  // For a local model, use only the running provider's reported allocation.
  // The engine/config notification may belong to the preceding cloud turn.
  // For an OpenAI account, only use the window reported for that authenticated
  // session. `model_context_window` can retain a local-provider override and
  // therefore is not a safe hosted fallback.
  const windowSize = isLocalProvider
    ? Number(localContextWindow)
    : reportedWindow;
  if (!windowSize) return { percent: 0, label: used ? `${compactTokens(used)} tokens used` : 'Context usage unavailable', used };
  // Match the engine's hosted-context calculation: the fixed prompt/tool
  // baseline is removed from both used tokens and available tokens. Removing
  // it from only the denominator made account rings start partially filled.
  // Local providers continue to report their exact allocated window.
  const baseline = isLocalProvider || windowSize <= 12_000 ? 0 : 12_000;
  const usable = Math.max(1, windowSize - baseline);
  const userControlledUsed = Math.max(0, used - baseline);
  const percent = Math.min(1, Math.max(0, userControlledUsed / usable));
  return { percent, label: `${compactTokens(used)} / ${compactTokens(windowSize)} tokens used`, used };
}
function compactTokens(value: number): string {
  if (value < 1000) return value.toLocaleString();
  const compact = value / 1000;
  return `${compact >= 100 ? Math.round(compact) : compact.toFixed(1).replace(/\.0$/, '')}k`;
}
function titleFromFirstMessage(draft: string, attachments: Array<{ name: string }>): string {
  const message = draft
    .replace(/\$(?:goal|plan)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (message) return message;
  if (attachments.length === 1) return attachments[0].name;
  if (attachments.length > 1) return `${attachments.length} attachments`;
  return 'New chat';
}
function serializeComposer(value: string, plugins: PluginSummary[]): { text: string; textElements: any[] } {
  const textElements: any[] = [];
  for (const plugin of plugins) {
    const mention = `$${plugin.name}`;
    let index = value.indexOf(mention);
    while (index >= 0) {
      const start = new TextEncoder().encode(value.slice(0, index)).length;
      const end = start + new TextEncoder().encode(mention).length;
      textElements.push({ byteRange: { start, end }, placeholder: plugin.interface?.displayName || plugin.name });
      index = value.indexOf(mention, index + mention.length);
    }
  }
  textElements.sort((left, right) => left.byteRange.start - right.byteRange.start);
  return { text: value, textElements };
}
function deletedThreadIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem('hexa.deleted-thread-ids') || localStorage.getItem('codex-shell.deleted-thread-ids') || '[]'));
  } catch {
    return new Set();
  }
}
function rememberDeletedThread(threadId: string): void {
  const ids = deletedThreadIds();
  ids.add(threadId);
  localStorage.setItem('hexa.deleted-thread-ids', JSON.stringify([...ids].slice(-500)));
}

type SandboxPreflightRecord = {
  id: string;
  turnId?: string;
  afterItemId?: string;
  type?: string;
  toolName?: string;
  status?: string;
  _shellPreflight?: boolean;
};

const SANDBOX_PREFLIGHT_STORAGE_KEY = 'hexa.sandbox-preflight-transcript.v1';

function sandboxPreflightStore(): Record<string, SandboxPreflightRecord[]> {
  try {
    const value = JSON.parse(localStorage.getItem(SANDBOX_PREFLIGHT_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function rememberSandboxPreflight(threadId: string, update: SandboxPreflightRecord): void {
  if (!threadId || threadId.startsWith('local-thread-')) return;
  const store = sandboxPreflightStore();
  const records = store[threadId] ?? [];
  const index = records.findIndex((record) => record.id === update.id);
  const next = { ...(index >= 0 ? records[index] : {}), ...update };
  if (index >= 0) records[index] = next;
  else records.push(next);
  store[threadId] = records.slice(-20);
  const entries = Object.entries(store).slice(-500);
  localStorage.setItem(SANDBOX_PREFLIGHT_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function restoreSandboxPreflights(thread: ThreadView): ThreadView {
  const records = sandboxPreflightStore()[thread.id] ?? [];
  if (!records.length) return thread;
  return {
    ...thread,
    turns: (thread.turns ?? []).map((turn: any) => {
      const additions = records.filter((record) => record.turnId === turn.id && !turn.items?.some((item: any) => item.id === record.id));
      if (!additions.length) return turn;
      const items = [...(turn.items ?? [])];
      for (const record of additions) {
        // A restored overlay cannot still be actively checking after a full
        // app restart, so settle an interrupted local preflight as completed.
        const item = { ...record, type: 'guardianPermissionReview', toolName: 'Sandbox permission check', status: 'completed', _shellPreflight: true };
        const anchor = record.afterItemId == null ? -1 : items.findIndex((entry: any) => entry.id === record.afterItemId);
        items.splice(anchor >= 0 ? anchor + 1 : items.length, 0, item);
      }
      return { ...turn, items };
    }),
  };
}

type RawCustomToolRecord = {
  id: string;
  turnId: string;
  type?: string;
  namespace?: string | null;
  tool?: string;
  arguments?: unknown;
  status?: string;
  afterItemId?: string;
  _shellRawCustomTool?: boolean;
};

const RAW_CUSTOM_TOOL_STORAGE_KEY = 'hexa.raw-custom-tool-transcript.v1';

function rawCustomToolStore(): Record<string, RawCustomToolRecord[]> {
  try {
    const value = JSON.parse(localStorage.getItem(RAW_CUSTOM_TOOL_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function rememberRawCustomTool(threadId: string, turnId: string, update: Partial<RawCustomToolRecord> & { id: string }): void {
  if (!threadId || threadId.startsWith('local-thread-')) return;
  const store = rawCustomToolStore();
  const records = store[threadId] ?? [];
  const index = records.findIndex((record) => record.id === update.id && record.turnId === turnId);
  const next: RawCustomToolRecord = {
    ...(index >= 0 ? records[index] : {}),
    type: 'dynamicToolCall',
    _shellRawCustomTool: true,
    ...update,
    id: update.id,
    turnId,
  };
  if (index >= 0) records[index] = next;
  else records.push(next);
  store[threadId] = records.slice(-100);
  localStorage.setItem(RAW_CUSTOM_TOOL_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(store).slice(-500))));
}

function restoreRawCustomTools(thread: ThreadView): ThreadView {
  const records = rawCustomToolStore()[thread.id] ?? [];
  if (!records.length) return thread;
  return {
    ...thread,
    turns: (thread.turns ?? []).map((turn: any) => {
      const additions = records.filter((record) => record.turnId === turn.id && !turn.items?.some((item: any) => item.id === record.id));
      if (!additions.length) return turn;
      const items = [...(turn.items ?? [])];
      for (const record of additions) {
        const item = { ...record, status: record.status === 'failed' ? 'failed' : 'completed' };
        const anchor = record.afterItemId == null ? -1 : items.findIndex((entry: any) => entry.id === record.afterItemId);
        items.splice(anchor >= 0 ? anchor + 1 : items.length, 0, item);
      }
      return { ...turn, items };
    }),
  };
}
function friendlyPermission(id: string): string {
  const map: Record<string, string> = { ':read-only': 'Ask for approval', ':workspace': 'Approve for me', ':danger-full-access': 'Full access' };
  return map[id] || id.replace(/^:/, '').replaceAll('-', ' ');
}
function approvalPolicyForPermission(permission: string, configured?: unknown): any {
  // Permission profiles describe sandbox access; approvalPolicy describes when
  // the engine is allowed to ask for escalation. `never` is not an auto-approve
  // switch: it prevents requests entirely. For workspace mode that can turn a
  // recoverable command/file escalation into a hard failure.
  if (permission === ':danger-full-access') return 'never';
  if (permission === ':workspace') return 'on-request';
  if (configured === 'untrusted' || configured === 'on-request' || configured === 'never') return configured;
  if (configured && typeof configured === 'object' && 'granular' in (configured as Record<string, unknown>)) return configured;
  return 'on-request';
}
function permissionIcon(id: string, size: number): React.ReactNode {
  if (id === ':danger-full-access') return <ShieldAlert size={size} />;
  if (id === ':read-only') return <Hand size={size} />;
  return <ShieldCheck size={size} />;
}
function permissionDescription(id: string, fallback?: string | null): string {
  const map: Record<string, string> = {
    ':read-only': 'Ask before editing files or accessing the internet',
    ':workspace': 'Only ask for actions detected as potentially unsafe',
    ':danger-full-access': 'Unrestricted internet and file access',
  };
  return map[id] || fallback || id;
}
function friendlyEffort(effort: string): string {
  const labels: Record<string, string> = { none: 'Light', minimal: 'Light', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max', ultra: 'Ultra' };
  return labels[effort] || effort;
}
function ArrowUpIcon() { return <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden><path d="M10 15V5m0 0L6 9m4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function PlusIcon() { return <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>; }
function AttachmentMark() { return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden><path d="M5.2 9.2l5.6-5.6a3 3 0 014.2 4.2l-7 7a4.1 4.1 0 01-5.8-5.8l6.7-6.7" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/><path d="M7.2 11.7l5.4-5.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round"/></svg>; }
function GoalCompass() { return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden><path d="M10 2.1l2 5.9 5.9 2-5.9 2-2 5.9-2-5.9-5.9-2L8 8l2-5.9z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round"/><circle cx="10" cy="10" r="1.7" fill="currentColor"/></svg>; }
function PlanPath() { return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden><circle cx="4" cy="5" r="1.7" stroke="currentColor" strokeWidth="1.25"/><circle cx="16" cy="15" r="1.7" stroke="currentColor" strokeWidth="1.25"/><path d="M5.8 5h3.7a2 2 0 012 2v6a2 2 0 002 2h.7M8.3 11.3l3.2 1.7-3.2 1.7v-3.4z" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function SideDockIcon() { return <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden><rect x="2.5" y="3" width="15" height="14" rx="3" stroke="currentColor" strokeWidth="1.3"/><path d="M12.5 3v14" stroke="currentColor" strokeWidth="1.3"/></svg>; }
function BottomDockIcon() { return <svg viewBox="0 0 20 20" width="17" height="17" fill="none" aria-hidden><rect x="2.5" y="3" width="15" height="14" rx="3" stroke="currentColor" strokeWidth="1.3"/><path d="M2.5 12h15" stroke="currentColor" strokeWidth="1.3"/></svg>; }
function ListViewIcon() { return <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden><path d="M4 5h12M4 10h12M4 15h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="2" cy="5" r=".8" fill="currentColor"/><circle cx="2" cy="10" r=".8" fill="currentColor"/><circle cx="2" cy="15" r=".8" fill="currentColor"/></svg>; }
function GridViewIcon() { return <svg viewBox="0 0 20 20" width="16" height="16" fill="none" aria-hidden><rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><rect x="11.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><rect x="11.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2"/></svg>; }
