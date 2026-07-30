import { describe, expect, it, beforeEach } from '@jest/globals';
import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { sweepAutoReleases } from '../modules/escrow/escrow.service.js';
import { verifyWorkRecord } from '../modules/reputation/signing.service.js';

const app = createApp();

/** Registers a user and returns { token, id }. */
async function makeUser(role: 'FREELANCER' | 'CLIENT', tag: string) {
  const res = await request(app).post('/api/auth/register').send({
    email: `${tag}@example.com`,
    password: 'correct-horse-battery',
    role,
    displayName: tag,
  });
  return { token: res.body.accessToken as string, id: res.body.user.id as string };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Drives the marketplace to a funded, submitted milestone — the state most
 * scenarios branch from.
 */
async function submittedMilestone() {
  const client = await makeUser('CLIENT', 'client');
  const freelancer = await makeUser('FREELANCER', 'freelancer');

  await request(app).post('/api/wallet/deposit').set(auth(client.token)).send({ amountCents: 100_000 });

  const job = await request(app).post('/api/jobs').set(auth(client.token)).send({
    title: 'Build an escrow engine',
    description: 'Append-only ledger, state machine, the works. At least twenty chars.',
    category: 'web-development',
    budgetCents: 50_000,
  });

  const proposal = await request(app)
    .post(`/api/jobs/${job.body.id}/proposals`)
    .set(auth(freelancer.token))
    .send({ coverLetter: 'I have built exactly this before, twice.', amountCents: 50_000 });

  const accept = await request(app)
    .post(`/api/proposals/${proposal.body.id}/accept`)
    .set(auth(client.token))
    .send({ milestones: [{ title: 'Ledger + state machine', amountCents: 50_000 }] });

  const contractId = accept.body.contractId as string;
  const contract = await request(app).get(`/api/contracts/${contractId}`).set(auth(client.token));
  const milestoneId = contract.body.milestones[0].id as string;

  await request(app).post(`/api/milestones/${milestoneId}/fund`).set(auth(client.token)).send({});
  await request(app).post(`/api/milestones/${milestoneId}/start`).set(auth(freelancer.token)).send();
  await request(app)
    .post(`/api/milestones/${milestoneId}/submit`)
    .set(auth(freelancer.token))
    .send({ note: 'Done — see the attached ledger tests.' });

  return { client, freelancer, contractId, milestoneId, jobId: job.body.id as string };
}

async function balanceOf(token: string): Promise<number> {
  const res = await request(app).get('/api/wallet').set(auth(token));
  return res.body.balanceCents as number;
}

describe('marketplace flow (Sprint 2)', () => {
  it('walks job -> proposal -> contract with milestones', async () => {
    const { contractId, client } = await submittedMilestone();
    const res = await request(app).get(`/api/contracts/${contractId}`).set(auth(client.token));

    expect(res.status).toBe(200);
    expect(res.body.milestones).toHaveLength(1);
    expect(res.body.totalAmountCents).toBe(50_000);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('rejects a freelancer creating a job (RBAC)', async () => {
    const f = await makeUser('FREELANCER', 'f1');
    const res = await request(app).post('/api/jobs').set(auth(f.token)).send({
      title: 'Should not work',
      description: 'Freelancers cannot post jobs, this must 403.',
      category: 'other',
      budgetCents: 1000,
    });
    expect(res.status).toBe(403);
  });

  it('rejects a duplicate proposal from the same freelancer', async () => {
    const client = await makeUser('CLIENT', 'c2');
    const f = await makeUser('FREELANCER', 'f2');
    const job = await request(app).post('/api/jobs').set(auth(client.token)).send({
      title: 'One bid per freelancer',
      description: 'Second proposal should conflict with the unique index.',
      category: 'other',
      budgetCents: 1000,
    });
    const bid = { coverLetter: 'First bid, should be accepted fine.', amountCents: 900 };
    await request(app).post(`/api/jobs/${job.body.id}/proposals`).set(auth(f.token)).send(bid);
    const dup = await request(app).post(`/api/jobs/${job.body.id}/proposals`).set(auth(f.token)).send(bid);
    expect(dup.status).toBe(409);
  });

  it('keeps non-parties out of a contract workspace', async () => {
    const { contractId } = await submittedMilestone();
    const outsider = await makeUser('FREELANCER', 'outsider');
    const res = await request(app).get(`/api/contracts/${contractId}`).set(auth(outsider.token));
    expect(res.status).toBe(403);
  });
});

describe('escrow engine (Sprint 3)', () => {
  it('full happy path moves money correctly and mints a verifiable record', async () => {
    const { client, freelancer, milestoneId, contractId } = await submittedMilestone();

    // 100k deposited, 50k locked in escrow.
    expect(await balanceOf(client.token)).toBe(50_000);
    expect(await balanceOf(freelancer.token)).toBe(0);

    const approve = await request(app)
      .post(`/api/milestones/${milestoneId}/approve`)
      .set(auth(client.token))
      .send({ rating: 5, feedback: 'Flawless' });
    expect(approve.status).toBe(200);

    // Money arrived; escrow emptied; nothing printed or burned.
    expect(await balanceOf(client.token)).toBe(50_000);
    expect(await balanceOf(freelancer.token)).toBe(50_000);

    // The signed record exists and verifies with the public key alone.
    const record = await prisma.workRecord.findUnique({ where: { milestoneId } });
    expect(record).not.toBeNull();
    const verified = await verifyWorkRecord(record!.jws);
    expect(verified?.claims.amountCents).toBe(50_000);
    expect(verified?.claims.rating).toBe(5);

    // Trust score computed; contract completed.
    const user = await prisma.user.findUnique({ where: { id: freelancer.id } });
    expect(user!.trustScore).not.toBeNull();
    const contract = await prisma.contract.findUnique({ where: { id: contractId } });
    expect(contract!.status).toBe('COMPLETED');
  });

  it('rejects every out-of-order transition', async () => {
    const client = await makeUser('CLIENT', 'c3');
    const f = await makeUser('FREELANCER', 'f3');
    await request(app).post('/api/wallet/deposit').set(auth(client.token)).send({ amountCents: 10_000 });
    const job = await request(app).post('/api/jobs').set(auth(client.token)).send({
      title: 'Transition guard test',
      description: 'Approve before submit must be rejected with 409.',
      category: 'other',
      budgetCents: 5000,
    });
    const prop = await request(app)
      .post(`/api/jobs/${job.body.id}/proposals`)
      .set(auth(f.token))
      .send({ coverLetter: 'Bid for the guard test, thanks.', amountCents: 5000 });
    const accept = await request(app)
      .post(`/api/proposals/${prop.body.id}/accept`)
      .set(auth(client.token))
      .send({ milestones: [{ title: 'Milestone one', amountCents: 5000 }] });
    const c = await request(app).get(`/api/contracts/${accept.body.contractId}`).set(auth(client.token));
    const mid = c.body.milestones[0].id;

    // approve a CREATED milestone -> invalid
    const early = await request(app).post(`/api/milestones/${mid}/approve`).set(auth(client.token)).send({});
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INVALID_TRANSITION');

    // submit a CREATED milestone -> invalid
    const submitEarly = await request(app)
      .post(`/api/milestones/${mid}/submit`)
      .set(auth(f.token))
      .send({ note: 'Trying to submit before funding' });
    expect(submitEarly.status).toBe(409);

    // freelancer cannot fund; client cannot start
    await request(app).post(`/api/milestones/${mid}/fund`).set(auth(f.token)).send({}).expect(403);
    await request(app).post(`/api/milestones/${mid}/fund`).set(auth(client.token)).send({}).expect(200);
    await request(app).post(`/api/milestones/${mid}/start`).set(auth(client.token)).send().expect(403);

    // double-fund -> invalid transition
    const doubleFund = await request(app).post(`/api/milestones/${mid}/fund`).set(auth(client.token)).send({});
    expect(doubleFund.status).toBe(409);
  });

  it('refuses funding beyond the wallet balance', async () => {
    const client = await makeUser('CLIENT', 'poor-client');
    const f = await makeUser('FREELANCER', 'f4');
    await request(app).post('/api/wallet/deposit').set(auth(client.token)).send({ amountCents: 100 });
    const job = await request(app).post('/api/jobs').set(auth(client.token)).send({
      title: 'Underfunded job',
      description: 'The wallet only has one dollar in it, funding must fail.',
      category: 'other',
      budgetCents: 5000,
    });
    const prop = await request(app)
      .post(`/api/jobs/${job.body.id}/proposals`)
      .set(auth(f.token))
      .send({ coverLetter: 'A bid on the underfunded job.', amountCents: 5000 });
    const accept = await request(app)
      .post(`/api/proposals/${prop.body.id}/accept`)
      .set(auth(client.token))
      .send({ milestones: [{ title: 'Milestone one', amountCents: 5000 }] });
    const c = await request(app).get(`/api/contracts/${accept.body.contractId}`).set(auth(client.token));

    const res = await request(app)
      .post(`/api/milestones/${c.body.milestones[0].id}/fund`)
      .set(auth(client.token))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_FUNDS');
  });

  it('is idempotent: replaying a fund with the same key writes one ledger row', async () => {
    const client = await makeUser('CLIENT', 'c5');
    const f = await makeUser('FREELANCER', 'f5');
    await request(app).post('/api/wallet/deposit').set(auth(client.token)).send({ amountCents: 20_000 });
    const job = await request(app).post('/api/jobs').set(auth(client.token)).send({
      title: 'Idempotency test job',
      description: 'Retrying a fund request must not double-lock funds.',
      category: 'other',
      budgetCents: 5000,
    });
    const prop = await request(app)
      .post(`/api/jobs/${job.body.id}/proposals`)
      .set(auth(f.token))
      .send({ coverLetter: 'Bid for the idempotency test.', amountCents: 5000 });
    const accept = await request(app)
      .post(`/api/proposals/${prop.body.id}/accept`)
      .set(auth(client.token))
      .send({ milestones: [{ title: 'Milestone one', amountCents: 5000 }] });
    const c = await request(app).get(`/api/contracts/${accept.body.contractId}`).set(auth(client.token));
    const mid = c.body.milestones[0].id;

    const key = crypto.randomUUID();
    const r1 = await request(app).post(`/api/milestones/${mid}/fund`).set(auth(client.token)).send({ idempotencyKey: key });
    const r2 = await request(app).post(`/api/milestones/${mid}/fund`).set(auth(client.token)).send({ idempotencyKey: key });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200); // retry succeeds quietly...

    const rows = await prisma.escrowTransaction.count({ where: { milestoneId: mid, type: 'FUND' } });
    expect(rows).toBe(1); // ...but only one row moved money
    expect(await balanceOf(client.token)).toBe(15_000);
  });

  it('supports the rework loop and clears the auto-release clock', async () => {
    const { client, freelancer, milestoneId } = await submittedMilestone();

    await request(app)
      .post(`/api/milestones/${milestoneId}/request-changes`)
      .set(auth(client.token))
      .send({ note: 'The ledger tests are failing on Windows.' })
      .expect(200);

    const m = await prisma.milestone.findUnique({ where: { id: milestoneId } });
    expect(m!.state).toBe('IN_PROGRESS');
    expect(m!.autoReleaseAt).toBeNull(); // a sent-back milestone must never auto-pay

    // Freelancer resubmits, client approves — loop closes.
    await request(app)
      .post(`/api/milestones/${milestoneId}/submit`)
      .set(auth(freelancer.token))
      .send({ note: 'Fixed the Windows path handling.' })
      .expect(200);
    await request(app)
      .post(`/api/milestones/${milestoneId}/approve`)
      .set(auth(client.token))
      .send({ rating: 4 })
      .expect(200);
  });

  it('auto-releases after the review window and mints an unrated record', async () => {
    const { freelancer, milestoneId } = await submittedMilestone();

    // Backdate the deadline instead of waiting seven days.
    await prisma.milestone.update({
      where: { id: milestoneId },
      data: { autoReleaseAt: new Date(Date.now() - 1000) },
    });

    const released = await sweepAutoReleases();
    expect(released).toBe(1);

    expect(await balanceOf(freelancer.token)).toBe(50_000);
    const record = await prisma.workRecord.findUnique({ where: { milestoneId } });
    expect(record).not.toBeNull();
    expect((record!.payload as { rating: number | null }).rating).toBeNull();
  });

  it('resolves a dispute with a partial split that sums exactly', async () => {
    const { client, freelancer, milestoneId } = await submittedMilestone();
    const admin = await makeUser('FREELANCER', 'arb');
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'arb@example.com', password: 'correct-horse-battery' });
    const adminToken = adminLogin.body.accessToken as string;

    const dispute = await request(app)
      .post(`/api/milestones/${milestoneId}/dispute`)
      .set(auth(client.token))
      .send({ reason: 'Deliverable does not match the milestone scope.' });
    expect(dispute.status).toBe(201);

    // A disputed milestone must refuse approval — the escrow is frozen.
    const approveDuringDispute = await request(app)
      .post(`/api/milestones/${milestoneId}/approve`)
      .set(auth(client.token))
      .send({});
    expect(approveDuringDispute.status).toBe(409);

    // Only an admin resolves.
    await request(app)
      .post(`/api/disputes/${dispute.body.disputeId}/resolve`)
      .set(auth(client.token))
      .send({ freelancerPct: 60, note: 'Client trying to self-arbitrate' })
      .expect(403);

    const resolve = await request(app)
      .post(`/api/disputes/${dispute.body.disputeId}/resolve`)
      .set(auth(adminToken))
      .send({ freelancerPct: 60, note: 'Work substantially complete; partial delivery gaps.' });
    expect(resolve.status).toBe(200);

    // 60% of 50k = 30k to freelancer, 20k back to client (50k + 50k unspent).
    expect(await balanceOf(freelancer.token)).toBe(30_000);
    expect(await balanceOf(client.token)).toBe(70_000);

    // Escrow is exactly empty — conservation of money.
    const m = await prisma.milestone.findUnique({ where: { id: milestoneId } });
    expect(m!.state).toBe('RESOLVED');
    const ledgerSum = await prisma.escrowTransaction.aggregate({
      where: { milestoneId },
      _sum: { amountCents: true },
    });
    // FUND 50k in, RELEASE 30k + REFUND 20k out -> rows sum to 100k gross.
    expect(ledgerSum._sum.amountCents).toBe(100_000);
  });

  it('double-dispute is rejected', async () => {
    const { client, freelancer, milestoneId } = await submittedMilestone();
    await request(app)
      .post(`/api/milestones/${milestoneId}/dispute`)
      .set(auth(client.token))
      .send({ reason: 'First dispute, should be accepted.' })
      .expect(201);
    const second = await request(app)
      .post(`/api/milestones/${milestoneId}/dispute`)
      .set(auth(freelancer.token))
      .send({ reason: 'Second dispute on the same milestone.' });
    expect(second.status).toBe(409);
  });
});

