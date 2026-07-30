import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

// globalSetup runs before setupFilesAfterEnv, so config/env.ts has not loaded
// the root .env yet. Load it here explicitly.
const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(here, '../../../../.env') });

/**
 * Applies migrations to the test database once, before any suite runs.
 *
 * `migrate deploy` rather than `migrate dev`: deploy is non-interactive and
 * never tries to generate a new migration, so a schema drift in CI fails loudly
 * instead of silently inventing a migration nobody reviewed.
 */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Copy .env.example to .env — tests refuse to run against the dev database.',
    );
  }

  execSync('npx prisma migrate deploy', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
