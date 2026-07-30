import { Router } from 'express';
import { z } from 'zod';
import type { ProposalDto } from '@trustlance/shared-types';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/api-error.js';
import { requireAuth, requireRole } from '../../middleware/require-auth.js';
import { validateBody } from '../../middleware/validate.js';
import { notify } from '../notifications/notifications.service.js';
import { avatarUrlFor } from '../users/avatar.js';

export const proposalsRouter: Router = Router();

const submitSchema = z
  .object({
    coverLetter: z.string().min(20).max(5000).trim(),
    amountCents: z.number().int('Amount must be integer cents').positive().max(10_000_000_00),
  })
  .strict();

const milestonePlanSchema = z
  .object({
    milestones: z
      .array(
        z
          .object({
            title: z.string().min(3).max(120).trim(),
            description: z.string().max(2000).trim().optional(),
            amountCents: z.number().int().positive(),
            dueDate: z.string().datetime().optional(),
          })
          .strict(),
      )
      .min(1, 'A contract needs at least one milestone')
      .max(20),
  })
  .strict();

type ProposalRow = {
  id: string;
  jobId: string;
  freelancerId: string;
  coverLetter: string;
  amountCents: number;
  status: string;
  createdAt: Date;
  job?: { title: string };
  freelancer: { trustScore: number | null; profile: { displayName: string; avatarPath: string | null; updatedAt: Date } | null };
};

function toDto(p: ProposalRow): ProposalDto {
  return {
    id: p.id,
    jobId: p.jobId,
    jobTitle: p.job?.title,
    freelancerId: p.freelancerId,
    freelancerName: p.freelancer.profile?.displayName ?? 'Freelancer',
    freelancerAvatarUrl: avatarUrlFor(p.freelancerId, p.freelancer.profile),
    freelancerTrustScore: p.freelancer.trustScore,
    coverLetter: p.coverLetter,
    amountCents: p.amountCents,
    status: p.status as ProposalDto['status'],
    createdAt: p.createdAt.toISOString(),
  };
}

const proposalInclude = {
  job: { select: { title: true } },
  freelancer: { select: { trustScore: true, profile: { select: { displayName: true, avatarPath: true, updatedAt: true } } } },
} as const;

/** POST /api/jobs/:jobId/proposals — freelancer bids (Day 7). */
proposalsRouter.post(
  '/jobs/:jobId/proposals',
  requireAuth,
  requireRole('FREELANCER'),
  validateBody(submitSchema),
  async (req, res) => {
    const { jobId } = req.params as { jobId: string };
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true, clientId: true, title: true },
    });
    if (!job) throw ApiError.notFound('Job not found');
    if (job.status !== 'OPEN') throw ApiError.conflict('This job is no longer accepting proposals');
    if (job.clientId === req.user!.id) throw ApiError.forbidden('You cannot bid on your own job');

    try {
      const proposal = await prisma.proposal.create({
        data: { jobId, freelancerId: req.user!.id, ...req.body },
        include: proposalInclude,
      });
      await notify(job.clientId, 'proposal:new', {
        title: `New proposal on "${job.title}"`,
        link: `/jobs/${jobId}`,
      });
      res.status(201).json(toDto(proposal));
    } catch (err) {
      // Unique (jobId, freelancerId) — a second bid is a conflict, not a crash.
      if ((err as { code?: string }).code === 'P2002') {
        throw ApiError.conflict('You already submitted a proposal for this job');
      }
      throw err;
    }
  },
);

/** GET /api/jobs/:jobId/proposals — job owner reviews bids. */
proposalsRouter.get('/jobs/:jobId/proposals', requireAuth, async (req, res) => {
  const { jobId } = req.params as { jobId: string };
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { clientId: true } });
  if (!job) throw ApiError.notFound('Job not found');
  if (job.clientId !== req.user!.id) throw ApiError.forbidden('Only the job owner can see proposals');

  const rows = await prisma.proposal.findMany({
    where: { jobId },
    include: proposalInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows.map(toDto));
});

/** GET /api/proposals/mine — freelancer dashboard (Day 9). */
proposalsRouter.get('/proposals/mine', requireAuth, requireRole('FREELANCER'), async (req, res) => {
  const rows = await prisma.proposal.findMany({
    where: { freelancerId: req.user!.id },
    include: proposalInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows.map(toDto));
});

/** POST /api/proposals/:id/reject */
proposalsRouter.post('/proposals/:id/reject', requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const proposal = await prisma.proposal.findUnique({
    where: { id },
    select: { status: true, freelancerId: true, job: { select: { clientId: true, title: true } } },
  });
  if (!proposal) throw ApiError.notFound('Proposal not found');
  if (proposal.job.clientId !== req.user!.id) throw ApiError.forbidden('Not your job');
  if (proposal.status !== 'PENDING') throw ApiError.conflict(`Proposal is already ${proposal.status}`);

  await prisma.proposal.update({ where: { id }, data: { status: 'REJECTED' } });
  await notify(proposal.freelancerId, 'proposal:rejected', {
    title: `Your proposal on "${proposal.job.title}" was declined`,
  });
  res.status(204).send();
});

/**
 * POST /api/proposals/:id/accept — the Day 8 pivot: proposal becomes contract.
 *
 * The client supplies the milestone plan here (the "milestone wizard" output).
 * Contract + milestones + proposal status + job closure all commit in ONE
 * transaction: a contract with no milestones, or an accepted proposal with no
 * contract, would leave the marketplace in a state no screen can render.
 */
proposalsRouter.post(
  '/proposals/:id/accept',
  requireAuth,
  requireRole('CLIENT'),
  validateBody(milestonePlanSchema),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const { milestones } = req.body as z.infer<typeof milestonePlanSchema>;

    const proposal = await prisma.proposal.findUnique({
      where: { id },
      select: {
        status: true,
        jobId: true,
        freelancerId: true,
        amountCents: true,
        job: { select: { clientId: true, title: true } },
      },
    });
    if (!proposal) throw ApiError.notFound('Proposal not found');
    if (proposal.job.clientId !== req.user!.id) throw ApiError.forbidden('Not your job');
    if (proposal.status !== 'PENDING') throw ApiError.conflict(`Proposal is already ${proposal.status}`);

    const total = milestones.reduce((s, m) => s + m.amountCents, 0);

    const contract = await prisma.$transaction(async (tx) => {
      const c = await tx.contract.create({
        data: {
          jobId: proposal.jobId,
          proposalId: id,
          clientId: req.user!.id,
          freelancerId: proposal.freelancerId,
          totalAmountCents: total,
          milestones: {
            create: milestones.map((m, index) => ({
              position: index,
              title: m.title,
              description: m.description ?? null,
              amountCents: m.amountCents,
              dueDate: m.dueDate ? new Date(m.dueDate) : null,
            })),
          },
        },
        select: { id: true },
      });
      await tx.proposal.update({ where: { id }, data: { status: 'ACCEPTED' } });
      // Close the job and reject the other pending bids in the same commit.
      await tx.job.update({ where: { id: proposal.jobId }, data: { status: 'CLOSED' } });
      await tx.proposal.updateMany({
        where: { jobId: proposal.jobId, status: 'PENDING', id: { not: id } },
        data: { status: 'REJECTED' },
      });
      return c;
    });

    await notify(proposal.freelancerId, 'proposal:accepted', {
      title: `Your proposal on "${proposal.job.title}" was accepted — contract created`,
      link: `/contracts/${contract.id}`,
    });
    res.status(201).json({ contractId: contract.id });
  },
);
