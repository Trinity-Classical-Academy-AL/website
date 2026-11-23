import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4323';
const seed = JSON.parse(readFileSync(process.env.PERF_SEED || '/tmp/tca-e2e-seed.json', 'utf8'));
const browser = await chromium.launch({
	executablePath: process.env.CHROME_PATH || undefined,
	args: ['--no-sandbox'],
});

async function contextFor(token, options = {}) {
	const context = await browser.newContext(options);
	if (token) await context.addCookies([{ name: 'tca_family_session', value: token, url: base }]);
	return context;
}

async function text(token, path) {
	const context = await contextFor(token);
	const page = await context.newPage();
	const response = await page.goto(base + path, { waitUntil: 'domcontentloaded' });
	const body = await page.locator('body').innerText();
	await context.close();
	return { status: response?.status() ?? 0, url: page.url(), body };
}

try {
const anon = await text('', '/');
assert.match(anon.body, /Sign in to TCA Portal/);
const signedOut = await text('', '/?signedout=1');
assert.match(signedOut.body, /You’re signed out/);
const google = await text('', '/auth/google');
assert.ok(google.url.includes('error=google') || google.url.includes('accounts.google.com'), google.url);

const context = await browser.newContext();
const page = await context.newPage();
await page.goto(base + '/');
await page.fill('#email', 'not-an-email');
await page.getByRole('button', { name: 'Continue' }).click();
const invalid = await page.locator('#email').evaluate((el) => el.validationMessage);
assert.match(invalid, /email/i);
assert.doesNotMatch(page.url(), /\/password/);
await page.goto(base + '/');
await page.fill('#email', seed.pat.email);
await page.getByRole('button', { name: 'Continue' }).click();
await page.waitForURL(/\/password/);
assert.match(page.url(), /password/);
await page.waitForLoadState('networkidle');
await page.evaluate(() => { window.__passwordDocument = 'same-document'; });
const passwordInput = page.locator('input[name="password"]').filter({ visible: true });
const visibilityToggle = page.locator('.pw-t').filter({ visible: true });
await visibilityToggle.click();
assert.equal(await passwordInput.getAttribute('type'), 'text');
await visibilityToggle.click();
assert.equal(await passwordInput.getAttribute('type'), 'password');
await page.locator('input[name="password"]').filter({ visible: true }).fill(seed.password);
await page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true }).click();
await page.waitForURL(/\/home$/);
assert.equal(await page.evaluate(() => window.__passwordDocument), 'same-document');
assert.ok((await context.cookies()).some(cookie => cookie.name === 'tca_family_session' && cookie.httpOnly));
await context.close();

const home = await text(seed.cookies.pat, '/home');
assert.equal(home.status, 200);
assert.match(home.url, /\/home$/);
assert.doesNotMatch(home.body, /Your family/);
const oldFamily = await text(seed.cookies.pat, '/your-family');
assert.match(oldFamily.url, /\/home$/);
const tour = await text(seed.cookies.pat, '/tour');
assert.match(tour.body, /Request a tour/);
const guardianHome = await text(seed.cookies.ada, '/g');
// 2026-11 classroom release: the guardian home's to-do card is now "Needs your attention".
assert.match(guardianHome.body, /Needs your attention/);
// 2026-11 classroom release: documents are in two tabs, the family's own and the school library.
const docs = await text(seed.cookies.ada, '/g/documents');
assert.match(docs.body, /Ada report card/);
const library = await text(seed.cookies.ada, '/g/documents?tab=library');
assert.match(library.body, /Family handbook/);
const hidden = await text(seed.cookies.bea, '/g/documents');
assert.doesNotMatch(hidden.body, /Ada report card/);
const hiddenLibrary = await text(seed.cookies.bea, '/g/documents?tab=library');
assert.doesNotMatch(hiddenLibrary.body, /Ada report card/);
assert.match(hiddenLibrary.body, /Family handbook/);
const forms = await text(seed.cookies.ada, '/g/forms');
assert.match(forms.body, /Photo release/);
const announcements = await text(seed.cookies.ada, '/g/announcements');
assert.equal(announcements.status, 200);

