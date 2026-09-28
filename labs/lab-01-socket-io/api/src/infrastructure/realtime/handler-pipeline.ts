import { z } from 'zod';
import type { Logger } from '../../application/ports.ts';
import type { Result } from '../../application/result.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import type { Ack, ClientToServerEvents } from './contract.ts';
import { failure, toAck } from './mappers.ts';

type ClientEvent = keyof ClientToServerEvents;

type EventPayload<E extends ClientEvent> = Parameters<ClientToServerEvents[E]>[0];

type EventAckData<E extends ClientEvent> =
  Parameters<ClientToServerEvents[E]>[1] extends (response: Ack<infer T>) => void ? T : never;

export interface HandlerContext {
  readonly socketId: string;
  readonly logger: Logger;
  readonly rateLimiter: RateLimiter;
}

export interface HandlerSpec<E extends ClientEvent> {
  readonly schema: z.ZodType<EventPayload<E>>;
  readonly handle: (payload: EventPayload<E>) => Promise<Result<EventAckData<E>>>;
}

export function withPipeline<E extends ClientEvent>(ctx: HandlerContext, spec: HandlerSpec<E>) {
  return async (raw: unknown, ack: unknown): Promise<void> => {
    if (typeof ack !== 'function') {
      ctx.logger.warn('Event without acknowledgement callback ignored');
      return;
    }
    const reply = ack as (response: Ack<EventAckData<E>>) => void;

    if (!(await ctx.rateLimiter.tryConsume(ctx.socketId))) {
      reply(failure('RATE_LIMITED', 'Too many messages, slow down'));
      return;
    }

    const parsed = spec.schema.safeParse(raw);
    if (!parsed.success) {
      reply(failure('VALIDATION_ERROR', z.prettifyError(parsed.error)));
      return;
    }

    try {
      reply(toAck(await spec.handle(parsed.data)));
    } catch (error) {
      ctx.logger.error('Unhandled error in event handler', { error });
      reply(failure('INTERNAL_ERROR', 'Internal server error'));
    }
  };
}