describe('reputation (Sprint 4)', () => {
  it('export bundle verifies independently; tampering is detected', async () => {
    const { client, freelancer, milestoneId } = await submittedMilestone();
    await request(app)
      .post(`/api/milestones/${milestoneId}/approve`)
      .set(auth(client.token))
      .send({ rating: 5 })
      .expect(200);

    const exportRes = await request(app)
      .get(`/api/reputation/${freelancer.id}/export`)
      .set(auth(freelancer.token));
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.records).toHaveLength(1);
    expect(exportRes.body.publicKeyPem).toContain('PUBLIC KEY');

    const jws = exportRes.body.records[0] as string;

    // The verify endpoint accepts the genuine record...
    const ok = await request(app).post('/api/reputation/verify').send({ jws });
    expect(ok.body.valid).toBe(true);
    expect(ok.body.claims.freelancerId).toBe(freelancer.id);

    // ...and rejects a single flipped character in the payload.
    const parts = jws.split('.');
    const tamperedPayload = parts[1]!.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
    const tampered = [parts[0], tamperedPayload, parts[2]].join('.');
    const bad = await request(app).post('/api/reputation/verify').send({ jws: tampered });
    expect(bad.body.valid).toBe(false);
  });

  it('only the owner can export their bundle', async () => {
    const { client, freelancer } = await submittedMilestone();
    const res = await request(app)
      .get(`/api/reputation/${freelancer.id}/export`)
      .set(auth(client.token));
    expect(res.status).toBe(403);
  });
});

