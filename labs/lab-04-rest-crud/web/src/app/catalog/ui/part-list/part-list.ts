import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi } from '../../data-access/catalog-api';
import type { PartDto, PartsResponse, ProcessCardsResponse } from '../../data-access/contract';

@Component({
  selector: 'app-part-list',
  imports: [DatePipe, RouterLink],
  templateUrl: './part-list.html',
})
export class PartList {
  readonly #api = inject(CatalogApi);

  protected readonly parts = httpResource<PartsResponse>(() => API.parts);
  protected readonly cards = httpResource<ProcessCardsResponse>(() => API.processCards);
  protected readonly busyId = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly rows = computed(() => {
    const parts = this.parts.hasValue() ? this.parts.value().parts : [];
    const cards = this.cards.hasValue() ? this.cards.value().processCards : [];
    const cardByPart = new Map(cards.map((card) => [card.part.id, card.id]));
    return parts.map((part) => ({ part, cardId: cardByPart.get(part.id) ?? null }));
  });

  protected readonly loadError = computed(() => {
    const error = this.parts.error() ?? this.cards.error();
    return error ? describeApiError(error) : null;
  });

  protected reload(): void {
    this.parts.reload();
    this.cards.reload();
  }

  protected async remove(part: PartDto): Promise<void> {
    if (!confirm(`Видалити деталь «${part.designation} ${part.name}»?`)) {
      return;
    }
    this.busyId.set(part.id);
    this.actionError.set(null);
    try {
      await this.#api.deletePart(part.id);
    } catch (error) {
      this.actionError.set(describeApiError(error));
    } finally {
      this.busyId.set(null);
      this.reload();
    }
  }
}
