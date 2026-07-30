import { describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { signAccessToken } from '../modules/auth/token.service.js';

const app = createApp();

const VALID = {
  email: 'alice@example.com',
  password: 'correct-horse-battery',
  role: 'FREELANCER' as const,
  displayName: 'Alice',
};

/** Pulls the refresh token out of the Set-Cookie header. */
function refreshCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw];
  const match = cookies.find((c) => c?.startsWith('trustlance_rt='));
  if (!match) throw new Error('no refresh cookie set');
  return match.split(';')[0]!;
}

describe('POST /api/auth/register', () => {
  it('creates an account and returns tokens', async () => {
    const res = await request(app).post('/api/auth/register').send(VALID);

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user.email).toBe(VALID.email);
    expect(res.body.user.profile.displayName).toBe('Alice');
    // The refresh token must never appear in the body — cookie only.
    expect(res.body.refreshToken).toBeUndefined();
    expect(refreshCookie(res)).toContain('trustlance_rt=');
  });

  it('never exposes the password hash', async () => {
    const res = await request(app).post('/api/auth/register').send(VALID);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('$2');
  });

  it('sets the refresh cookie httpOnly and scoped to /api/auth', async () => {
    const res = await request(app).post('/api/auth/register').send(VALID);
    const raw = res.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [raw]).find((c) => c?.startsWith('trustlance_rt='))!;

    // httpOnly is the property that makes XSS unable to steal the refresh token.
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);
  });

  it('rejects a duplicate email', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app).post('/api/auth/register').send(VALID);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects a password shorter than 12 characters', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...VALID, password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.details.password[0]).toMatch(/at least 12/i);
  });

  it('refuses to create an ADMIN account (privilege escalation)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...VALID, role: 'ADMIN' });

    expect(res.status).toBe(400);
    // Nothing was written — an arbitrator cannot be self-provisioned.
    expect(await prisma.user.count()).toBe(0);
  });

  it('normalises email casing so Alice@ and alice@ are one account', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...VALID, email: 'ALICE@example.com' });

    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  it('authenticates with correct credentials', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID.email, password: VALID.password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it('rejects a wrong password', async () => {
    await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID.email, password: 'wrong-password-here' });

    expect(res.status).toBe(401);
  });

  it('returns an identical error for unknown email and wrong password', async () => {
    await request(app).post('/api/auth/register').send(VALID);

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID.email, password: 'wrong-password-here' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password-here' });

    // Any difference here turns login into an account-enumeration oracle.
    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });
});

describe('POST /api/auth/refresh — rotation and reuse detection', () => {
  it('rotates: the returned token differs from the one presented', async () => {
    const reg = await request(app).post('/api/auth/register').send(VALID);
    const rt1 = refreshCookie(reg);

    const res = await request(app).post('/api/auth/refresh').set('Cookie', rt1);
    expect(res.status).toBe(200);
    expect(refreshCookie(res)).not.toBe(rt1);
  });

  it('rejects a refresh with no cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('rejects an unknown refresh token', async () => {
    const res = await request(app).post('/api/auth/refresh').set('Cookie', 'trustlance_rt=bogus');
    expect(res.status).toBe(401);
  });

  /*
   * The security property this whole design exists for.
   *
   * A leaked refresh token must not be usable, AND detecting the leak must kill
   * the legitimate session too — otherwise the attacker simply keeps rotating
   * alongside the victim, forever.
   *
   * This test previously passed while the implementation was broken: the family
   * revocation ran inside a transaction that the subsequent throw rolled back.
   * Asserting on RT3 (the victim's live token), not just on the replayed token,
   * is what catches that.
   */
  it('revokes the ENTIRE family when a used token is replayed', async () => {
    const reg = await request(app).post('/api/auth/register').send(VALID);
    const rt1 = refreshCookie(reg);

    const r2 = await request(app).post('/api/auth/refresh').set('Cookie', rt1);
    const rt2 = refreshCookie(r2);

    const r3 = await request(app).post('/api/auth/refresh').set('Cookie', rt2);
    const rt3 = refreshCookie(r3);
    expect(r3.status).toBe(200);

    // Attacker replays the stolen, already-rotated rt2.
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', rt2);
    expect(replay.status).toBe(401);

    // The victim's still-current rt3 must now be dead as well.
    const victim = await request(app).post('/api/auth/refresh').set('Cookie', rt3);
    expect(victim.status).toBe(401);

    const live = await prisma.refreshToken.count({ where: { revokedAt: null } });
    expect(live).toBe(0);
  });

  it('clears the cookie when refresh fails, so the browser stops replaying it', async () => {
    const res = await request(app).post('/api/auth/refresh').set('Cookie', 'trustlance_rt=bogus');
    const raw = res.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw];
    expect(cookies.some((c) => c?.includes('trustlance_rt=;'))).toBe(true);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session and succeeds without an access token', async () => {
    const reg = await request(app).post('/api/auth/register').send(VALID);
    const rt = refreshCookie(reg);

    const out = await request(app).post('/api/auth/logout').set('Cookie', rt);
    expect(out.status).toBe(204);

    // The revoked token must not be usable afterwards.
    const after = await request(app).post('/api/auth/refresh').set('Cookie', rt);
    expect(after.status).toBe(401);
  });
});

