import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

/**
 * Ledger arithmetic (§10.2).
 *
 * There is no balance column anywhere. Every balance is a SUM over the
 * append-only escrow_transactions table, computed inside whatever transaction
 * the caller is running. Two sources of truth cannot drift when there is only
 * one source of truth.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/** Spendable wallet balance: everything credited minus everything sent to escrow. */
export async function walletBalanceCents(userId: string, db: Db = prisma): Promise<number> {
  const [credits, debits] = await Promise.all([
    db.escrowTransaction.aggregate({
      where: { toUserId: userId },
      _sum: { amountCents: true },
    }),
    db.escrowTransaction.aggregate({
      where: { fromUserId: userId },
      _sum: { amountCents: true },
    }),
  ]);
  return (credits._sum.amountCents ?? 0) - (debits._sum.amountCents ?? 0);
}

/** Funds currently locked in one milestone's escrow. */
export async function milestoneEscrowCents(milestoneId: string, db: Db = prisma): Promise<number> {
  const [inflow, outflow] = await Promise.all([
    db.escrowTransaction.aggregate({
      where: { milestoneId, type: 'FUND' },
      _sum: { amountCents: true },
    }),
    db.escrowTransaction.aggregate({
      where: { milestoneId, type: { in: ['RELEASE', 'REFUND'] } },
      _sum: { amountCents: true },
    }),
  ]);
  return (inflow._sum.amountCents ?? 0) - (outflow._sum.amountCents ?? 0);
}

/** Total a user has locked across all live escrows (client side of FUND). */
export async function userInEscrowCents(userId: string, db: Db = prisma): Promise<number> {
  const funded = await db.escrowTransaction.aggregate({
    where: { fromUserId: userId, type: 'FUND' },
    _sum: { amountCents: true },
  });
  const returned = await db.escrowTransaction.aggregate({
    where: {
      type: { in: ['RELEASE', 'REFUND'] },
      milestone: { contract: { clientId: userId } },
    },
    _sum: { amountCents: true },
  });
  return (funded._sum.amountCents ?? 0) - (returned._sum.amountCents ?? 0);
}
