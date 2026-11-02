import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi } from '../../data-access/catalog-api';
import type { ProcessCardDto, ProcessCardsResponse } from '../../data-access/contract';
import { formatDuration } from '../../data-access/format';

@Component({
  selector: 'app-process-card-list',
  imports: [DatePipe, RouterLink],
  templateUrl: './process-card-list.html',
  styleUrl: './process-card-list.css',
})
export class ProcessCardList {
  readonly #api = inject(CatalogApi);

  protected readonly cards = httpResource<ProcessCardsResponse>(() => API.processCards);
  protected readonly busyId = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly rows = computed(() =>
    (this.cards.hasValue() ? this.cards.value().processCards : []).map((card) => ({
      card,
      route: card.operations.map((operation) => operation.operationType.name),
      duration: formatDuration(card.totalDurationMinutes),
    })),
  );

  protected readonly loadError = computed(() => {
    const error = this.cards.error();
    return error ? describeApiError(error) : null;
  });

  protected async remove(card: ProcessCardDto): Promise<void> {
    if (!confirm(`Видалити технологічну карту деталі «${card.part.designation}»?`)) {
      return;
    }
    this.busyId.set(card.id);
    this.actionError.set(null);
    try {
      await this.#api.deleteProcessCard(card.id);
    } catch (error) {
      this.actionError.set(describeApiError(error));
    } finally {
      this.busyId.set(null);
      this.cards.reload();
    }
  }
}
