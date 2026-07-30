import { Router } from 'express';
import { z } from 'zod';
import type { JobDto } from '@trustlance/shared-types';
import { JOB_CATEGORIES } from '@trustlance/shared-types';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/api-error.js';
import { requireAuth, requireRole } from '../../middleware/require-auth.js';
import { validateBody } from '../../middleware/validate.js';
import { avatarUrlFor } from '../users/avatar.js';

export const jobsRouter: Router = Router();

const createJobSchema = z
  .object({
    title: z.string().min(5).max(120).trim(),
    description: z.string().min(20).max(10_000).trim(),
    category: z.enum(JOB_CATEGORIES),
    budgetCents: z.number().int('Budget must be integer cents').positive().max(10_000_000_00),
    skills: z.array(z.string().min(1).max(40).trim()).max(15).default([]),
  })
  .strict();

type JobRow = {
  id: string;
  clientId: string;
  title: string;
  description: string;
  category: string;
  budgetCents: number;
  skills: string[];
  status: string;
  createdAt: Date;
  client: { profile: { displayName: string; avatarPath: string | null; updatedAt: Date } | null };
  _count: { proposals: number };
};

function toJobDto(j: JobRow): JobDto {
  return {
    id: j.id,
    clientId: j.clientId,
    clientName: j.client.profile?.displayName ?? 'Client',
    clientAvatarUrl: avatarUrlFor(j.clientId, j.client.profile),
    title: j.title,
    description: j.description,
    category: j.category,
    budgetCents: j.budgetCents,
    skills: j.skills,
    status: j.status as JobDto['status'],
    proposalCount: j._count.proposals,
    createdAt: j.createdAt.toISOString(),
  };
}

const jobInclude = {
  client: { select: { profile: { select: { displayName: true, avatarPath: true, updatedAt: true } } } },
  _count: { select: { proposals: true } },
} as const;

/**
 * GET /api/jobs — public listing with search/filter (Day 9).
 * ?q= text search  ?category=  ?skill=  ?minBudget= / ?maxBudget= (cents)
 * ?mine=1 — the calling client's own jobs (any status)
 */
jobsRouter.get('/', async (req, res) => {
  const { q, category, skill, minBudget, maxBudget } = req.query as Record<string, string>;

  // Public listing shows OPEN jobs only; own jobs live at /mine with auth.
  const where: Record<string, unknown> = { status: 'OPEN' };
  if (q) where.OR = [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }];
  if (category) where.category = category;
  if (skill) where.skills = { has: skill };
  const budget: Record<string, number> = {};
  if (minBudget && Number.isInteger(+minBudget)) budget.gte = +minBudget;
  if (maxBudget && Number.isInteger(+maxBudget)) budget.lte = +maxBudget;
  if (Object.keys(budget).length) where.budgetCents = budget;

  const rows = await prisma.job.findMany({
    where,
    include: jobInclude,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(rows.map(toJobDto));
});

/** GET /api/jobs/mine — client dashboard (Day 9). */
jobsRouter.get('/mine', requireAuth, requireRole('CLIENT'), async (req, res) => {
  const rows = await prisma.job.findMany({
    where: { clientId: req.user!.id },
    include: jobInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows.map(toJobDto));
});

/** GET /api/jobs/:jobId */
jobsRouter.get('/:jobId', async (req, res) => {
  const { jobId } = req.params as { jobId: string };
  if (!z.string().uuid().safeParse(jobId).success) throw ApiError.badRequest('Invalid job id');

  const job = await prisma.job.findUnique({ where: { id: jobId }, include: jobInclude });
  if (!job) throw ApiError.notFound('Job not found');
  res.json(toJobDto(job));
});

/** POST /api/jobs — client-only (Day 6). */
jobsRouter.post(
  '/',
  requireAuth,
  requireRole('CLIENT'),
  validateBody(createJobSchema),
  async (req, res) => {
    const job = await prisma.job.create({
      data: { ...req.body, clientId: req.user!.id },
      include: jobInclude,
    });
    res.status(201).json(toJobDto(job));
  },
);

/** POST /api/jobs/:jobId/close — stop receiving proposals. */
jobsRouter.post('/:jobId/close', requireAuth, requireRole('CLIENT'), async (req, res) => {
  const { jobId } = req.params as { jobId: string };
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { clientId: true } });
  if (!job) throw ApiError.notFound('Job not found');
  // Ownership, not just role: any client is a CLIENT, only the poster owns it.
  if (job.clientId !== req.user!.id) throw ApiError.forbidden('Not your job');

  await prisma.job.update({ where: { id: jobId }, data: { status: 'CLOSED' } });
  res.status(204).send();
});
