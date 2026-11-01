import type { Response } from 'express';
import type { AppError, AppErrorCode, Result } from '../../application/result.ts';
import type { ErrorCode, ErrorResponse, ValidationIssueDto } from './contract.ts';

const STATUS_BY_APP_ERROR: Readonly<Record<AppErrorCode, number>> = {
  NOT_FOUND: 404,
  PART_DESIGNATION_TAKEN: 409,
  OPERATION_TYPE_NAME_TAKEN: 409,
  PART_ALREADY_HAS_CARD: 409,
  PART_IN_USE: 409,
  OPERATION_TYPE_IN_USE: 409,
  UNKNOWN_PART: 422,
  UNKNOWN_OPERATION_TYPE: 422,
};

export class RequestValidationError extends Error {
  override readonly name = 'RequestValidationError';
  readonly issues: readonly ValidationIssueDto[];

  constructor(issues: readonly ValidationIssueDto[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    this.issues = issues;
  }
}

export function sendError(
  response: Response,
  statusCode: number,
  code: ErrorCode,
  message: string,
  issues?: readonly ValidationIssueDto[],
): void {
  const body: ErrorResponse = { error: issues ? { code, message, issues } : { code, message } };
  response.status(statusCode).json(body);
}

export function sendAppError(response: Response, error: AppError): void {
  sendError(response, STATUS_BY_APP_ERROR[error.code], error.code, error.message);
}

export function sendResult<T>(
  response: Response,
  result: Result<T>,
  toBody: (value: T) => unknown,
  statusCode = 200,
): void {
  if (!result.ok) {
    sendAppError(response, result.error);
    return;
  }
  response.status(statusCode).json(toBody(result.value));
}

export function sendNoContent(response: Response, result: Result<void>): void {
  if (!result.ok) {
    sendAppError(response, result.error);
    return;
  }
  response.status(204).end();
}
