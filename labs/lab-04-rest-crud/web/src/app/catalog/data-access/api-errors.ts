import { HttpErrorResponse } from '@angular/common/http';
import type { ErrorCode, ErrorResponse } from './contract';

const MESSAGES: Readonly<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Сервер не прийняв дані. Перевірте правильність заповнення полів',
  NOT_FOUND: 'Запис не знайдено. Можливо, його вже видалили',
  PART_DESIGNATION_TAKEN: 'Деталь з таким позначенням уже існує',
  OPERATION_TYPE_NAME_TAKEN: 'Вид обробки з такою назвою вже існує',
  PART_ALREADY_HAS_CARD: 'Для цієї деталі вже створено технологічну карту',
  PART_IN_USE: 'Деталь має технологічну карту. Спершу видаліть карту',
  OPERATION_TYPE_IN_USE: 'Вид обробки використовується в технологічних картах',
  UNKNOWN_PART: 'Обрану деталь не знайдено. Оновіть сторінку',
  UNKNOWN_OPERATION_TYPE: 'Один із видів обробки не знайдено. Оновіть сторінку',
  DATABASE_UNAVAILABLE: 'База даних тимчасово недоступна. Спробуйте за кілька секунд',
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
