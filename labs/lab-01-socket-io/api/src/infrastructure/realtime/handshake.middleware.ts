import { z } from 'zod';
import type { Logger } from '../../application/ports.ts';
import type { ErrorCode, ErrorDto } from './contract.ts';
import { toErrorDto } from './mappers.ts';
import { handshakeAuthSchema } from './schemas.ts';
import type { ChatServer } from './socket-server.ts';

type Middleware = Parameters<ChatServer['use']>[0];

export function createHandshakeMiddleware(logger: Logger): Middleware {
  return (socket, next) => {
    const parsed = handshakeAuthSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) {
      logger.debug('Handshake rejected', { socketId: socket.id });
      next(rejection('VALIDATION_ERROR', z.prettifyError(parsed.error)));
      return;
    }
    socket.data.nickname = parsed.data.nickname;
    socket.data.roomName = parsed.data.room;
    next();
  };
}

function rejection(code: ErrorCode, message: string): Error & { data: ErrorDto } {
  return Object.assign(new Error(code), { data: toErrorDto(code, message) });
}
