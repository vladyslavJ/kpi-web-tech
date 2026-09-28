import pino from 'pino';
import type { LogContext, Logger, LogLevel } from '../../application/ports.ts';

export interface PinoLoggerOptions {
  readonly level: LogLevel;
  readonly pretty: boolean;
}

export function createPinoLogger(options: PinoLoggerOptions): Logger {
  return new PinoLogger(
    pino({
      level: options.level,
      serializers: { error: pino.stdSerializers.err },
      transport: options.pretty ? { target: 'pino-pretty' } : undefined,
    }),
  );
}

class PinoLogger implements Logger {
  readonly #pino: pino.Logger;

  constructor(instance: pino.Logger) {
    this.#pino = instance;
  }

  debug(message: string, context: LogContext = {}): void {
    this.#pino.debug(context, message);
  }

  info(message: string, context: LogContext = {}): void {
    this.#pino.info(context, message);
  }

  warn(message: string, context: LogContext = {}): void {
    this.#pino.warn(context, message);
  }

  error(message: string, context: LogContext = {}): void {
    this.#pino.error(context, message);
  }

  child(bindings: LogContext): Logger {
    return new PinoLogger(this.#pino.child(bindings));
  }
}
