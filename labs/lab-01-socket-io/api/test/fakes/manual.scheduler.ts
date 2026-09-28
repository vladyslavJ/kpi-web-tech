import type { Scheduler } from '../../src/application/ports.ts';

export class ManualScheduler implements Scheduler {
  readonly intervals: number[] = [];
  readonly #entries = new Set<{ readonly task: () => void }>();

  every(intervalMs: number, task: () => void): () => void {
    const entry = { task };
    this.intervals.push(intervalMs);
    this.#entries.add(entry);
    return () => {
      this.#entries.delete(entry);
    };
  }

  tick(): void {
    for (const { task } of [...this.#entries]) {
      task();
    }
  }
}