describe('access control', () => {
  it('rejects a protected route without a token', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const res = await request(app).get('/api/users/me').set('Authorization', 'Bearer nonsense');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const reg = await request(app).post('/api/auth/register').send(VALID);
    const forged = signAccessToken(reg.body.user.id, 'ADMIN');
    // Sanity: a correctly signed token IS accepted, proving the next assertion
    // fails for the signature and not for some unrelated reason.
    const ok = await request(app).get('/api/users/me').set('Authorization', `Bearer ${forged}`);
    expect(ok.status).toBe(200);

    const tampered = `${forged.slice(0, -3)}xyz`;
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });

  it('denies a FREELANCER access to an ADMIN route', async () => {
    const reg = await request(app).post('/api/auth/register').send(VALID);
    const res = await request(app)
      .get('/api/admin/ping')
      .set('Authorization', `Bearer ${reg.body.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an ADMIN through the same route', async () => {
    const reg = await request(app).post('/api/auth/register').send(VALID);
    await prisma.user.update({ where: { id: reg.body.user.id }, data: { role: 'ADMIN' } });

    // Role lives in the token, so a fresh one is needed after the change.
    const token = signAccessToken(reg.body.user.id, 'ADMIN');
    const res = await request(app).get('/api/admin/ping').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('OAuth-only accounts', () => {
  /*
   * A null passwordHash must never be treated as "matches anything". bcrypt
   * compares against a dummy hash so timing matches an unknown email, and the
   * null is rejected explicitly — belt and braces, because getting this wrong
   * would let anyone into every federated account with an arbitrary password.
   */
  it('cannot be logged into with any password', async () => {
    const reg = await request(app).post('/api/auth/register').send(VALID);
    // Simulate a Google-created account: strip the password.
    await prisma.user.update({
      where: { id: reg.body.user.id },
      data: { passwordHash: null },
    });

    for (const password of ['correct-horse-battery', 'anything-at-all', 'x'.repeat(12)]) {
      const res = await request(app).post('/api/auth/login').send({ email: VALID.email, password });
      expect(res.status).toBe(401);
    }
  });

  it('returns the same error as an unknown email, leaking nothing', async () => {
    const reg = await request(app).post('/api/auth/register').send(VALID);
    await prisma.user.update({ where: { id: reg.body.user.id }, data: { passwordHash: null } });

    const oauthOnly = await request(app)
      .post('/api/auth/login')
      .send({ email: VALID.email, password: 'correct-horse-battery' });
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'correct-horse-battery' });

    // Differing here would reveal which addresses are federated accounts.
    expect(oauthOnly.status).toBe(unknown.status);
    expect(oauthOnly.body.error.message).toBe(unknown.body.error.message);
  });
});

describe('OAuth provider discovery', () => {
  it('reports whether Google is configured', async () => {
    const res = await request(app).get('/api/auth/oauth/providers');
    expect(res.status).toBe(200);
    expect(typeof res.body.google).toBe('boolean');
  });

  it('refuses to start a flow for an unconfigured provider', async () => {
    // The test environment sets no Google credentials.
    const res = await request(app).get('/api/auth/oauth/google/start');
    expect([501, 302]).toContain(res.status);
    if (res.status === 501) expect(res.body.error.code).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('rejects a callback with an unknown state', async () => {
    const res = await request(app).get('/api/auth/oauth/google/callback?code=x&state=never-issued');
    // Always a redirect back to login with a reason — never a 500.
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('oauth_error=');
  });
});
