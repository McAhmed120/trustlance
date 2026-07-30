// Named import, not default: under NodeNext ESM resolution ioredis's default
// export is the module namespace and is not constructable.
import { Redis } from 'ioredis';
import { env } from '../config/env.js';

const globalForRedis = globalThis as unknown as { redis?: Redis };

/**
 * Shared Redis connection (cache, rate limiting, and — from Sprint 3 — the
 * BullMQ auto-release queue).
 *
 * `maxRetriesPerRequest: null` is required by BullMQ and is set now so the
 * client doesn't have to be reconfigured when the queue lands.
 */
export const redis =
  globalForRedis.redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
    // Without a ceiling, a Redis outage produces an unbounded reconnect storm.
    retryStrategy: (times: number) => Math.min(times * 200, 5_000),
  });

if (!env.isProduction) globalForRedis.redis = redis;

// ioredis emits 'error' on every failed reconnect; an unhandled 'error' event
// crashes the process. Log and let retryStrategy do its job.
redis.on('error', (err: Error) => {
  console.error('[redis]', err.message);
});

export async function checkRedis(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}
