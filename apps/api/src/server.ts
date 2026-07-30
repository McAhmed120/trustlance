import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { redis } from './lib/redis.js';
import { createSocketServer } from './realtime/socket.js';
import { startAutoReleaseWorker } from './jobs/auto-release.worker.js';

const app = createApp();
const stopWorkerPromise = startAutoReleaseWorker().catch((err) => {
  console.error('[auto-release] failed to start:', err.message);
  return async () => {};
});

// Express and Socket.io share one HTTP server so both are reachable on a single
// port — which is also what most PaaS hosts (Railway, Render) expect.
const httpServer = createServer(app);
const io = createSocketServer(httpServer);

httpServer.listen(env.API_PORT, () => {
  console.log(`[api] listening on http://localhost:${env.API_PORT} (${env.NODE_ENV})`);
  console.log(`[api] health:  http://localhost:${env.API_PORT}/health`);
  if (!env.isProduction) {
    console.log(`[api] docs:    http://localhost:${env.API_PORT}/api/docs`);
  }
  console.log(`[ws]  socket.io attached`);
});

/**
 * Graceful shutdown.
 *
 * This matters more than usual here: from Sprint 3, a request can be midway
 * through an escrow transaction, and killing the pool underneath it is how you
 * end up with a ledger row written but no state transition recorded.
 */
async function shutdown(signal: string) {
  console.log(`\n[api] ${signal} received, shutting down`);
  await (await stopWorkerPromise)();
  io.close();
  httpServer.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    process.exit(0);
  });
  // Don't hang forever on a stuck connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
