import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import {
  applyEach,
  form,
  FormField,
  FormRoot,
  max,
  maxLength,
  min,
  required,
  validate,
} from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi, resourceUrl } from '../../data-access/catalog-api';
import type {
  OperationTypesResponse,
  PartsResponse,
  ProcessCardResponse,
  ProcessCardsResponse,
} from '../../data-access/contract';
import { firstError } from '../../data-access/form-errors';
import { formatDuration, formatOperationNumber, sumMinutes } from '../../data-access/format';
import {
  DURATION_HINT,
  DURATION_MINUTES,
  EQUIPMENT_MAX_LENGTH,
  isTenthOfMinute,
  OPERATIONS_MAX,
} from '../../data-access/rules';

interface OperationModel {
  readonly operationTypeId: string;
  readonly equipment: string;
  readonly durationMinutes: number | null;
}

interface ProcessCardModel {
  readonly partId: string;
  readonly operations: readonly OperationModel[];
}

const OPERATION_NUMBER_STEP = 5;

function emptyOperation(): OperationModel {
  return { operationTypeId: '', equipment: '', durationMinutes: null };
}

@Component({
  selector: 'app-process-card-form',
  imports: [FormField, FormRoot, RouterLink],
  templateUrl: './process-card-form.html',
  styleUrl: './process-card-form.css',
})
export class ProcessCardForm {
  readonly id = input<string>();
  readonly partId = input<string>();

  readonly #api = inject(CatalogApi);
  readonly #router = inject(Router);

  protected readonly errorOf = firstError;
  protected readonly durationHint = DURATION_HINT;
  protected readonly operationsMax = OPERATIONS_MAX;
  protected readonly isEdit = computed(() => this.id() !== undefined);

  protected readonly existing = httpResource<ProcessCardResponse>(() => {
    const id = this.id();
    return id === undefined ? undefined : resourceUrl(API.processCards, id);
  });
  protected readonly parts = httpResource<PartsResponse>(() => API.parts);
  protected readonly operationTypes = httpResource<OperationTypesResponse>(
    () => API.operationTypes,
  );
  protected readonly cards = httpResource<ProcessCardsResponse>(() => API.processCards);

  protected readonly ready = computed(
    () =>
      this.parts.hasValue() &&
      this.operationTypes.hasValue() &&
      this.cards.hasValue() &&
      (!this.isEdit() || this.existing.hasValue()),
  );
  protected readonly loadError = computed(() => {
    const error =
      this.existing.error() ??
      this.parts.error() ??
      this.operationTypes.error() ??
      this.cards.error();
    return error ? describeApiError(error) : null;
  });
  protected readonly availableParts = computed(() => {
    const parts = this.parts.hasValue() ? this.parts.value().parts : [];
    const cards = this.cards.hasValue() ? this.cards.value().processCards : [];
    const ownPart = this.existing.hasValue() ? this.existing.value().processCard.part.id : null;
    const taken = new Set(cards.map((card) => card.part.id));
    return parts.filter((part) => part.id === ownPart || !taken.has(part.id));
  });
  protected readonly types = computed(() =>
    this.operationTypes.hasValue() ? this.operationTypes.value().operationTypes : [],
  );
  protected readonly serverError = signal<string | null>(null);

  readonly #model = signal<ProcessCardModel>({ partId: '', operations: [emptyOperation()] });

  protected readonly numbers = computed(() =>
    this.#model().operations.map((_, index) =>
      formatOperationNumber((index + 1) * OPERATION_NUMBER_STEP),
    ),
  );
  protected readonly total = computed(() =>
    formatDuration(sumMinutes(this.#model().operations.map((item) => item.durationMinutes))),
  );

  protected readonly form = form(
    this.#model,
    (path) => {
      required(path.partId, { message: 'Оберіть деталь' });
      validate(path.operations, ({ value }) =>
        value().length === 0
          ? { kind: 'empty', message: 'Додайте хоча б одну операцію' }
          : undefined,
      );
      applyEach(path.operations, (operation) => {
        required(operation.operationTypeId, { message: 'Оберіть вид обробки' });
        maxLength(operation.equipment, EQUIPMENT_MAX_LENGTH, {
          message: `Не більше ${EQUIPMENT_MAX_LENGTH} символів`,
        });
        required(operation.durationMinutes, { message: 'Вкажіть тривалість' });
        min(operation.durationMinutes, DURATION_MINUTES.min, { message: DURATION_HINT });
        max(operation.durationMinutes, DURATION_MINUTES.max, { message: DURATION_HINT });
        validate(operation.durationMinutes, ({ value }) => {
          const minutes = value();
          return minutes === null || isTenthOfMinute(minutes)
            ? undefined
            : { kind: 'precision', message: 'Не більше одного знака після коми' };
        });
      });
    },
    {
      submission: {
        action: async (field) => {
          const { partId, operations } = field().value();
          this.serverError.set(null);
          try {
            const { processCard } = await this.#api.saveProcessCard(this.id() ?? null, {
              partId,
              operations: operations.map((operation) => ({
                operationTypeId: operation.operationTypeId,
                equipment: operation.equipment.trim() === '' ? null : operation.equipment.trim(),
                durationMinutes: operation.durationMinutes ?? 0,
              })),
            });
            await this.#router.navigate(['/process-cards', processCard.id]);
          } catch (error) {
            this.serverError.set(describeApiError(error));
          }
          return undefined;
        },
      },
    },
  );

  constructor() {
    effect(() => {
      if (this.existing.hasValue()) {
        const card = this.existing.value().processCard;
        untracked(() =>
          this.#model.set({
            partId: card.part.id,
            operations: card.operations.map((operation) => ({
              operationTypeId: operation.operationType.id,
              equipment: operation.equipment ?? '',
              durationMinutes: operation.durationMinutes,
            })),
          }),
        );
      }
    });
    effect(() => {
      const partId = this.partId();
      if (partId !== undefined && !this.isEdit()) {
        untracked(() => this.#model.update((model) => ({ ...model, partId })));
      }
    });
  }

  protected addOperation(): void {
    this.#model.update((model) =>
      model.operations.length >= OPERATIONS_MAX
        ? model
        : { ...model, operations: [...model.operations, emptyOperation()] },
    );
  }

  protected removeOperation(index: number): void {
    this.#model.update((model) => ({
      ...model,
      operations: model.operations.filter((_, position) => position !== index),
    }));
  }

  protected moveOperation(index: number, offset: -1 | 1): void {
    this.#model.update((model) => {
      const target = index + offset;
      const operations = [...model.operations];
      const [moved] = operations.splice(index, 1);
      if (moved === undefined || target < 0 || target > operations.length) {
        return model;
      }
      operations.splice(target, 0, moved);
      return { ...model, operations };
    });
  }
}
