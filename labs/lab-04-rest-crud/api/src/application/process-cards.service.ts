import type { OperationType, OperationTypeId } from '../domain/operation-type.ts';
import type { Part } from '../domain/part.ts';
import {
  createProcessCardDetails,
  referencedOperationTypes,
  type ProcessCard,
  type ProcessCardDetails,
  type ProcessCardId,
  type ProcessCardInput,
} from '../domain/process-card.ts';
import type {
  OperationTypeRepository,
  PartRepository,
  ProcessCardRepository,
  WriteResult,
} from './ports.ts';
import { err, ok, type Result } from './result.ts';

const NOT_FOUND = err('NOT_FOUND', 'Process card not found');
const PART_HAS_CARD = err('PART_ALREADY_HAS_CARD', 'The part already has a process card');
const UNKNOWN_PART = err('UNKNOWN_PART', 'The referenced part does not exist');

export interface ProcessCardView {
  readonly card: ProcessCard;
  readonly part: Part;
  readonly operationTypes: ReadonlyMap<OperationTypeId, OperationType>;
}

export class ProcessCardsService {
  readonly #processCards: ProcessCardRepository;
  readonly #parts: PartRepository;
  readonly #operationTypes: OperationTypeRepository;

  constructor(deps: {
    processCards: ProcessCardRepository;
    parts: PartRepository;
    operationTypes: OperationTypeRepository;
  }) {
    this.#processCards = deps.processCards;
    this.#parts = deps.parts;
    this.#operationTypes = deps.operationTypes;
  }

  async list(): Promise<readonly ProcessCardView[]> {
    const views = await this.#views(await this.#processCards.list());
    return views.toSorted((a, b) => a.part.designation.localeCompare(b.part.designation, 'uk'));
  }

  async get(id: ProcessCardId): Promise<Result<ProcessCardView>> {
    const card = await this.#processCards.findById(id);
    return card ? ok(await this.#view(card)) : NOT_FOUND;
  }

  async create(input: ProcessCardInput): Promise<Result<ProcessCardView>> {
    const details = createProcessCardDetails(input);
    const invalid = await this.#checkReferences(details);
    if (invalid) {
      return invalid;
    }
    return this.#fromWrite(await this.#processCards.create(details));
  }

  async update(id: ProcessCardId, input: ProcessCardInput): Promise<Result<ProcessCardView>> {
    const details = createProcessCardDetails(input);
    if (!(await this.#processCards.findById(id))) {
      return NOT_FOUND;
    }
    const invalid = await this.#checkReferences(details);
    if (invalid) {
      return invalid;
    }
    return this.#fromWrite(await this.#processCards.update(id, details));
  }

  async remove(id: ProcessCardId): Promise<Result<void>> {
    return (await this.#processCards.remove(id)) ? ok(undefined) : NOT_FOUND;
  }

  async #checkReferences(details: ProcessCardDetails): Promise<Result<never> | null> {
    if (!(await this.#parts.findById(details.partId))) {
      return UNKNOWN_PART;
    }
    const ids = referencedOperationTypes(details);
    const found = new Set((await this.#operationTypes.findByIds(ids)).map((type) => type.id));
    const missing = ids.find((id) => !found.has(id));
    return missing === undefined
      ? null
      : err('UNKNOWN_OPERATION_TYPE', `Operation type ${missing} does not exist`);
  }

  async #fromWrite(saved: WriteResult<ProcessCard>): Promise<Result<ProcessCardView>> {
    if (saved.ok) {
      return ok(await this.#view(saved.value));
    }
    return saved.reason === 'duplicate' ? PART_HAS_CARD : NOT_FOUND;
  }

  async #view(card: ProcessCard): Promise<ProcessCardView> {
    const [view] = await this.#views([card]);
    if (!view) {
      throw new Error(`Process card ${card.id} could not be resolved`);
    }
    return view;
  }

  async #views(cards: readonly ProcessCard[]): Promise<ProcessCardView[]> {
    const partIds = [...new Set(cards.map((card) => card.partId))];
    const typeIds = [...new Set(cards.flatMap(referencedOperationTypes))];
    const [parts, types] = await Promise.all([
      this.#parts.findByIds(partIds),
      this.#operationTypes.findByIds(typeIds),
    ]);
    const partsById = new Map(parts.map((part) => [part.id, part]));
    const operationTypes = new Map(types.map((type) => [type.id, type]));

    return cards.map((card) => {
      const part = partsById.get(card.partId);
      const missingType = card.operations.find(
        (operation) => !operationTypes.has(operation.operationTypeId),
      );
      if (!part || missingType) {
        throw new Error(`Process card ${card.id} references a deleted part or operation type`);
      }
      return { card, part, operationTypes };
    });
  }
}
