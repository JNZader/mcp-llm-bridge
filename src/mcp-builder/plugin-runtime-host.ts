import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import {
  LiveRequestIds,
  PluginRuntimeProtocolError,
  validatePluginRuntimeEnvelope,
  type PluginRuntimeErrorCode,
  type PluginRuntimeManifest,
} from './plugin-runtime-protocol.js';

const DIAGNOSTIC_EVENT_BYTES = 8 * 1024;
const DIAGNOSTIC_LIFETIME_BYTES = 64 * 1024;

export const PLUGIN_RUNTIME_STATE = {
  STARTING: 'starting',
  ADMITTING: 'admitting',
  ACTIVE: 'active',
  TERMINATING: 'terminating',
  EXITED: 'exited',
  QUARANTINED: 'quarantined',
} as const;

export type PluginRuntimeState = (typeof PLUGIN_RUNTIME_STATE)[keyof typeof PLUGIN_RUNTIME_STATE];
export type DiagnosticStream = 'stdout' | 'stderr';

export interface WorkerLike extends EventEmitter {
  postMessage(value: unknown): void;
  terminate(): Promise<number>;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
}

export interface PluginRuntimeDiagnostic {
  stream: DiagnosticStream;
  text: string;
  truncated: boolean;
  emittedBytes: number;
  droppedBytes: number;
}

export interface PluginRuntimeDiagnosticCounter {
  emittedBytes: number;
  droppedBytes: number;
}

export interface PluginRuntimeHostOptions {
  worker?: WorkerLike;
  workerEntry?: string | URL;
  pluginUrl?: string;
  environment?: Record<string, string>;
  importTimeoutMs?: number;
  invocationTimeoutMs?: number;
  onDiagnostic?: (event: PluginRuntimeDiagnostic) => void;
}

