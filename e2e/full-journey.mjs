/**
 * Sprint 6, Day 27 — end-to-end journey through the whole platform.
 *
 * signup → job → proposal → contract → fund → submit → approve → export →
 * verify → dispute → resolve
 *
 * Driven through the real HTTP API with three independent sessions (client,
 * freelancer, arbitrator), exactly as three browsers would. Asserts money
 * conservation at every step: the ledger is the thing that must never be wrong.
 *
 *   node e2e/full-journey.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:4000';
const stamp = Date.now();

let pass = 0;
let fail = 0;
const ok = (m) => {
  pass++;
  console.log(`  ✓ ${m}`);
};
const bad = (m) => {
  fail++;
  console.log(`  ✗ ${m}`);
};
const check = (cond, m) => (cond ? ok(m) : bad(m));

/** Minimal session: keeps an access token and the refresh cookie. */
function session(label) {
  let token = null;
  let cookie = null;
  return {
    label,
    get token() {
      return token;
    },
    async call(path, { method = 'GET', body } = {}) {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie?.includes('trustlance_rt=')) cookie = setCookie.split(';')[0];
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON (file download) */
      }
      return { status: res.status, body: json, text };
    },
    async register(role, tag) {
      const r = await this.call('/api/auth/register', {
        method: 'POST',
        body: {
          email: `${tag}+${stamp}@example.com`,
          password: 'correct-horse-battery',
          role,
          displayName: tag,
        },
      });
      token = r.body?.accessToken ?? null;
      return r;
    },
    async login(email) {
      const r = await this.call('/api/auth/login', {
        method: 'POST',
        body: { email, password: 'correct-horse-battery' },
      });
      token = r.body?.accessToken ?? null;
      return r;
    },
  };
}

const usd = (c) => `$${(c / 100).toFixed(2)}`;
const balance = async (s) => (await s.call('/api/wallet')).body.balanceCents;

