import type { Clock } from '../../application/ports.ts';
import type { RateLimiter } from './rate-limiter.ts';

interface Bucket {
  readonly tokens: number;
  readonly updatedAt: number;
}

export class TokenBucketRateLimiter implements RateLimiter {
  readonly #capacity: number;
  readonly #refillPerSecond: number;
  readonly #clock: Clock;
  readonly #buckets = new Map<string, Bucket>();

  constructor(options: { capacity: number; refillPerSecond: number; clock: Clock }) {
    this.#capacity = options.capacity;
    this.#refillPerSecond = options.refillPerSecond;
    this.#clock = options.clock;
  }

  async tryConsume(key: string): Promise<boolean> {
    const now = this.#clock.now().getTime();
    const bucket = this.#buckets.get(key) ?? { tokens: this.#capacity, updatedAt: now };
    const refilled = (now - bucket.updatedAt) / 1000 * this.#refillPerSecond;
    const tokens = Math.min(this.#capacity, bucket.tokens + refilled);

    if (tokens < 1) {
      this.#buckets.set(key, { tokens, updatedAt: now });
      return false;
    }
    this.#buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    return true;
  }

  async release(key: string): Promise<void> {
    this.#buckets.delete(key);
  }
}
