import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4323';
const seed = JSON.parse(readFileSync('/tmp/tca-e2e-seed.json', 'utf8'));
const browser = await chromium.launch({
	executablePath: process.env.CHROME_PATH || undefined,
	args: ['--no-sandbox'],
});

function contextFor(token) {
	return browser.newContext({
		extraHTTPHeaders: token ? { cookie: `tca_family_session=${token}` } : {},
	});
}

async function text(token, path) {
	const context = await contextFor(token);
	const page = await context.newPage();
	const response = await page.goto(base + path, { waitUntil: 'domcontentloaded' });
	const body = await page.locator('body').innerText();
	await context.close();
	return { status: response?.status() ?? 0, url: page.url(), body };
}

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
await page.waitForTimeout(500);
assert.match(await page.locator('body').innerText(), /Enter an email/);
await page.goto(base + '/');
await page.fill('#email', seed.pat.email);
await page.getByRole('button', { name: 'Continue' }).click();
await page.waitForURL(/\/password/);
assert.match(page.url(), /password/);
await context.close();

const home = await text(seed.pat, '/home');
assert.equal(home.status, 200);
assert.doesNotMatch(home.body, /Your family/);
const oldFamily = await text(seed.pat, '/your-family');
assert.match(oldFamily.url, /\/home$/);
const tour = await text(seed.pat, '/tour');
assert.match(tour.body, /Request a tour/);
const guardianHome = await text(seed.ada, '/g');
assert.match(guardianHome.body, /Forms to do/);
const docs = await text(seed.ada, '/g/documents');
assert.match(docs.body, /Ada report card/);
assert.match(docs.body, /Family handbook/);
const hidden = await text(seed.bea, '/g/documents');
assert.doesNotMatch(hidden.body, /Ada report card/);
assert.match(hidden.body, /Family handbook/);
const forms = await text(seed.ada, '/g/forms');
assert.match(forms.body, /Photo release/);
const announcements = await text(seed.ada, '/g/announcements');
assert.equal(announcements.status, 200);

const adaContext = await contextFor(seed.ada);
const adaRequest = await adaContext.request.get(`${base}/g/documents/file?id=${seed.privateDoc}`);
assert.equal(adaRequest.status(), 200);
assert.match(adaRequest.headers()['content-disposition'] || '', /attachment/);
assert.equal(adaRequest.headers()['x-content-type-options'], 'nosniff');
const beaContext = await contextFor(seed.bea);
const stolen = await beaContext.request.get(`${base}/g/documents/file?id=${seed.privateDoc}`);
assert.equal(stolen.status(), 404);
const signedOutFile = await (await browser.newContext()).request.get(`${base}/g/documents/file?id=${seed.privateDoc}`);
assert.ok(signedOutFile.status() === 302 || signedOutFile.status() === 401 || signedOutFile.url().endsWith('/'));
await adaContext.close();
await beaContext.close();

const admin = await text(seed.office, '/admin/tours?sheet=add');
assert.match(admin.body, /Add a time/);
assert.match(admin.body, /Open house/);
for (const path of ['/admin/prospects', '/admin/families', '/admin/staff', '/admin/documents', '/admin/events', '/admin/website']) {
	const view = await text(seed.office, path);
	assert.equal(view.status, 200, path);
	assert.doesNotMatch(view.body, /You don’t have access/);
}
const prospectAdmin = await text(seed.pat, '/admin/tours');
assert.match(prospectAdmin.body, /don’t have access/);
const missing = await text(seed.ada, '/not-a-real-page');
assert.match(missing.body, /Page not found/);
const health = await (await browser.newContext()).request.get(`${base}/health`);
assert.equal(health.status(), 200);
assert.match(await health.text(), /"ok":true/);

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { cookie: `tca_family_session=${seed.ada}` } });
const mobilePage = await mobile.newPage();
await mobilePage.goto(base + '/g');
await mobilePage.getByRole('button', { name: 'Open menu' }).click();
assert.match(await mobilePage.locator('body').innerText(), /Documents/);
await mobile.close();

await browser.close();
console.log('portal flows passed');
