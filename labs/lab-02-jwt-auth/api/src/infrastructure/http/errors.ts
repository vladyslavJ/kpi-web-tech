import type { Response } from 'express';
import type { AppError, AppErrorCode } from '../../application/result.ts';
import type { ErrorCode, ErrorResponse } from './contract.ts';

const STATUS_BY_APP_ERROR: Readonly<Record<AppErrorCode, number>> = {
  USERNAME_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  UNAUTHORIZED: 401,
  TOKEN_EXPIRED: 401,
  INVALID_TOKEN: 401,
  NOT_FOUND: 404,
  LAST_ADMIN: 409,
  SELF_DELETE: 409,
};

export class RequestValidationError extends Error {
  override readonly name = 'RequestValidationError';
}

export function sendError(
  response: Response,
  statusCode: number,
  code: ErrorCode,
  message: string,
): void {
  const body: ErrorResponse = { error: { code, message } };
  response.status(statusCode).json(body);
}

export function sendAppError(response: Response, error: AppError): void {
  sendError(response, STATUS_BY_APP_ERROR[error.code], error.code, error.message);
}
