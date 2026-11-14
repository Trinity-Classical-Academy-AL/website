import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4397';
const stage = process.env.PERF_STAGE || 'after';
const out = process.env.PERF_SHOTS || '/home/bryant/work/tca/perf-shots/client-assets';
const seed = JSON.parse(readFileSync(process.env.PERF_SEED || '/tmp/tca-e2e-seed.json'));
mkdirSync(`${out}/${stage}`, { recursive: true });
const results = [];
for (const [name, path, cookie] of [['login', '/', ''], ['guardian', '/g', seed.cookies.ada]]) {
  const profile = mkdtempSync(`${process.env.TMPDIR || '/tmp'}/client-lh-`);
  const chrome = await launch({ userDataDir: profile, chromePath: process.env.CHROME_PATH, chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const result = await lighthouse(base + path, { port: chrome.port, output: 'html', logLevel: 'error', onlyCategories: ['performance'], extraHeaders: cookie ? { Cookie: `tca_family_session=${cookie}` } : {} });
    const { lhr } = result;
    const audits = lhr.audits;
    results.push({ name, score: lhr.categories.performance.score * 100, fcp: audits['first-contentful-paint'].numericValue, lcp: audits['largest-contentful-paint'].numericValue, cls: audits['cumulative-layout-shift'].numericValue, tbt: audits['total-blocking-time'].numericValue, transfer: audits['total-byte-weight'].numericValue, finalUrl: lhr.finalDisplayedUrl });
    writeFileSync(`${out}/${stage}/lighthouse-${name}.html`, cookie ? result.report.replaceAll(cookie, '[redacted]') : result.report);
    // Do not save lhr.configSettings: it contains the authentication header.
  } finally { await chrome.kill(); rmSync(profile, { recursive: true, force: true }); }
}
writeFileSync(`${out}/${stage}/lighthouse.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
