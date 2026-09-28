import { z } from 'zod';
import type { LogLevel } from './application/ports.ts';
import { MESSAGE_MAX_LENGTH } from './domain/message.ts';

const DEFAULT_AUTO_MESSAGE_TEXT =
  'Автоматичне повідомлення від ст. Жукова Владислава Віталійовича гр. ІС-33 Варіант 11';

export type Environment = 'development' | 'production' | 'test';

export type LogFormat = 'pretty' | 'json';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:4200'),
  HISTORY_LIMIT: z.coerce.number().int().min(0).max(500).default(50),
  AUTO_MESSAGE_INTERVAL_MS: z.coerce.number().int().min(100).default(21_000),
  AUTO_MESSAGE_TEXT: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH).default(DEFAULT_AUTO_MESSAGE_TEXT),
  RATE_LIMIT_BURST: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_REFILL_PER_SECOND: z.coerce.number().positive().default(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  STATIC_DIR: z.string().trim().min(1).optional(),
});

export interface AppConfig {
  readonly environment: Environment;
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly historyLimit: number;
  readonly maxPayloadBytes: number;
  readonly autoMessage: { readonly text: string; readonly intervalMs: number };
  readonly rateLimit: { readonly capacity: number; readonly refillPerSecond: number };
  readonly logLevel: LogLevel;
  readonly logFormat: LogFormat;
  readonly staticDir: string | undefined;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export function loadConfig(env: Readonly<Record<string, string | undefined>>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const vars = parsed.data;
  return {
    environment: vars.NODE_ENV,
    port: vars.PORT,
    corsOrigins: vars.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    historyLimit: vars.HISTORY_LIMIT,
    maxPayloadBytes: 16 * 1024,
    autoMessage: { text: vars.AUTO_MESSAGE_TEXT, intervalMs: vars.AUTO_MESSAGE_INTERVAL_MS },
    rateLimit: { capacity: vars.RATE_LIMIT_BURST, refillPerSecond: vars.RATE_LIMIT_REFILL_PER_SECOND },
    logLevel: vars.LOG_LEVEL ?? (vars.NODE_ENV === 'production' ? 'info' : 'debug'),
    logFormat: vars.NODE_ENV === 'development' ? 'pretty' : 'json',
    staticDir: vars.STATIC_DIR,
  };
}
