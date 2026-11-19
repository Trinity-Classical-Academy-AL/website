import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { db } from '@tca/school';

const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4323';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local preview only');
assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(new URL(process.env.DATABASE_URL).hostname), 'Local test DB only');
const seed = JSON.parse(readFileSync('/tmp/tca-e2e-seed.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
 for (const width of [390, 1440]) {
  const id = randomUUID();
  const email = `verified-${id}@example.com`;
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
  try {
   await db()`insert into family_emails (id, family_id, email, is_primary, verified_at)
    values (${id}, ${seed.ada.id}, ${email}, false, now())`;
   await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
   await context.addCookies([{ name: 'tca_family_session', value: seed.cookies.ada, url: base }]);
   const page = await context.newPage();
   page.setDefaultTimeout(7000);
   await page.goto(base + '/account', { waitUntil: 'networkidle' });
   const row = page.locator(`[data-row="${id}"]`);
   await row.getByRole('link', { name: 'Remove', exact: true }).click();
   const dialog = page.getByRole('dialog', { name: 'Remove email', exact: true });
   await dialog.waitFor();
   // A real pointer click must hit the button at both viewport widths.
   await dialog.getByRole('button', { name: 'Remove email', exact: true }).click();
   await page.waitForURL(url => url.pathname === '/account' && url.searchParams.get('notice') === 'Email removed.');
   assert.equal(await page.locator(`[data-row="${id}"]`).count(), 0);
   assert.equal((await db()`select id from family_emails where id = ${id}`).length, 0);
   await page.reload({ waitUntil: 'networkidle' });
   assert.equal(await page.locator(`[data-row="${id}"]`).count(), 0);
   console.log(`verified email removal passed at ${width}px`);
  } finally {
   await context.close();
   await db()`delete from family_emails where id = ${id}`;
  }
 }
} finally {
 await browser.close();
 await db().end();
}
