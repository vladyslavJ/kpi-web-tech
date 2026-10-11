import { z } from 'zod';
import type { LogLevel } from './application/ports.ts';

const DEVELOPMENT_JWT_SECRET = 'development-only-secret-do-not-use-in-production';
const JWT_SECRET_MIN_LENGTH = 32;

export type Environment = 'development' | 'production' | 'test';

export type LogFormat = 'pretty' | 'json';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    DATA_FILE: z.string().trim().min(1).default('data/users.json'),
    JWT_SECRET: z.string().min(JWT_SECRET_MIN_LENGTH).optional(),
    JWT_ISSUER: z.string().trim().min(1).default('lab-02-jwt-auth'),
    JWT_TTL_SECONDS: z.coerce.number().int().min(1).max(86_400).default(71),
    TOKEN_AUTHOR: z.string().trim().min(1).default('Жуков В.В.'),
    TOKEN_GROUP: z.string().trim().min(1).default('ІС-33'),
    TOKEN_VARIANT: z.coerce.number().int().min(1).default(11),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    STATIC_DIR: z.string().trim().min(1).optional(),
  })
  .refine((vars) => vars.NODE_ENV !== 'production' || vars.JWT_SECRET !== undefined, {
    path: ['JWT_SECRET'],
    message: `JWT_SECRET is required in production (at least ${JWT_SECRET_MIN_LENGTH} characters)`,
  });

export interface AppConfig {
  readonly environment: Environment;
  readonly port: number;
  readonly dataFile: string;
  readonly bodyLimitBytes: number;
  readonly jwt: {
    readonly secret: string;
    readonly issuer: string;
    readonly ttlSeconds: number;
  };
  readonly tokenSignature: {
    readonly author: string;
    readonly group: string;
    readonly variant: number;
  };
  readonly authRateLimit: { readonly max: number; readonly windowMs: number };
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
    dataFile: vars.DATA_FILE,
    bodyLimitBytes: 16 * 1024,
    jwt: {
      secret: vars.JWT_SECRET ?? DEVELOPMENT_JWT_SECRET,
      issuer: vars.JWT_ISSUER,
      ttlSeconds: vars.JWT_TTL_SECONDS,
    },
    tokenSignature: {
      author: vars.TOKEN_AUTHOR,
      group: vars.TOKEN_GROUP,
      variant: vars.TOKEN_VARIANT,
    },
    authRateLimit: { max: vars.AUTH_RATE_LIMIT_MAX, windowMs: vars.AUTH_RATE_LIMIT_WINDOW_MS },
    logLevel: vars.LOG_LEVEL ?? (vars.NODE_ENV === 'production' ? 'info' : 'debug'),
    logFormat: vars.NODE_ENV === 'development' ? 'pretty' : 'json',
    staticDir: vars.STATIC_DIR,
  };
}
