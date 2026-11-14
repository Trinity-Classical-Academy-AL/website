import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4397';
const seed = JSON.parse(readFileSync(process.env.PERF_SEED || '/tmp/tca-e2e-seed.json'));
const out = process.env.PERF_SHOTS || '/home/bryant/work/tca/perf-shots/client-assets';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const summary = [];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 } });
    await context.addCookies([{ name: 'tca_family_session', value: seed.cookies.ada, url: base }]);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    const requests = [];
    const scripts = [];
    page.on('request', req => requests.push(new URL(req.url()).pathname));
    page.on('response', res => { if (/\.js(?:\?|$)/.test(res.url())) scripts.push(new URL(res.url()).pathname); });
    const response = await page.goto(base + '/g', { waitUntil: 'networkidle' });
    assert.match(response.headers()['cache-control'], /private, no-cache/);
    assert.equal(response.headers()['netlify-cdn-cache-control'], 'no-store');
    assert.equal(await page.locator('main:visible').count(), 1);
    assert.equal(await page.locator('astro-island').count(), 0);
    assert.ok(!scripts.some(path => /react|AccountMenu|MobileMenu/.test(path) && !path.includes('ClientRouter')), scripts.join(', '));
    const account = page.getByRole('button', { name: 'Account menu', exact: true });
    await account.focus();
    await page.keyboard.press('Enter');
    await page.locator('.acct-pop:visible').waitFor();
    assert.equal(await account.getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    await page.locator('.acct-pop:visible').waitFor({ state: 'hidden' });
    assert.equal(await account.getAttribute('aria-expanded'), 'false');
    assert.ok(await account.evaluate(el => document.activeElement === el));
    await account.click();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Settings');
    await page.keyboard.press('Escape');
    if (width === 390) {
      const menu = page.getByRole('button', { name: 'Open menu' });
      await menu.focus(); await page.keyboard.press('Enter');
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Documents', exact: true }).waitFor();
      await page.keyboard.press('Escape');
      assert.ok(await menu.evaluate(el => el === document.activeElement));
      await menu.click();
    }
    await page.evaluate(() => {
      window.perfSidebar = document.querySelector('[data-portal-sidebar]');
      window.perfFrames = [];
      const sample = () => {
        const main = document.querySelector(innerWidth < 760 ? '.mwrap' : '.main');
        const chrome = document.querySelector(innerWidth < 760 ? '.mtop' : '.side');
        window.perfFrames.push({ content: !!main?.textContent.trim(), chrome: !!chrome?.getBoundingClientRect().height, background: getComputedStyle(document.body).backgroundColor });
        window.perfFrameId = requestAnimationFrame(sample);
      };
      sample();
    });
    const navigation = page.getByRole('navigation', { name: 'Main' });
    await navigation.getByRole('link', { name: 'Documents', exact: true }).click();
    await page.waitForURL(base + '/g/documents');
    await page.getByRole('heading', { name: 'Documents', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => window.perfSidebar === document.querySelector('[data-portal-sidebar]')));
    if (width === 1440) {
      assert.equal(await page.locator('.side .nav a[aria-current="page"]').getAttribute('href'), '/g/documents');
      // A tall fixture verifies the scrolling container independently of seed row count.
      await page.evaluate(() => {
        const pad = () => { const child = document.querySelector('.main > div'); if (child) child.style.minHeight = '2400px'; };
        document.addEventListener('astro:after-swap', pad); pad();
        document.querySelector(innerWidth < 760 ? '.mwrap' : '.main').scrollTop = 230;
      });
      await page.waitForFunction(() => document.querySelector(innerWidth < 760 ? '.mwrap' : '.main').scrollTop === 230);
      await page.locator('.side a[href="/g/students"]').click();
      await page.waitForURL(base + '/g/students');
      await page.getByRole('heading', { name: 'Students', exact: true }).waitFor();
      assert.equal(await page.locator('main:visible').evaluate(el => el.scrollTop), 0);
      await page.goBack();
      await page.waitForURL(base + '/g/documents');
      await page.waitForFunction(() => document.querySelector(innerWidth < 760 ? '.mwrap' : '.main').scrollTop === 230);
      await page.goForward();
      await page.waitForURL(base + '/g/students');
      await page.getByRole('heading', { name: 'Students', exact: true }).waitFor();
      assert.equal(await page.locator('main:visible').evaluate(el => el.scrollTop), 0);
    }
    const frames = await page.evaluate(() => { cancelAnimationFrame(window.perfFrameId); return window.perfFrames; });
    assert.ok(frames.length > 0);
    assert.ok(frames.every(frame => frame.content && frame.chrome && frame.background !== 'rgb(255, 255, 255)'), JSON.stringify(frames.filter(f => !f.content || !f.chrome)));
    assert.ok(!requests.some(path => /sign-out|auth\/|(?:-export)$|\/file$/.test(path)), requests.join(', '));
    // Native account behavior still works after swaps/persistence.
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.locator('.acct-pop:visible').waitFor();
    await page.keyboard.press('Escape');
    // Browser viewport changes retain one form/content tree and usable controls.
    await page.setViewportSize({ width: width === 1440 ? 390 : 1440, height: 844 });
    assert.equal(await page.locator('main:visible').count(), 1);
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.locator('.acct-pop:visible').waitFor();
    await page.keyboard.press('Escape');
    summary.push({ width, frameCount: frames.length, blankFrames: frames.filter(f => !f.content || !f.chrome).length, scripts: [...new Set(scripts)] });
    // Exercise the unchanged POST/CSRF/session flow through each replacement menu.
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await page.waitForURL(/\/\?signedout=1$/);
    assert.ok(!(await context.cookies()).some(cookie => cookie.name === 'tca_family_session'));
    await context.tracing.stop({ path: `${out}/after/navigation-${width}.zip` });
    await context.close();
  }
} finally { await browser.close(); }
writeFileSync(`${out}/after/navigation.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
