import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi, resourceUrl } from '../../data-access/catalog-api';
import type { ProcessCardDto, ProcessCardResponse } from '../../data-access/contract';
import {
  formatDuration,
  formatMinutes,
  formatOperationNumber,
  pluralize,
} from '../../data-access/format';

@Component({
  selector: 'app-process-card-details',
  imports: [DatePipe, RouterLink],
  templateUrl: './process-card-details.html',
  styleUrl: './process-card-details.css',
})
export class ProcessCardDetails {
  readonly id = input.required<string>();

  readonly #api = inject(CatalogApi);
  readonly #router = inject(Router);

  protected readonly resource = httpResource<ProcessCardResponse>(() =>
    resourceUrl(API.processCards, this.id()),
  );
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected readonly view = computed(() => {
    if (!this.resource.hasValue()) {
      return null;
    }
    const card = this.resource.value().processCard;
    const total = card.totalDurationMinutes;
    return {
      card,
      count: pluralize(card.operations.length, ['операція', 'операції', 'операцій']),
      total: formatDuration(total),
      totalMinutes: formatMinutes(total),
      operations: card.operations.map((operation) => ({
        operation,
        number: formatOperationNumber(operation.number),
        minutes: formatMinutes(operation.durationMinutes),
        share: total > 0 ? (operation.durationMinutes / total) * 100 : 0,
      })),
    };
  });

  protected readonly loadError = computed(() => {
    const error = this.resource.error();
    return error ? describeApiError(error) : null;
  });

  protected async remove(card: ProcessCardDto): Promise<void> {
    if (!confirm(`Видалити технологічну карту деталі «${card.part.designation}»?`)) {
      return;
    }
    this.busy.set(true);
    this.actionError.set(null);
    try {
      await this.#api.deleteProcessCard(card.id);
      await this.#router.navigateByUrl('/process-cards');
    } catch (error) {
      this.actionError.set(describeApiError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
