import { StorageUnavailableError } from '../../../application/ports.ts';

const DUPLICATE_KEY = 11000;
const CONNECTIVITY_ERRORS = new Set([
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
  'MongoPoolClearedError',
  'MongoTopologyClosedError',
]);

export function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === DUPLICATE_KEY;
}

export function isConnectivityError(error: unknown): boolean {
  return CONNECTIVITY_ERRORS.has((error as { name?: unknown } | null)?.name as string);
}

export async function withStorage<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isConnectivityError(error)) {
      throw new StorageUnavailableError('MongoDB is unavailable', { cause: error });
    }
    throw error;
  }
}
