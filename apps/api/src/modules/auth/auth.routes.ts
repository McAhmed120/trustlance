import crypto from 'node:crypto';
import { Router } from 'express';
import type { AuthResponse } from '@trustlance/shared-types';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { ApiError } from '../../lib/api-error.js';
import { validateBody } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { authRateLimit } from '../../middleware/rate-limit.js';
import { requireCustomHeader } from '../../middleware/require-custom-header.js';
import { loginSchema, registerSchema } from './auth.schemas.js';
import { getUserById, registerUser, verifyCredentials } from './auth.service.js';
import { buildGoogleAuthUrl, completeGoogleCallback, googleConfigured } from './oauth.service.js';
import {
  REFRESH_COOKIE,
  issueNewSession,
  refreshCookieOptions,
  revokeRefreshToken,
  rotateRefreshToken,
} from './token.service.js';

export const authRouter: Router = Router();

function clientContext(req: { headers: Record<string, unknown>; ip?: string | undefined }) {
  const ua = req.headers['user-agent'];
  return { userAgent: typeof ua === 'string' ? ua.slice(0, 255) : undefined, ip: req.ip };
}

/** POST /api/auth/register */
authRouter.post(
  '/register',
  authRateLimit,
  validateBody(registerSchema),
  async (req, res) => {
    const user = await registerUser(req.body);
    const tokens = await issueNewSession(user.id, user.role, clientContext(req));

    res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions(tokens.refreshExpiresAt));
    const body: AuthResponse = {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      user,
    };
    res.status(201).json(body);
  },
);

/** POST /api/auth/login */
authRouter.post('/login', authRateLimit, validateBody(loginSchema), async (req, res) => {
  const user = await verifyCredentials(req.body);
  const tokens = await issueNewSession(user.id, user.role, clientContext(req));

  res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions(tokens.refreshExpiresAt));
  const body: AuthResponse = {
    accessToken: tokens.accessToken,
    expiresIn: tokens.expiresIn,
    user,
  };
  res.status(200).json(body);
});

/**
 * POST /api/auth/refresh
 *
 * Takes the refresh token from the httpOnly cookie only — never the body — so
 * a page-embedded script has no way to supply one it obtained elsewhere.
 */
authRouter.post('/refresh', requireCustomHeader, async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!presented) throw ApiError.unauthorized('No refresh token provided');

  let rotated;
  try {
    rotated = await rotateRefreshToken(presented, clientContext(req));
  } catch (err) {
    // Clear the dead cookie so the browser stops replaying a token that will
    // never work again; otherwise every subsequent request retries and fails.
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    throw err;
  }

  const user = await getUserById(rotated.userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists');

  res.cookie(REFRESH_COOKIE, rotated.refreshToken, refreshCookieOptions(rotated.refreshExpiresAt));
  const body: AuthResponse = {
    accessToken: rotated.accessToken,
    expiresIn: rotated.expiresIn,
    user,
  };
  res.status(200).json(body);
});

/**
 * POST /api/auth/logout
 *
 * Intentionally does not require an access token: a user whose access token
 * has already expired must still be able to end their session.
 */
authRouter.post('/logout', requireCustomHeader, async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (presented) await revokeRefreshToken(presented);
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.status(204).send();
});

/**
 * POST /api/auth/request-verification — Day 19 email verification.
 * No SMTP in v1: the verification link is written to the server log (dev) —
 * swap in a mail provider by replacing the console.log.
 */
authRouter.post('/request-verification', requireAuth, async (req, res) => {
  const token = crypto.randomBytes(24).toString('base64url');
  // 24h TTL; token maps to the user it verifies.
  await redis.set(`verify-email:${token}`, req.user!.id, 'EX', 86_400);
  const link = `${env.CLIENT_ORIGIN}/verify-email?token=${token}`;
  console.log(`[email] verification link for user ${req.user!.id}: ${link}`);
  res.json({ sent: true, ...(env.isProduction ? {} : { devLink: link }) });
});

/** POST /api/auth/verify-email { token } */
authRouter.post('/verify-email', async (req, res) => {
  const token = (req.body as { token?: string })?.token;
  if (!token) throw ApiError.badRequest('token is required');
  const userId = await redis.get(`verify-email:${token}`);
  if (!userId) throw ApiError.badRequest('Invalid or expired verification token');
  await redis.del(`verify-email:${token}`);
  await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  res.json({ verified: true });
});

// ─────────────────────────────── OAuth ───────────────────────────────

/**
 * GET /api/auth/oauth/providers
 *
 * Lets the UI render only the providers this deployment can actually complete.
 * A social button that dead-ends is worse than no button.
 */
authRouter.get('/oauth/providers', (_req, res) => {
  res.json({ google: googleConfigured() });
});

/**
 * GET /api/auth/oauth/google/start?role=FREELANCER|CLIENT
 *
 * Redirects the browser to Google. `role` only applies when the flow creates a
 * brand-new account; existing users keep the role they already have.
 */
authRouter.get('/oauth/google/start', authRateLimit, async (req, res) => {
  const role = req.query.role === 'CLIENT' ? 'CLIENT' : 'FREELANCER';
  const url = await buildGoogleAuthUrl(role, `${env.CLIENT_ORIGIN}/dashboard`);
  res.redirect(url);
});

/**
 * GET /api/auth/oauth/google/callback
 *
 * Google redirects the browser here. On success this sets the same rotating
 * refresh cookie a password login would, then bounces to the web app — the
 * access token is minted client-side by the usual /refresh call, so no token
 * ever rides in a URL where it could land in history or a Referer header.
 */
authRouter.get('/oauth/google/callback', async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;

  const fail = (reason: string) =>
    res.redirect(`${env.CLIENT_ORIGIN}/login?oauth_error=${encodeURIComponent(reason)}`);

  if (error) return fail(error === 'access_denied' ? 'cancelled' : error);
  if (!code || !state) return fail('missing_code');

  try {
    const { user, returnTo } = await completeGoogleCallback(code, state);
    const tokens = await issueNewSession(user.id, user.role, clientContext(req));
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions(tokens.refreshExpiresAt));
    res.redirect(returnTo);
  } catch (err) {
    console.error('[oauth] callback failed:', (err as Error).message);
    return fail(err instanceof ApiError ? err.code.toLowerCase() : 'failed');
  }
});

/** GET /api/auth/me — the session probe the frontend calls on mount. */
authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await getUserById(req.user!.id);
  if (!user) throw ApiError.unauthorized('Account no longer exists');
  res.json(user);
});
