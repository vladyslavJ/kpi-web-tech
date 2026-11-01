import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { form, FormField, FormRoot, maxLength, required, validate } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi, resourceUrl } from '../../data-access/catalog-api';
import type { OperationTypeResponse } from '../../data-access/contract';
import { firstError, normalizedLength } from '../../data-access/form-errors';
import {
  OPERATION_TYPE_DESCRIPTION_MAX_LENGTH,
  OPERATION_TYPE_NAME_LENGTH,
} from '../../data-access/rules';

@Component({
  selector: 'app-operation-type-form',
  imports: [FormField, FormRoot, RouterLink],
  templateUrl: './operation-type-form.html',
})
export class OperationTypeForm {
  readonly id = input<string>();

  readonly #api = inject(CatalogApi);
  readonly #router = inject(Router);

  protected readonly errorOf = firstError;
  protected readonly descriptionLimit = OPERATION_TYPE_DESCRIPTION_MAX_LENGTH;
  protected readonly isEdit = computed(() => this.id() !== undefined);
  protected readonly existing = httpResource<OperationTypeResponse>(() => {
    const id = this.id();
    return id === undefined ? undefined : resourceUrl(API.operationTypes, id);
  });
  protected readonly loadError = computed(() => {
    const error = this.existing.error();
    return error ? describeApiError(error) : null;
  });
  protected readonly ready = computed(() => !this.isEdit() || this.existing.hasValue());
  protected readonly serverError = signal<string | null>(null);

  readonly #model = signal({ name: '', description: '' });

  protected readonly form = form(
    this.#model,
    (path) => {
      required(path.name, { message: 'Вкажіть назву виду обробки' });
      validate(path.name, ({ value }) => {
        const length = normalizedLength(value());
        const { min, max } = OPERATION_TYPE_NAME_LENGTH;
        return length === 0 || (length >= min && length <= max)
          ? undefined
          : { kind: 'length', message: `Від ${min} до ${max} символів` };
      });
      maxLength(path.description, OPERATION_TYPE_DESCRIPTION_MAX_LENGTH, {
        message: `Не більше ${OPERATION_TYPE_DESCRIPTION_MAX_LENGTH} символів`,
      });
    },
    {
      submission: {
        action: async (field) => {
          const { name, description } = field().value();
          this.serverError.set(null);
          try {
            await this.#api.saveOperationType(this.id() ?? null, {
              name: name.trim(),
              description: description.trim() === '' ? null : description.trim(),
            });
            await this.#router.navigateByUrl('/operation-types');
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
        const { operationType } = this.existing.value();
        untracked(() =>
          this.#model.set({
            name: operationType.name,
            description: operationType.description ?? '',
          }),
        );
      }
    });
  }
}
