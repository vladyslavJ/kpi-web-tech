import type { OperationType } from '../domain/operation-type.ts';
import { sumDurations } from '../domain/process-card.ts';
import type { OperationTypeRepository, PartRepository, ProcessCardRepository } from './ports.ts';

export interface WorkloadEntry {
  readonly operationType: OperationType;
  readonly operations: number;
  readonly totalDurationMinutes: number;
}

export interface Statistics {
  readonly parts: number;
  readonly operationTypes: number;
  readonly processCards: number;
  readonly operations: number;
  readonly totalDurationMinutes: number;
  readonly workload: readonly WorkloadEntry[];
}

export class StatisticsService {
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

  async collect(): Promise<Statistics> {
    const [parts, processCards, operationTypes, workload] = await Promise.all([
      this.#parts.count(),
      this.#processCards.count(),
      this.#operationTypes.list(),
      this.#processCards.workload(),
    ]);
    const byType = new Map(workload.map((entry) => [entry.operationTypeId, entry]));
    const entries = operationTypes
      .map((operationType) => ({
        operationType,
        operations: byType.get(operationType.id)?.operations ?? 0,
        totalDurationMinutes: byType.get(operationType.id)?.totalDurationMinutes ?? 0,
      }))
      .toSorted(
        (a, b) =>
          b.totalDurationMinutes - a.totalDurationMinutes ||
          a.operationType.name.localeCompare(b.operationType.name, 'uk'),
      );

    return {
      parts,
      operationTypes: operationTypes.length,
      processCards,
      operations: entries.reduce((total, entry) => total + entry.operations, 0),
      totalDurationMinutes: sumDurations(entries.map((entry) => entry.totalDurationMinutes)),
      workload: entries,
    };
  }
}
