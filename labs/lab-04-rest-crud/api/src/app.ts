import { createServer } from 'node:http';
import { OperationTypesService } from './application/operation-types.service.ts';
import { PartsService } from './application/parts.service.ts';
import type { Logger, Storage } from './application/ports.ts';
import { ProcessCardsService } from './application/process-cards.service.ts';
import { SeedDemoData } from './application/seed-demo-data.ts';
import { StatisticsService } from './application/statistics.service.ts';
import type { AppConfig } from './config.ts';
import { close, createHttpApp, listen } from './infrastructure/http/server.ts';
import { createPinoLogger } from './infrastructure/logging/pino.logger.ts';
import { MongoStorage } from './infrastructure/persistence/mongo/mongo-storage.ts';

export interface Infrastructure {
  readonly logger: Logger;
  readonly storage: Storage;
}

export interface App {
  start(): Promise<{ readonly port: number; readonly seeded: boolean }>;
  stop(): Promise<void>;
}

export async function createApp(
  config: AppConfig,
  overrides: Partial<Infrastructure> = {},
): Promise<App> {
  const logger =
    overrides.logger ??
    createPinoLogger({ level: config.logLevel, pretty: config.logFormat === 'pretty' });
  const storage =
    overrides.storage ??
    (await MongoStorage.connect({
      uri: config.mongodb.uri,
      timeoutMs: config.mongodb.timeoutMs,
      logger,
    }));
  const repositories = {
    parts: storage.parts,
    operationTypes: storage.operationTypes,
    processCards: storage.processCards,
  };

  const server = createServer(
    createHttpApp({
      logger,
      bodyLimitBytes: config.bodyLimitBytes,
      staticDir: config.staticDir,
      isDatabaseAvailable: () => storage.isAvailable(),
      parts: new PartsService(repositories),
      operationTypes: new OperationTypesService(repositories),
      processCards: new ProcessCardsService(repositories),
      statistics: new StatisticsService(repositories),
    }),
  );
  const seedDemoData = new SeedDemoData(repositories);

  return {
    async start() {
      const seeded = config.seedDemoData && (await seedDemoData.execute());
      return { port: await listen(server, config.port), seeded };
    },
    async stop() {
      if (server.listening) {
        await close(server);
      }
      await storage.close();
    },
  };
}
