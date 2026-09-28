export const NAME_PATTERN = /^[\p{L}\p{N} _.-]{2,32}$/u;
export const NAME_MAX_LENGTH = 32;
export const NAME_HINT = '2–32 символи: літери, цифри, пробіл, _ . -';

export const DEFAULT_ROOM = 'Загальна';

export const MESSAGE_MAX_LENGTH = 1000;

export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/gu, ' ');
}

export function isValidName(raw: string): boolean {
  return NAME_PATTERN.test(normalizeName(raw));
}
