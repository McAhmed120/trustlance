import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@trustlance/shared-types';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/api-error.js';

export const REFRESH_COOKIE = 'trustlance_rt';

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** Seconds represented by the JWT_ACCESS_TTL string, for the `expiresIn` field. */
function accessTtlSeconds(): number {
  const m = /^(\d+)([smhd])$/.exec(env.JWT_ACCESS_TTL);
  if (!m) return 900;
  const n = Number(m[1]);
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return n * mult;
}

export function signAccessToken(userId: string, role: Role): string {
  return jwt.sign({ role }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'trustlance',
  });
}

export function verifyAccessToken(token: string): { sub: string; role: Role } {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'trustlance' });
    if (typeof payload === 'string' || !payload.sub) throw new Error('malformed');
    return { sub: payload.sub, role: (payload as jwt.JwtPayload).role as Role };
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token');
  }
}

/**
 * Refresh tokens are opaque random strings, not JWTs.
 *
 * A JWT would be self-validating, which is exactly wrong here: the server must
 * be able to *revoke* a refresh token, and a signature that verifies offline
 * can't be revoked. Storing a hash of an opaque token means every refresh is a
 * deliberate database lookup that can consult revocation state.
 */
function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

/** Refresh tokens are stored hashed so a database dump yields no usable sessions. */
export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

interface IssueContext {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

/**
 * Issues an access token plus a brand-new refresh-token family.
 * Used on register and login — anything that starts a fresh session.
 */
export async function issueNewSession(
  userId: string,
  role: Role,
  ctx: IssueContext = {},
): Promise<IssuedTokens> {
  const familyId = crypto.randomUUID();
  return issueTokens(userId, role, familyId, ctx);
}

async function issueTokens(
  userId: string,
  role: Role,
  familyId: string,
  ctx: IssueContext,
  replacesTokenId?: string,
): Promise<IssuedTokens> {
  const refreshToken = generateRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 86_400_000);

  const created = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      familyId,
      expiresAt: refreshExpiresAt,
      userAgent: ctx.userAgent ?? null,
      ip: ctx.ip ?? null,
    },
    select: { id: true },
  });

  // Link the old token to its successor so a reuse incident can be traced.
  if (replacesTokenId) {
    await prisma.refreshToken.update({
      where: { id: replacesTokenId },
      data: { replacedByTokenId: created.id },
    });
  }

  return {
    accessToken: signAccessToken(userId, role),
    expiresIn: accessTtlSeconds(),
    refreshToken,
    refreshExpiresAt,
  };
}

/**
 * Rotates a refresh token.
 *
 * The security-critical path of this whole module. Three cases:
 *
 *   1. Token unknown        -> reject. Nothing to revoke.
 *   2. Token already used   -> the token leaked. Someone is replaying a token
 *                              the legitimate client already exchanged, so
 *                              revoke the ENTIRE family: both the attacker and
 *                              the victim are logged out, and the victim's next
 *                              login starts a clean family. Silently issuing a
 *                              new token here would let a stolen token be used
 *                              indefinitely, which defeats rotation entirely.
 *   3. Token valid          -> revoke it, issue its successor in the same family.
 *
 * Runs inside a serializable transaction so two concurrent refreshes with the
 * same token cannot both observe it as unused and both succeed.
 */
