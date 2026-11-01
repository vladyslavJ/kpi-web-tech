import { createConnection, type Connection } from 'mongoose';
import { StorageUnavailableError, type Logger, type Storage } from '../../../application/ports.ts';
import { registerModels } from './models.ts';
import { MongoOperationTypeRepository } from './mongo.operation-type-repository.ts';
import { MongoPartRepository } from './mongo.part-repository.ts';
import { MongoProcessCardRepository } from './mongo.process-card-repository.ts';

export interface MongoStorageOptions {
  readonly uri: string;
  readonly timeoutMs: number;
  readonly logger: Logger;
}

export class MongoStorage implements Storage {
  readonly parts: MongoPartRepository;
  readonly operationTypes: MongoOperationTypeRepository;
  readonly processCards: MongoProcessCardRepository;
  readonly #connection: Connection;
  #closing = false;

  private constructor(connection: Connection, logger: Logger) {
    const models = registerModels(connection);
    this.parts = new MongoPartRepository(models.Part);
    this.operationTypes = new MongoOperationTypeRepository(models.OperationType);
    this.processCards = new MongoProcessCardRepository(models.ProcessCard);
    this.#connection = connection;

    connection.on('disconnected', () => {
      if (!this.#closing) {
        logger.warn('MongoDB connection lost');
      }
    });
    connection.on('reconnected', () => logger.info('MongoDB connection restored'));
  }

  static async connect(options: MongoStorageOptions): Promise<MongoStorage> {
    const connection = createConnection(options.uri, {
      serverSelectionTimeoutMS: options.timeoutMs,
      bufferCommands: false,
      autoIndex: false,
      autoCreate: true,
    });
    try {
      await connection.asPromise();
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw new StorageUnavailableError('Cannot connect to MongoDB', { cause: error });
    }

    const storage = new MongoStorage(connection, options.logger.child({ component: 'mongodb' }));
    await Promise.all(Object.values(connection.models).map((model) => model.createIndexes()));
    return storage;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.#connection.db?.admin().ping();
      return this.#connection.db !== undefined;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.#closing = true;
    await this.#connection.close();
  }
}
