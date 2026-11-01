import { DomainError } from './domain-error.ts';

export function normalizeText(raw: string): string {
  return raw.trim().replace(/\s+/gu, ' ');
}

export function optionalText(raw: string | null | undefined): string | null {
  const text = normalizeText(raw ?? '');
  return text.length > 0 ? text : null;
}

export function assertLength(
  field: string,
  value: string,
  limits: { readonly min: number; readonly max: number },
): void {
  if (value.length < limits.min || value.length > limits.max) {
    throw new DomainError(`${field} must be ${limits.min}-${limits.max} characters long`);
  }
}
