import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * Single Prisma client for the process.
 *
 * Held on globalThis in development so `tsx watch` hot-reloads don't leak a new
 * connection pool on every file save until Postgres refuses connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
    log: env.isProduction ? ['error'] : ['warn', 'error'],
  });

if (!env.isProduction) globalForPrisma.prisma = prisma;

/** Cheap liveness probe used by GET /health. */
export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
