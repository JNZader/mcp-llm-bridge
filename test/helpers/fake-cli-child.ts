import { EventEmitter } from 'node:events';

export class FakeCliChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = new EventEmitter() as EventEmitter & {
    end: () => void;
    write: (input: string) => boolean;
  };
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly killCalls: NodeJS.Signals[] = [];
  readonly killResults: boolean[] = [];
  throwOnKillSignal: NodeJS.Signals | undefined;
  readonly stdinWrites: string[] = [];
  stdinEnded = false;

  constructor() {
    super();
    this.stdin.write = (input: string) => {
      this.stdinWrites.push(input);
      return true;
    };
    this.stdin.end = () => {
      this.stdinEnded = true;
    };
  }

  emitStdout(value: string): void {
    this.stdout.emit('data', Buffer.from(value));
  }

  emitStderr(value: string): void {
    this.stderr.emit('data', Buffer.from(value));
  }

  emitProcessError(error: Error): void {
    this.emit('error', error);
  }

  kill(signal: NodeJS.Signals): boolean {
    this.killCalls.push(signal);
    if (this.throwOnKillSignal === signal) {
      throw new Error(`kill ${signal} failed`);
    }

    const result = this.killResults.shift() ?? true;
    if (result) this.killed = true;
    return result;
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }

  emitClose(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('close', code, signal);
  }
}
