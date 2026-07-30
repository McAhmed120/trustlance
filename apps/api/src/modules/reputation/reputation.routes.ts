import { Router } from 'express';
import { z } from 'zod';
import type { ReputationExportDto, WorkRecordDto } from '@trustlance/shared-types';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/api-error.js';
import { requireAuth, requireRole } from '../../middleware/require-auth.js';
import { validateBody } from '../../middleware/validate.js';
import { env } from '../../config/env.js';
import { getPublicKeyPem, verifyWorkRecord } from './signing.service.js';
import { avatarUrlFor } from '../users/avatar.js';

export const reputationRouter: Router = Router();

/** GET /api/reputation/public-key — for third parties building verifiers. */
reputationRouter.get('/public-key', async (_req, res) => {
  res.json({ keyId: env.SIGNING_KEY_ID, publicKeyPem: await getPublicKeyPem() });
});

/**
 * POST /api/reputation/verify — checks a JWS against the public key ONLY.
 * No table is read: the endpoint proves what any third party could prove
 * offline, which is the §10.1 portability claim made testable.
 */
reputationRouter.post(
  '/verify',
  validateBody(z.object({ jws: z.string().min(20) }).strict()),
  async (req, res) => {
    const result = await verifyWorkRecord(req.body.jws);
    if (!result) {
      res.status(200).json({ valid: false });
      return;
    }
    res.json({ valid: true, keyId: result.keyId, claims: result.claims });
  },
);

/**
 * GET /api/reputation/showcase — recent completed work across the platform.
 *
 * Powers the landing page's "Proven results" section. Public and unauthenticated
 * because every field it returns is already publicly readable: work records are
 * visible on trust profiles, and the freelancer's display name and avatar are
 * on their public profile.
 *
 * Deliberately returns only the freelancer's side. The client who paid is NOT
 * named — being a buyer isn't something a user opted to publicise, and the
 * record's value is the freelancer's proof, not the client's identity.
 */
reputationRouter.get('/showcase', async (_req, res) => {
  /*
   * Over-fetch, then keep one record per freelancer.
   *
   * Straight "latest 6" fills the wall with whoever completed work most
   * recently — often the same person four times over, which reads as broken
   * rather than as a showcase. One-per-freelancer shows breadth instead.
   */
  const rows = await prisma.workRecord.findMany({
    where: { milestone: { rating: { not: null } } },
    orderBy: { createdAt: 'desc' },
    take: 60,
    include: {
      milestone: { select: { rating: true, feedback: true } },
      freelancer: {
        select: {
          id: true,
          trustScore: true,
          profile: {
            select: { displayName: true, avatarPath: true, updatedAt: true, skills: true },
          },
        },
      },
    },
  });

  const seen = new Set<string>();
  const distinct = rows.filter((r) => {
    if (seen.has(r.freelancerId)) return false;
    seen.add(r.freelancerId);
    return true;
  });

  res.json(
    distinct.slice(0, 6).map((r) => {
      const claims = r.payload as unknown as { title: string; amountCents: number; completedAt: string };
      return {
        id: r.id,
        title: claims.title,
        amountCents: claims.amountCents,
        completedAt: claims.completedAt,
        rating: r.milestone.rating,
        feedback: r.milestone.feedback,
        freelancerId: r.freelancerId,
        freelancerName: r.freelancer.profile?.displayName ?? 'Freelancer',
        freelancerAvatarUrl: avatarUrlFor(r.freelancerId, r.freelancer.profile),
        freelancerTrustScore: r.freelancer.trustScore,
        skills: r.freelancer.profile?.skills.slice(0, 2) ?? [],
      };
    }),
  );
});

/** GET /api/reputation/:userId/records — public: renders on the trust profile. */
reputationRouter.get('/:userId/records', async (req, res) => {
  const { userId } = req.params as { userId: string };
  if (!z.string().uuid().safeParse(userId).success) throw ApiError.badRequest('Invalid user id');

  const rows = await prisma.workRecord.findMany({
    where: { freelancerId: userId },
    orderBy: { createdAt: 'desc' },
  });
  const body: WorkRecordDto[] = rows.map((r) => ({
    id: r.id,
    milestoneId: r.milestoneId,
    jws: r.jws,
    payload: r.payload as unknown as WorkRecordDto['payload'],
    createdAt: r.createdAt.toISOString(),
  }));
  res.json(body);
});

/**
 * GET /api/reputation/:userId/export — the §9 export bundle.
 *
 * Only the owner exports their own ledger: the records are already publicly
 * *viewable*, but the export is the freelancer's portable asset and carries
 * the framing (key, keyId) needed to verify offline forever.
 */
reputationRouter.get('/:userId/export', requireAuth, async (req, res) => {
  const { userId } = req.params as { userId: string };
  if (userId !== req.user!.id) throw ApiError.forbidden('You can only export your own records');

  const rows = await prisma.workRecord.findMany({
    where: { freelancerId: userId },
    orderBy: { createdAt: 'asc' },
    select: { jws: true },
  });

  const bundle: ReputationExportDto = {
    keyId: env.SIGNING_KEY_ID,
    publicKeyPem: await getPublicKeyPem(),
    freelancerId: userId,
    exportedAt: new Date().toISOString(),
    records: rows.map((r) => r.jws),
  };

  res.setHeader('Content-Disposition', `attachment; filename="trustlance-reputation-${userId.slice(0, 8)}.json"`);
  res.json(bundle);
});

/**
 * GET /api/reputation/admin/flags — Day 19 sybil review queue.
 * Surfaces freelancers whose recent 5-star ratings came from client accounts
 * younger than 24h — the cheap, high-signal pattern from §10.3.
 */
reputationRouter.get('/admin/flags', requireAuth, requireRole('ADMIN'), async (_req, res) => {
  const dayAgo = new Date(Date.now() - 86_400_000);
  const suspicious = await prisma.workRecord.findMany({
    where: {
      milestone: { rating: 5 },
      // client account created within 24h of the rating it handed out
      createdAt: { gte: dayAgo },
    },
    include: { milestone: { select: { rating: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  const flags = [];
  for (const r of suspicious) {
    const client = await prisma.user.findUnique({
      where: { id: r.clientId },
      select: { createdAt: true },
    });
    if (client && r.createdAt.getTime() - client.createdAt.getTime() < 86_400_000) {
      flags.push({
        workRecordId: r.id,
        freelancerId: r.freelancerId,
        clientId: r.clientId,
        clientAgeHoursAtRating: Math.round((r.createdAt.getTime() - client.createdAt.getTime()) / 3_600_000),
        rating: r.milestone.rating,
        createdAt: r.createdAt.toISOString(),
      });
    }
  }
  res.json(flags);
});
