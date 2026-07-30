/**
 * Browser tour of the full platform UI.
 *
 * Drives two real browser sessions (client + freelancer) through the marketplace
 * and escrow flow, screenshotting each surface. The point is to see the pages,
 * not just to assert on them — a passing selector on a broken layout is exactly
 * the failure this catches.
 *
 *   node e2e/ui-tour.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const WEB = 'http://localhost:3000';
const API = 'http://localhost:4000';
const SHOTS = 'screenshots';
mkdirSync(SHOTS, { recursive: true });

const stamp = Date.now();
const PW = 'correct-horse-battery';
const clientEmail = `ui-client+${stamp}@example.com`;
const freelancerEmail = `ui-free+${stamp}@example.com`;
const arbEmail = `ui-arb+${stamp}@example.com`;

let pass = 0;
let fail = 0;
const check = (cond, m) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${m}`);
  } else {
    fail++;
    console.log(`  ✗ ${m}`);
  }
};

let shot = 0;
async function snap(page, name) {
  /*
   * Neutralise ONLY sticky/fixed elements for the capture. In a stitched
   * fullPage screenshot a sticky header renders at its scroll offset, so it
   * appears mid-document — an artefact, not a layout bug (verified: the header
   * stays at y=0 while scrolling).
   *
   * A blanket '*{position:static}' also flattens every absolutely-positioned
   * child (icons inside inputs, badges on avatars) and fabricates layout bugs
   * that don't exist. Target computed position instead.
   */
  await page
    .evaluate(() => {
      document.querySelectorAll('*').forEach((el) => {
        const pos = getComputedStyle(el).position;
        if (pos === 'sticky' || pos === 'fixed') {
          el.setAttribute('data-unstick', '1');
          el.style.setProperty('position', 'static', 'important');
        }
      });
    })
    .catch(() => {});
  /*
   * animations: 'disabled' freezes CSS animations at their end state.
   *
   * Two reasons: captures become deterministic instead of catching a keyframe
   * mid-flight, and Chromium intermittently fails a fullPage capture outright
   * ("Unable to capture screenshot") while an infinite animation is running —
   * which is exactly what the hero's drifting glow introduced.
   */
  await page.screenshot({
    path: `${SHOTS}/${String(++shot).padStart(2, '0')}-${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
  await page
    .evaluate(() => {
      document.querySelectorAll('[data-unstick]').forEach((el) => {
        el.style.removeProperty('position');
        el.removeAttribute('data-unstick');
      });
    })
    .catch(() => {});
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const errors = [];

async function newSession(label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('401') && !m.text().includes('favicon')) {
      errors.push(`[${label}] ${m.text()}`);
    }
  });
  return page;
}

async function register(page, email, role, name) {
  await page.goto(`${WEB}/register`, { waitUntil: 'networkidle' });
  await page.click(`button:has-text("${role}")`);
  await page.fill('input[name="displayName"]', name);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile', { timeout: 20000 });
}

async function login(page, email) {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  // Login lands on the dashboard (a returning user wants their work, not
  // profile settings); registration still lands on /profile to fill it in.
  await page.waitForURL('**/dashboard', { timeout: 20000 });
}

try {
  // ------------------------------------------------------------------ home --
  console.log('\nLanding & auth');
  const client = await newSession('client');
  await client.goto(WEB, { waitUntil: 'networkidle' });
  await snap(client, 'home');
  check(await client.isVisible('text=Reputation you own'), 'landing page renders');

  await register(client, clientEmail, 'client', 'Ada Client');
  check(client.url().includes('/profile'), 'client registered');
  await snap(client, 'profile');

  const freelancer = await newSession('freelancer');
  await register(freelancer, freelancerEmail, 'freelancer', 'Grace Freelancer');
  check(freelancer.url().includes('/profile'), 'freelancer registered');

  // ---------------------------------------------------------------- wallet --
  console.log('\nWallet');
  await client.goto(`${WEB}/wallet`, { waitUntil: 'networkidle' });
  await client.fill('input[name="amount"]', '2000.00');
  await client.click('button:has-text("Add demo funds")');
  await client.waitForTimeout(1200);
  await snap(client, 'wallet-funded');
  check((await client.textContent('body')).includes('$2,000.00'), 'wallet shows the top-up');
  check(await client.isVisible('text=Ledger'), 'append-only ledger is displayed');

  // ------------------------------------------------------------------ job ---
  console.log('\nJob posting');
  await client.goto(`${WEB}/jobs/new`, { waitUntil: 'networkidle' });
  await client.fill('input[name="title"]', 'Build a verifiable reputation ledger');
  await client.fill(
    'textarea[name="description"]',
    'Ed25519-signed work records with an offline verifier page and an export bundle.',
  );
  await client.selectOption('select[name="category"]', 'web-development');
  await client.fill('input[name="budget"]', '1200.00');
  await client.fill('input[name="skills"]', 'TypeScript, PostgreSQL');
  await snap(client, 'job-new');
  await client.click('button:has-text("Post job")');
  await client.waitForURL(/\/jobs\/[0-9a-f-]{36}/, { timeout: 20000 });
  const jobUrl = client.url();
  await snap(client, 'job-detail-client');
  check(true, 'job posted and detail page loaded');

  // ------------------------------------------------------------- proposal ---
  console.log('\nProposal');
  await freelancer.goto(`${WEB}/jobs`, { waitUntil: 'networkidle' });
  await snap(freelancer, 'jobs-browse');
  check(
    (await freelancer.textContent('body')).includes('Build a verifiable reputation ledger'),
    'job appears in the freelancer’s browse list',
  );

  await freelancer.goto(jobUrl, { waitUntil: 'networkidle' });
  await freelancer.fill('textarea[name="coverLetter"]', 'I have shipped signed audit trails before — happy to walk through the design.');
  await freelancer.fill('input[name="amount"]', '1200.00');
  await snap(freelancer, 'proposal-form');
  await freelancer.click('button:has-text("Submit proposal")');
  await freelancer.waitForSelector('text=Proposal submitted', { timeout: 20000 });
  check(true, 'proposal submitted');

  // ------------------------------------------------- accept + milestones ---
  console.log('\nMilestone wizard');
  await client.reload({ waitUntil: 'networkidle' });
  await client.waitForSelector('text=Grace Freelancer', { timeout: 20000 });
  await snap(client, 'proposal-review');
  check(await client.isVisible('button:has-text("Accept & set milestones")'), 'client sees the proposal');

  await client.click('button:has-text("Accept & set milestones")');
  await client.waitForSelector('text=Define milestones');
  // Split 1200 into 700 + 500 to exercise the balance check.
  await client.fill('input[name="amount-0"]', '700.00');
  await client.click('button:has-text("+ Add milestone")');
  await client.fill('input[name="title-1"]', 'Verifier page and export');
  await client.fill('input[name="amount-1"]', '500.00');
  await snap(client, 'milestone-wizard');
  check(
    (await client.textContent('body')).includes('$1,200.00 of $1,200.00'),
    'wizard confirms the split matches the agreed bid',
  );

  await client.click('button:has-text("Create contract")');
  await client.waitForURL(/\/contracts\/[0-9a-f-]{36}/, { timeout: 20000 });
  const contractUrl = client.url();
  await snap(client, 'contract-created');
  check(true, 'contract created from the wizard');

  // ------------------------------------------------------------- escrow ----
  console.log('\nEscrow lifecycle');
  await client.click('button:has-text("Fund escrow")');
  await client.waitForSelector('text=held in escrow', { timeout: 20000 });
  await snap(client, 'milestone-funded');
  check(await client.isVisible('text=Funded'), 'milestone funded — escrow badge shown');

  await freelancer.goto(contractUrl, { waitUntil: 'networkidle' });
  await freelancer.click('button:has-text("Start work")');
  await freelancer.waitForSelector('text=In progress', { timeout: 20000 });
  check(true, 'freelancer started work');

  // Time tracking.
  await freelancer.click('button[role="tab"]:has-text("Time")');
  await freelancer.waitForSelector('text=Start timer');
  await freelancer.click('button:has-text("Start timer")');
  await freelancer.waitForTimeout(2200);
  await freelancer.fill('input[aria-label="Time entry note"]', 'signing service');
  await freelancer.click('button:has-text("Stop & log")');
  await freelancer.waitForSelector('text=Hash chain verified', { timeout: 20000 });
  await snap(freelancer, 'time-tracker');
  check(await freelancer.isVisible('text=Hash chain verified'), 'time entry logged and chain verified');

  // Chat.
  await freelancer.click('button[role="tab"]:has-text("Chat")');
  await freelancer.fill('input[aria-label="Message"]', 'First milestone is ready for review.');
  await freelancer.click('button:has-text("Send")');
  await freelancer.waitForSelector('text=First milestone is ready', { timeout: 20000 });
  await snap(freelancer, 'chat');
  check(true, 'chat message sent');

  // Submit.
  await freelancer.click('button[role="tab"]:has-text("Milestones")');
  await freelancer.click('button:has-text("Submit deliverable")');
  await freelancer.fill('textarea[aria-label="Note"]', 'Signing service complete with rotation tests.');
  await freelancer.click('button:has-text("Confirm")');
  await freelancer.waitForSelector('text=Awaiting review', { timeout: 20000 });
  await snap(freelancer, 'submitted');
  check(true, 'deliverable submitted');

  // Approve.
  await client.reload({ waitUntil: 'networkidle' });
  await client.waitForSelector('button:has-text("Approve & release")', { timeout: 20000 });
  await client.click('button:has-text("Approve & release")');
  await client.waitForSelector('text=Release payment');
  await snap(client, 'approve-prompt');
  await client.click('button:has-text("Release payment")');
  await client.waitForSelector('text=signed work record issued', { timeout: 20000 });
  await snap(client, 'milestone-released');
  check(await client.isVisible('text=signed work record issued'), 'release issued a signed work record');

  // -------------------------------------------------------- reputation ----
  console.log('\nReputation');
  await freelancer.goto(`${WEB}/profile`, { waitUntil: 'networkidle' });
  // Snapshot a POPULATED profile: by this point the freelancer has a released
  // milestone, a signed record and a computed trust score, so the page shows
  // real content rather than the empty states a fresh account renders.
  await freelancer.waitForSelector('text=Signed work records', { timeout: 20000 });
  await snap(freelancer, 'profile-populated');
  check(await freelancer.isVisible('button:has-text("Export reputation")'), 'export button available to the freelancer');
  check(
    (await freelancer.textContent('body')).includes('Trust score'),
    'profile rail shows the computed trust score',
  );

  const freelancerId = await freelancer.evaluate(async () => {
    const r = await fetch('http://localhost:4000/api/auth/refresh', { method: 'POST', credentials: 'include' });
    return (await r.json()).user.id;
  });

  const anon = await newSession('anon');
  await anon.goto(`${WEB}/u/${freelancerId}`, { waitUntil: 'networkidle' });
  await snap(anon, 'public-trust-profile');
  const anonText = await anon.textContent('body');
  check(anonText.includes('Verified work records'), 'public profile lists verified work records');
  check(anonText.includes('Trust score'), 'trust score shown');
  check(!anonText.includes(freelancerEmail), 'no email leaked on the public profile');

  // Verifier — grab the JWS from the public profile and paste it in.
  const jws = await anon.evaluate(async (id) => {
    const r = await fetch(`http://localhost:4000/api/reputation/${id}/records`);
    return (await r.json())[0].jws;
  }, freelancerId);

  await anon.goto(`${WEB}/verify`, { waitUntil: 'networkidle' });
  await anon.fill('#jws', jws);
  await anon.click('button:has-text("Verify")');
  await anon.waitForSelector('text=Valid signature', { timeout: 20000 });
  await snap(anon, 'verifier-valid');
  check(true, 'verifier accepts a genuine record with no login');

  // Tamper it.
  const bad = jws.split('.');
  bad[1] = bad[1].replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
  await anon.fill('#jws', bad.join('.'));
  await anon.click('button:has-text("Verify")');
  await anon.waitForSelector('text=Not valid', { timeout: 20000 });
  await snap(anon, 'verifier-tampered');
  check(true, 'verifier rejects a tampered record');

  // ---------------------------------------------------------- dispute ----
  console.log('\nDispute & arbitration');
  await client.goto(contractUrl, { waitUntil: 'networkidle' });
  await client.click('button:has-text("Fund escrow")');
  await client.waitForTimeout(1500);
  await freelancer.goto(contractUrl, { waitUntil: 'networkidle' });
  await freelancer.click('button:has-text("Start work")');
  await freelancer.waitForTimeout(1200);
  await freelancer.click('button:has-text("Submit deliverable")');
  await freelancer.fill('textarea[aria-label="Note"]', 'Verifier page shipped.');
  await freelancer.click('button:has-text("Confirm")');
  await freelancer.waitForTimeout(1500);

  await client.reload({ waitUntil: 'networkidle' });
  await client.waitForSelector('button:has-text("Raise dispute")', { timeout: 20000 });
  const disputeButtons = await client.$$('button:has-text("Raise dispute")');
  await disputeButtons[disputeButtons.length - 1].click();
  await client.fill('textarea[aria-label="Note"]', 'Bundle upload handling is missing from the verifier.');
  await client.click('button:has-text("Confirm")');
  await client.waitForSelector('text=Dispute open', { timeout: 20000 });
  await snap(client, 'dispute-raised');
  check(await client.isVisible('text=escrow frozen'), 'dispute freezes escrow with a clear notice');

  // Arbitrator.
  const arb = await newSession('arbitrator');
  await register(arb, arbEmail, 'client', 'Alan Arbitrator');
  execSync(
    `docker exec trustlance-postgres psql -U trustlance -d trustlance -c "UPDATE users SET role='ADMIN' WHERE email='${arbEmail}'"`,
    { stdio: 'ignore' },
  );
  await arb.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await login(arb, arbEmail);

  await arb.goto(`${WEB}/admin/disputes`, { waitUntil: 'networkidle' });
  await arb.waitForSelector('text=Dispute queue', { timeout: 20000 });
  await snap(arb, 'dispute-queue');
  check(await arb.isVisible('button:has-text("Review evidence & rule")'), 'arbitrator sees the queue');

  await arb.click('button:has-text("Review evidence & rule")');
  await arb.waitForSelector('text=Evidence', { timeout: 20000 });
  await snap(arb, 'evidence-bundle');
  const arbText = await arb.textContent('body');
  check(arbText.includes('Chat ('), 'chat attached to the evidence bundle');
  check(arbText.includes('Time entries ('), 'time logs attached to the evidence bundle');

  await arb.fill('#pct', '40');
  await arb.fill('textarea[name="note"]', 'Core verifier works; bundle upload was in scope and is absent.');
  await snap(arb, 'ruling');
  await arb.click('button:has-text("Issue ruling & move funds")');
  await arb.waitForSelector('text=Ruling recorded', { timeout: 20000 });
  await snap(arb, 'resolved');
  check(true, 'arbitrator issued the split and funds moved');

  // ------------------------------------------------------- dashboard ----
  console.log('\nDashboards');
  await client.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
  await snap(client, 'dashboard-client');
  check(await client.isVisible('text=Your job posts'), 'client dashboard shows jobs and contracts');

  await freelancer.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
  await snap(freelancer, 'dashboard-freelancer');
  check(await freelancer.isVisible('text=Your proposals'), 'freelancer dashboard shows proposals');

  await freelancer.goto(`${WEB}/wallet`, { waitUntil: 'networkidle' });
  await snap(freelancer, 'wallet-freelancer');
  check((await freelancer.textContent('body')).includes('$900.00'), 'freelancer wallet shows 700 + 200 earned');

  // Mobile viewport check.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mobile.newPage();
  await mp.goto(`${WEB}/jobs`, { waitUntil: 'networkidle' });
  await mp.screenshot({ path: `${SHOTS}/${String(++shot).padStart(2, '0')}-mobile-jobs.png`, fullPage: true });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, 'no horizontal overflow at 390px');
  await mobile.close();
} catch (err) {
  fail++;
  console.log(`\n  ✗ tour threw: ${err.message}`);
  try {
    const pages = browser.contexts().flatMap((c) => c.pages());
    if (pages[0]) await snap(pages[0], 'failure');
  } catch {
    /* ignore */
  }
} finally {
  console.log('\nPage errors:', errors.length ? errors.slice(0, 6).join('\n  ') : '(none)');
  console.log(`\n${'='.repeat(52)}`);
  console.log(`  ${pass} passed, ${fail} failed  ·  ${shot} screenshots`);
  console.log('='.repeat(52));
  await browser.close();
  process.exit(fail ? 1 : 0);
}
