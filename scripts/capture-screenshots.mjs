/**
 * Regenerates the README screenshots in docs/images.
 *
 * Drives a real client + freelancer session through the full lifecycle so the
 * captures show genuine escrow states and a genuine signed record, rather than
 * empty placeholder screens.
 *
 *   npm run screenshots     (both servers must be running)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const WEB = 'http://localhost:3000';
const OUT = 'docs/images';
mkdirSync(OUT, { recursive: true });

const stamp = Date.now();
const PW = 'correct-horse-battery';
const client = { email: `demo-client+${stamp}@example.com`, name: 'Amelia Stone' };
const freelancer = { email: `demo-dev+${stamp}@example.com`, name: 'Jonas Meyer' };

const browser = await chromium.launch({ args: ['--no-sandbox'] });

async function session(colorScheme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme });
  return ctx.newPage();
}

/** Viewport-sized capture — full-page shots are far too tall for a README. */
const shot = (page, name, opts = {}) =>
  page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled', ...opts });

async function register(page, { email, name }, role) {
  await page.goto(`${WEB}/register`, { waitUntil: 'networkidle' });
  await page.click(`button:has-text("${role}")`);
  await page.fill('input[name="displayName"]', name);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile', { timeout: 30000 });
}

try {
  console.log('Setting up demo data…');
  const c = await session();
  const f = await session();
  await register(c, client, 'client');
  await register(f, freelancer, 'freelancer');

  // Fund the client's demo wallet.
  await c.goto(`${WEB}/wallet`, { waitUntil: 'networkidle' });
  await c.fill('input[name="amount"]', '2000.00');
  await c.click('button:has-text("Add demo funds")');
  await c.waitForTimeout(1200);

  // Post a job.
  await c.goto(`${WEB}/jobs/new`, { waitUntil: 'networkidle' });
  await c.fill('input[name="title"]', 'Build a verifiable reputation ledger');
  await c.fill(
    'textarea[name="description"]',
    'Ed25519-signed work records with an offline verifier page and an exportable bundle. Postgres-backed append-only ledger for escrow.',
  );
  await c.selectOption('select[name="category"]', 'web-development');
  await c.fill('input[name="budget"]', '1200.00');
  await c.fill('input[name="skills"]', 'TypeScript, PostgreSQL, Cryptography');
  await c.click('button:has-text("Post job")');
  await c.waitForURL(/\/jobs\/[0-9a-f-]{36}/, { timeout: 30000 });
  const jobUrl = c.url();

  // Freelancer bids.
  await f.goto(jobUrl, { waitUntil: 'networkidle' });
  await f.fill(
    'textarea[name="coverLetter"]',
    'I have shipped signed audit trails before. I would start with the key management and rotation story, then the verifier.',
  );
  await f.fill('input[name="amount"]', '1200.00');
  await f.click('button:has-text("Submit proposal")');
  await f.waitForSelector('text=Proposal submitted', { timeout: 30000 });

  // Client accepts and splits into milestones.
  await c.reload({ waitUntil: 'networkidle' });
  await c.click('button:has-text("Accept & set milestones")');
  await c.waitForSelector('text=Define milestones');
  await c.fill('input[name="title-0"]', 'Signing service and key management');
  await c.fill('input[name="amount-0"]', '700.00');
  await c.click('button:has-text("+ Add milestone")');
  await c.fill('input[name="title-1"]', 'Verifier page and export bundle');
  await c.fill('input[name="amount-1"]', '500.00');
  await c.click('button:has-text("Create contract")');
  await c.waitForURL(/\/contracts\/[0-9a-f-]{36}/, { timeout: 30000 });
  const contractUrl = c.url();

  // Drive milestone 1 to released so a signed record exists.
  await c.click('button:has-text("Fund escrow")');
  await c.waitForSelector('text=held in escrow', { timeout: 30000 });
  await f.goto(contractUrl, { waitUntil: 'networkidle' });
  await f.click('button:has-text("Start work")');
  await f.waitForSelector('text=In progress', { timeout: 30000 });

  // A little chat and logged time, so the workspace tabs aren't empty.
  await f.click('button[role="tab"]:has-text("Chat")');
  await f.fill('input[aria-label="Message"]', 'Key rotation is handled through the JWS kid header — pushing tonight.');
  await f.click('button:has-text("Send")');
  await f.waitForTimeout(800);
  await f.click('button[role="tab"]:has-text("Time")');
  await f.click('button:has-text("Start timer")');
  await f.waitForTimeout(2200);
  await f.fill('input[aria-label="Time entry note"]', 'signing service');
  await f.click('button:has-text("Stop & log")');
  await f.waitForSelector('text=Hash chain verified', { timeout: 30000 });

  await f.click('button[role="tab"]:has-text("Milestones")');
  await f.click('button:has-text("Submit deliverable")');
  await f.fill('textarea[aria-label="Note"]', 'Signing service complete, with key-rotation tests.');
  await f.click('button:has-text("Confirm")');
  await f.waitForSelector('text=Awaiting review', { timeout: 30000 });

  await c.reload({ waitUntil: 'networkidle' });
  await c.click('button:has-text("Approve & release")');
  await c.waitForSelector('text=Release payment');
  await c.click('button:has-text("Release payment")');
  await c.waitForSelector('text=signed work record issued', { timeout: 30000 });

  // Fund milestone 2 so the workspace shows a mix of states.
  await c.click('button:has-text("Fund escrow")');
  await c.waitForTimeout(1500);

  console.log('Capturing…');

  // 1 — landing, light and dark
  const anon = await session();
  await anon.goto(WEB, { waitUntil: 'networkidle' });
  await anon.waitForTimeout(900);
  await shot(anon, '01-landing');

  const anonDark = await session('dark');
  await anonDark.goto(WEB, { waitUntil: 'networkidle' });
  await anonDark.evaluate(() => localStorage.setItem('trustlance-theme', 'dark'));
  await anonDark.reload({ waitUntil: 'networkidle' });
  await anonDark.waitForTimeout(900);
  await shot(anonDark, '02-landing-dark');

  // 2 — job board
  await anon.goto(`${WEB}/jobs`, { waitUntil: 'networkidle' });
  await anon.waitForTimeout(600);
  await shot(anon, '03-job-board');

  // 3 — contract workspace, the heart of the product
  await c.goto(contractUrl, { waitUntil: 'networkidle' });
  await c.waitForTimeout(800);
  await shot(c, '04-contract-workspace');

  // 4 — tamper-evident time log
  await f.goto(contractUrl, { waitUntil: 'networkidle' });
  await f.click('button[role="tab"]:has-text("Time")');
  await f.waitForTimeout(700);
  await shot(f, '05-time-tracking');

  // 5 — public trust profile, seen logged out
  const freelancerId = await f.evaluate(async () => {
    const r = await fetch('http://localhost:4000/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    return (await r.json()).user.id;
  });
  await anon.goto(`${WEB}/u/${freelancerId}`, { waitUntil: 'networkidle' });
  await anon.waitForTimeout(700);
  await shot(anon, '06-trust-profile');

  // 6 — the verifier proving a real record, with no account
  const jws = await anon.evaluate(async (id) => {
    const r = await fetch(`http://localhost:4000/api/reputation/${id}/records`);
    return (await r.json())[0].jws;
  }, freelancerId);
  await anon.goto(`${WEB}/verify`, { waitUntil: 'networkidle' });
  await anon.fill('#jws', jws);
  await anon.click('button:has-text("Verify record")');
  await anon.waitForSelector('text=Valid signature', { timeout: 30000 });
  await anon.waitForTimeout(500);
  await shot(anon, '07-verifier', { fullPage: true });

  // 7 — wallet ledger
  await c.goto(`${WEB}/wallet`, { waitUntil: 'networkidle' });
  await c.waitForTimeout(600);
  await shot(c, '08-wallet-ledger');

  // 8 — freelancer profile with its signed record
  await f.goto(`${WEB}/profile`, { waitUntil: 'networkidle' });
  await f.waitForTimeout(700);
  await shot(f, '09-profile');

  console.log(`\nDone — 9 images written to ${OUT}/`);
} catch (err) {
  console.error('\nCapture failed:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