export class PluginRuntimeHostError extends Error {
  constructor(public readonly code: PluginRuntimeErrorCode) {
    super(code);
    this.name = 'PluginRuntimeHostError';
  }
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface StartupPending {
  resolve(value: PluginRuntimeManifest): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

function configuredTimeout(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value >= 0 ? value : fallback;
}

function utf8Prefix(value: Buffer, limit: number): Buffer {
  let length = Math.min(value.length, limit);
  while (length > 0) {
    const text = value.subarray(0, length).toString('utf8');
    const encoded = Buffer.from(text, 'utf8');
    if (encoded.length <= limit) return encoded;
    length -= 1;
  }
  return Buffer.alloc(0);
}

export class PluginRuntimeHost {
  public state: PluginRuntimeState = PLUGIN_RUNTIME_STATE.STARTING;
  public manifest?: PluginRuntimeManifest;
  public readonly worker: WorkerLike;
  public readonly diagnosticCounters: Record<DiagnosticStream, PluginRuntimeDiagnosticCounter> = {
    stdout: { emittedBytes: 0, droppedBytes: 0 },
    stderr: { emittedBytes: 0, droppedBytes: 0 },
  };

  private readonly pending = new Map<string, Pending>();
  private readonly liveIds = new LiveRequestIds();
  private readonly diagnostic?: PluginRuntimeHostOptions['onDiagnostic'];
  private readonly onMessage = (value: unknown) => this.message(value);
  private readonly onError = () => undefined;
  private readonly onExit = () => this.exit();
  private readonly diagnosticListeners = new Map<DiagnosticStream, (chunk: Buffer | string) => void>();
  private importTimeout: number;
  private invocationTimeout: number;
  private startup?: StartupPending;
  private startupPromise?: Promise<PluginRuntimeManifest>;
  private terminalCode?: PluginRuntimeErrorCode;
  private finalized = false;
  private exitPromise: Promise<void>;
  private resolveExit!: () => void;

  constructor(options: PluginRuntimeHostOptions) {
    this.worker = options.worker ?? this.createWorker(options);
    this.importTimeout = configuredTimeout(options.importTimeoutMs, 50);
    this.invocationTimeout = configuredTimeout(options.invocationTimeoutMs, 50);
    this.diagnostic = options.onDiagnostic;
    this.exitPromise = new Promise((resolve) => { this.resolveExit = resolve; });

    this.worker.on('message', this.onMessage);
    this.worker.on('error', this.onError);
    this.worker.on('exit', this.onExit);
    this.attachDiagnosticStreams();
  }

  setImportTimeout(milliseconds: number): void {
    this.importTimeout = configuredTimeout(milliseconds, this.importTimeout);
  }

  setInvocationTimeout(milliseconds: number): void {
    this.invocationTimeout = configuredTimeout(milliseconds, this.invocationTimeout);
  }

  start(): Promise<PluginRuntimeManifest> {
    if (this.startupPromise) return this.startupPromise;
    if (this.state !== PLUGIN_RUNTIME_STATE.STARTING) {
      return Promise.reject(new PluginRuntimeHostError('PLUGIN_QUARANTINED'));
    }

    this.startupPromise = new Promise<PluginRuntimeManifest>((resolve, reject) => {
      const timer = setTimeout(() => this.beginTermination('IMPORT_TIMEOUT'), this.importTimeout);
      this.startup = { resolve, reject, timer };
    });
    return this.startupPromise;
  }

  invoke(tool: string, args: unknown): Promise<unknown> {
    if (this.state !== PLUGIN_RUNTIME_STATE.ACTIVE) {
      return Promise.reject(new PluginRuntimeHostError('PLUGIN_QUARANTINED'));
    }

    const id = this.reserveRequestId();
    try {
      validatePluginRuntimeEnvelope({ v: 1, kind: 'invoke', id, tool, args });
    } catch (error) {
      this.liveIds.release(id);
      const code = error instanceof PluginRuntimeProtocolError ? error.code : 'PROTOCOL_INVALID';
      return Promise.reject(new PluginRuntimeHostError(code));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        this.liveIds.release(id);
        pending.reject(new PluginRuntimeHostError('INVOCATION_TIMEOUT'));
      }, this.invocationTimeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ v: 1, kind: 'invoke', id, tool, args });
    });
  }

  async shutdown(): Promise<void> {
    if (this.finalized) return;
    this.beginTermination('WORKER_EXITED');
    await this.exitPromise;
  }

  capture(stream: DiagnosticStream, chunk: Buffer): void {
    const counters = this.diagnosticCounters[stream];
    const lifetimeEmittedBytes = this.diagnosticCounters.stdout.emittedBytes
      + this.diagnosticCounters.stderr.emittedBytes;
    const remaining = Math.max(0, DIAGNOSTIC_LIFETIME_BYTES - lifetimeEmittedBytes);
    const prefix = utf8Prefix(chunk, Math.min(DIAGNOSTIC_EVENT_BYTES, remaining));
    const emittedBytes = prefix.length;
    const droppedBytes = chunk.length - emittedBytes;
    counters.emittedBytes += emittedBytes;
    counters.droppedBytes += droppedBytes;
    if (emittedBytes === 0) return;
    this.diagnostic?.({
      stream,
      text: prefix.toString('utf8'),
      truncated: droppedBytes > 0,
      emittedBytes: counters.emittedBytes,
      droppedBytes: counters.droppedBytes,
    });
  }

  private createWorker(options: PluginRuntimeHostOptions): WorkerLike {
    if (!options.workerEntry || !options.pluginUrl) {
      throw new PluginRuntimeHostError('CONFIG_INVALID');
    }
    return new Worker(options.workerEntry, {
      workerData: { pluginUrl: options.pluginUrl },
      env: { ...(options.environment ?? {}) },
      argv: [],
      execArgv: [],
      stdout: true,
      stderr: true,
    });
  }

  private reserveRequestId(): string {
    for (;;) {
      const id = crypto.randomUUID();
      try {
        this.liveIds.reserve(id);
        return id;
      } catch (error) {
        if (!(error instanceof PluginRuntimeProtocolError)) throw error;
      }
    }
  }

  private message(value: unknown): void {
    let envelope;
    try {
      envelope = validatePluginRuntimeEnvelope(value);
    } catch {
      if (this.state === PLUGIN_RUNTIME_STATE.STARTING || this.state === PLUGIN_RUNTIME_STATE.ADMITTING) {
        this.beginTermination('PROTOCOL_INVALID');
      }
      return;
    }

    if (envelope.kind === 'ready') {
      if (this.state !== PLUGIN_RUNTIME_STATE.STARTING) return;
      this.state = PLUGIN_RUNTIME_STATE.ADMITTING;
      this.manifest = envelope.manifest;
      const startup = this.startup;
      if (!startup) return;
      clearTimeout(startup.timer);
      this.startup = undefined;
      this.state = PLUGIN_RUNTIME_STATE.ACTIVE;
      startup.resolve(envelope.manifest);
      return;
    }

    if (envelope.kind === 'result') {
      const pending = this.pending.get(envelope.id);
      if (!pending) return;
      this.pending.delete(envelope.id);
      this.liveIds.release(envelope.id);
      clearTimeout(pending.timer);
      pending.resolve(envelope.result);
      return;
    }

    if (envelope.kind === 'failure') {
      if (envelope.id !== undefined) {
        const pending = this.pending.get(envelope.id);
        if (!pending) return;
        this.pending.delete(envelope.id);
        this.liveIds.release(envelope.id);
        clearTimeout(pending.timer);
        pending.reject(new PluginRuntimeHostError(envelope.code));
        return;
      }
      this.beginTermination(envelope.code);
    }
  }

  private beginTermination(code: PluginRuntimeErrorCode): void {
    if (this.finalized || this.state === PLUGIN_RUNTIME_STATE.TERMINATING) return;
    this.state = PLUGIN_RUNTIME_STATE.TERMINATING;
    this.terminalCode = code;
    void this.worker.terminate().catch(() => undefined);
  }

  private exit(): void {
    if (this.finalized) return;
    this.finalized = true;
    this.state = PLUGIN_RUNTIME_STATE.QUARANTINED;
    this.removeManagedListeners();

    if (this.startup) {
      clearTimeout(this.startup.timer);
      const startup = this.startup;
      this.startup = undefined;
      startup.reject(new PluginRuntimeHostError(this.terminalCode ?? 'WORKER_EXITED'));
    }

    const failure = new PluginRuntimeHostError(this.terminalCode ?? 'WORKER_EXITED');
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.liveIds.release(id);
      pending.reject(failure);
    }
    this.pending.clear();
    this.resolveExit();
  }

  private attachDiagnosticStreams(): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      const readable = this.worker[stream];
      if (!readable) continue;
      const listener = (chunk: Buffer | string) => this.capture(stream, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      this.diagnosticListeners.set(stream, listener);
      readable.on('data', listener);
    }
  }

  private removeManagedListeners(): void {
    this.worker.removeListener('message', this.onMessage);
    this.worker.removeListener('error', this.onError);
    this.worker.removeListener('exit', this.onExit);
    for (const [stream, listener] of this.diagnosticListeners) {
      const readable = this.worker[stream];
      readable?.removeListener('data', listener);
      readable?.resume();
    }
    this.diagnosticListeners.clear();
  }
}
