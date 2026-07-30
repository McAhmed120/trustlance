import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Role } from '@trustlance/shared-types';
import { env } from '../../config/env.js';
import { redis } from '../../lib/redis.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/api-error.js';
import { toMeDto, userSelect } from './auth.service.js';

/**
 * Google OAuth 2.0 (authorization code + PKCE).
 *
 * Why the full server-side code flow rather than a client-side ID token:
 * the exchange happens with the client secret over TLS, the browser never
 * touches a provider token, and the resulting session is an ordinary
 * TrustLance refresh cookie — so every downstream rule (rotation, reuse
 * detection, RBAC) applies unchanged.
 */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Google's public keys, cached and rotated by jose. */
const googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export function googleConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function googleRedirectUri(): string {
  return `${env.API_PUBLIC_URL}/api/auth/oauth/google/callback`;
}

interface PendingAuth {
  verifier: string;
  role: Role;
  /** Where to send the browser once the exchange succeeds. */
  returnTo: string;
}

const STATE_PREFIX = 'oauth:google:';
const STATE_TTL_SECONDS = 600; // 10 minutes to complete the round trip

/**
 * Builds the provider URL and stashes the PKCE verifier against a one-time
 * state value.
 *
 * State lives in Redis rather than a cookie so it is genuinely single-use: the
 * callback deletes it, which means a replayed callback URL cannot mint a second
 * session.
 */
export async function buildGoogleAuthUrl(role: Role, returnTo: string): Promise<string> {
  if (!googleConfigured()) {
    throw new ApiError(501, 'PROVIDER_NOT_CONFIGURED', 'Google sign-in is not configured on this server');
  }

  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  const pending: PendingAuth = { verifier, role, returnTo };
  await redis.set(STATE_PREFIX + state, JSON.stringify(pending), 'EX', STATE_TTL_SECONDS);

  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID!);
  url.searchParams.set('redirect_uri', googleRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // Ask for a fresh consent screen only when we have no account yet; Google
  // otherwise silently reuses the last-used account.
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

interface GoogleClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

/**
 * Completes the flow: validates state, exchanges the code, verifies the ID
 * token's signature, then finds or creates the local account.
 */
export async function completeGoogleCallback(
  code: string,
  state: string,
): Promise<{ user: Awaited<ReturnType<typeof toMeDto>>; returnTo: string }> {
  if (!googleConfigured()) {
    throw new ApiError(501, 'PROVIDER_NOT_CONFIGURED', 'Google sign-in is not configured');
  }

  // Single-use: GETDEL removes the state as it reads it, so a replayed callback
  // finds nothing and is rejected.
  const raw = await redis.getdel(STATE_PREFIX + state);
  if (!raw) throw ApiError.badRequest('Sign-in link expired or already used. Please try again.');
  const pending = JSON.parse(raw) as PendingAuth;

  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirectUri(),
      grant_type: 'authorization_code',
      code_verifier: pending.verifier,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[oauth] google token exchange failed:', res.status, body.slice(0, 300));
    throw ApiError.badRequest('Google sign-in failed. Please try again.');
  }

  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw ApiError.badRequest('Google did not return an identity token');

  // Verify the signature against Google's JWKS — never trust an unverified JWT,
  // even one that arrived over TLS from the token endpoint.
  const { payload } = await jwtVerify(tokens.id_token, googleJwks, {
    issuer: GOOGLE_ISSUERS,
    audience: env.GOOGLE_CLIENT_ID!,
  });
  const claims = payload as unknown as GoogleClaims;

  if (!claims.sub) throw ApiError.badRequest('Google identity token is missing a subject');
  if (!claims.email || claims.email_verified !== true) {
    // Linking on an unverified email would let someone claim an address they
    // do not control and take over the matching local account.
    throw ApiError.badRequest('Your Google account has no verified email address');
  }

  const user = await linkOrCreate({
    provider: 'google',
    providerAccountId: claims.sub,
    email: claims.email.toLowerCase(),
    displayName: claims.name?.trim() || claims.email.split('@')[0]!,
    role: pending.role,
  });

  return { user, returnTo: pending.returnTo };
}

/**
 * Resolves a federated identity to a local account, in priority order:
 *
 *   1. Already-linked provider account  -> log in.
 *   2. Existing local account, same verified email -> link and log in.
 *   3. Nothing -> create the account with the requested role.
 *
 * Step 2 is only safe because the provider asserted email_verified: it means
 * the person completing the flow demonstrably controls that mailbox.
 */
async function linkOrCreate(input: {
  provider: string;
  providerAccountId: string;
  email: string;
  displayName: string;
  role: Role;
}) {
  const existingLink = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
    },
    select: { user: { select: userSelect } },
  });
  if (existingLink) return toMeDto(existingLink.user);

  const byEmail = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (byEmail) {
    const user = await prisma.user.update({
      where: { id: byEmail.id },
      data: {
        // A provider-verified email is stronger evidence than our own unsent
        // verification mail, so trust it.
        emailVerified: true,
        oauthAccounts: {
          create: { provider: input.provider, providerAccountId: input.providerAccountId },
        },
      },
      select: userSelect,
    });
    return toMeDto(user);
  }

  const created = await prisma.user.create({
    data: {
      email: input.email,
      // No password: this account can only be reached through the provider.
      passwordHash: null,
      role: input.role,
      emailVerified: true,
      profile: { create: { displayName: input.displayName.slice(0, 80) } },
      oauthAccounts: {
        create: { provider: input.provider, providerAccountId: input.providerAccountId },
      },
    },
    select: userSelect,
  });
  return toMeDto(created);
}
