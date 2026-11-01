import type {
  OperationType,
  OperationTypeDetails,
  OperationTypeId,
} from '../domain/operation-type.ts';
import type { Part, PartDetails, PartId } from '../domain/part.ts';
import type { ProcessCard, ProcessCardDetails, ProcessCardId } from '../domain/process-card.ts';

export type WriteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: 'duplicate' | 'not-found' };

export interface PartRepository {
  list(): Promise<readonly Part[]>;
  count(): Promise<number>;
  findById(id: PartId): Promise<Part | undefined>;
  findByIds(ids: readonly PartId[]): Promise<readonly Part[]>;
  create(details: PartDetails): Promise<WriteResult<Part>>;
  update(id: PartId, details: PartDetails): Promise<WriteResult<Part>>;
  remove(id: PartId): Promise<boolean>;
}

export interface OperationTypeRepository {
  list(): Promise<readonly OperationType[]>;
  count(): Promise<number>;
  findById(id: OperationTypeId): Promise<OperationType | undefined>;
  findByIds(ids: readonly OperationTypeId[]): Promise<readonly OperationType[]>;
  create(details: OperationTypeDetails): Promise<WriteResult<OperationType>>;
  update(id: OperationTypeId, details: OperationTypeDetails): Promise<WriteResult<OperationType>>;
  remove(id: OperationTypeId): Promise<boolean>;
}

export interface OperationTypeWorkload {
  readonly operationTypeId: OperationTypeId;
  readonly operations: number;
  readonly totalDurationMinutes: number;
}

export interface ProcessCardRepository {
  list(): Promise<readonly ProcessCard[]>;
  count(): Promise<number>;
  findById(id: ProcessCardId): Promise<ProcessCard | undefined>;
  create(details: ProcessCardDetails): Promise<WriteResult<ProcessCard>>;
  update(id: ProcessCardId, details: ProcessCardDetails): Promise<WriteResult<ProcessCard>>;
  remove(id: ProcessCardId): Promise<boolean>;
  isPartUsed(id: PartId): Promise<boolean>;
  isOperationTypeUsed(id: OperationTypeId): Promise<boolean>;
  workload(): Promise<readonly OperationTypeWorkload[]>;
}

export interface Storage {
  readonly parts: PartRepository;
  readonly operationTypes: OperationTypeRepository;
  readonly processCards: ProcessCardRepository;
  isAvailable(): Promise<boolean>;
  close(): Promise<void>;
}

export class StorageUnavailableError extends Error {
  override readonly name = 'StorageUnavailableError';
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}
