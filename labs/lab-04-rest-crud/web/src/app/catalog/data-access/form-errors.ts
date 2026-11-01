import type { FieldTree } from '@angular/forms/signals';

export function firstError<T>(field: FieldTree<T>): string | null {
  const state = field();
  return state.touched() && state.invalid() ? (state.errors()[0]?.message ?? null) : null;
}

export function normalizedLength(value: string): number {
  return value.trim().replace(/\s+/gu, ' ').length;
}
