import { DomainError } from './domain-error.ts';
import { assertLength, normalizeText, optionalText } from './text.ts';

export type PartId = string & { readonly __brand: 'PartId' };

export const PART_DESIGNATION_PATTERN = /^[\p{Lu}\p{N}][\p{Lu}\p{N}./-]{1,38}[\p{Lu}\p{N}]$/u;
export const PART_NAME_LENGTH = { min: 2, max: 120 } as const;
export const PART_MATERIAL_LENGTH = { min: 1, max: 80 } as const;

export interface PartDetails {
  readonly designation: string;
  readonly name: string;
  readonly material: string | null;
}

export interface Part extends PartDetails {
  readonly id: PartId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PartInput {
  readonly designation: string;
  readonly name: string;
  readonly material?: string | null | undefined;
}

export function normalizeDesignation(raw: string): string {
  return raw.trim().toLocaleUpperCase('uk');
}

export function createPartDetails(input: PartInput): PartDetails {
  const designation = normalizeDesignation(input.designation);
  if (!PART_DESIGNATION_PATTERN.test(designation)) {
    throw new DomainError(`Invalid part designation: ${JSON.stringify(input.designation)}`);
  }
  const name = normalizeText(input.name);
  assertLength('Part name', name, PART_NAME_LENGTH);
  const material = optionalText(input.material);
  if (material !== null) {
    assertLength('Part material', material, PART_MATERIAL_LENGTH);
  }
  return Object.freeze({ designation, name, material });
}
