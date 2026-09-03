import { app } from 'electron';
import electronUpdater, { type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { ShellUpdateState } from '../../shared/types.js';

// electron-updater is published as CommonJS. Import its module object through
// the ESM default bridge so Electron does not try to resolve autoUpdater as a
// native ESM named export during main-process startup.
const { autoUpdater } = electronUpdater;

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 20 * 1000;

export class UpdateManager {
  private state: ShellUpdateState;
  private checkPending: Promise<ShellUpdateState> | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly publish: (state: ShellUpdateState) => void,
    private readonly beforeInstall: () => Promise<void>,
  ) {
    this.state = {
      phase: app.isPackaged ? 'idle' : 'unsupported',
      currentVersion: app.getVersion(),
      message: app.isPackaged ? 'Updates have not been checked yet.' : 'Update checks are available in packaged builds.',
    };

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.fullChangelog = false;

    autoUpdater.on('checking-for-update', () => this.setState({ phase: 'checking', message: 'Checking for updates…' }));
    autoUpdater.on('update-available', (info) => this.onAvailable(info));
    autoUpdater.on('update-not-available', (info) => this.setState({
      phase: 'up-to-date',
      availableVersion: info.version,
      checkedAt: Date.now(),
      message: `Hexa ${app.getVersion()} is up to date.`,
      progress: undefined,
    }));
    autoUpdater.on('download-progress', (progress) => this.onProgress(progress));
    autoUpdater.on('update-downloaded', (info) => this.setState({
      phase: 'downloaded',
      availableVersion: info.version,
      progress: 100,
      message: `Hexa ${info.version} is ready to install.`,
    }));
    autoUpdater.on('error', (error) => this.setState({
      phase: 'error',
      message: error.message || 'The update operation failed.',
      error: error.message,
    }));
  }

  getState(): ShellUpdateState {
    return { ...this.state };
  }

  startPeriodicChecks(): void {
    if (!app.isPackaged || this.initialTimer || this.intervalTimer) return;
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      void this.checkForUpdates(false);
    }, INITIAL_CHECK_DELAY_MS);
    this.initialTimer.unref();
    this.intervalTimer = setInterval(() => void this.checkForUpdates(false), CHECK_INTERVAL_MS);
    this.intervalTimer.unref();
  }

  async checkForUpdates(manual = true): Promise<ShellUpdateState> {
    if (!app.isPackaged) return this.getState();
    if (this.checkPending) return this.checkPending;
    // Once offered, keep the update state stable so declining the dialog never
    // makes its title-bar button disappear during a later periodic check.
    if (this.state.phase === 'available' || this.state.phase === 'downloading' || this.state.phase === 'downloaded') return this.getState();

    this.checkPending = (async () => {
      if (manual) this.setState({ phase: 'checking', message: 'Checking for updates…', error: undefined });
      try {
        await autoUpdater.checkForUpdates();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.setState({ phase: 'error', message, error: message, checkedAt: Date.now() });
      } finally {
        this.checkPending = null;
      }
      return this.getState();
    })();
    return this.checkPending;
  }

  async downloadUpdate(): Promise<ShellUpdateState> {
    if (!app.isPackaged || this.state.phase !== 'available') return this.getState();
    this.setState({ phase: 'downloading', progress: 0, message: `Downloading Hexa ${this.state.availableVersion}…`, error: undefined });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setState({ phase: 'error', message, error: message });
    }
    return this.getState();
  }

  async installUpdate(): Promise<{ accepted: boolean }> {
    if (!app.isPackaged || this.state.phase !== 'downloaded') return { accepted: false };
    await this.beforeInstall();
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { accepted: true };
  }

  private onAvailable(info: UpdateInfo): void {
    const releaseNotes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes
      : Array.isArray(info.releaseNotes)
        ? (info.releaseNotes.find((entry) => entry.version === info.version)?.note
          ?? info.releaseNotes[0]?.note
          ?? undefined)
        : undefined;
    this.setState({
      phase: 'available',
      availableVersion: info.version,
      releaseName: typeof info.releaseName === 'string' ? info.releaseName : undefined,
      releaseNotes,
      checkedAt: Date.now(),
      progress: undefined,
      error: undefined,
      message: `Hexa ${info.version} is available.`,
    });
  }

  private onProgress(progress: ProgressInfo): void {
    this.setState({
      phase: 'downloading',
      progress: Math.max(0, Math.min(100, progress.percent)),
      transferred: progress.transferred,
      total: progress.total,
      message: `Downloading Hexa ${this.state.availableVersion ?? ''}…`,
    });
  }

  private setState(patch: Partial<ShellUpdateState>): void {
    this.state = { ...this.state, ...patch, currentVersion: app.getVersion() };
    this.publish(this.getState());
  }
}
