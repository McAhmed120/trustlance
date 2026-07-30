import type { RequestHandler } from 'express';
import { redis } from '../lib/redis.js';
import { env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';

interface RateLimitOptions {
  /** Window length in seconds. */
  windowSec: number;
  /** Requests permitted per key per window. */
  max: number;
  /** Namespace, so different limiters don't share counters. */
  bucket: string;
}

/**
 * Fixed-window rate limiter backed by Redis.
 *
 * Redis rather than in-memory state because the counter has to be shared across
 * every API instance — a per-process limiter is trivially bypassed by spreading
 * requests over instances, which is exactly what an attacker enumerating
 * accounts or farming sybil signups (§10.3) would do.
 *
 * Fixed window admits up to 2x burst across a window boundary. That is an
 * acceptable trade for the simplicity here; the Day 19 signup limiter is the
 * one that needs to be tighter.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { windowSec, max, bucket } = options;

  return async (req, res, next) => {
    // Rate limiting fights the Day 5 test suite, which deliberately hammers
    // these endpoints. Skipped under NODE_ENV=test only.
    if (env.isTest) {
      next();
      return;
    }

    const key = `ratelimit:${bucket}:${req.ip ?? 'unknown'}`;

    try {
      const count = await redis.incr(key);
      // Only set the TTL on the first request, otherwise the window slides
      // forward on every hit and never expires under sustained load.
      if (count === 1) await redis.expire(key, windowSec);

      const remaining = Math.max(0, max - count);
      res.setHeader('RateLimit-Limit', max);
      res.setHeader('RateLimit-Remaining', remaining);

      if (count > max) {
        const ttl = await redis.ttl(key);
        res.setHeader('Retry-After', Math.max(ttl, 1));
        next(ApiError.tooManyRequests(`Too many requests. Try again in ${Math.max(ttl, 1)}s.`));
        return;
      }

      next();
    } catch (err) {
      // Fail open. A Redis outage should degrade rate limiting, not take down
      // login for everyone. The trade-off is deliberate; revisit if abuse
      // during a Redis outage ever becomes a real problem.
      console.error('[rate-limit] Redis unavailable, allowing request:', (err as Error).message);
      next();
    }
  };
}

/**
 * Login/register: strict, because these are the credential-stuffing and
 * sybil-signup targets (§10.3). This is the limit that actually protects
 * something, so it stays tight.
 */
export const authRateLimit = rateLimit({
  bucket: 'auth',
  windowSec: 900,
  max: env.RATE_LIMIT_AUTH_MAX,
});

/**
 * General API traffic.
 *
 * Deliberately generous. A single dashboard render fires several queries plus a
 * token refresh and a notification fetch, so a low ceiling here throttles
 * ordinary use — it was originally 120/min and a normal click-through tripped
 * it. This limit exists to blunt scraping, not to police real sessions.
 */
export const apiRateLimit = rateLimit({
  bucket: 'api',
  windowSec: 60,
  max: env.RATE_LIMIT_API_MAX,
});
