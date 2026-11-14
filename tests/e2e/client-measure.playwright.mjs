import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4397';
const stage = process.env.PERF_STAGE || 'after';
const out = process.env.PERF_SHOTS || '/home/bryant/work/tca/perf-shots/client-assets';
const seed = JSON.parse(readFileSync(process.env.PERF_SEED || '/tmp/tca-e2e-seed.json'));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] });
const results = [];
mkdirSync(`${out}/${stage}`, { recursive: true });
try {
  for (const [role, path] of [['anon', '/'], ['pat', '/home'], ['ada', '/g'], ['office', '/admin'], ['office', '/admin/tours']]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    if (seed.cookies[role]) await context.addCookies([{ name: 'tca_family_session', value: seed.cookies[role], url: base }]);
    const page = await context.newPage();
    const js = new Map(), pending = [];
    page.on('response', res => { if (/\/_astro\/.*\.js(?:\?|$)/.test(res.url())) pending.push(res.body().then(body => js.set(new URL(res.url()).pathname, gzipSync(body).length))); });
    const response = await page.goto(base + path, { waitUntil: 'networkidle' });
    const html = await response.text();
    await Promise.all(pending);
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([,attrs]) => !/\bsrc\s*=|application\/(?:ld\+)?json/i.test(attrs)).map(([, ,code]) => code).join('\n');
    const externalJsGzip = [...js.values()].reduce((a,b) => a+b, 0);
    const inlineJsGzip = inline ? gzipSync(inline).length : 0;
    results.push({ role, path, status: response.status(), htmlBytes: Buffer.byteLength(html), htmlGzipBytes: gzipSync(html).length, externalJsGzip, inlineJsGzip, totalJsGzip: externalJsGzip + inlineJsGzip, jsFiles: Object.fromEntries(js), islands: await page.locator('astro-island').count(), fontPreloads: await page.locator('link[rel="preload"][as="font"]').count() });
    await context.close();
  }
  // Capture loaded-font account styles separately for diagnosing pixel differences.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: 'tca_family_session', value: seed.cookies.pat, url: base }]);
  const page = await context.newPage(); await page.goto(base + '/home', { waitUntil: 'networkidle' }); await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  const styles = await page.locator('.sheet-pop').evaluate(el => [...el.querySelectorAll('.h3,.mute,.av,a,button')].map(e => {
    const s = getComputedStyle(e); return { tag: e.tagName, class: e.className, family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, color: s.color, lineHeight: s.lineHeight, smoothing: s.webkitFontSmoothing, rect: e.getBoundingClientRect().toJSON() };
  }));
  writeFileSync(`${out}/${stage}/account-styles.json`, JSON.stringify(styles, null, 2));
  await context.close();
} finally { await browser.close(); }
writeFileSync(`${out}/${stage}/metrics.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results.map(({jsFiles, ...row}) => row), null, 2));
