import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeClock } from '../../../fakes/system.ts';
import { TokenBucketRateLimiter } from '../../../../src/infrastructure/rate-limit/token-bucket.rate-limiter.ts';

describe('TokenBucketRateLimiter', () => {
  it('allows a burst, then rejects until tokens refill', async () => {
    const clock = new FakeClock();
    const limiter = new TokenBucketRateLimiter({ capacity: 3, refillPerSecond: 1, clock });

    for (let i = 0; i < 3; i += 1) {
      assert.equal(await limiter.tryConsume('socket-a'), true);
    }
    assert.equal(await limiter.tryConsume('socket-a'), false, 'burst exhausted');

    clock.advance(500);
    assert.equal(await limiter.tryConsume('socket-a'), false, 'half a token is not enough');

    clock.advance(600);
    assert.equal(await limiter.tryConsume('socket-a'), true, 'a whole token has refilled');
  });

  it('tracks keys independently and forgets released ones', async () => {
    const limiter = new TokenBucketRateLimiter({ capacity: 1, refillPerSecond: 1, clock: new FakeClock() });

    assert.equal(await limiter.tryConsume('a'), true);
    assert.equal(await limiter.tryConsume('a'), false);
    assert.equal(await limiter.tryConsume('b'), true, 'another key has its own bucket');

    await limiter.release('a');
    assert.equal(await limiter.tryConsume('a'), true, 'a released key starts over');
  });
});
