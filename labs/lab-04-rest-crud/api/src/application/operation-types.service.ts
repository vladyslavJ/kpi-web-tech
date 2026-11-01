import {
  createOperationTypeDetails,
  type OperationType,
  type OperationTypeId,
  type OperationTypeInput,
} from '../domain/operation-type.ts';
import type { OperationTypeRepository, ProcessCardRepository, WriteResult } from './ports.ts';
import { err, ok, type Result } from './result.ts';

const NOT_FOUND = err('NOT_FOUND', 'Operation type not found');
const NAME_TAKEN = err(
  'OPERATION_TYPE_NAME_TAKEN',
  'An operation type with this name already exists',
);
const IN_USE = err(
  'OPERATION_TYPE_IN_USE',
  'The operation type is used in process cards, remove those operations first',
);

export class OperationTypesService {
  readonly #operationTypes: OperationTypeRepository;
  readonly #processCards: ProcessCardRepository;

  constructor(deps: {
    operationTypes: OperationTypeRepository;
    processCards: ProcessCardRepository;
  }) {
    this.#operationTypes = deps.operationTypes;
    this.#processCards = deps.processCards;
  }

  list(): Promise<readonly OperationType[]> {
    return this.#operationTypes.list();
  }

  async get(id: OperationTypeId): Promise<Result<OperationType>> {
    const operationType = await this.#operationTypes.findById(id);
    return operationType ? ok(operationType) : NOT_FOUND;
  }

  async create(input: OperationTypeInput): Promise<Result<OperationType>> {
    return fromWrite(await this.#operationTypes.create(createOperationTypeDetails(input)));
  }

  async update(id: OperationTypeId, input: OperationTypeInput): Promise<Result<OperationType>> {
    return fromWrite(await this.#operationTypes.update(id, createOperationTypeDetails(input)));
  }

  async remove(id: OperationTypeId): Promise<Result<void>> {
    if (await this.#processCards.isOperationTypeUsed(id)) {
      return IN_USE;
    }
    return (await this.#operationTypes.remove(id)) ? ok(undefined) : NOT_FOUND;
  }
}

function fromWrite(saved: WriteResult<OperationType>): Result<OperationType> {
  if (saved.ok) {
    return ok(saved.value);
  }
  return saved.reason === 'duplicate' ? NAME_TAKEN : NOT_FOUND;
}
