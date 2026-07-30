/**
 * Focused check for the two features added on top of the redesign:
 * profile-picture upload/replace/remove, and the light/dark/system theme.
 *
 *   node e2e/avatar-theme.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const WEB = 'http://localhost:3000';
const API = 'http://localhost:4000';
const SHOTS = 'screenshots';
mkdirSync(SHOTS, { recursive: true });

const stamp = Date.now();
const PW = 'correct-horse-battery';
const email = `avatar+${stamp}@example.com`;

let pass = 0;
let fail = 0;
const check = (c, m) => {
  if (c) {
    pass++;
    console.log(`  ✓ ${m}`);
  } else {
    fail++;
    console.log(`  ✗ ${m}`);
  }
};

/**
 * Writes a real, OPAQUE PNG fixture.
 *
 * Built here rather than pasted as base64: the previous hand-written blob was a
 * structurally valid but fully *transparent* image, so the avatar rendered as
 * nothing while the test still counted an <img> and passed. An opaque colour is
 * what makes "the picture is actually visible" checkable.
 */
function solidPng(size, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 2; // truecolour RGB, no alpha channel — guarantees it is opaque
  // Each scanline is one filter byte (0 = none) followed by RGB triples.
  const raw = Buffer.concat(
    Array.from({ length: size }, () =>
      Buffer.concat([
        Buffer.from([0]),
        Buffer.concat(Array.from({ length: size }, () => Buffer.from([r, g, b]))),
      ]),
    ),
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG_PATH = 'e2e/.fixture-avatar.png';
writeFileSync(PNG_PATH, solidPng(64, [20, 168, 0])); // opaque TrustLance green

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  console.log('\n1. Register');
  await page.goto(`${WEB}/register`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("freelancer")');
  await page.fill('input[name="displayName"]', 'Nadia Avatar');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PW);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/profile', { timeout: 20000 });
  check(true, 'registered and landed on the profile');

  console.log('\n2. Initials before any upload');
  await page.waitForSelector('text=Profile picture');
  const imgsBefore = await page.locator('img[alt*="profile picture"]').count();
  check(imgsBefore === 0, 'no image yet — initials are shown');

  console.log('\n3. Upload a picture');
  await page.setInputFiles('input[type="file"]', PNG_PATH);
  await page.waitForSelector('img[alt*="profile picture"]', { timeout: 20000 });
  check(true, 'avatar image appears after upload');
  check(
    await page.isVisible('button:has-text("Change picture")'),
    'control switches to "Change picture"',
  );
  check(await page.isVisible('button:has-text("Remove")'), 'remove option appears');

  // The served bytes must actually be an image.
  const src = await page.getAttribute('img[alt*="profile picture"]', 'src');
  const res = await page.request.get(src.startsWith('http') ? src : `${API}${src}`);
  check(res.ok(), `avatar URL serves 200 (${res.status()})`);
  check(
    (res.headers()['content-type'] ?? '').startsWith('image/'),
    `served as an image (${res.headers()['content-type']})`,
  );
  // Cache-busting version is what makes a replacement show up immediately.
  check(src.includes('?v='), 'avatar URL carries a cache-busting version');

  /*
   * Assert the image genuinely DECODED and has pixels on screen.
   *
   * Counting <img> elements is not enough: a transparent or corrupt image still
   * produces an element with CSS dimensions, so the earlier version of this test
   * passed against an avatar that rendered as nothing at all.
   */
  const painted = await page.evaluate(() => {
    const el = document.querySelector('img[alt*="profile picture"]');
    if (!el) return null;
    return { complete: el.complete, w: el.naturalWidth, h: el.naturalHeight };
  });
  check(
    painted?.complete === true && painted.w > 0 && painted.h > 0,
    `image decoded with real pixels (${painted?.w}×${painted?.h})`,
  );

  await page.screenshot({ animations: 'disabled', path: `${SHOTS}/A1-avatar-uploaded.png`, fullPage: false });

  console.log('\n4. Avatar shows in the header');
  const headerImg = await page.locator('header img[alt*="profile picture"]').count();
  check(headerImg >= 1, 'header shows the uploaded avatar');

  console.log('\n5. Avatar survives a reload and appears on the public profile');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('img[alt*="profile picture"]', { timeout: 20000 });
  check(true, 'avatar persists across reload (stored server-side)');

  const userId = await page.evaluate(async () => {
    const r = await fetch('http://localhost:4000/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    return (await r.json()).user.id;
  });
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(`${WEB}/u/${userId}`, { waitUntil: 'networkidle' });
  const publicImg = await anon.locator('img[alt*="profile picture"]').count();
  check(publicImg >= 1, 'avatar visible to a logged-out visitor on the public profile');
  await anon.close();

  console.log('\n6. Theme: dark');
  await page.click('button[aria-label^="Theme"]');
  await page.click('button[role="radio"]:has-text("Dark")');
  await page.waitForTimeout(400);
  const darkAttr = await page.getAttribute('html', 'data-theme');
  check(darkAttr === 'dark', `html[data-theme] = ${darkAttr}`);
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(darkBg !== 'rgb(255, 255, 255)', `body background switched (${darkBg})`);
  await page.screenshot({ animations: 'disabled', path: `${SHOTS}/A2-profile-dark.png`, fullPage: true });

  console.log('\n7. Dark survives a reload with no flash');
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Read immediately: the inline script must have applied it before paint.
  const earlyAttr = await page.getAttribute('html', 'data-theme');
  check(earlyAttr === 'dark', 'theme applied pre-paint by the inline script (no flash)');

  console.log('\n8. Theme: light overrides an OS set to dark');
  const darkOs = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
  const dp = await darkOs.newPage();
  await dp.goto(`${WEB}/jobs`, { waitUntil: 'networkidle' });
  const osDarkBg = await dp.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await dp.click('button[aria-label^="Theme"]');
  await dp.click('button[role="radio"]:has-text("Light")');
  await dp.waitForTimeout(400);
  const forcedLightBg = await dp.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(
    forcedLightBg === 'rgb(255, 255, 255)',
    `explicit light beats an OS-dark machine (${osDarkBg} → ${forcedLightBg})`,
  );
  await dp.screenshot({ animations: 'disabled', path: `${SHOTS}/A3-light-on-dark-os.png`, fullPage: false });
  await darkOs.close();

  console.log('\n9. Landing page in dark mode');
  await page.goto(`${WEB}/`, { waitUntil: 'networkidle' });
  await page.screenshot({ animations: 'disabled', path: `${SHOTS}/A4-landing-dark.png`, fullPage: true });
  check((await page.getAttribute('html', 'data-theme')) === 'dark', 'dark carried across navigation');

  /*
   * Contrast guard for elements on always-white chips inside the dark hero/CTA.
   * These originally used text-foreground, which flips to near-white in dark
   * mode — making the active tab, hero search field and CTA label invisible.
   * A screenshot caught it; this makes it a failing test instead.
   */
  const contrast = await page.evaluate(() => {
    const parse = (c) => (c.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    // Perceived brightness (ITU-R BT.601), enough to catch light-on-light.
    const lum = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const targets = [
      ['hero active tab', '[role="tab"][aria-selected="true"]'],
      ['hero search input', 'input[aria-label^="Search"]'],
      ['CTA button', 'a:has-text("Create your account")'],
    ];
    const bad = [];
    for (const [name, sel] of targets) {
      const el = sel.includes(':has-text')
        ? [...document.querySelectorAll('a')].find((a) => a.textContent?.includes('Create your account'))
        : document.querySelector(sel);
      if (!el) continue;
      const st = getComputedStyle(el);
      const fg = lum(parse(st.color));
      // Walk up for a non-transparent background.
      let node = el;
      let bgc = 'rgba(0, 0, 0, 0)';
      while (node && (bgc === 'rgba(0, 0, 0, 0)' || bgc === 'transparent')) {
        bgc = getComputedStyle(node).backgroundColor;
        node = node.parentElement;
      }
      const bg = lum(parse(bgc));
      if (Math.abs(fg - bg) < 0.25) bad.push(`${name} (fg ${fg.toFixed(2)} vs bg ${bg.toFixed(2)})`);
    }
    return bad;
  });
  check(
    contrast.length === 0,
    contrast.length === 0
      ? 'white-chip elements stay readable in dark mode'
      : `low contrast in dark mode: ${contrast.join('; ')}`,
  );

  console.log('\n10. Remove the picture');
  await page.goto(`${WEB}/profile`, { waitUntil: 'networkidle' });
  await page.click('button:has-text("Remove")');
  await page.waitForTimeout(1200);
  const after = await page.locator('img[alt*="profile picture"]').count();
  check(after === 0, 'avatar removed — back to initials');

  console.log('\n11. Non-image upload is rejected');
  writeFileSync('e2e/.fixture-bad.txt', 'not an image');
  await page.setInputFiles('input[type="file"]', 'e2e/.fixture-bad.txt');
  // Scoped to main: Next's dev overlay injects its own empty [role="alert"]
  // container, and an unscoped selector intermittently matches that instead.
  await page.waitForSelector('main [role="alert"]', { timeout: 20000 });
  const alert = await page.textContent('main [role="alert"]');
  check(/image/i.test(alert), `rejected with a useful message: "${alert.trim().slice(0, 60)}"`);
} catch (err) {
  fail++;
  console.log(`\n  ✗ threw: ${err.message}`);
  await page.screenshot({ animations: 'disabled', path: `${SHOTS}/A-failure.png` }).catch(() => {});
} finally {
  console.log('\nPage errors:', errors.length ? errors.slice(0, 4).join('\n  ') : '(none)');
  console.log(`\n${'='.repeat(52)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log('='.repeat(52));
  await browser.close();
  process.exit(fail ? 1 : 0);
}
