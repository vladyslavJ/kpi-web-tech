import type { SendErrorCode } from './chat-gateway';
import { MESSAGE_MAX_LENGTH, NAME_HINT } from './chat-rules';
import type { ErrorCode } from './contract';

const SEND_ERRORS: Record<SendErrorCode, string> = {
  VALIDATION_ERROR: `Повідомлення порожнє або довше за ${MESSAGE_MAX_LENGTH} символів.`,
  RATE_LIMITED: 'Забагато повідомлень поспіль — зачекайте кілька секунд.',
  NOT_JOINED: 'Ви ще не в чаті — зачекайте на підключення.',
  INTERNAL_ERROR: 'Помилка сервера. Спробуйте ще раз.',
  TIMEOUT: 'Сервер не відповів вчасно. Перевірте з’єднання.',
  OFFLINE: 'Немає з’єднання з сервером.',
};

export function describeSendError(code: SendErrorCode): string {
  return SEND_ERRORS[code];
}

export function describeJoinError(code: ErrorCode): string {
  return code === 'VALIDATION_ERROR'
    ? `Сервер не прийняв нікнейм або назву кімнати. ${NAME_HINT}.`
    : 'Сервер відхилив підключення. Спробуйте ще раз.';
}
