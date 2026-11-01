import { DomainError } from './domain-error.ts';
import type { OperationTypeId } from './operation-type.ts';
import type { PartId } from './part.ts';
import { assertLength, optionalText } from './text.ts';

export type ProcessCardId = string & { readonly __brand: 'ProcessCardId' };

export const OPERATIONS_COUNT = { min: 1, max: 30 } as const;
export const DURATION_MINUTES = { min: 0.1, max: 1440 } as const;
export const EQUIPMENT_LENGTH = { min: 1, max: 120 } as const;
export const OPERATION_NUMBER_STEP = 5;

const TENTHS_PER_MINUTE = 10;

export interface Operation {
  readonly operationTypeId: OperationTypeId;
  readonly equipment: string | null;
  readonly durationMinutes: number;
}

export interface ProcessCardDetails {
  readonly partId: PartId;
  readonly operations: readonly Operation[];
}

export interface ProcessCard extends ProcessCardDetails {
  readonly id: ProcessCardId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OperationInput {
  readonly operationTypeId: string;
  readonly equipment?: string | null | undefined;
  readonly durationMinutes: number;
}

export interface ProcessCardInput {
  readonly partId: string;
  readonly operations: readonly OperationInput[];
}

export function isValidDuration(minutes: number): boolean {
  const tenths = minutes * TENTHS_PER_MINUTE;
  return (
    Number.isFinite(minutes) &&
    minutes >= DURATION_MINUTES.min &&
    minutes <= DURATION_MINUTES.max &&
    Math.abs(tenths - Math.round(tenths)) < 1e-9
  );
}

export function roundDuration(minutes: number): number {
  return Math.round(minutes * TENTHS_PER_MINUTE) / TENTHS_PER_MINUTE;
}

export function sumDurations(durations: readonly number[]): number {
  const tenths = durations.reduce(
    (total, minutes) => total + Math.round(minutes * TENTHS_PER_MINUTE),
    0,
  );
  return tenths / TENTHS_PER_MINUTE;
}

export function totalDuration(card: ProcessCardDetails): number {
  return sumDurations(card.operations.map((operation) => operation.durationMinutes));
}

export function operationNumber(index: number): number {
  return (index + 1) * OPERATION_NUMBER_STEP;
}

export function referencedOperationTypes(card: ProcessCardDetails): readonly OperationTypeId[] {
  return [...new Set(card.operations.map((operation) => operation.operationTypeId))];
}

export function createProcessCardDetails(input: ProcessCardInput): ProcessCardDetails {
  const count = input.operations.length;
  if (count < OPERATIONS_COUNT.min || count > OPERATIONS_COUNT.max) {
    throw new DomainError(
      `A process card must have ${OPERATIONS_COUNT.min}-${OPERATIONS_COUNT.max} operations`,
    );
  }
  const operations = input.operations.map((operation, index) => {
    if (!isValidDuration(operation.durationMinutes)) {
      throw new DomainError(
        `Operation ${operationNumber(index)}: invalid duration ${operation.durationMinutes}`,
      );
    }
    const equipment = optionalText(operation.equipment);
    if (equipment !== null) {
      assertLength(`Operation ${operationNumber(index)} equipment`, equipment, EQUIPMENT_LENGTH);
    }
    return Object.freeze({
      operationTypeId: operation.operationTypeId as OperationTypeId,
      equipment,
      durationMinutes: operation.durationMinutes,
    });
  });
  return Object.freeze({ partId: input.partId as PartId, operations: Object.freeze(operations) });
}
