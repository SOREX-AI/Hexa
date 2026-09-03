import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import path from 'node:path';
import type { JsonValue, RpcError, ServerEvent, ServerRequest } from '../../shared/types.js';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: NodeJS.Timeout;
}

export interface AppServerMetadata {
  engineHome?: string;
  sqliteHome?: string;
  platformFamily?: string;
  platformOs?: string;
  userAgent?: string;
}

export interface AppServerStartOptions {
  sqliteHome: string;
  engineHome?: string;
}

export interface AppServerExitEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
  intentional: boolean;
  error: Error;
}

export class AppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private initialized = false;
  private intentionallyStopping = new WeakSet<ChildProcessWithoutNullStreams>();
  private stderrTail = '';
  metadata: AppServerMetadata = {};

  async start(binaryPath: string, options: AppServerStartOptions): Promise<void> {
    if (this.child) await this.stop();

    this.stderrTail = '';
    this.metadata = { sqliteHome: options.sqliteHome };

    const runtimeDir = path.dirname(binaryPath);
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
    const currentPath = process.env[pathKey] ?? '';
    const appServerBinary = path.join(
      runtimeDir,
      process.platform === 'win32' ? 'HexaAppServer.exe' : 'hexa-app-server',
    );
    const child = spawn(appServerBinary, ['--listen', 'stdio://', '--session-source', 'vscode'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Installed Electron apps can inherit a working directory inside the
      // installation tree (or another non-user location). Run the engine from
      // its writable home so any relative state/config paths cannot resolve
      // into Program Files/app resources and break SQLite access.
      ...(options.engineHome ? { cwd: options.engineHome } : {}),
      env: {
        ...process.env,
        LOG_FORMAT: 'json',
        RUST_LOG: process.env.HEXA_ENGINE_RUST_LOG || 'error',
        [pathKey]: currentPath ? `${runtimeDir}${path.delimiter}${currentPath}` : runtimeDir,
        // Give Hexa a distinct process/runtime namespace. Hexa does not inherit
        // the configured home or SQLite environment variables.
        HEXA_PROCESS_NAMESPACE: 'hexa',
        HEXA_SQLITE_HOME: options.sqliteHome,
        ...(options.engineHome ? { HEXA_ENGINE_HOME: options.engineHome } : {}),
      },
      windowsHide: true,
    });
    this.child = child;

    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => this.consumeLine(line));
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      this.stderrTail = (this.stderrTail + text).slice(-16_000);
      this.emit('stderr', text);
    });
    child.once('error', (error) => this.failAll(error));
    child.once('exit', (code, signal) => {
      const intentional = this.intentionallyStopping.has(child);
      this.intentionallyStopping.delete(child);
      this.initialized = false;
      if (this.child === child) this.child = null;
      const error = intentional
        ? new Error('Hexa Engine stopped.')
        : this.exitError(code, signal);
      this.failAll(error);
      this.emit('exit', { code, signal, intentional, error } satisfies AppServerExitEvent);
    });

    const initialized = await this.request<Record<string, unknown>>('initialize', {
      clientInfo: {
        name: 'hexa',
        title: 'Hexa',
        version: '0.0.1',
      },
      capabilities: {
        experimentalApi: true,
        extensions: {
          'openai/form': {},
          'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
        },
      },
    });
    this.metadata = {
      engineHome: typeof initialized.codexHome === 'string' ? initialized.codexHome : undefined,
      sqliteHome: options.sqliteHome,
      platformFamily:
        typeof initialized.platformFamily === 'string' ? initialized.platformFamily : undefined,
      platformOs: typeof initialized.platformOs === 'string' ? initialized.platformOs : undefined,
      userAgent: typeof initialized.userAgent === 'string' ? initialized.userAgent : undefined,
    };
    this.notify('initialized', {});
    this.initialized = true;
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.intentionallyStopping.add(child);
    this.child = null;
    this.initialized = false;
    try {
      child.stdin.end();
    } catch {
      // already closed
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        clearTimeout(hardTimer);
        resolve();
      };
      const killTimer = setTimeout(() => {
        child.kill();
      }, 1500);
      const hardTimer = setTimeout(finish, 3500);
      child.once('exit', finish);
    });
  }

  isReady(): boolean {
    return Boolean(this.child && this.initialized);
  }

  request<T = unknown>(method: string, params: unknown = {}): Promise<T> {
    const id = this.nextId++;
    const child = this.requireChild();
    const payload = { method, id, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 120_000);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    });
  }

  notify(method: string, params: unknown = {}): void {
    const child = this.requireChild();
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  respond(id: number | string, result: unknown): void {
    const child = this.requireChild();
    child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  respondError(id: number | string, code: number, message: string, data?: JsonValue): void {
    const child = this.requireChild();
    child.stdin.write(`${JSON.stringify({ id, error: { code, message, data } })}\n`);
  }

  private consumeLine(line: string): void {
    if (!line.trim()) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.emit('protocolError', new Error(`Invalid JSON from app-server: ${line.slice(0, 500)}`));
      return;
    }

    if ('id' in message && ('result' in message || 'error' in message) && !('method' in message)) {
      const id = typeof message.id === 'number' ? message.id : Number(message.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (message.error) {
        const error = message.error as RpcError;
        pending.reject(new Error(`${error.message} (${error.code})`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === 'string' && 'id' in message) {
      this.emit('request', message as unknown as ServerRequest);
      return;
    }

    if (typeof message.method === 'string') {
      this.emit('notification', message as unknown as ServerEvent);
    }
  }


  private exitError(code: number | null, signal: NodeJS.Signals | null): Error {
    const stderr = this.stderrTail.trim();
    const suffix = stderr ? `

Hexa Engine stderr:
${stderr}` : '';
    return new Error(
      `Hexa Engine exited (${code ?? 'null'}, ${signal ?? 'no signal'}).${suffix}`,
    );
  }

  private requireChild(): ChildProcessWithoutNullStreams {
    if (!this.child || this.child.stdin.destroyed) {
      throw new Error('Hexa Engine is not running.');
    }
    return this.child;
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
