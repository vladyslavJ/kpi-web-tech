import type { Clock, IdGenerator, LogContext, Logger } from '../../src/application/ports.ts';

export class FakeClock implements Clock {
  #now: number;

  constructor(start = Date.parse('2026-09-27T12:00:00.000Z')) {
    this.#now = start;
  }

  now(): Date {
    return new Date(this.#now);
  }

  advance(ms: number): void {
    this.#now += ms;
  }
}

export class SequentialIds implements IdGenerator {
  readonly #prefix: string;
  #counter = 0;

  constructor(prefix = 'id') {
    this.#prefix = prefix;
  }

  next(): string {
    this.#counter += 1;
    return `${this.#prefix}-${this.#counter}`;
  }
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silentLogger,
};

export class RecordingLogger implements Logger {
  readonly errors: { readonly message: string; readonly context: LogContext | undefined }[] = [];

  debug(): void {}
  info(): void {}
  warn(): void {}

  error(message: string, context?: LogContext): void {
    this.errors.push({ message, context });
  }

  child(): Logger {
    return this;
  }
}
