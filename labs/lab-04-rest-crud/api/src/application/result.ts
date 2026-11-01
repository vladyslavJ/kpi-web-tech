export type AppErrorCode =
  | 'NOT_FOUND'
  | 'PART_DESIGNATION_TAKEN'
  | 'OPERATION_TYPE_NAME_TAKEN'
  | 'PART_ALREADY_HAS_CARD'
  | 'PART_IN_USE'
  | 'OPERATION_TYPE_IN_USE'
  | 'UNKNOWN_PART'
  | 'UNKNOWN_OPERATION_TYPE';

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