export async function rotateRefreshToken(
  presentedToken: string,
  ctx: IssueContext = {},
): Promise<IssuedTokens & { userId: string; role: Role }> {
  const tokenHash = hashRefreshToken(presentedToken);

  /*
   * The transaction only *classifies* the presented token. It must not throw,
   * and must not perform the family revocation.
   *
   * Throwing inside $transaction rolls the transaction back — which would undo
   * the very revocation the reuse branch just wrote, leaving the stolen family
   * fully usable while still returning 401. The compensating write therefore
   * happens after the transaction has committed, below.
   *
   * The same trap applies to the escrow ledger in Sprint 3: never write a
   * compensating row inside a transaction you are about to abort.
   */
  type Outcome =
    | { kind: 'unknown' }
    | { kind: 'expired' }
    | { kind: 'reuse'; familyId: string; userId: string }
    | { kind: 'ok'; userId: string; role: Role; familyId: string; tokenId: string };

  const classify = () =>
    prisma.$transaction(
    async (tx): Promise<Outcome> => {
      const existing = await tx.refreshToken.findUnique({
        where: { tokenHash },
        include: { user: { select: { id: true, role: true } } },
      });

      // Case 1 — never issued, or already pruned.
      if (!existing) return { kind: 'unknown' };

      // Case 2 — reuse of an already-rotated token.
      if (existing.revokedAt) {
        return { kind: 'reuse', familyId: existing.familyId, userId: existing.userId };
      }

      if (existing.expiresAt.getTime() < Date.now()) return { kind: 'expired' };

      // Case 3 — valid. Mark used. Serializable isolation makes two concurrent
      // refreshes of the same token conflict rather than both succeeding.
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });

      return {
        kind: 'ok',
        userId: existing.user.id,
        role: existing.user.role as Role,
        familyId: existing.familyId,
        tokenId: existing.id,
      };
    },
    { isolationLevel: 'Serializable' },
  );

  /*
   * Serializable isolation makes write conflicts an expected outcome, not an
   * error: Postgres aborts one of two overlapping transactions with P2034 and
   * asks the caller to retry. Choosing Serializable and then not retrying is
   * how that surfaces as a 500 — which is exactly what happened here until a
   * browser session raced its own bootstrap refresh against a 401 retry.
   *
   * The aborted transaction rolled back completely, so a retry re-reads clean
   * state. Bounded at 3 attempts: beyond that the contention is not transient.
   */
  let outcome: Outcome | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      outcome = await classify();
      break;
    } catch (err) {
      const code = (err as { code?: string }).code;
      const retryable = code === 'P2034' || code === 'P2028';
      if (!retryable || attempt === 3) throw err;
      // Brief jittered backoff so retries don't collide with each other.
      await new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 25));
    }
  }
  if (!outcome) throw ApiError.unauthorized('Could not rotate refresh token');

  if (outcome.kind === 'unknown') throw ApiError.unauthorized('Invalid refresh token');
  if (outcome.kind === 'expired') throw ApiError.unauthorized('Refresh token expired');

  if (outcome.kind === 'reuse') {
    // Committed separately, so it survives the throw below. Someone is
    // replaying a token the legitimate client already exchanged: revoke every
    // live token in the family, logging out attacker and victim alike.
    await prisma.refreshToken.updateMany({
      where: { familyId: outcome.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    console.warn(
      `[auth] refresh token reuse detected for user ${outcome.userId}; family ${outcome.familyId} revoked`,
    );
    throw ApiError.unauthorized('Refresh token has already been used; session revoked');
  }

  const { userId, role, familyId, tokenId } = outcome;
  const tokens = await issueTokens(userId, role, familyId, ctx, tokenId);
  return { ...tokens, userId, role };
}

/** Revokes a single token (logout on this device). */
export async function revokeRefreshToken(presentedToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(presentedToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every active session for a user (password change, admin action). */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Cookie options for the refresh token. */
export function refreshCookieOptions(expires: Date) {
  const sameSite = env.COOKIE_SAMESITE;
  return {
    // Blocks JS access entirely, so XSS cannot exfiltrate the refresh token.
    httpOnly: true,
    // SameSite=None is invalid without Secure — browsers drop the cookie
    // outright — so 'none' always implies Secure regardless of NODE_ENV.
    secure: env.isProduction || sameSite === 'none',
    /*
     * Strict by default, which is right when the API and web app share a
     * registrable domain. Split-host deployments must set COOKIE_SAMESITE=none,
     * or the cookie is never sent and login appears to do nothing.
     *
     * When it is 'none', /api/auth/refresh additionally demands a custom header
     * (see requireCustomHeader) so a foreign origin cannot silently trigger a
     * rotation and log the victim out.
     */
    sameSite,
    expires,
    path: '/api/auth',
  };
}
