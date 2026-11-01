import type { ProcessCardView } from '../../application/process-cards.service.ts';
import type { Statistics } from '../../application/statistics.service.ts';
import type { OperationType } from '../../domain/operation-type.ts';
import type { Part } from '../../domain/part.ts';
import { operationNumber, totalDuration } from '../../domain/process-card.ts';
import type {
  OperationTypeDto,
  OperationTypeRefDto,
  PartDto,
  ProcessCardDto,
  StatisticsResponse,
} from './contract.ts';

export function toPartDto(part: Part): PartDto {
  return {
    id: part.id,
    designation: part.designation,
    name: part.name,
    material: part.material,
    createdAt: part.createdAt.toISOString(),
    updatedAt: part.updatedAt.toISOString(),
  };
}

export function toOperationTypeDto(operationType: OperationType): OperationTypeDto {
  return {
    id: operationType.id,
    name: operationType.name,
    description: operationType.description,
    createdAt: operationType.createdAt.toISOString(),
    updatedAt: operationType.updatedAt.toISOString(),
  };
}

export function toProcessCardDto({ card, part, operationTypes }: ProcessCardView): ProcessCardDto {
  return {
    id: card.id,
    part: {
      id: part.id,
      designation: part.designation,
      name: part.name,
      material: part.material,
    },
    operations: card.operations.map((operation, index) => {
      const operationType = operationTypes.get(operation.operationTypeId);
      if (!operationType) {
        throw new Error(`Operation type ${operation.operationTypeId} is not resolved`);
      }
      return {
        number: operationNumber(index),
        operationType: toOperationTypeRef(operationType),
        equipment: operation.equipment,
        durationMinutes: operation.durationMinutes,
      };
    }),
    totalDurationMinutes: totalDuration(card),
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

export function toStatisticsResponse(statistics: Statistics): StatisticsResponse {
  return {
    parts: statistics.parts,
    operationTypes: statistics.operationTypes,
    processCards: statistics.processCards,
    operations: statistics.operations,
    totalDurationMinutes: statistics.totalDurationMinutes,
    workload: statistics.workload.map((entry) => ({
      operationType: toOperationTypeRef(entry.operationType),
      operations: entry.operations,
      totalDurationMinutes: entry.totalDurationMinutes,
    })),
  };
}

function toOperationTypeRef(operationType: OperationType): OperationTypeRefDto {
  return { id: operationType.id, name: operationType.name };
}
