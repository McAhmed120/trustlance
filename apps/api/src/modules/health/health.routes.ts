import { Router } from 'express';
import { checkDatabase } from '../../lib/prisma.js';
import { checkRedis } from '../../lib/redis.js';

export const healthRouter: Router = Router();

/**
 * GET /health
 *
 * Reports dependency reachability, not just process liveness — a process that
 * is up but cannot reach Postgres is not healthy, and returning 200 for it
 * would make a deploy look successful when it isn't.
 */
healthRouter.get('/', async (_req, res) => {
  const [db, redisOk] = await Promise.all([checkDatabase(), checkRedis()]);
  const ok = db && redisOk;

  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    db,
    redis: redisOk,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
