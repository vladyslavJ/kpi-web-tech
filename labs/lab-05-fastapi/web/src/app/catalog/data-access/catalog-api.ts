import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  OperationTypeRequest,
  OperationTypeResponse,
  PartRequest,
  PartResponse,
  ProcessCardRequest,
  ProcessCardResponse,
} from './contract';

export const API = {
  health: '/api/health',
  statistics: '/api/statistics',
  parts: '/api/parts',
  operationTypes: '/api/operation-types',
  processCards: '/api/process-cards',
  openApi: '/api/openapi.json',
} as const;

export function resourceUrl(collection: string, id: string): string {
  return `${collection}/${encodeURIComponent(id)}`;
}

@Injectable({ providedIn: 'root' })
export class CatalogApi {
  readonly #http = inject(HttpClient);

  savePart(id: string | null, part: PartRequest): Promise<PartResponse> {
    return this.#save<PartResponse>(API.parts, id, part);
  }

  deletePart(id: string): Promise<void> {
    return this.#delete(API.parts, id);
  }

  saveOperationType(
    id: string | null,
    operationType: OperationTypeRequest,
  ): Promise<OperationTypeResponse> {
    return this.#save<OperationTypeResponse>(API.operationTypes, id, operationType);
  }

  deleteOperationType(id: string): Promise<void> {
    return this.#delete(API.operationTypes, id);
  }

  saveProcessCard(
    id: string | null,
    processCard: ProcessCardRequest,
  ): Promise<ProcessCardResponse> {
    return this.#save<ProcessCardResponse>(API.processCards, id, processCard);
  }

  deleteProcessCard(id: string): Promise<void> {
    return this.#delete(API.processCards, id);
  }

  #save<T>(collection: string, id: string | null, body: object): Promise<T> {
    return firstValueFrom(
      id === null
        ? this.#http.post<T>(collection, body)
        : this.#http.put<T>(resourceUrl(collection, id), body),
    );
  }

  async #delete(collection: string, id: string): Promise<void> {
    await firstValueFrom(this.#http.delete(resourceUrl(collection, id)));
  }
}