describe('workspace (Sprint 5)', () => {
  it('chat: parties can post and read; outsiders cannot', async () => {
    const { client, freelancer, contractId } = await submittedMilestone();

    await request(app)
      .post(`/api/contracts/${contractId}/messages`)
      .set(auth(client.token))
      .send({ body: 'How is the second milestone going?' })
      .expect(201);
    await request(app)
      .post(`/api/contracts/${contractId}/messages`)
      .set(auth(freelancer.token))
      .send({ body: 'Nearly done — pushing tonight.' })
      .expect(201);

    const history = await request(app)
      .get(`/api/contracts/${contractId}/messages`)
      .set(auth(client.token));
    expect(history.body).toHaveLength(2);

    const outsider = await makeUser('CLIENT', 'nosy');
    await request(app)
      .get(`/api/contracts/${contractId}/messages`)
      .set(auth(outsider.token))
      .expect(403);
  });

  it('time chain: entries link, verification passes, tampering breaks it', async () => {
    const { freelancer, contractId } = await submittedMilestone();

    const base = Date.now() - 3_600_000;
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/contracts/${contractId}/time`)
        .set(auth(freelancer.token))
        .send({
          startedAt: new Date(base + i * 600_000).toISOString(),
          endedAt: new Date(base + i * 600_000 + 500_000).toISOString(),
          note: `session ${i}`,
        })
        .expect(201);
    }

    const before = await request(app).get(`/api/contracts/${contractId}/time`).set(auth(freelancer.token));
    expect(before.body.chainValid).toBe(true);
    expect(before.body.entries).toHaveLength(3);
    // Each entry's prevHash is its predecessor's hash.
    expect(before.body.entries[1].prevHash).toBe(before.body.entries[0].hash);
    expect(before.body.entries[2].prevHash).toBe(before.body.entries[1].hash);

    // Tamper with the middle entry directly in the database (§10.4's threat).
    await prisma.timeEntry.updateMany({
      where: { contractId, note: 'session 1' },
      data: { note: 'session 1 (padded to bill more hours)' },
    });

    const after = await request(app).get(`/api/contracts/${contractId}/time`).set(auth(freelancer.token));
    expect(after.body.chainValid).toBe(false);
  });

  it('clients cannot log time on the freelancer’s behalf', async () => {
    const { client, contractId } = await submittedMilestone();
    const res = await request(app)
      .post(`/api/contracts/${contractId}/time`)
      .set(auth(client.token))
      .send({ startedAt: new Date(Date.now() - 1000).toISOString(), endedAt: new Date().toISOString() });
    expect(res.status).toBe(403);
  });

  it('evidence bundle reaches the arbitrator with chat and time logs attached', async () => {
    const { client, freelancer, contractId, milestoneId } = await submittedMilestone();
    await request(app)
      .post(`/api/contracts/${contractId}/messages`)
      .set(auth(freelancer.token))
      .send({ body: 'Delivered as agreed, see repo.' });
    const dispute = await request(app)
      .post(`/api/milestones/${milestoneId}/dispute`)
      .set(auth(client.token))
      .send({ reason: 'Deliverable incomplete in my view.' });

    const admin = await makeUser('CLIENT', 'arb2');
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'arb2@example.com', password: 'correct-horse-battery' });

    const bundle = await request(app)
      .get(`/api/disputes/${dispute.body.disputeId}`)
      .set(auth(login.body.accessToken));
    expect(bundle.status).toBe(200);
    expect(bundle.body.evidence.messages).toHaveLength(1);
    expect(bundle.body.milestone.escrowCents).toBe(50_000);
  });
});

// Isolate: notifications accumulate across scenarios in this suite.
beforeEach(async () => {
  await prisma.notification.deleteMany();
});
