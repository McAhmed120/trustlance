import { afterAll, beforeEach } from '@jest/globals';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

/**
 * Truncate before each test rather than after.
 *
 * After-cleanup leaves the database dirty whenever a test fails mid-way, which
 * then cascades into confusing failures in the next test. Cleaning on the way
 * in means each test starts from a known-empty state regardless of how the
 * previous one ended.
 *
 * CASCADE handles profiles and refresh_tokens via their foreign keys.
 */
beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});
