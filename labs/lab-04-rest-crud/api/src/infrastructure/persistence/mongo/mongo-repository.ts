import { isObjectIdOrHexString, type Model, type Types } from 'mongoose';
import type { WriteResult } from '../../../application/ports.ts';
import { isDuplicateKeyError, withStorage } from './mongo-errors.ts';

const NOT_FOUND = { ok: false, reason: 'not-found' } as const;
const DUPLICATE = { ok: false, reason: 'duplicate' } as const;

export interface RecordMapping<TRecord, TEntity, TDetails> {
  readonly model: Model<TRecord>;
  readonly toEntity: (record: TRecord) => TEntity;
  readonly toRecord: (details: TDetails) => Record<string, unknown>;
  readonly sort: Readonly<Record<string, 1 | -1>>;
  readonly collation?: { readonly locale: string; readonly numericOrdering?: boolean };
}

export class MongoRepository<
  TRecord extends { _id: Types.ObjectId },
  TEntity,
  TDetails,
  TId extends string,
> {
  protected readonly model: Model<TRecord>;
  readonly #mapping: RecordMapping<TRecord, TEntity, TDetails>;

  constructor(mapping: RecordMapping<TRecord, TEntity, TDetails>) {
    this.model = mapping.model;
    this.#mapping = mapping;
  }

  list(): Promise<readonly TEntity[]> {
    return withStorage(async () => {
      const query = this.model.find().sort({ ...this.#mapping.sort });
      if (this.#mapping.collation) {
        query.collation({ ...this.#mapping.collation });
      }
      const records = await query.lean<TRecord[]>();
      return records.map(this.#mapping.toEntity);
    });
  }

  count(): Promise<number> {
    return withStorage(async () => this.model.countDocuments());
  }

  async findById(id: TId): Promise<TEntity | undefined> {
    if (!isObjectIdOrHexString(id)) {
      return undefined;
    }
    return withStorage(async () => {
      const record = await this.model.findById(id).lean<TRecord>();
      return record ? this.#mapping.toEntity(record) : undefined;
    });
  }

  async findByIds(ids: readonly TId[]): Promise<readonly TEntity[]> {
    const valid = ids.filter((id) => isObjectIdOrHexString(id));
    if (valid.length === 0) {
      return [];
    }
    return withStorage(async () => {
      const records = await this.model.find({ _id: { $in: valid } }).lean<TRecord[]>();
      return records.map(this.#mapping.toEntity);
    });
  }

  create(details: TDetails): Promise<WriteResult<TEntity>> {
    return withStorage(async () => {
      try {
        const document = new this.model(this.#mapping.toRecord(details));
        await document.save();
        return { ok: true, value: this.#mapping.toEntity(document.toObject() as TRecord) };
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return DUPLICATE;
        }
        throw error;
      }
    });
  }

  async update(id: TId, details: TDetails): Promise<WriteResult<TEntity>> {
    if (!isObjectIdOrHexString(id)) {
      return NOT_FOUND;
    }
    return withStorage(async () => {
      try {
        const record = await this.model
          .findByIdAndUpdate(
            id,
            { $set: this.#mapping.toRecord(details) },
            { returnDocument: 'after', runValidators: true },
          )
          .lean<TRecord>();
        return record ? { ok: true, value: this.#mapping.toEntity(record) } : NOT_FOUND;
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return DUPLICATE;
        }
        throw error;
      }
    });
  }

  async remove(id: TId): Promise<boolean> {
    if (!isObjectIdOrHexString(id)) {
      return false;
    }
    return withStorage(async () => {
      const { deletedCount } = await this.model.deleteOne({ _id: id });
      return deletedCount === 1;
    });
  }
}
