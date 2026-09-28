import type { Scheduler } from '../../application/ports.ts';

export const intervalScheduler: Scheduler = {
  every(intervalMs, task) {
    const timer = setInterval(task, intervalMs);
    return () => clearInterval(timer);
  },
};
