import type { OperationType, OperationTypeId } from '../../../domain/operation-type.ts';
import type { Part, PartId } from '../../../domain/part.ts';
import type { ProcessCard, ProcessCardId } from '../../../domain/process-card.ts';
import type { OperationTypeRecord, PartRecord, ProcessCardRecord } from './models.ts';

export function toPart(record: PartRecord): Part {
  return Object.freeze({
    id: record._id.toHexString() as PartId,
    designation: record.designation,
    name: record.name,
    material: record.material ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export function toOperationType(record: OperationTypeRecord): OperationType {
  return Object.freeze({
    id: record._id.toHexString() as OperationTypeId,
    name: record.name,
    description: record.description ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export function toProcessCard(record: ProcessCardRecord): ProcessCard {
  return Object.freeze({
    id: record._id.toHexString() as ProcessCardId,
    partId: record.part.toHexString() as PartId,
    operations: Object.freeze(
      record.operations.map((operation) =>
        Object.freeze({
          operationTypeId: operation.operationType.toHexString() as OperationTypeId,
          equipment: operation.equipment ?? null,
          durationMinutes: operation.durationMinutes,
        }),
      ),
    ),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}
