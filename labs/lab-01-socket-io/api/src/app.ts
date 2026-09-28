import { AutoMessageScheduler } from './application/auto-message.scheduler.ts';
import { BroadcastAutoMessage } from './application/broadcast-auto-message.use-case.ts';
import { JoinChat } from './application/join-chat.use-case.ts';
import { LeaveChat } from './application/leave-chat.use-case.ts';
import type { Clock, IdGenerator, Logger, Scheduler } from './application/ports.ts';
import { SendMessage } from './application/send-message.use-case.ts';
import type { AppConfig } from './config.ts';
import { createHttpServer, listen } from './infrastructure/http/http-server.ts';
import { createPinoLogger } from './infrastructure/logging/pino.logger.ts';
import { InMemoryMessageRepository } from './infrastructure/persistence/in-memory-message.repository.ts';
import { InMemoryParticipantRepository } from './infrastructure/persistence/in-memory-participant.repository.ts';
import { TokenBucketRateLimiter } from './infrastructure/rate-limit/token-bucket.rate-limiter.ts';
import { ChatGateway } from './infrastructure/realtime/chat.gateway.ts';
import { SocketIoChatNotifier } from './infrastructure/realtime/socket-io.notifier.ts';
import { createSocketServer } from './infrastructure/realtime/socket-server.ts';
import { intervalScheduler } from './infrastructure/scheduling/interval.scheduler.ts';
import { cryptoIdGenerator } from './infrastructure/system/crypto.id-generator.ts';
import { systemClock } from './infrastructure/system/system.clock.ts';

export interface Infrastructure {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
}

export interface App {
  start(): Promise<{ readonly port: number }>;
  stop(): Promise<void>;
}

export function createApp(config: AppConfig, overrides: Partial<Infrastructure> = {}): App {
  const clock = overrides.clock ?? systemClock;
  const ids = overrides.ids ?? cryptoIdGenerator;
  const scheduler = overrides.scheduler ?? intervalScheduler;
  const logger =
    overrides.logger ?? createPinoLogger({ level: config.logLevel, pretty: config.logFormat === 'pretty' });

  const httpServer = createHttpServer({ staticDir: config.staticDir });
  const io = createSocketServer(httpServer, config);

  const participants = new InMemoryParticipantRepository();
  const messages = new InMemoryMessageRepository({ capacity: config.historyLimit });
  const notifier = new SocketIoChatNotifier({ io });

  const autoMessages = new AutoMessageScheduler({
    scheduler,
    logger,
    intervalMs: config.autoMessage.intervalMs,
    broadcast: new BroadcastAutoMessage({ notifier, ids, clock, text: config.autoMessage.text }),
  });

  new ChatGateway({
    io,
    logger,
    rateLimiter: new TokenBucketRateLimiter({ ...config.rateLimit, clock }),
    joinChat: new JoinChat({
      participants,
      messages,
      notifier,
      ids,
      clock,
      historyLimit: config.historyLimit,
    }),
    leaveChat: new LeaveChat({ participants, messages, notifier, ids, clock }),
    sendMessage: new SendMessage({ participants, messages, notifier, ids, clock }),
  }).register();

  return {
    async start() {
      const port = await listen(httpServer, config.port);
      autoMessages.start();
      return { port };
    },
    async stop() {
      autoMessages.stop();
      await new Promise<void>((resolve) => {
        void io.close(() => resolve());
      });
    },
  };
}
