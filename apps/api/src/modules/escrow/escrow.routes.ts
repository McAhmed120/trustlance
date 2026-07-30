import { Router } from 'express';
import { z } from 'zod';
import type { WalletDto } from '@trustlance/shared-types';
import { prisma } from '../../lib/prisma.js';
import { requireAuth, requireRole } from '../../middleware/require-auth.js';
import { validateBody } from '../../middleware/validate.js';
import { walletBalanceCents, userInEscrowCents } from './ledger.service.js';
import * as escrow from './escrow.service.js';

export const walletRouter: Router = Router();
export const milestonesRouter: Router = Router();
export const disputesRouter: Router = Router();

// ---------------------------------------------------------------- wallet ----

const depositSchema = z
  .object({
    amountCents: z
      .number()
      .int('Amount must be integer cents')
      .positive()
      .max(100_000_00, 'Demo top-ups are capped at $100,000'),
  })
  .strict();

/** GET /api/wallet — balance + ledger (both derived from escrow_transactions). */
walletRouter.get('/', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const [balanceCents, inEscrowCents, rows] = await Promise.all([
    walletBalanceCents(userId),
    userInEscrowCents(userId),
    prisma.escrowTransaction.findMany({
      where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);
  const body: WalletDto = {
    balanceCents,
    inEscrowCents,
    ledger: rows.map((r) => ({
      id: r.id,
      type: r.type,
      // Sign from this user's perspective: outgoing FUND rows show negative.
      amountCents: r.fromUserId === userId ? -r.amountCents : r.amountCents,
      milestoneId: r.milestoneId,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    })),
  };
  res.json(body);
});

/** POST /api/wallet/deposit — demo-mode top-up (Day 15). */
walletRouter.post('/deposit', requireAuth, validateBody(depositSchema), async (req, res) => {
  await escrow.deposit(req.user!.id, req.body.amountCents);
  res.status(201).json({ balanceCents: await walletBalanceCents(req.user!.id) });
});

// ------------------------------------------------------------ milestones ----

const idempotencySchema = z.object({ idempotencyKey: z.string().uuid().optional() }).strict();
const noteSchema = z.object({ note: z.string().min(3).max(5000).trim() }).strict();
const approveSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    feedback: z.string().max(2000).trim().optional(),
    idempotencyKey: z.string().uuid().optional(),
  })
  .strict();
const disputeSchema = z.object({ reason: z.string().min(10).max(5000).trim() }).strict();

function param(req: { params: unknown }, key: string): string {
  return (req.params as Record<string, string>)[key]!;
}

/** POST /api/milestones/:id/fund (client) */
milestonesRouter.post('/:id/fund', requireAuth, validateBody(idempotencySchema), async (req, res) => {
  await escrow.fundMilestone(param(req, 'id'), req.user!.id, req.body.idempotencyKey);
  res.status(200).json({ ok: true });
});

/** POST /api/milestones/:id/start (freelancer) */
milestonesRouter.post('/:id/start', requireAuth, async (req, res) => {
  await escrow.startMilestone(param(req, 'id'), req.user!.id);
  res.status(200).json({ ok: true });
});

/** POST /api/milestones/:id/submit (freelancer) */
milestonesRouter.post('/:id/submit', requireAuth, validateBody(noteSchema), async (req, res) => {
  await escrow.submitMilestone(param(req, 'id'), req.user!.id, req.body.note);
  res.status(200).json({ ok: true });
});

/** POST /api/milestones/:id/approve (client) — releases escrow, mints record. */
milestonesRouter.post('/:id/approve', requireAuth, validateBody(approveSchema), async (req, res) => {
  await escrow.approveMilestone(param(req, 'id'), { clientId: req.user!.id }, req.body);
  res.status(200).json({ ok: true });
});

/** POST /api/milestones/:id/request-changes (client) — rework loop. */
milestonesRouter.post('/:id/request-changes', requireAuth, validateBody(noteSchema), async (req, res) => {
  await escrow.requestChanges(param(req, 'id'), req.user!.id, req.body.note);
  res.status(200).json({ ok: true });
});

/** POST /api/milestones/:id/cancel (client) */
milestonesRouter.post('/:id/cancel', requireAuth, async (req, res) => {
  await escrow.cancelMilestone(param(req, 'id'), req.user!.id);
  res.status(200).json({ ok: true });
});

