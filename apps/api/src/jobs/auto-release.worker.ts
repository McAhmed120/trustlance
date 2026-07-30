import { Queue, Worker } from 'bullmq';
import { env } from '../config/env.js';
import { sweepAutoReleases } from '../modules/escrow/escrow.service.js';

/**
 * Auto-release scheduler (Sprint 3, Day 13).
 *
 * One repeatable job sweeps for SUBMITTED milestones whose review window has
 * lapsed, rather than a delayed job per milestone: a sweep can't leak orphaned
 * jobs when a milestone is disputed or reworked mid-window, and a missed tick
 * self-heals on the next one. Each hit goes through the same locked
 * approveMilestone path a human uses — the worker holds no special powers.
 */

const QUEUE = 'auto-release';
const connection = { url: env.REDIS_URL };

export async function startAutoReleaseWorker(): Promise<() => Promise<void>> {
  const queue = new Queue(QUEUE, { connection });

  await queue.upsertJobScheduler('auto-release-sweep', { every: 60_000 }, { name: 'sweep' });

  const worker = new Worker(
    QUEUE,
    async () => {
      const n = await sweepAutoReleases();
      if (n > 0) console.log(`[auto-release] released ${n} milestone(s)`);
    },
    { connection },
  );

  worker.on('failed', (_job, err) => console.error('[auto-release] sweep failed:', err.message));

  return async () => {
    await worker.close();
    await queue.close();
  };
}
