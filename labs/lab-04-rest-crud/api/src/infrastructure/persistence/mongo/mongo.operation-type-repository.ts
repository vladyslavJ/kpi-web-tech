import type { Model } from 'mongoose';
import type { OperationTypeRepository } from '../../../application/ports.ts';
import type {
  OperationType,
  OperationTypeDetails,
  OperationTypeId,
} from '../../../domain/operation-type.ts';
import type { OperationTypeRecord } from './models.ts';
import { MongoRepository } from './mongo-repository.ts';
import { toOperationType } from './record-mappers.ts';

export class MongoOperationTypeRepository
  extends MongoRepository<OperationTypeRecord, OperationType, OperationTypeDetails, OperationTypeId>
  implements OperationTypeRepository
{
  constructor(model: Model<OperationTypeRecord>) {
    super({
      model,
      toEntity: toOperationType,
      toRecord: (details) => ({ name: details.name, description: details.description }),
      sort: { name: 1 },
      collation: { locale: 'uk' },
    });
  }
}
