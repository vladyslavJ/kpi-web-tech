import { httpResource } from '@angular/common/http';
import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API } from '../../data-access/catalog-api';
import type { StatisticsResponse } from '../../data-access/contract';
import { formatDuration, pluralize } from '../../data-access/format';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.css',
})
export class Home {
  protected readonly statistics = httpResource<StatisticsResponse>(() => API.statistics);

  protected readonly loadError = computed(() => {
    const error = this.statistics.error();
    return error ? describeApiError(error) : null;
  });

  protected readonly tiles = computed(() => {
    const value = this.statistics.hasValue() ? this.statistics.value() : null;
    const count = (pick: (statistics: StatisticsResponse) => number) =>
      value ? String(pick(value)) : '—';
    return [
      { label: 'Технологічні карти', value: count((s) => s.processCards), link: '/process-cards' },
      { label: 'Деталі', value: count((s) => s.parts), link: '/parts' },
      { label: 'Види обробки', value: count((s) => s.operationTypes), link: '/operation-types' },
      { label: 'Операції в картах', value: count((s) => s.operations), link: '/process-cards' },
      {
        label: 'Сумарна тривалість',
        value: value ? formatDuration(value.totalDurationMinutes) : '—',
        link: '/process-cards',
      },
    ];
  });

  protected readonly workload = computed(() => {
    if (!this.statistics.hasValue()) {
      return [];
    }
    const entries = this.statistics.value().workload;
    const longest = Math.max(0, ...entries.map((entry) => entry.totalDurationMinutes));
    return entries.map((entry) => ({
      id: entry.operationType.id,
      name: entry.operationType.name,
      operations: pluralize(entry.operations, ['операція', 'операції', 'операцій']),
      duration: formatDuration(entry.totalDurationMinutes),
      share: longest > 0 ? (entry.totalDurationMinutes / longest) * 100 : 0,
    }));
  });
}
