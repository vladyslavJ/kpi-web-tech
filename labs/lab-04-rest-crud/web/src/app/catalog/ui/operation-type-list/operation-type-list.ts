import { httpResource } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { describeApiError } from '../../data-access/api-errors';
import { API, CatalogApi } from '../../data-access/catalog-api';
import type {
  OperationTypeDto,
  OperationTypesResponse,
  StatisticsResponse,
} from '../../data-access/contract';
import { formatDuration } from '../../data-access/format';

@Component({
  selector: 'app-operation-type-list',
  imports: [RouterLink],
  templateUrl: './operation-type-list.html',
})
export class OperationTypeList {
  readonly #api = inject(CatalogApi);

  protected readonly operationTypes = httpResource<OperationTypesResponse>(
    () => API.operationTypes,
  );
  protected readonly statistics = httpResource<StatisticsResponse>(() => API.statistics);
  protected readonly busyId = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly rows = computed(() => {
    const types = this.operationTypes.hasValue() ? this.operationTypes.value().operationTypes : [];
    const workload = this.statistics.hasValue() ? this.statistics.value().workload : [];
    const usage = new Map(workload.map((entry) => [entry.operationType.id, entry]));
    return types.map((operationType) => {
      const entry = usage.get(operationType.id);
      return {
        operationType,
        operations: entry?.operations ?? null,
        duration: entry ? formatDuration(entry.totalDurationMinutes) : '—',
      };
    });
  });

  protected readonly loadError = computed(() => {
    const error = this.operationTypes.error() ?? this.statistics.error();
    return error ? describeApiError(error) : null;
  });

  protected reload(): void {
    this.operationTypes.reload();
    this.statistics.reload();
  }

  protected async remove(operationType: OperationTypeDto): Promise<void> {
    if (!confirm(`Видалити вид обробки «${operationType.name}»?`)) {
      return;
    }
    this.busyId.set(operationType.id);
    this.actionError.set(null);
    try {
      await this.#api.deleteOperationType(operationType.id);
    } catch (error) {
      this.actionError.set(describeApiError(error));
    } finally {
      this.busyId.set(null);
      this.reload();
    }
  }
}
