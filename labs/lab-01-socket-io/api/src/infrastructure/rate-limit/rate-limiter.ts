export interface RateLimiter {
  tryConsume(key: string): Promise<boolean>;
  release(key: string): Promise<void>;
}
