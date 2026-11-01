import type { Model } from 'mongoose';
import type { PartRepository } from '../../../application/ports.ts';
import type { Part, PartDetails, PartId } from '../../../domain/part.ts';
import type { PartRecord } from './models.ts';
import { MongoRepository } from './mongo-repository.ts';
import { toPart } from './record-mappers.ts';

export class MongoPartRepository
  extends MongoRepository<PartRecord, Part, PartDetails, PartId>
  implements PartRepository
{
  constructor(model: Model<PartRecord>) {
    super({
      model,
      toEntity: toPart,
      toRecord: (details) => ({
        designation: details.designation,
        name: details.name,
        material: details.material,
      }),
      sort: { designation: 1 },
      collation: { locale: 'uk', numericOrdering: true },
    });
  }
}
