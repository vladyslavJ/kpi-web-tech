import { assertLength, normalizeText, optionalText } from './text.ts';

export type OperationTypeId = string & { readonly __brand: 'OperationTypeId' };

export const OPERATION_TYPE_NAME_LENGTH = { min: 2, max: 60 } as const;
export const OPERATION_TYPE_DESCRIPTION_LENGTH = { min: 1, max: 300 } as const;

export interface OperationTypeDetails {
  readonly name: string;
  readonly description: string | null;
}

export interface OperationType extends OperationTypeDetails {
  readonly id: OperationTypeId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OperationTypeInput {
  readonly name: string;
  readonly description?: string | null | undefined;
}

export function normalizeOperationTypeName(raw: string): string {
  const name = normalizeText(raw);
  return name.charAt(0).toLocaleUpperCase('uk') + name.slice(1);
}

export function createOperationTypeDetails(input: OperationTypeInput): OperationTypeDetails {
  const name = normalizeOperationTypeName(input.name);
  assertLength('Operation type name', name, OPERATION_TYPE_NAME_LENGTH);
  const description = optionalText(input.description);
  if (description !== null) {
    assertLength('Operation type description', description, OPERATION_TYPE_DESCRIPTION_LENGTH);
  }
  return Object.freeze({ name, description });
}
