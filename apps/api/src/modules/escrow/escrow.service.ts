import type { Prisma } from '@prisma/client';
import type { WorkRecordClaims } from '@trustlance/shared-types';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/api-error.js';
import { env } from '../../config/env.js';
import { milestoneEscrowCents, walletBalanceCents } from './ledger.service.js';
import { signWorkRecord } from '../reputation/signing.service.js';
import { recomputeTrustScore } from '../reputation/trust-score.service.js';
import { notify } from '../notifications/notifications.service.js';
import { emitToContract } from '../../realtime/socket.js';

/**
 * The escrow state machine (§10.2).
 *
 * Ground rules, learned the hard way in Sprint 1's token rotation:
 *
 *  1. Every transition runs inside ONE transaction holding a row lock
 *     (SELECT ... FOR UPDATE) on the milestone. Concurrent transitions —
 *     including the auto-release worker racing a human dispute at the
 *     deadline — serialize on that lock; the loser re-reads state and gets a
 *     clean INVALID_TRANSITION instead of double-moving money.
 *  2. Ledger writes and the state change commit together or not at all.
 *  3. Compensating writes (nothing here yet, but dispute flows) never happen
 *     inside a transaction that is about to throw.
 *  4. Side effects that are merely *derived* (trust score) or *cosmetic*
 *     (notifications, socket events) run after commit.
 */

type Tx = Prisma.TransactionClient;

type MilestoneWithContract = Prisma.MilestoneGetPayload<{
  include: { contract: true };
}>;

/** Allowed transitions. Anything not listed is rejected — the Day 12 guard. */
const TRANSITIONS: Record<string, string[]> = {
  CREATED: ['FUNDED', 'CANCELLED'],
  FUNDED: ['IN_PROGRESS', 'DISPUTED', 'CANCELLED'],
  IN_PROGRESS: ['SUBMITTED', 'DISPUTED'],
  SUBMITTED: ['RELEASED', 'IN_PROGRESS', 'DISPUTED'], // rework loop included
  DISPUTED: ['RESOLVED'],
  RELEASED: [],
  RESOLVED: [],
  CANCELLED: [],
};

function assertTransition(from: string, to: string): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new ApiError(409, 'INVALID_TRANSITION', `Cannot go from ${from} to ${to}`);
  }
}

/**
 * Locks the milestone row and hands the caller a transaction to work in.
 * The raw SELECT ... FOR UPDATE is the serialization point for all of escrow.
 */
async function withMilestoneLock<T>(
  milestoneId: string,
  fn: (tx: Tx, milestone: MilestoneWithContract) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM milestones WHERE id = ${milestoneId}::uuid FOR UPDATE`;
      const milestone = await tx.milestone.findUnique({
        where: { id: milestoneId },
        include: { contract: true },
      });
      if (!milestone) throw ApiError.notFound('Milestone not found');
      return fn(tx, milestone);
    },
    { timeout: 15_000 },
  );
}

/**
 * Idempotency (Day 14): if this key already produced a ledger row, the request
 * is a retry — succeed quietly without moving money again.
 */
async function alreadyProcessed(tx: Tx, idempotencyKey: string | undefined): Promise<boolean> {
  if (!idempotencyKey) return false;
  const existing = await tx.escrowTransaction.findUnique({ where: { idempotencyKey } });
  return existing !== null;
}

/** Demo-mode wallet top-up: an external -> wallet DEPOSIT row. */
export async function deposit(userId: string, amountCents: number): Promise<void> {
  await prisma.escrowTransaction.create({
    data: { type: 'DEPOSIT', amountCents, toUserId: userId, note: 'Demo wallet top-up' },
  });
}

/** CREATED -> FUNDED. Client locks the milestone amount out of their wallet. */
export async function fundMilestone(
  milestoneId: string,
  clientId: string,
  idempotencyKey?: string,
): Promise<void> {
  await withMilestoneLock(milestoneId, async (tx, m) => {
    if (m.contract.clientId !== clientId) throw ApiError.forbidden('Only the client funds escrow');
    if (await alreadyProcessed(tx, idempotencyKey)) return;
    assertTransition(m.state, 'FUNDED');

    /*
     * The milestone lock doesn't serialize the *wallet* — two concurrent funds
     * of different milestones from one wallet could both read a sufficient
     * balance. An advisory lock keyed on the wallet closes that hole.
     */
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'wallet:' + clientId}))`;

    const balance = await walletBalanceCents(clientId, tx);
    if (balance < m.amountCents) {
      throw new ApiError(
        409,
        'INSUFFICIENT_FUNDS',
        `Wallet holds ${balance} cents; milestone needs ${m.amountCents}. Top up first.`,
      );
    }

    await tx.escrowTransaction.create({
      data: {
        type: 'FUND',
        amountCents: m.amountCents,
        milestoneId,
        fromUserId: clientId,
        idempotencyKey: idempotencyKey ?? null,
        note: `Fund "${m.title}"`,
      },
    });
    await tx.milestone.update({ where: { id: milestoneId }, data: { state: 'FUNDED' } });
  });

  const m = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    include: { contract: true },
  });
  if (m) {
    await notify(m.contract.freelancerId, 'milestone:funded', {
      title: `Escrow funded for "${m.title}" — you can start work`,
      link: `/contracts/${m.contractId}`,
    });
    emitToContract(m.contractId, 'milestone:update', { milestoneId, state: 'FUNDED' });
  }
}

