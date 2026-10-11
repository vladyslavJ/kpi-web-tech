import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../application/ports.ts';

export const cryptoIdGenerator: IdGenerator = {
  next: () => randomUUID(),
};
