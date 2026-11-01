import { Schema, type Connection, type Model, type Types } from 'mongoose';
import {
  OPERATION_TYPE_DESCRIPTION_LENGTH,
  OPERATION_TYPE_NAME_LENGTH,
} from '../../../domain/operation-type.ts';
import { PART_MATERIAL_LENGTH, PART_NAME_LENGTH } from '../../../domain/part.ts';
import {
  DURATION_MINUTES,
  EQUIPMENT_LENGTH,
  OPERATIONS_COUNT,
} from '../../../domain/process-card.ts';

export interface PartRecord {
  _id: Types.ObjectId;
  designation: string;
  name: string;
  material: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationTypeRecord {
  _id: Types.ObjectId;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OperationRecord {
  operationType: Types.ObjectId;
  equipment: string | null;
  durationMinutes: number;
}

export interface ProcessCardRecord {
  _id: Types.ObjectId;
  part: Types.ObjectId;
  operations: OperationRecord[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Models {
  readonly Part: Model<PartRecord>;
  readonly OperationType: Model<OperationTypeRecord>;
  readonly ProcessCard: Model<ProcessCardRecord>;
}

const RECORD_OPTIONS = { timestamps: true, versionKey: false, strict: 'throw' } as const;
const UKRAINIAN_COLLATION = { locale: 'uk', strength: 2 } as const;

const partSchema = new Schema<PartRecord>(
  {
    designation: { type: String, required: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: PART_NAME_LENGTH.max },
    material: { type: String, default: null, trim: true, maxlength: PART_MATERIAL_LENGTH.max },
  },
  { ...RECORD_OPTIONS, collection: 'parts' },
);
partSchema.index({ designation: 1 }, { unique: true });

const operationTypeSchema = new Schema<OperationTypeRecord>(
  {
    name: { type: String, required: true, trim: true, maxlength: OPERATION_TYPE_NAME_LENGTH.max },
    description: {
      type: String,
      default: null,
      trim: true,
      maxlength: OPERATION_TYPE_DESCRIPTION_LENGTH.max,
    },
  },
  { ...RECORD_OPTIONS, collection: 'operation_types' },
);
operationTypeSchema.index({ name: 1 }, { unique: true, collation: UKRAINIAN_COLLATION });

const operationSchema = new Schema<OperationRecord>(
  {
    operationType: { type: Schema.Types.ObjectId, ref: 'OperationType', required: true },
    equipment: { type: String, default: null, trim: true, maxlength: EQUIPMENT_LENGTH.max },
    durationMinutes: {
      type: Number,
      required: true,
      min: DURATION_MINUTES.min,
      max: DURATION_MINUTES.max,
    },
  },
  { _id: false },
);

const processCardSchema = new Schema<ProcessCardRecord>(
  {
    part: { type: Schema.Types.ObjectId, ref: 'Part', required: true },
    operations: {
      type: [operationSchema],
      validate: {
        validator: (operations: readonly unknown[]) =>
          operations.length >= OPERATIONS_COUNT.min && operations.length <= OPERATIONS_COUNT.max,
        message: `A process card must have ${OPERATIONS_COUNT.min}-${OPERATIONS_COUNT.max} operations`,
      },
    },
  },
  { ...RECORD_OPTIONS, collection: 'process_cards' },
);
processCardSchema.index({ part: 1 }, { unique: true });
processCardSchema.index({ 'operations.operationType': 1 });

export function registerModels(connection: Connection): Models {
  return {
    Part: connection.model<PartRecord>('Part', partSchema),
    OperationType: connection.model<OperationTypeRecord>('OperationType', operationTypeSchema),
    ProcessCard: connection.model<ProcessCardRecord>('ProcessCard', processCardSchema),
  };
}
