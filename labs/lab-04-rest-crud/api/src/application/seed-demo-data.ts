import { createOperationTypeDetails, type OperationTypeId } from '../domain/operation-type.ts';
import { createPartDetails, type PartId } from '../domain/part.ts';
import { createProcessCardDetails } from '../domain/process-card.ts';
import { DEMO_OPERATION_TYPES, DEMO_PARTS, DEMO_PROCESS_CARDS } from './demo-data.ts';
import type {
  OperationTypeRepository,
  PartRepository,
  ProcessCardRepository,
  WriteResult,
} from './ports.ts';

export class SeedDemoData {
  readonly #parts: PartRepository;
  readonly #operationTypes: OperationTypeRepository;
  readonly #processCards: ProcessCardRepository;

  constructor(deps: {
    parts: PartRepository;
    operationTypes: OperationTypeRepository;
    processCards: ProcessCardRepository;
  }) {
    this.#parts = deps.parts;
    this.#operationTypes = deps.operationTypes;
    this.#processCards = deps.processCards;
  }

  async execute(): Promise<boolean> {
    const counts = await Promise.all([
      this.#parts.count(),
      this.#operationTypes.count(),
      this.#processCards.count(),
    ]);
    if (counts.some((count) => count > 0)) {
      return false;
    }

    const typeIds = new Map<string, OperationTypeId>();
    for (const input of DEMO_OPERATION_TYPES) {
      const type = saved(await this.#operationTypes.create(createOperationTypeDetails(input)));
      typeIds.set(type.name, type.id);
    }

    const partIds = new Map<string, PartId>();
    for (const input of DEMO_PARTS) {
      const part = saved(await this.#parts.create(createPartDetails(input)));
      partIds.set(part.designation, part.id);
    }

    for (const card of DEMO_PROCESS_CARDS) {
      const details = createProcessCardDetails({
        partId: lookup(partIds, card.part),
        operations: card.operations.map((operation) => ({
          operationTypeId: lookup(typeIds, operation.type),
          equipment: operation.equipment,
          durationMinutes: operation.durationMinutes,
        })),
      });
      saved(await this.#processCards.create(details));
    }
    return true;
  }
}

function saved<T>(result: WriteResult<T>): T {
  if (!result.ok) {
    throw new Error(`Demo data could not be saved: ${result.reason}`);
  }
  return result.value;
}

function lookup<T>(ids: ReadonlyMap<string, T>, key: string): T {
  const id = ids.get(key);
  if (id === undefined) {
    throw new Error(`Demo data references an unknown record: ${key}`);
  }
  return id;
}
