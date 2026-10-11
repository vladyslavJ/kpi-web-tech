import { HttpErrorResponse } from '@angular/common/http';
import type { ErrorCode, ErrorResponse } from './contract';

const MESSAGES: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Перевірте правильність заповнення полів',
  USERNAME_TAKEN: 'Це ім’я користувача вже зайняте',
  INVALID_CREDENTIALS: 'Неправильне ім’я користувача або пароль',
  UNAUTHORIZED: 'Потрібна авторизація',
  TOKEN_EXPIRED: 'Термін дії токена минув',
  INVALID_TOKEN: 'Токен недійсний',
  FORBIDDEN: 'Недостатньо прав для цієї дії',
  NOT_FOUND: 'Користувача не знайдено',
  LAST_ADMIN: 'Має залишитися хоча б один адміністратор',
  SELF_DELETE: 'Не можна видалити власний обліковий запис',
  RATE_LIMITED: 'Забагато спроб. Спробуйте трохи пізніше',
  INTERNAL_ERROR: 'Помилка сервера. Спробуйте ще раз',
};

export function apiErrorCode(error: unknown): ErrorCode | null {
  if (!(error instanceof HttpErrorResponse)) {
    return null;
  }
  const body = error.error as Partial<ErrorResponse> | null;
  const code = body?.error?.code;
  return code !== undefined && code in MESSAGES ? code : null;
}

export function describeApiError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 0) {
    return 'Сервер недоступний. Перевірте, чи запущений API';
  }
  const code = apiErrorCode(error);
  return code ? MESSAGES[code] : 'Щось пішло не так. Спробуйте ще раз';
}
