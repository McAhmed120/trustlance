import { describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../app.js';

const app = createApp();

const VALID = {
  email: 'bob@example.com',
  password: 'correct-horse-battery',
  role: 'FREELANCER' as const,
  displayName: 'Bob',
};

async function registerAndGetToken() {
  const res = await request(app).post('/api/auth/register').send(VALID);
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

describe('PATCH /api/users/me', () => {
  it('updates profile fields', async () => {
    const { token } = await registerAndGetToken();
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ bio: 'Escrow systems.', skills: ['TypeScript'], hourlyRateCents: 8500 });

    expect(res.status).toBe(200);
    expect(res.body.profile.bio).toBe('Escrow systems.');
    expect(res.body.profile.hourlyRateCents).toBe(8500);
  });

  it('rejects a non-integer hourly rate (§11: money is always integer cents)', async () => {
    const { token } = await registerAndGetToken();
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ hourlyRateCents: 49.99 });

    expect(res.status).toBe(400);
  });

  it('rejects unknown keys instead of silently ignoring them', async () => {
    const { token } = await registerAndGetToken();
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ trustScore: 999 });

    expect(res.status).toBe(400);
  });

  /*
   * The trust score is computed from completed work (§10.3). If a user could
   * write it directly, the entire reputation system would be decorative.
   */
  it('does not let a user raise their own trust score', async () => {
    const { token, userId } = await registerAndGetToken();
    await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ trustScore: 999 });

    const pub = await request(app).get(`/api/users/${userId}`);
    expect(pub.body.trustScore).toBeNull();
  });

  it('rejects an invalid portfolio URL', async () => {
    const { token } = await registerAndGetToken();
    const res = await request(app)
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ portfolioLinks: ['not a url'] });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/users/:userId — public trust profile', () => {
  it('is readable without authentication', async () => {
    const { userId } = await registerAndGetToken();
    const res = await request(app).get(`/api/users/${userId}`);
    expect(res.status).toBe(200);
  });

  it('never exposes email, verification state, or the password hash', async () => {
    const { userId } = await registerAndGetToken();
    const res = await request(app).get(`/api/users/${userId}`);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('bob@example.com');
    expect(res.body.email).toBeUndefined();
    expect(res.body.emailVerified).toBeUndefined();
    expect(body).not.toContain('passwordHash');
  });

  it('404s for an unknown user', async () => {
    const res = await request(app).get('/api/users/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });

  it('400s for a non-uuid id rather than reaching the database', async () => {
    const res = await request(app).get('/api/users/not-a-uuid');
    expect(res.status).toBe(400);
  });
});

describe('GET /health', () => {
  it('reports database and redis reachability', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: true, redis: true });
  });
});