/** FUNDED -> IN_PROGRESS. Freelancer starts work. */
export async function startMilestone(milestoneId: string, freelancerId: string): Promise<void> {
  const contractId = await withMilestoneLock(milestoneId, async (tx, m) => {
    if (m.contract.freelancerId !== freelancerId) throw ApiError.forbidden('Only the freelancer starts work');
    assertTransition(m.state, 'IN_PROGRESS');
    await tx.milestone.update({ where: { id: milestoneId }, data: { state: 'IN_PROGRESS' } });
    return m.contractId;
  });
  emitToContract(contractId, 'milestone:update', { milestoneId, state: 'IN_PROGRESS' });
}

/** IN_PROGRESS -> SUBMITTED. Sets the auto-release deadline (Day 13). */
export async function submitMilestone(
  milestoneId: string,
  freelancerId: string,
  note: string,
): Promise<void> {
  const info = await withMilestoneLock(milestoneId, async (tx, m) => {
    if (m.contract.freelancerId !== freelancerId) throw ApiError.forbidden('Only the freelancer submits');
    assertTransition(m.state, 'SUBMITTED');

    const autoReleaseAt = new Date(Date.now() + env.AUTO_RELEASE_DAYS * 86_400_000);
    await tx.milestone.update({
      where: { id: milestoneId },
      data: { state: 'SUBMITTED', submissionNote: note, submittedAt: new Date(), autoReleaseAt },
    });
    return { contractId: m.contractId, clientId: m.contract.clientId, title: m.title };
  });

  await notify(info.clientId, 'milestone:submitted', {
    title: `Deliverable submitted for "${info.title}" — review it`,
    link: `/contracts/${info.contractId}`,
  });
  emitToContract(info.contractId, 'milestone:update', { milestoneId, state: 'SUBMITTED' });
}

/** SUBMITTED -> IN_PROGRESS. Client requests changes — the rework loop. */
export async function requestChanges(
  milestoneId: string,
  clientId: string,
  note: string,
): Promise<void> {
  const info = await withMilestoneLock(milestoneId, async (tx, m) => {
    if (m.contract.clientId !== clientId) throw ApiError.forbidden('Only the client requests changes');
    assertTransition(m.state, 'IN_PROGRESS');
    await tx.milestone.update({
      where: { id: milestoneId },
      // Clearing autoReleaseAt matters: otherwise the worker would auto-pay a
      // milestone the client explicitly sent back.
      data: { state: 'IN_PROGRESS', autoReleaseAt: null, feedback: note },
    });
    return { contractId: m.contractId, freelancerId: m.contract.freelancerId, title: m.title };
  });

  await notify(info.freelancerId, 'milestone:changes', {
    title: `Changes requested on "${info.title}"`,
    link: `/contracts/${info.contractId}`,
  });
  emitToContract(info.contractId, 'milestone:update', { milestoneId, state: 'IN_PROGRESS' });
}

/**
 * SUBMITTED -> RELEASED. The hinge of the whole platform: one transaction
 * writes the RELEASE ledger row, flips the state, AND mints the signed work
 * record (§10.1). If any of those fails, none happened.
 *
 * `actor` distinguishes the client approving from the auto-release worker
 * approving on their behalf after silence.
 */
