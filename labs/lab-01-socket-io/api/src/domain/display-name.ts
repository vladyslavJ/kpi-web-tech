export const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N} _.-]{2,32}$/u;

export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/gu, ' ');
}

export function isValidDisplayName(normalized: string): boolean {
  return DISPLAY_NAME_PATTERN.test(normalized);
}
