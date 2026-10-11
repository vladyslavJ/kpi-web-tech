export const USERNAME_PATTERN = /^[\p{L}\p{N}_.-]{3,32}$/u;
export const USERNAME_HINT = '3–32 символи: літери, цифри, крапка, дефіс або підкреслення';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_HINT = `від ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символів, не лише пробіли`;

export const ROLE_LABELS = {
  user: 'Користувач',
  admin: 'Адміністратор',
} as const;
