import { Router } from 'express';
import type { z } from 'zod';
import type { Result } from '../../../application/result.ts';
import { sendNoContent, sendResult } from '../errors.ts';
import { idParamsSchema, parseInput } from '../schemas.ts';

export interface CrudService<TEntity, TInput, TId extends string> {
  list(): Promise<readonly TEntity[]>;
  get(id: TId): Promise<Result<TEntity>>;
  create(input: TInput): Promise<Result<TEntity>>;
  update(id: TId, input: TInput): Promise<Result<TEntity>>;
  remove(id: TId): Promise<Result<void>>;
}

export interface CrudResource<TEntity, TInput, TId extends string> {
  readonly path: string;
  readonly service: CrudService<TEntity, TInput, TId>;
  readonly input: z.ZodType<TInput>;
  readonly idOf: (entity: TEntity) => string;
  readonly toItem: (entity: TEntity) => unknown;
  readonly toList: (entities: readonly TEntity[]) => unknown;
}

export function crudRoutes<TEntity, TInput, TId extends string>(
  resource: CrudResource<TEntity, TInput, TId>,
): Router {
  const router = Router();
  const { path, service } = resource;
  const idFrom = (params: unknown): TId => parseInput(idParamsSchema, params).id as TId;

  router.get(path, async (_request, response) => {
    response.json(resource.toList(await service.list()));
  });

  router.get(`${path}/:id`, async (request, response) => {
    sendResult(response, await service.get(idFrom(request.params)), resource.toItem);
  });

  router.post(path, async (request, response) => {
    const result = await service.create(parseInput(resource.input, request.body));
    if (result.ok) {
      response.location(`${request.baseUrl}${path}/${resource.idOf(result.value)}`);
    }
    sendResult(response, result, resource.toItem, 201);
  });

  router.put(`${path}/:id`, async (request, response) => {
    const id = idFrom(request.params);
    const input = parseInput(resource.input, request.body);
    sendResult(response, await service.update(id, input), resource.toItem);
  });

  router.delete(`${path}/:id`, async (request, response) => {
    sendNoContent(response, await service.remove(idFrom(request.params)));
  });

  return router;
}
