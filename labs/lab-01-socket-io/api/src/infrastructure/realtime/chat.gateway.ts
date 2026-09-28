import type { JoinChat } from '../../application/join-chat.use-case.ts';
import type { LeaveChat } from '../../application/leave-chat.use-case.ts';
import type { Logger } from '../../application/ports.ts';
import { err } from '../../application/result.ts';
import type { SendMessage } from '../../application/send-message.use-case.ts';
import { roomIdOf } from '../../domain/room.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import { withPipeline, type HandlerContext } from './handler-pipeline.ts';
import { createHandshakeMiddleware } from './handshake.middleware.ts';
import { toSnapshotDto } from './mappers.ts';
import { sendMessagePayloadSchema } from './schemas.ts';
import { roomChannel } from './socket-io.notifier.ts';
import type { ChatServer, ChatSocket } from './socket-server.ts';

export class ChatGateway {
  readonly #io: ChatServer;
  readonly #joinChat: JoinChat;
  readonly #leaveChat: LeaveChat;
  readonly #sendMessage: SendMessage;
  readonly #rateLimiter: RateLimiter;
  readonly #logger: Logger;

  constructor(deps: {
    io: ChatServer;
    joinChat: JoinChat;
    leaveChat: LeaveChat;
    sendMessage: SendMessage;
    rateLimiter: RateLimiter;
    logger: Logger;
  }) {
    this.#io = deps.io;
    this.#joinChat = deps.joinChat;
    this.#leaveChat = deps.leaveChat;
    this.#sendMessage = deps.sendMessage;
    this.#rateLimiter = deps.rateLimiter;
    this.#logger = deps.logger;
  }

  register(): void {
    this.#io.use(createHandshakeMiddleware(this.#logger));
    this.#io.on('connection', (socket) => this.#onConnection(socket));
  }

  #onConnection(socket: ChatSocket): void {
    const logger = this.#logger.child({ socketId: socket.id });
    const ctx: HandlerContext = { socketId: socket.id, logger, rateLimiter: this.#rateLimiter };

    socket.on(
      'message:send',
      withPipeline<'message:send'>(ctx, {
        schema: sendMessagePayloadSchema,
        handle: async ({ text }) => {
          const authorId = socket.data.participantId;
          if (!authorId) {
            return err('NOT_JOINED', 'Join the chat before sending messages');
          }
          return this.#sendMessage.execute({ authorId, text });
        },
      }),
    );
    socket.on('disconnect', (reason) => void this.#onDisconnect(socket, logger, reason));

    void this.#join(socket, logger);
  }

  async #join(socket: ChatSocket, logger: Logger): Promise<void> {
    const { nickname, roomName } = socket.data;
    if (nickname === undefined || roomName === undefined) {
      logger.error('Connection without a validated handshake');
      socket.disconnect(true);
      return;
    }

    try {
      await socket.join(roomChannel(roomIdOf(roomName)));
      const snapshot = await this.#joinChat.execute({ nickname, roomName });
      socket.data.participantId = snapshot.self.id;

      if (socket.disconnected) {
        await this.#leave(socket);
        return;
      }
      socket.emit('chat:snapshot', toSnapshotDto(snapshot));
      logger.info('Participant joined', {
        participantId: snapshot.self.id,
        nickname: snapshot.self.nickname,
        room: snapshot.room.name,
      });
    } catch (error) {
      logger.error('Join failed', { error });
      socket.disconnect(true);
    }
  }

  async #onDisconnect(socket: ChatSocket, logger: Logger, reason: string): Promise<void> {
    try {
      await this.#rateLimiter.release(socket.id);
      await this.#leave(socket);
      logger.info('Socket disconnected', { reason });
    } catch (error) {
      logger.error('Leave failed', { error });
    }
  }

  async #leave(socket: ChatSocket): Promise<void> {
    const participantId = socket.data.participantId;
    if (!participantId) {
      return;
    }
    socket.data.participantId = undefined;
    await this.#leaveChat.execute({ participantId });
  }
}