export async function approveMilestone(
  milestoneId: string,
  actor: { clientId: string } | { system: true },
  opts: { rating?: number; feedback?: string; idempotencyKey?: string } = {},
): Promise<void> {
  const info = await withMilestoneLock(milestoneId, async (tx, m) => {
    if ('clientId' in actor && m.contract.clientId !== actor.clientId) {
      throw ApiError.forbidden('Only the client approves');
    }
    if (await alreadyProcessed(tx, opts.idempotencyKey)) return null;
    assertTransition(m.state, 'RELEASED');

    const escrow = await milestoneEscrowCents(m.id, tx);
    // Invariant, not input validation: if this trips, the ledger and the state
    // machine disagree and releasing would print money. Fail loudly.
    if (escrow !== m.amountCents) {
      throw new ApiError(500, 'LEDGER_MISMATCH', `Escrow holds ${escrow}, expected ${m.amountCents}`);
    }

    const completedAt = new Date();
    await tx.escrowTransaction.create({
      data: {
        type: 'RELEASE',
        amountCents: m.amountCents,
        milestoneId: m.id,
        toUserId: m.contract.freelancerId,
        idempotencyKey: opts.idempotencyKey ?? null,
        note: 'system' in actor ? 'Auto-released after review window' : `Release "${m.title}"`,
      },
    });
    await tx.milestone.update({
      where: { id: m.id },
      data: {
        state: 'RELEASED',
        approvedAt: completedAt,
        rating: opts.rating ?? null,
        feedback: opts.feedback ?? null,
        autoReleaseAt: null,
      },
    });

    // Mint the portable reputation record in the same commit.
    const claims: WorkRecordClaims = {
      v: 1,
      platform: 'trustlance',
      freelancerId: m.contract.freelancerId,
      clientId: m.contract.clientId,
      contractId: m.contractId,
      milestoneId: m.id,
      title: m.title,
      amountCents: m.amountCents,
      rating: opts.rating ?? null,
      completedAt: completedAt.toISOString(),
    };
    const jws = await signWorkRecord(claims);
    await tx.workRecord.create({
      data: {
        milestoneId: m.id,
        freelancerId: m.contract.freelancerId,
        clientId: m.contract.clientId,
        contractId: m.contractId,
        jws,
        payload: claims as unknown as Prisma.InputJsonValue,
      },
    });

    // Contract completes when its last milestone reaches a terminal state.
    const open = await tx.milestone.count({
      where: { contractId: m.contractId, state: { notIn: ['RELEASED', 'RESOLVED', 'CANCELLED'] }, id: { not: m.id } },
    });
    if (open === 0) {
      await tx.contract.update({ where: { id: m.contractId }, data: { status: 'COMPLETED' } });
    }

    return { contractId: m.contractId, freelancerId: m.contract.freelancerId, title: m.title };
  });

  if (info) {
    // Derived + cosmetic effects, after commit.
    await recomputeTrustScore(info.freelancerId);
    await notify(info.freelancerId, 'milestone:released', {
      title: `Payment released for "${info.title}" 🎉`,
      link: `/contracts/${info.contractId}`,
    });
    emitToContract(info.contractId, 'milestone:update', { milestoneId, state: 'RELEASED' });
  }
}

/** CREATED -> CANCELLED (nothing to refund) or FUNDED -> CANCELLED (full refund). */
export async function cancelMilestone(milestoneId: string, clientId: string): Promise<void> {
  const info = await withMilestoneLock(milestoneId, async (tx, m) => {
    if (m.contract.clientId !== clientId) throw ApiError.forbidden('Only the client cancels');
    assertTransition(m.state, 'CANCELLED');

    if (m.state === 'FUNDED') {
      const escrow = await milestoneEscrowCents(m.id, tx);
      if (escrow > 0) {
        await tx.escrowTransaction.create({
          data: {
            type: 'REFUND',
            amountCents: escrow,
            milestoneId: m.id,
            toUserId: clientId,
            note: `Cancelled "${m.title}"`,
          },
        });
      }
    }
    await tx.milestone.update({ where: { id: m.id }, data: { state: 'CANCELLED' } });
    return { contractId: m.contractId, freelancerId: m.contract.freelancerId, title: m.title };
  });

  await notify(info.freelancerId, 'milestone:cancelled', {
    title: `Milestone "${info.title}" was cancelled`,
    link: `/contracts/${info.contractId}`,
  });
  emitToContract(info.contractId, 'milestone:update', { milestoneId, state: 'CANCELLED' });
}

/**
 * FUNDED | IN_PROGRESS | SUBMITTED -> DISPUTED. Either party (§9 — the doc's
 * diagram only allowed the client, but a freelancer facing a ghosting client
 * needs this path too). Locks the escrow until an arbitrator rules.
 */
