import { isObjectIdOrHexString, type Model, type Types } from 'mongoose';
import type { OperationTypeWorkload, ProcessCardRepository } from '../../../application/ports.ts';
import type { OperationTypeId } from '../../../domain/operation-type.ts';
import type { PartId } from '../../../domain/part.ts';
import {
  roundDuration,
  type ProcessCard,
  type ProcessCardDetails,
  type ProcessCardId,
} from '../../../domain/process-card.ts';
import type { ProcessCardRecord } from './models.ts';
import { withStorage } from './mongo-errors.ts';
import { MongoRepository } from './mongo-repository.ts';
import { toProcessCard } from './record-mappers.ts';

interface WorkloadRow {
  readonly _id: Types.ObjectId;
  readonly operations: number;
  readonly totalDurationMinutes: number;
}

export class MongoProcessCardRepository
  extends MongoRepository<ProcessCardRecord, ProcessCard, ProcessCardDetails, ProcessCardId>
  implements ProcessCardRepository
{
  constructor(model: Model<ProcessCardRecord>) {
    super({
      model,
      toEntity: toProcessCard,
      toRecord: (details) => ({
        part: details.partId,
        operations: details.operations.map((operation) => ({
          operationType: operation.operationTypeId,
          equipment: operation.equipment,
          durationMinutes: operation.durationMinutes,
        })),
      }),
      sort: { createdAt: 1 },
    });
  }

  async isPartUsed(id: PartId): Promise<boolean> {
    if (!isObjectIdOrHexString(id)) {
      return false;
    }
    return withStorage(async () => (await this.model.exists({ part: id })) !== null);
  }

  async isOperationTypeUsed(id: OperationTypeId): Promise<boolean> {
    if (!isObjectIdOrHexString(id)) {
      return false;
    }
    return withStorage(
      async () => (await this.model.exists({ 'operations.operationType': id })) !== null,
    );
  }

  workload(): Promise<readonly OperationTypeWorkload[]> {
    return withStorage(async () => {
      const rows = await this.model.aggregate<WorkloadRow>([
        { $unwind: '$operations' },
        {
          $group: {
            _id: '$operations.operationType',
            operations: { $sum: 1 },
            totalDurationMinutes: { $sum: '$operations.durationMinutes' },
          },
        },
      ]);
      return rows.map((row) => ({
        operationTypeId: row._id.toHexString() as OperationTypeId,
        operations: row.operations,
        totalDurationMinutes: roundDuration(row.totalDurationMinutes),
      }));
    });
  }
}