const adaContext = await contextFor(seed.cookies.ada);
const adaRequest = await adaContext.request.get(`${base}/g/documents/file?id=${seed.privateDoc}`);
assert.equal(adaRequest.status(), 200);
assert.match(adaRequest.headers()['content-disposition'] || '', /attachment/);
assert.equal(adaRequest.headers()['x-content-type-options'], 'nosniff');
const beaContext = await contextFor(seed.cookies.bea);
const stolen = await beaContext.request.get(`${base}/g/documents/file?id=${seed.privateDoc}`);
assert.equal(stolen.status(), 404);
const signedOutFile = await (await browser.newContext()).request.get(`${base}/g/documents/file?id=${seed.privateDoc}`);
assert.ok(signedOutFile.status() === 302 || signedOutFile.status() === 401 || signedOutFile.url().endsWith('/'));
await adaContext.close();
await beaContext.close();

// 2026-11 classroom release: tours live on the calendar, so the old tours sheet redirects there.
const admin = await text(seed.cookies.office, '/admin/tours?sheet=add');
assert.match(admin.url, /\/admin\/calendar\?type=tour$/);
assert.match(admin.body, /Calendar/);
assert.doesNotMatch(admin.body, /You don’t have access/);
for (const path of ['/admin/prospects', '/admin/families', '/admin/staff', '/admin/documents', '/admin/events', '/admin/website']) {
	const view = await text(seed.cookies.office, path);
	assert.equal(view.status, 200, path);
	assert.doesNotMatch(view.body, /You don’t have access/);
}
const prospectAdmin = await text(seed.cookies.pat, '/admin/tours');
assert.match(prospectAdmin.body, /don’t have access/);
const missing = await text(seed.cookies.ada, '/not-a-real-page');
assert.match(missing.body, /Page not found/);
const health = await (await browser.newContext()).request.get(`${base}/health`);
assert.equal(health.status(), 200);
assert.match(await health.text(), /"ok":true/);

const mobile = await contextFor(seed.cookies.ada, { viewport: { width: 390, height: 844 } });
const mobilePage = await mobile.newPage();
await mobilePage.goto(base + '/g', { waitUntil: 'networkidle' });
const openMenu = mobilePage.getByRole('button', { name: 'Open menu' });
await openMenu.click();
const opened = mobilePage.getByRole('button', { name: 'Close menu' });
try {
	await opened.waitFor({ state: 'attached', timeout: 1500 });
} catch {
	await openMenu.click();
	await opened.waitFor({ state: 'attached' });
}
await mobilePage.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Documents', exact: true }).waitFor({ state: 'visible' });
await mobile.close();

// Timings must be numeric and request scoped, including auth redirects.
// Query ceilings, 2026-11 classroom release: the count measured on the fresh CI seed plus a margin of 2.
// Measured after cutting duplicate reads on /admin (14 -> 13) and /account (18 -> 14; a new account's first
// visit also repairs its guardian rows): /admin 13, /admin/tours 7 (it now redirects to the calendar, which
// this follows), /admin/families 8, /g 10, /account 14, /home 10. The pages show more than they used to.
for (const [path, token, maxQueries] of [
	['/admin', seed.cookies.office, 15], ['/admin/tours', seed.cookies.office, 9],
	['/admin/families', seed.cookies.office, 10], ['/g', seed.cookies.ada, 12],
	['/account', seed.cookies.pat, 16], ['/home', seed.cookies.pat, 12],
	['/', '', 0],
]) {
	const requestContext = await contextFor(token);
	try {
		const response = await requestContext.request.get(base + path);
		assert.equal(response.status(), 200, path);
		const timing = response.headers()['server-timing'] || '';
		assert.match(timing, /total;dur=\d+\.\d+, db;dur=\d+\.\d+/);
		const queries = Number(timing.match(/queries;desc="(\d+)"/)?.[1] ?? NaN);
		assert.ok(queries <= maxQueries, `${path}: ${queries} queries, ceiling ${maxQueries}`);
	} finally { await requestContext.close(); }
}
const rejected = await (await browser.newContext()).request.post(base + '/account', { headers: { origin: 'https://example.com' }, maxRedirects: 0 });
assert.equal(rejected.status(), 403);
// Astro may reject cross-origin POSTs before user middleware runs.
const redirect = await (await browser.newContext()).request.get(base + '/admin', { maxRedirects: 0 });
assert.equal(redirect.status(), 302);
assert.match(redirect.headers()['server-timing'], /queries;desc="0"/);
console.log('portal flows passed');
} finally {
	await browser.close();
}
