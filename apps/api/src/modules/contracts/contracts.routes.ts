import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { ContractDto, MilestoneDto } from '@trustlance/shared-types';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/api-error.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { milestoneEscrowCents } from '../escrow/ledger.service.js';

export const contractsRouter: Router = Router();

const contractInclude = {
  job: { select: { title: true } },
  milestones: { orderBy: { position: 'asc' as const }, include: { disputes: { where: { status: 'OPEN' as const } } } },
} as const;

type ContractRow = Prisma.ContractGetPayload<{ include: typeof contractInclude }>;

async function nameOf(userId: string): Promise<string> {
  const p = await prisma.profile.findUnique({ where: { userId }, select: { displayName: true } });
  return p?.displayName ?? 'User';
}

export async function toContractDto(c: ContractRow): Promise<ContractDto> {
  const milestones: MilestoneDto[] = await Promise.all(
    c.milestones.map(async (m) => ({
      id: m.id,
      contractId: m.contractId,
      title: m.title,
      description: m.description,
      amountCents: m.amountCents,
      dueDate: m.dueDate?.toISOString() ?? null,
      state: m.state as MilestoneDto['state'],
      submissionNote: m.submissionNote,
      submittedAt: m.submittedAt?.toISOString() ?? null,
      autoReleaseAt: m.autoReleaseAt?.toISOString() ?? null,
      approvedAt: m.approvedAt?.toISOString() ?? null,
      rating: m.rating,
      feedback: m.feedback,
      escrowCents: await milestoneEscrowCents(m.id),
      openDispute: m.disputes[0]
        ? {
            id: m.disputes[0].id,
            milestoneId: m.id,
            raisedById: m.disputes[0].raisedById,
            reason: m.disputes[0].reason,
            status: m.disputes[0].status as 'OPEN',
            freelancerPct: m.disputes[0].freelancerPct,
            resolutionNote: m.disputes[0].resolutionNote,
            resolvedAt: null,
            createdAt: m.disputes[0].createdAt.toISOString(),
          }
        : null,
    })),
  );

  return {
    id: c.id,
    jobId: c.jobId,
    jobTitle: c.job.title,
    clientId: c.clientId,
    clientName: await nameOf(c.clientId),
    freelancerId: c.freelancerId,
    freelancerName: await nameOf(c.freelancerId),
    totalAmountCents: c.totalAmountCents,
    status: c.status as ContractDto['status'],
    createdAt: c.createdAt.toISOString(),
    milestones,
  };
}

/** Loads a contract and enforces that the caller is a party (or an admin). */
export async function loadContractForParty(contractId: string, userId: string, role: string) {
  // Guard the id before it reaches Prisma. Without this, a malformed or
  // undefined id produces a 500 with a raw Prisma error — which in dev leaks
  // internal file paths and query text, and is the wrong status either way:
  // bad input is a 400.
  if (!z.string().uuid().safeParse(contractId).success) {
    throw ApiError.badRequest('Invalid contract id');
  }

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: contractInclude,
  });
  if (!contract) throw ApiError.notFound('Contract not found');
  const isParty = contract.clientId === userId || contract.freelancerId === userId;
  // Admin read access exists for arbitration (Sprint 5) — not for tampering:
  // no write endpoint accepts an admin outside dispute resolution.
  if (!isParty && role !== 'ADMIN') throw ApiError.forbidden('Not a party to this contract');
  return contract;
}

/** GET /api/contracts/mine — both dashboards (Day 9). */
contractsRouter.get('/mine', requireAuth, async (req, res) => {
  const rows = await prisma.contract.findMany({
    where: { OR: [{ clientId: req.user!.id }, { freelancerId: req.user!.id }] },
    include: contractInclude,
    orderBy: { createdAt: 'desc' },
  });
  res.json(await Promise.all(rows.map(toContractDto)));
});

/** GET /api/contracts/:id — the workspace. */
contractsRouter.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const contract = await loadContractForParty(id, req.user!.id, req.user!.role);
  res.json(await toContractDto(contract));
});
