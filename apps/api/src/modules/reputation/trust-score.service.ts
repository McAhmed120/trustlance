import { prisma } from '../../lib/prisma.js';

/**
 * Trust score (§10.3): a weighted function of completed contracts, average
 * rating, dispute rate, and account age. Recomputed after every completion and
 * every dispute resolution — never written by the user (see users.routes).
 *
 * Weights (out of 100):
 *   - rating quality   up to 60  (avg rating / 5; unrated completions count 4.0)
 *   - volume           up to 25  (1.25 per completed milestone, capped at 20)
 *   - account age      up to 15  (linear over the first year)
 *   - dispute penalty  −30 × (disputes involving them / completions, capped 1)
 */
export async function recomputeTrustScore(freelancerId: string): Promise<number | null> {
  const [records, disputes, user] = await Promise.all([
    prisma.workRecord.findMany({
      where: { freelancerId },
      select: { payload: true },
    }),
    prisma.dispute.count({
      where: { milestone: { contract: { freelancerId } } },
    }),
    prisma.user.findUnique({ where: { id: freelancerId }, select: { createdAt: true } }),
  ]);
  if (!user) return null;

  const completed = records.length;
  if (completed === 0 && disputes === 0) {
    // No history yet — a null score renders as "no completed contracts", which
    // is more honest than a fabricated number.
    await prisma.user.update({ where: { id: freelancerId }, data: { trustScore: null } });
    return null;
  }

  const ratings = records.map((r) => (r.payload as { rating: number | null }).rating ?? 4);
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;

  const ageDays = (Date.now() - user.createdAt.getTime()) / 86_400_000;
  const disputeRate = Math.min(disputes / Math.max(completed, 1), 1);

  const score = Math.max(
    0,
    Math.min(
      100,
      (avgRating / 5) * 60 + Math.min(completed, 20) * 1.25 + Math.min(ageDays / 365, 1) * 15 - disputeRate * 30,
    ),
  );

  const rounded = Math.round(score * 10) / 10;
  await prisma.user.update({ where: { id: freelancerId }, data: { trustScore: rounded } });
  return rounded;
}
