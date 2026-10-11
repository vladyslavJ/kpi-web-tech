export type AppErrorCode =
  | 'USERNAME_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHORIZED'
  | 'TOKEN_EXPIRED'
  | 'INVALID_TOKEN'
  | 'NOT_FOUND'
  | 'LAST_ADMIN'
  | 'SELF_DELETE';

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
}

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: AppError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err(code: AppErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}
