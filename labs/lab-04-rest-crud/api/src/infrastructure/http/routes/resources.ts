import type { Router } from 'express';
import type { OperationTypesService } from '../../../application/operation-types.service.ts';
import type { PartsService } from '../../../application/parts.service.ts';
import type { ProcessCardsService } from '../../../application/process-cards.service.ts';
import type {
  OperationTypeResponse,
  OperationTypesResponse,
  PartResponse,
  PartsResponse,
  ProcessCardResponse,
  ProcessCardsResponse,
} from '../contract.ts';
import { toOperationTypeDto, toPartDto, toProcessCardDto } from '../mappers.ts';
import { operationTypeSchema, partSchema, processCardSchema } from '../schemas.ts';
import { crudRoutes } from './crud.routes.ts';

export function partsRoutes(service: PartsService): Router {
  return crudRoutes({
    path: '/parts',
    service,
    input: partSchema,
    idOf: (part) => part.id,
    toItem: (part): PartResponse => ({ part: toPartDto(part) }),
    toList: (parts): PartsResponse => ({ parts: parts.map(toPartDto) }),
  });
}

export function operationTypesRoutes(service: OperationTypesService): Router {
  return crudRoutes({
    path: '/operation-types',
    service,
    input: operationTypeSchema,
    idOf: (operationType) => operationType.id,
    toItem: (operationType): OperationTypeResponse => ({
      operationType: toOperationTypeDto(operationType),
    }),
    toList: (operationTypes): OperationTypesResponse => ({
      operationTypes: operationTypes.map(toOperationTypeDto),
    }),
  });
}

export function processCardsRoutes(service: ProcessCardsService): Router {
  return crudRoutes({
    path: '/process-cards',
    service,
    input: processCardSchema,
    idOf: (view) => view.card.id,
    toItem: (view): ProcessCardResponse => ({ processCard: toProcessCardDto(view) }),
    toList: (views): ProcessCardsResponse => ({ processCards: views.map(toProcessCardDto) }),
  });
}
