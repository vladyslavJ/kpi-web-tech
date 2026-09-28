import type { BroadcastAutoMessage } from './broadcast-auto-message.use-case.ts';
import type { Logger, Scheduler } from './ports.ts';

export class AutoMessageScheduler {
  readonly #scheduler: Scheduler;
  readonly #broadcast: BroadcastAutoMessage;
  readonly #intervalMs: number;
  readonly #logger: Logger;
  #cancel: (() => void) | null = null;

  constructor(deps: {
    scheduler: Scheduler;
    broadcast: BroadcastAutoMessage;
    intervalMs: number;
    logger: Logger;
  }) {
    this.#scheduler = deps.scheduler;
    this.#broadcast = deps.broadcast;
    this.#intervalMs = deps.intervalMs;
    this.#logger = deps.logger;
  }

  start(): void {
    if (this.#cancel) {
      return;
    }
    this.#cancel = this.#scheduler.every(this.#intervalMs, () => this.#tick());
  }

  stop(): void {
    this.#cancel?.();
    this.#cancel = null;
  }

  #tick(): void {
    try {
      this.#broadcast.execute();
    } catch (error) {
      this.#logger.error('Auto message tick failed', { error });
    }
  }
}
