import { createPartDetails, type Part, type PartId, type PartInput } from '../domain/part.ts';
import type { PartRepository, ProcessCardRepository, WriteResult } from './ports.ts';
import { err, ok, type Result } from './result.ts';

const NOT_FOUND = err('NOT_FOUND', 'Part not found');
const DESIGNATION_TAKEN = err(
  'PART_DESIGNATION_TAKEN',
  'A part with this designation already exists',
);
const IN_USE = err('PART_IN_USE', 'The part has a process card, delete the card first');

export class PartsService {
  readonly #parts: PartRepository;
  readonly #processCards: ProcessCardRepository;

  constructor(deps: { parts: PartRepository; processCards: ProcessCardRepository }) {
    this.#parts = deps.parts;
    this.#processCards = deps.processCards;
  }

  list(): Promise<readonly Part[]> {
    return this.#parts.list();
  }

  async get(id: PartId): Promise<Result<Part>> {
    const part = await this.#parts.findById(id);
    return part ? ok(part) : NOT_FOUND;
  }

  async create(input: PartInput): Promise<Result<Part>> {
    return fromWrite(await this.#parts.create(createPartDetails(input)));
  }

  async update(id: PartId, input: PartInput): Promise<Result<Part>> {
    return fromWrite(await this.#parts.update(id, createPartDetails(input)));
  }

  async remove(id: PartId): Promise<Result<void>> {
    if (await this.#processCards.isPartUsed(id)) {
      return IN_USE;
    }
    return (await this.#parts.remove(id)) ? ok(undefined) : NOT_FOUND;
  }
}

function fromWrite(saved: WriteResult<Part>): Result<Part> {
  if (saved.ok) {
    return ok(saved.value);
  }
  return saved.reason === 'duplicate' ? DESIGNATION_TAKEN : NOT_FOUND;
}
