import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// .env lives at the monorepo root so one file serves api, prisma CLI, and tests.
loadDotenv({ path: path.resolve(here, '../../../../.env') });

/**
 * Environment schema (documentation §13).
 *
 * Validating at boot means a missing secret is a startup crash with a readable
 * message, not a 500 three weeks later when some rarely-hit code path finally
 * reads `process.env.JWT_REFRESH_SECRET` and gets undefined.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(4000),

    DATABASE_URL: z.string().url(),
    TEST_DATABASE_URL: z.string().url().optional(),
    REDIS_URL: z.string().url(),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
    BCRYPT_COST: z.coerce.number().int().min(12).default(12), // §11 requires cost >= 12

    /// Days of client silence after submission before escrow auto-releases
    /// (§10.2 "auto-approve timeout"). Fractional values allowed for demos.
    AUTO_RELEASE_DAYS: z.coerce.number().positive().default(7),

    /// Rate limits (§11). Auth stays tight; general API traffic is generous
    /// because one page render legitimately makes several calls.
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_API_MAX: z.coerce.number().int().positive().default(600),

    // Reserved for Sprint 4 (Day 16). Blank in Sprint 1 — signing is not wired yet.
    SIGNING_PRIVATE_KEY: z.string().optional(),
    SIGNING_PUBLIC_KEY: z.string().optional(),
    // Becomes the JWS `kid` header so work records survive a key rotation (§10.1).
    SIGNING_KEY_ID: z.string().default('trustlance-key-2026-01'),

    CLIENT_ORIGIN: z.string().url().default('http://localhost:3000'),

    /// Public base URL of THIS API, used to build the OAuth redirect_uri.
    /// Must match the redirect URI registered with the provider exactly.
    API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),

    /// Google OAuth. Both optional: when either is missing the provider is
    /// simply reported as unconfigured and its endpoints return 501, so the
    /// app runs fine without a Google Cloud project.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    // A shared secret would let an access token be replayed as a refresh token,
    // collapsing the short-TTL guarantee that makes access tokens safe to hold.
    if (val.JWT_ACCESS_SECRET === val.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error(`\nInvalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.\n`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  // Tests run against a throwaway database so a suite can drop and re-migrate
  // without destroying local dev data.
  DATABASE_URL:
    raw.NODE_ENV === 'test' && raw.TEST_DATABASE_URL ? raw.TEST_DATABASE_URL : raw.DATABASE_URL,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
} as const;

export type Env = typeof env;