/** POST /api/milestones/:id/dispute (either party) */
milestonesRouter.post('/:id/dispute', requireAuth, validateBody(disputeSchema), async (req, res) => {
  const disputeId = await escrow.openDispute(param(req, 'id'), req.user!.id, req.body.reason);
  res.status(201).json({ disputeId });
});

// -------------------------------------------------------------- disputes ----

const resolveSchema = z
  .object({
    freelancerPct: z.number().int().min(0).max(100),
    note: z.string().min(10).max(5000).trim(),
  })
  .strict();

/** GET /api/disputes — arbitrator queue (Sprint 5 Day 24). */
disputesRouter.get('/', requireAuth, requireRole('ADMIN'), async (_req, res) => {
  const rows = await prisma.dispute.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'asc' },
    include: {
      milestone: { include: { contract: { include: { job: { select: { title: true } } } } } },
    },
  });
  res.json(
    rows.map((d) => ({
      id: d.id,
      reason: d.reason,
      raisedById: d.raisedById,
      createdAt: d.createdAt.toISOString(),
      milestone: {
        id: d.milestone.id,
        title: d.milestone.title,
        amountCents: d.milestone.amountCents,
        state: d.milestone.state,
        contractId: d.milestone.contractId,
        jobTitle: d.milestone.contract.job.title,
        clientId: d.milestone.contract.clientId,
        freelancerId: d.milestone.contract.freelancerId,
      },
    })),
  );
});

/**
 * GET /api/disputes/:id — the Day 24 evidence bundle.
 * Auto-attaches chat, files, and time logs for the disputed contract so the
 * arbitrator rules on evidence, not on whoever wrote the angrier email.
 */
disputesRouter.get('/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { id } = req.params as { id: string };
  const dispute = await prisma.dispute.findUnique({
    where: { id },
    include: { milestone: { include: { contract: { include: { job: { select: { title: true } } } } } } },
  });
  if (!dispute) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Dispute not found' } });
    return;
  }
  const contractId = dispute.milestone.contractId;
  const [messages, files, timeEntries, escrowCents] = await Promise.all([
    prisma.message.findMany({ where: { contractId }, orderBy: { createdAt: 'asc' }, take: 500 }),
    prisma.fileAttachment.findMany({ where: { contractId }, orderBy: { createdAt: 'asc' } }),
    prisma.timeEntry.findMany({ where: { contractId }, orderBy: { createdAt: 'asc' } }),
    import('./ledger.service.js').then((m) => m.milestoneEscrowCents(dispute.milestoneId)),
  ]);

  res.json({
    id: dispute.id,
    reason: dispute.reason,
    raisedById: dispute.raisedById,
    status: dispute.status,
    createdAt: dispute.createdAt.toISOString(),
    milestone: {
      id: dispute.milestone.id,
      title: dispute.milestone.title,
      description: dispute.milestone.description,
      amountCents: dispute.milestone.amountCents,
      escrowCents,
      state: dispute.milestone.state,
      submissionNote: dispute.milestone.submissionNote,
      contractId,
      jobTitle: dispute.milestone.contract.job.title,
      clientId: dispute.milestone.contract.clientId,
      freelancerId: dispute.milestone.contract.freelancerId,
    },
    evidence: {
      messages: messages.map((m) => ({ senderId: m.senderId, body: m.body, at: m.createdAt.toISOString() })),
      files: files.map((f) => ({ id: f.id, filename: f.filename, version: f.version, sizeBytes: f.sizeBytes })),
      timeEntries: timeEntries.map((t) => ({
        startedAt: t.startedAt.toISOString(),
        endedAt: t.endedAt?.toISOString() ?? null,
        note: t.note,
      })),
    },
  });
});

/** POST /api/disputes/:id/resolve (admin) — the §9 fund split. */
disputesRouter.post(
  '/:id/resolve',
  requireAuth,
  requireRole('ADMIN'),
  validateBody(resolveSchema),
  async (req, res) => {
    await escrow.resolveDispute(param(req, 'id'), req.user!.id, req.body.freelancerPct, req.body.note);
    res.status(200).json({ ok: true });
  },
);
