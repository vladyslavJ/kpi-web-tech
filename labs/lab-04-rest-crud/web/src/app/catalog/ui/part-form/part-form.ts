import { httpResource } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { form, FormField, FormRoot, maxLength, required, validate } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi, resourceUrl } from '../../data-access/catalog-api';
import type { PartResponse } from '../../data-access/contract';
import { firstError, normalizedLength } from '../../data-access/form-errors';
import {
  PART_DESIGNATION_HINT,
  PART_DESIGNATION_PATTERN,
  PART_MATERIAL_MAX_LENGTH,
  PART_NAME_LENGTH,
} from '../../data-access/rules';

@Component({
  selector: 'app-part-form',
  imports: [FormField, FormRoot, RouterLink],
  templateUrl: './part-form.html',
})
export class PartForm {
  readonly id = input<string>();

  readonly #api = inject(CatalogApi);
  readonly #router = inject(Router);

  protected readonly designationHint = PART_DESIGNATION_HINT;
  protected readonly errorOf = firstError;
  protected readonly isEdit = computed(() => this.id() !== undefined);
  protected readonly existing = httpResource<PartResponse>(() => {
    const id = this.id();
    return id === undefined ? undefined : resourceUrl(API.parts, id);
  });
  protected readonly loadError = computed(() => {
    const error = this.existing.error();
    return error ? describeApiError(error) : null;
  });
  protected readonly ready = computed(() => !this.isEdit() || this.existing.hasValue());
  protected readonly serverError = signal<string | null>(null);

  readonly #model = signal({ designation: '', name: '', material: '' });

  protected readonly form = form(
    this.#model,
    (path) => {
      required(path.designation, { message: 'Вкажіть позначення деталі' });
      validate(path.designation, ({ value }) =>
        value().trim() === '' || PART_DESIGNATION_PATTERN.test(value().trim())
          ? undefined
          : { kind: 'pattern', message: PART_DESIGNATION_HINT },
      );
      required(path.name, { message: 'Вкажіть найменування деталі' });
      validate(path.name, ({ value }) => {
        const length = normalizedLength(value());
        return length === 0 || (length >= PART_NAME_LENGTH.min && length <= PART_NAME_LENGTH.max)
          ? undefined
          : {
              kind: 'length',
              message: `Від ${PART_NAME_LENGTH.min} до ${PART_NAME_LENGTH.max} символів`,
            };
      });
      maxLength(path.material, PART_MATERIAL_MAX_LENGTH, {
        message: `Не більше ${PART_MATERIAL_MAX_LENGTH} символів`,
      });
    },
    {
      submission: {
        action: async (field) => {
          const { designation, name, material } = field().value();
          this.serverError.set(null);
          try {
            await this.#api.savePart(this.id() ?? null, {
              designation: designation.trim(),
              name: name.trim(),
              material: material.trim() === '' ? null : material.trim(),
            });
            await this.#router.navigateByUrl('/parts');
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
        const { part } = this.existing.value();
        untracked(() =>
          this.#model.set({
            designation: part.designation,
            name: part.name,
            material: part.material ?? '',
          }),
        );
      }
    });
  }
}