export async function openDispute(
  milestoneId: string,
  raisedById: string,
  reason: string,
): Promise<string> {
  const info = await withMilestoneLock(milestoneId, async (tx, m) => {
    const isParty = m.contract.clientId === raisedById || m.contract.freelancerId === raisedById;
    if (!isParty) throw ApiError.forbidden('Only a contract party can raise a dispute');
    assertTransition(m.state, 'DISPUTED');

    const dispute = await tx.dispute.create({
      data: { milestoneId: m.id, raisedById, reason },
      select: { id: true },
    });
    await tx.milestone.update({
      where: { id: m.id },
      // Freeze the auto-release clock — a disputed milestone must never auto-pay.
      data: { state: 'DISPUTED', autoReleaseAt: null },
    });
    return { disputeId: dispute.id, m };
  });

  const other =
    info.m.contract.clientId === raisedById ? info.m.contract.freelancerId : info.m.contract.clientId;
  await notify(other, 'dispute:opened', {
    title: `Dispute opened on "${info.m.title}"`,
    link: `/contracts/${info.m.contractId}`,
  });
  emitToContract(info.m.contractId, 'milestone:update', { milestoneId, state: 'DISPUTED' });
  return info.disputeId;
}

/**
 * DISPUTED -> RESOLVED. Arbitrator splits the escrow: freelancerPct% releases,
 * the remainder refunds (Sprint 5 Day 25). Both ledger rows and the state flip
 * commit atomically.
 */
export async function resolveDispute(
  disputeId: string,
  arbitratorId: string,
  freelancerPct: number,
  note: string,
): Promise<void> {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    select: { milestoneId: true, status: true },
  });
  if (!dispute) throw ApiError.notFound('Dispute not found');
  if (dispute.status !== 'OPEN') throw ApiError.conflict('Dispute already resolved');

  const info = await withMilestoneLock(dispute.milestoneId, async (tx, m) => {
    assertTransition(m.state, 'RESOLVED');

    const escrow = await milestoneEscrowCents(m.id, tx);
    const toFreelancer = Math.round((escrow * freelancerPct) / 100);
    const toClient = escrow - toFreelancer; // remainder — the two always sum exactly

    if (toFreelancer > 0) {
      await tx.escrowTransaction.create({
        data: {
          type: 'RELEASE',
          amountCents: toFreelancer,
          milestoneId: m.id,
          toUserId: m.contract.freelancerId,
          note: `Dispute resolution: ${freelancerPct}% to freelancer`,
        },
      });
    }
    if (toClient > 0) {
      await tx.escrowTransaction.create({
        data: {
          type: 'REFUND',
          amountCents: toClient,
          milestoneId: m.id,
          toUserId: m.contract.clientId,
          note: `Dispute resolution: ${100 - freelancerPct}% refunded`,
        },
      });
    }

    await tx.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'RESOLVED',
        freelancerPct,
        resolutionNote: note,
        resolvedById: arbitratorId,
        resolvedAt: new Date(),
      },
    });
    await tx.milestone.update({ where: { id: m.id }, data: { state: 'RESOLVED' } });

    const open = await tx.milestone.count({
      where: { contractId: m.contractId, state: { notIn: ['RELEASED', 'RESOLVED', 'CANCELLED'] }, id: { not: m.id } },
    });
    if (open === 0) {
      await tx.contract.update({ where: { id: m.contractId }, data: { status: 'COMPLETED' } });
    }
    return m;
  });

  await recomputeTrustScore(info.contract.freelancerId);
  for (const uid of [info.contract.clientId, info.contract.freelancerId]) {
    await notify(uid, 'dispute:resolved', {
      title: `Dispute on "${info.title}" resolved: ${freelancerPct}% to freelancer`,
      link: `/contracts/${info.contractId}`,
    });
  }
  emitToContract(info.contractId, 'milestone:update', {
    milestoneId: dispute.milestoneId,
    state: 'RESOLVED',
  });
}

/**
 * Auto-release sweep (Day 13): approve every SUBMITTED milestone whose review
 * window lapsed. Called by the BullMQ worker; each milestone goes through the
 * same locked approve path a human uses, so the worker can never race a
 * just-arrived dispute into a double state change.
 */
export async function sweepAutoReleases(): Promise<number> {
  const due = await prisma.milestone.findMany({
    where: { state: 'SUBMITTED', autoReleaseAt: { lte: new Date() } },
    select: { id: true },
  });
  let released = 0;
  for (const { id } of due) {
    try {
      await approveMilestone(id, { system: true });
      released++;
    } catch (err) {
      // A dispute may have beaten us to the lock — that is the system working.
      if (!(err instanceof ApiError && err.code === 'INVALID_TRANSITION')) {
        console.error(`[auto-release] milestone ${id}:`, (err as Error).message);
      }
    }
  }
  return released;
}
