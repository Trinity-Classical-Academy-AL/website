// Run against tests/e2e/preview.mjs. One browser/page at a time; no email or mutating requests.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4397';
const stage = process.env.PERF_STAGE || 'after';
const out = process.env.PERF_SHOTS || '/home/bryant/work/tca/perf-shots/client-assets';
const seed = JSON.parse(readFileSync(process.env.PERF_SEED || '/tmp/tca-e2e-seed.json'));
mkdirSync(`${out}/${stage}`, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const results = { pages: [], diffs: [] };
const partial = Boolean(process.env.PERF_PAGES || process.env.PERF_WIDTH || process.env.PERF_ROLE);
const common = ['/account', '/account?dialog=name', '/settings', '/no-access', '/not-a-real-page'];
const routes = {
  anon: ['/', '/signup', '/password', '/forgot', '/sent', '/reset-expired', '/google-unavailable', '/interested', '/tour'],
  pat: ['/home', '/tour', '/tour?other=1', '/events', '/question', ...common],
  ada: ['/g', '/g/students', '/g/calendar', '/g/announcements', '/g/documents', `/g/documents/${seed.privateDoc}`, '/g/forms', '/g/forms?tab=submitted', ...common],
  office: ['/admin', '/admin/prospects', `/admin/prospects/${seed.pat.id}`, '/admin/inquiries', '/admin/tours', '/admin/tours?tab=requests', '/admin/tours?tab=bookings', '/admin/tours?sheet=add', '/admin/events', '/admin/families', `/admin/families/${seed.ada.id}`, '/admin/staff', '/admin/documents', '/admin/documents?sheet=upload', '/admin/documents?tab=forms', '/admin/documents?tab=forms&sheet=form', '/admin/website', ...common],
};
try {
  for (const [role, paths] of Object.entries(process.env.PERF_PAGES ? JSON.parse(process.env.PERF_PAGES) : routes)) {
    if (process.env.PERF_ROLE && process.env.PERF_ROLE !== role) continue;
    for (const width of [1440, 390]) {
      if (process.env.PERF_WIDTH && Number(process.env.PERF_WIDTH) !== width) continue;
      const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 900 : 844 } });
      if (seed.cookies[role]) await context.addCookies([{ name: 'tca_family_session', value: seed.cookies[role], url: base }]);
      const page = await context.newPage();
      const js = new Map();
      const pending = [];
      page.on('response', response => {
        if (/\/_astro\/.*\.js(?:\?|$)/.test(response.url())) pending.push(response.body().then(body => js.set(response.url(), gzipSync(body).length)).catch(() => {}));
      });
      // Include seeded dynamic form pages, discovered without submitting anything.
      if (role === 'ada' && width === 1440) {
        await page.goto(base + '/g/forms');
        const form = await page.locator('a[href^="/g/forms/"]').first().getAttribute('href');
        if (form && !paths.includes(form)) paths.push(form);
      }
      for (const path of paths) {
        js.clear(); pending.length = 0;
        const response = await page.goto(base + path, { waitUntil: 'networkidle' });
        if (response.status() >= 500) {
          if (stage !== 'before') {
            const baseline = JSON.parse(readFileSync(`${out}/before/results.json`));
            assert.ok(baseline.pages.some(p => p.role === role && p.path === path && p.status === response.status()), `new route failure: ${role} ${path}`);
          }
          results.pages.push({ role, path, status: response.status() }); console.log(`BASELINE ROUTE ERROR: ${role} ${path}: ${response.status()}`); continue; }
        await page.evaluate(() => document.fonts.ready);
        // optional fonts can remain in fallback on the first cold render; warm them and reload
        // for the loaded-font pixel contract. Cold behavior is measured separately by Lighthouse.
        await page.reload({ waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await Promise.all(pending);
        const html = await (await context.request.get(base + path)).body();
        const label = `${role}-${width}-${path.replace(/[^a-z0-9]/gi, '_')}`;
        const capture = async (suffix = '') => {
          const name = label + suffix + '.png';
          const shot = await page.screenshot({ path: `${out}/${stage}/${name}`, fullPage: true, animations: 'disabled' });
          const before = `${out}/before/${name}`;
          if (stage !== 'before' && existsSync(before)) {
            const a = PNG.sync.read(readFileSync(before));
            const b = PNG.sync.read(shot);
            let changed = -1;
            if (a.width === b.width && a.height === b.height) {
              const diff = new PNG({ width: a.width, height: a.height });
              changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
              const diffPath = `${out}/${stage}/${label}${suffix}-diff.png`;
              if (changed) writeFileSync(diffPath, PNG.sync.write(diff));
              else if (existsSync(diffPath)) unlinkSync(diffPath);
            }
            results.diffs.push({ name, changed, before: [a.width, a.height], after: [b.width, b.height] });
          }
        };
        await capture();
        if (['/home', '/g', '/admin'].includes(path)) {
          const trigger = page.getByRole('button', { name: 'Account menu', exact: true });
          if (await trigger.isVisible()) {
            await trigger.click(); await capture('-account');
            await page.keyboard.press('Escape');
            if (stage !== 'before') { await assert.doesNotReject(() => page.locator('.acct-pop:visible').waitFor({ state: 'hidden', timeout: 2000 })); await assert.equal(await trigger.evaluate(el => el === document.activeElement), true); }
          }
          if (width === 390) {
            await page.reload({ waitUntil: 'networkidle' });
            await page.getByRole('button', { name: 'Open menu', exact: true }).click();
            await capture('-menu');
          }
        }
        if (width === 1440 && ['/', '/home', '/g', '/admin', '/admin/tours'].includes(path)) {
          results.pages.push({ role, path, htmlBytes: html.length, jsGzipBytes: [...js.values()].reduce((a,b) => a+b,0), jsFiles: [...js.keys()].map(url => new URL(url).pathname), islands: await page.locator('astro-island').count(), domNodes: await page.locator('*').count() });
        }
        console.log(`${stage}: ${role} ${width} ${path}`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  if (partial && existsSync(`${out}/${stage}/results.json`)) {
    const previous = JSON.parse(readFileSync(`${out}/${stage}/results.json`));
    results.pages = [...previous.pages.filter(p => !results.pages.some(n => n.role === p.role && n.path === p.path)), ...results.pages];
    results.diffs = [...previous.diffs.filter(p => !results.diffs.some(n => n.name === p.name)), ...results.diffs];
  }
  writeFileSync(`${out}/${stage}/results.json`, JSON.stringify(results, null, 2));
}
console.log(JSON.stringify({ pages: results.pages, diffs: results.diffs.filter(x => x.changed !== 0) }, null, 2));

if (stage !== 'before') assert.deepEqual(results.diffs.filter(diff => diff.changed !== 0), [], 'visual regression against baseline');
