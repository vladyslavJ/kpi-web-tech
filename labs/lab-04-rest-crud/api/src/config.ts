import { z } from 'zod';
import type { LogLevel } from './application/ports.ts';

export type Environment = 'development' | 'production' | 'test';

export type LogFormat = 'pretty' | 'json';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  MONGODB_URI: z
    .string()
    .trim()
    .regex(/^mongodb(\+srv)?:\/\/\S+$/, 'Expected a mongodb:// or mongodb+srv:// connection string')
    .default('mongodb://127.0.0.1:27018/lab04'),
  MONGODB_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5000),
  SEED_DEMO_DATA: z.stringbool().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  STATIC_DIR: z.string().trim().min(1).optional(),
});

export interface AppConfig {
  readonly environment: Environment;
  readonly port: number;
  readonly bodyLimitBytes: number;
  readonly mongodb: { readonly uri: string; readonly timeoutMs: number };
  readonly seedDemoData: boolean;
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
    bodyLimitBytes: 64 * 1024,
    mongodb: { uri: vars.MONGODB_URI, timeoutMs: vars.MONGODB_TIMEOUT_MS },
    seedDemoData: vars.SEED_DEMO_DATA ?? vars.NODE_ENV === 'development',
    logLevel: vars.LOG_LEVEL ?? (vars.NODE_ENV === 'production' ? 'info' : 'debug'),
    logFormat: vars.NODE_ENV === 'development' ? 'pretty' : 'json',
    staticDir: vars.STATIC_DIR,
  };
}

export function redactConnectionString(uri: string): string {
  return uri.replace(/^(mongodb(?:\+srv)?:\/\/)[^@/]*@/, '$1***@');
}
