import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FakeClock, RecordingLogger, SequentialIds, silentLogger } from '../../fakes/system.ts';
import { SpyNotifier } from '../../fakes/spy.notifier.ts';
import type { SystemMessage } from '../../../src/domain/message.ts';
import { intervalScheduler } from '../../../src/infrastructure/scheduling/interval.scheduler.ts';
import { AutoMessageScheduler } from '../../../src/application/auto-message.scheduler.ts';
import { BroadcastAutoMessage } from '../../../src/application/broadcast-auto-message.use-case.ts';
import type { Logger } from '../../../src/application/ports.ts';

const TEXT = 'Автоматичне повідомлення від ст. Жукова Владислава Віталійовича гр. ІС-33 Варіант 11';
const INTERVAL_MS = 21_000;

function createScheduler(notifier: SpyNotifier, logger: Logger = silentLogger): AutoMessageScheduler {
  return new AutoMessageScheduler({
    scheduler: intervalScheduler,
    intervalMs: INTERVAL_MS,
    logger,
    broadcast: new BroadcastAutoMessage({
      notifier,
      ids: new SequentialIds('auto'),
      clock: new FakeClock(),
      text: TEXT,
    }),
  });
}

describe('AutoMessageScheduler', () => {
  it('broadcasts the configured system message every 21 seconds', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const notifier = new SpyNotifier();
    const auto = createScheduler(notifier);

    auto.start();
    t.mock.timers.tick(INTERVAL_MS - 1);
    assert.equal(notifier.announced.length, 0, 'nothing before the first interval');

    t.mock.timers.tick(1);
    assert.equal(notifier.announced.length, 1);

    t.mock.timers.tick(2 * INTERVAL_MS);
    assert.equal(notifier.announced.length, 3);
    assert.ok(notifier.announced.every((message) => message.type === 'system' && message.text === TEXT));
    auto.stop();
  });

  it('start() is idempotent and stop() halts the schedule', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const notifier = new SpyNotifier();
    const auto = createScheduler(notifier);

    auto.start();
    auto.start();
    t.mock.timers.tick(INTERVAL_MS);
    assert.equal(notifier.announced.length, 1, 'a second start() must not add a second timer');

    auto.stop();
    t.mock.timers.tick(5 * INTERVAL_MS);
    assert.equal(notifier.announced.length, 1);
  });

  it('keeps ticking after a failed broadcast and reports the failure', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });

    class FlakyNotifier extends SpyNotifier {
      #failuresLeft = 1;

      override announcementMade(message: SystemMessage): void {
        if (this.#failuresLeft > 0) {
          this.#failuresLeft -= 1;
          throw new Error('network is down');
        }
        super.announcementMade(message);
      }
    }
    const notifier = new FlakyNotifier();
    const logger = new RecordingLogger();
    const auto = createScheduler(notifier, logger);

    auto.start();
    t.mock.timers.tick(INTERVAL_MS);
    assert.equal(notifier.announced.length, 0);
    assert.equal(logger.errors.length, 1);

    t.mock.timers.tick(INTERVAL_MS);
    assert.equal(notifier.announced.length, 1, 'the next tick is delivered');
    auto.stop();
  });
});