async function main() {
  const client = session('client');
  const freelancer = session('freelancer');

  console.log('\n1. Accounts');
  const c = await client.register('CLIENT', 'e2e-client');
  const f = await freelancer.register('FREELANCER', 'e2e-freelancer');
  check(c.status === 201 && f.status === 201, 'client and freelancer registered');
  const clientId = c.body.user.id;
  const freelancerId = f.body.user.id;

  console.log('\n2. Wallet top-up (demo mode)');
  const dep = await client.call('/api/wallet/deposit', { method: 'POST', body: { amountCents: 200_000 } });
  check(dep.status === 201 && (await balance(client)) === 200_000, `client funded ${usd(200_000)}`);

  console.log('\n3. Job posting');
  const job = await client.call('/api/jobs', {
    method: 'POST',
    body: {
      title: 'Build a portable reputation system',
      description: 'Ed25519 signed work records, exportable and verifiable offline. Long enough.',
      category: 'web-development',
      budgetCents: 120_000,
      skills: ['TypeScript', 'PostgreSQL'],
    },
  });
  check(job.status === 201, `job posted (${usd(120_000)})`);

  // Public listing must show it without any auth.
  const anon = await fetch(`${API}/api/jobs`).then((r) => r.json());
  check(
    anon.some((j) => j.id === job.body.id),
    'job appears on the public listing (no auth)',
  );

  console.log('\n4. Proposal');
  const prop = await freelancer.call(`/api/jobs/${job.body.id}/proposals`, {
    method: 'POST',
    body: { coverLetter: 'I have built signed audit trails before, happy to walk you through.', amountCents: 120_000 },
  });
  check(prop.status === 201, 'freelancer submitted a proposal');

  const ownBid = await client.call(`/api/jobs/${job.body.id}/proposals`, {
    method: 'POST',
    body: { coverLetter: 'A client trying to bid on their own job here.', amountCents: 1000 },
  });
  check(ownBid.status === 403, 'client cannot bid on their own job');

  console.log('\n5. Accept → contract with two milestones');
  const accept = await client.call(`/api/proposals/${prop.body.id}/accept`, {
    method: 'POST',
    body: {
      milestones: [
        { title: 'Signing service and key management', amountCents: 70_000 },
        { title: 'Verifier page and export bundle', amountCents: 50_000 },
      ],
    },
  });
  check(accept.status === 201, 'contract created');
  const contractId = accept.body.contractId;

  const contract = await client.call(`/api/contracts/${contractId}`);
  check(contract.body.milestones.length === 2, 'two milestones attached');
  const [m1, m2] = contract.body.milestones;

  const jobAfter = await client.call(`/api/jobs/${job.body.id}`);
  check(jobAfter.body.status === 'CLOSED', 'job auto-closed on acceptance');

  console.log('\n6. Milestone 1 — the happy path');
  check((await client.call(`/api/milestones/${m1.id}/fund`, { method: 'POST', body: {} })).status === 200, 'client funded escrow');
  check((await balance(client)) === 130_000, `client balance now ${usd(130_000)} (70k locked)`);

  check((await freelancer.call(`/api/milestones/${m1.id}/start`, { method: 'POST' })).status === 200, 'freelancer started work');

  // Log time — hash chain.
  const now = Date.now();
  await freelancer.call(`/api/contracts/${contractId}/time`, {
    method: 'POST',
    body: {
      startedAt: new Date(now - 7_200_000).toISOString(),
      endedAt: new Date(now - 3_600_000).toISOString(),
      note: 'key management',
    },
  });
  await freelancer.call(`/api/contracts/${contractId}/time`, {
    method: 'POST',
    body: { startedAt: new Date(now - 3_600_000).toISOString(), endedAt: new Date(now).toISOString(), note: 'signing' },
  });
  const time = await freelancer.call(`/api/contracts/${contractId}/time`);
  check(time.body.chainValid === true && time.body.entries.length === 2, 'time-entry hash chain verifies');
  check(
    time.body.entries[1].prevHash === time.body.entries[0].hash,
    'each entry links to its predecessor',
  );

  // Chat.
  await freelancer.call(`/api/contracts/${contractId}/messages`, {
    method: 'POST',
    body: { body: 'Signing service is done — key rotation is handled via the kid header.' },
  });
  const chat = await client.call(`/api/contracts/${contractId}/messages`);
  check(chat.body.length === 1, 'chat message delivered to the client');

  check(
    (await freelancer.call(`/api/milestones/${m1.id}/submit`, { method: 'POST', body: { note: 'Delivered — see the repo and tests.' } })).status === 200,
    'freelancer submitted the deliverable',
  );

  // Rework loop.
  check(
    (await client.call(`/api/milestones/${m1.id}/request-changes`, { method: 'POST', body: { note: 'Please add a key-rotation test.' } })).status === 200,
    'client requested changes (rework loop)',
  );
  await freelancer.call(`/api/milestones/${m1.id}/submit`, { method: 'POST', body: { note: 'Added the rotation test.' } });

  const approve = await client.call(`/api/milestones/${m1.id}/approve`, {
    method: 'POST',
    body: { rating: 5, feedback: 'Excellent work.' },
  });
  check(approve.status === 200, 'client approved → escrow released');
  check((await balance(freelancer)) === 70_000, `freelancer received ${usd(70_000)}`);
  check((await balance(client)) === 130_000, 'client balance unchanged by release (money moved from escrow)');

  console.log('\n7. Signed work record');
  const records = await fetch(`${API}/api/reputation/${freelancerId}/records`).then((r) => r.json());
  check(records.length === 1, 'work record minted on approval');
  check(records[0].payload.rating === 5 && records[0].payload.amountCents === 70_000, 'record claims match the milestone');

  const verify = await fetch(`${API}/api/reputation/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jws: records[0].jws }),
  }).then((r) => r.json());
  check(verify.valid === true, 'record verifies against the public key alone');

  // Tamper detection.
  const parts = records[0].jws.split('.');
  const tampered = `${parts[0]}.${parts[1].replace(/^./, (ch) => (ch === 'A' ? 'B' : 'A'))}.${parts[2]}`;
  const badVerify = await fetch(`${API}/api/reputation/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jws: tampered }),
  }).then((r) => r.json());
  check(badVerify.valid === false, 'a single altered character fails verification');

  console.log('\n8. Export bundle');
  const exp = await freelancer.call(`/api/reputation/${freelancerId}/export`);
  check(exp.status === 200 && exp.body.records.length === 1, 'freelancer exported their bundle');
  check(exp.body.publicKeyPem.includes('PUBLIC KEY') && Boolean(exp.body.keyId), 'bundle carries the public key and key id');
  const foreign = await client.call(`/api/reputation/${freelancerId}/export`);
  check(foreign.status === 403, 'the client cannot export someone else’s reputation');

  const profile = await fetch(`${API}/api/users/${freelancerId}`).then((r) => r.json());
  check(typeof profile.trustScore === 'number' && profile.trustScore > 0, `trust score computed (${profile.trustScore})`);
  check(profile.email === undefined, 'public profile still leaks no email');

  console.log('\n9. Milestone 2 — dispute and arbitration');
  await client.call(`/api/milestones/${m2.id}/fund`, { method: 'POST', body: {} });
  await freelancer.call(`/api/milestones/${m2.id}/start`, { method: 'POST' });
  await freelancer.call(`/api/milestones/${m2.id}/submit`, { method: 'POST', body: { note: 'Verifier page shipped.' } });

  const dispute = await client.call(`/api/milestones/${m2.id}/dispute`, {
    method: 'POST',
    body: { reason: 'The verifier page does not handle bundle uploads as scoped.' },
  });
  check(dispute.status === 201, 'client raised a dispute');

  const blocked = await client.call(`/api/milestones/${m2.id}/approve`, { method: 'POST', body: {} });
  check(blocked.status === 409, 'a disputed milestone cannot be approved (escrow frozen)');

  // Arbitrator: promoted out of band, as the docs specify.
  const arb = session('arbitrator');
  await arb.register('CLIENT', 'e2e-arb');
  const promote = await fetch(`${API}/api/admin/promote-for-demo`, { method: 'POST' }).catch(() => null);
  void promote; // no such endpoint — promotion is done directly below

  console.log('   (promoting arbitrator directly in the database, as §10 requires out-of-band provisioning)');
  const { execSync } = await import('node:child_process');
  execSync(
    `docker exec trustlance-postgres psql -U trustlance -d trustlance -c "UPDATE users SET role='ADMIN' WHERE email='e2e-arb+${stamp}@example.com'"`,
    { stdio: 'ignore' },
  );
  await arb.login(`e2e-arb+${stamp}@example.com`);

  const queue = await arb.call('/api/disputes');
  check(queue.status === 200 && queue.body.length >= 1, 'dispute appears in the arbitrator queue');

  const bundle = await arb.call(`/api/disputes/${dispute.body.disputeId}`);
  check(bundle.status === 200, 'arbitrator can load the evidence bundle');
  check(bundle.body.evidence.messages.length >= 1, 'chat auto-attached as evidence');
  check(bundle.body.evidence.timeEntries.length === 2, 'time logs auto-attached as evidence');
  check(bundle.body.milestone.escrowCents === 50_000, `${usd(50_000)} confirmed in escrow`);

  const selfRule = await client.call(`/api/disputes/${dispute.body.disputeId}/resolve`, {
    method: 'POST',
    body: { freelancerPct: 100, note: 'Client attempting to self-arbitrate.' },
  });
  check(selfRule.status === 403, 'a party cannot arbitrate their own dispute');

  const ruling = await arb.call(`/api/disputes/${dispute.body.disputeId}/resolve`, {
    method: 'POST',
    body: { freelancerPct: 40, note: 'Partial delivery: core verifier works, bundle upload missing.' },
  });
  check(ruling.status === 200, 'arbitrator issued a 40/60 split');

  const fBal = await balance(freelancer);
  const cBal = await balance(client);
  check(fBal === 70_000 + 20_000, `freelancer got 40% of escrow → ${usd(fBal)}`);
  check(cBal === 80_000 + 30_000, `client refunded 60% → ${usd(cBal)}`);

  console.log('\n10. Money conservation');
  // Everything deposited must equal everything held by someone, plus escrow.
  const totalIn = 200_000;
  const finalContract = await client.call(`/api/contracts/${contractId}`);
  const escrowLeft = finalContract.body.milestones.reduce((s, m) => s + m.escrowCents, 0);
  check(
    fBal + cBal + escrowLeft === totalIn,
    `${usd(fBal)} + ${usd(cBal)} + ${usd(escrowLeft)} escrow = ${usd(totalIn)} deposited`,
  );
  check(finalContract.body.status === 'COMPLETED', 'contract completed once all milestones were terminal');

  console.log('\n11. Auth hardening spot-checks');
  const noAuth = await fetch(`${API}/api/contracts/mine`);
  check(noAuth.status === 401, 'protected route rejects an anonymous request');
  const outsider = session('outsider');
  await outsider.register('FREELANCER', 'e2e-outsider');
  const peek = await outsider.call(`/api/contracts/${contractId}`);
  check(peek.status === 403, 'a non-party cannot read the contract');
  const badId = await client.call('/api/contracts/not-a-uuid');
  check(badId.status === 400, 'a malformed contract id is a 400, not a 500');

  console.log(`\n${'='.repeat(52)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(52));
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('\nE2E crashed:', err);
  process.exit(1);
});
