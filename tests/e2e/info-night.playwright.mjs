import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { handleAdmissionsRequest } from '../../src/lib/admissions/http.ts';
import { chromium } from 'playwright';
import { db, dbReady } from '@tca/school';
import { INFO_NIGHT_ID } from '../../packages/school/src/schema.ts';

const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4417';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Use the local preview only');
assert.equal(process.env.RESEND_API_KEY || '', '', 'Local verification must not send emails');
const seed = JSON.parse(readFileSync('/tmp/tca-e2e-seed.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const stamp = Date.now();
const email = `info-night-${stamp}@example.com`;
const guestName = `Guest Family ${stamp}`;
const interviewName = `Interview ${stamp}`;
let admin;
try {
	await dbReady();
	const anonymous = await browser.newContext();
	const page = await anonymous.newPage();
	await page.goto(`${base}/rsvp/${INFO_NIGHT_ID}`);
	await page.getByRole('heading', { name: 'Information & Enrollment Night' }).waitFor();
	assert.match(await page.locator('body').innerText(), /Tuesday, January 26, 2027 · 6:30 pm/);
	await page.getByLabel('Name', { exact: true }).fill(guestName);
	await page.getByLabel('Email', { exact: true }).fill(email);
	await page.getByLabel('Number attending').fill('3');
	await page.getByLabel('Note').fill('Two adults and one child');
	await page.getByRole('button', { name: 'RSVP', exact: true }).click();
	await page.getByRole('status').filter({ hasText: "You're on the list. See you on Tuesday, January 26." }).waitFor();
	await page.getByRole('link', { name: 'Change your response' }).click();
	await page.getByLabel('Name', { exact: true }).fill(guestName);
	await page.getByLabel('Email', { exact: true }).fill(email.toUpperCase());
	await page.getByLabel('Number attending').fill('4');
	await page.getByLabel('Note').fill('Updated to four');
	await page.getByRole('button', { name: 'RSVP', exact: true }).click();
	await page.getByRole('status').filter({ hasText: "You're on the list" }).waitFor();
	const [guest] = await db()`select count(*)::int as responses, sum(head_count)::int as heads from event_guest_rsvps where event_id = ${INFO_NIGHT_ID} and email = ${email}`;
	assert.deepEqual({ ...guest }, { responses: 1, heads: 4 });
	const missing = await page.goto(`${base}/rsvp/not-an-event`);
	assert.equal(missing.status(), 404);
	assert.match(await page.locator('body').innerText(), /Event not found/);

	admin = await browser.newContext();
	await admin.addCookies([{ name: 'tca_family_session', value: seed.cookies.office, url: base }]);
	const staff = await admin.newPage();
	await staff.goto(`${base}/admin/events?event=${INFO_NIGHT_ID}`);
	const guestList = staff.getByRole('dialog', { name: 'Edit event' });
	await guestList.getByText(guestName, { exact: true }).waitFor();
	assert.match(await guestList.innerText(), /4 attending/);
	assert.match(await guestList.innerText(), /Updated to four/);
	const csv = await admin.request.get(`${base}/admin/event-guests-export?id=${INFO_NIGHT_ID}`);
	assert.equal(csv.status(), 200);
	assert.match(await csv.text(), new RegExp(guestName));

	await page.goto(`${base}/interview`);
	assert.equal(await page.locator('[data-child]:visible').count(), 1);
	await page.getByLabel('First Name', { exact: true }).fill(interviewName);
	await page.getByLabel('Last Name', { exact: true }).fill('Example');
	await page.getByLabel('Email', { exact: true }).fill(seed.pat.email);
	await page.getByLabel('Phone Number', { exact: true }).fill('2055550101');
	await page.getByLabel('Which year are you hoping to enroll in?').fill('2027-2028');
	await page.locator('[name="child.0.name"]').fill('Jamie Example');
	await page.locator('[name="child.0.currentGrade"]').fill('Kindergarten');
	await page.locator('[name="child.0.dateOfBirth"]').fill('2021-05-12');
	await page.locator('[name="child.0.school"]').fill('Example School');
	await page.locator('[name="child.0.description"]').fill('Loves reading');
	await page.getByRole('button', { name: 'Add another child' }).click();
	assert.equal(await page.locator('[data-child]:visible').count(), 2);
	await page.locator('[name="child.1.name"]').fill('Robin Example');
	await page.locator('[name="child.1.currentGrade"]').fill('3rd grade');
	await page.getByLabel('Church Name', { exact: false }).fill('Example Church');
	await page.getByRole('button', { name: 'Request an interview', exact: true }).click();
	await page.getByRole('status').filter({ hasText: 'We received your request' }).waitFor();
	const [inquiry] = await db()`select id, details, autoreply_sent_at from inquiries where email = ${seed.pat.email} order by created_at desc limit 1`;
	assert.equal(inquiry.details.children.length, 2);
	assert.equal(inquiry.autoreply_sent_at, null);
	await staff.goto(`${base}/admin/inquiries`);
	await staff.getByRole('link', { name: `${interviewName} Example`, exact: true }).click();
	const detail = staff.getByRole('dialog', { name: 'Inquiry details' });
	await detail.getByText(/Robin Example/).waitFor();
	assert.match(await detail.innerText(), /Jamie Example/);
	assert.match(await detail.innerText(), /Example Church/);
	await staff.goto(`${base}/admin/prospects`);
	await staff.getByText(`${interviewName} Example`, { exact: true }).filter({ visible: true }).waitFor();
	await staff.goto(`${base}/admin/inquiries`);
	const toggle = staff.getByRole('checkbox', { name: /Send an automatic reply/ });
	assert.equal(await toggle.isChecked(), false);
	await staff.getByText('Preview automatic reply', { exact: true }).filter({ visible: true }).click();
	assert.match(await staff.locator('body').innerText(), /Hi Alex,/);
	assert.match(await staff.locator('body').innerText(), /Information & Enrollment Night on Tuesday, January 26 at 6:30 pm/);
	await toggle.check();
	await staff.getByRole('button', { name: 'Save automatic reply setting' }).click();
	await staff.waitForURL(`${base}/admin/inquiries`);
	assert.equal(await toggle.isChecked(), true);
	await toggle.uncheck();
	await staff.getByRole('button', { name: 'Save automatic reply setting' }).click();
	await staff.waitForURL(`${base}/admin/inquiries`);
	assert.equal(await toggle.isChecked(), false);

	// The forms work at phone width without horizontal overflow or wrapping pill labels.
	const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const phone = await mobile.newPage();
	for (const path of [`/rsvp/${INFO_NIGHT_ID}`, '/interview']) {
		await phone.goto(base + path);
		await phone.locator('h1').waitFor();
		assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path);
		for (const button of await phone.locator('button:visible').all()) assert.ok(await button.evaluate((el) => el.scrollWidth <= el.clientWidth), path);
	}
	await phone.screenshot({ path: `${process.env.TMPDIR || '/tmp'}/interview-mobile.png`, fullPage: true });
	await mobile.close();

	// Without JavaScript all three blocks are available; blank extras are ignored.
	const nojs = await browser.newContext({ javaScriptEnabled: false });
	const fallback = await nojs.newPage();
	await fallback.goto(`${base}/interview`);
	assert.equal(await fallback.locator('[data-child]:visible').count(), 3);
	await fallback.getByLabel('First Name', { exact: true }).fill('Nojs');
	await fallback.getByLabel('Last Name', { exact: true }).fill('Example');
	await fallback.getByLabel('Email', { exact: true }).fill(`nojs-${stamp}@example.com`);
	await fallback.getByLabel('Phone Number', { exact: true }).fill('2055550101');
	await fallback.getByLabel('Which year are you hoping to enroll in?').fill('2027-2028');
	await fallback.locator('[name="child.0.name"]').fill('Child Example');
	await fallback.getByRole('button', { name: 'Request an interview', exact: true }).click();
	await fallback.getByRole('status').filter({ hasText: 'We received your request' }).waitFor();
	await nojs.close();

	// Exports and setting writes are protected even when called directly.
	for (const token of ['', seed.cookies.pat]) {
		const restricted = await browser.newContext();
		if (token) await restricted.addCookies([{ name: 'tca_family_session', value: token, url: base }]);
		for (const path of [`/admin/event-guests-export?id=${INFO_NIGHT_ID}`, '/admin/inquiries-export']) {
			const denied = await restricted.request.get(base + path, { maxRedirects: 0 });
			assert.ok([302, 401, 403].includes(denied.status()), `${path}: ${denied.status()}`);
			assert.doesNotMatch(denied.headers()['content-type'] || '', /csv/);
		}
		const denied = await restricted.request.post(`${base}/admin/inquiries`, { form: { action: 'autoreply', enabled: 'on' }, maxRedirects: 0 });
		assert.ok([302, 401, 403].includes(denied.status()));
		await restricted.close();
	}
	const csrfDenied = await admin.request.post(`${base}/admin/inquiries`, { form: { action: 'autoreply', enabled: 'on', csrf: 'invalid' } });
	assert.match(await csrfDenied.text(), /request expired/);
	assert.equal((await db()`select value from settings where key = 'inquiry_autoreply_enabled'`)[0].value, false);
	// Serve the built homepage through browser interception; the API payload comes from local Postgres.
	// This also blocks analytics and every external request during the website checks.
	const bannerResponse = await handleAdmissionsRequest(new Request(`${base}/api/banner`));
	assert.equal(bannerResponse.status, 200);
	const banner = await bannerResponse.json();
	assert.equal(banner.active, true);
	assert.equal(banner.flyer, null);
	assert.match(banner.modal.whenLabel, /Tuesday, January 26, 2027 · 6:30 pm/);
	assert.ok(banner.modal.rsvpUrl.endsWith(`/rsvp/${INFO_NIGHT_ID}`));
	const site = await browser.newContext();
	const publicRoot = resolve('dist');
	const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
	await site.route('**/*', async (route) => {
		const url = new URL(route.request().url());
		if (url.origin !== base) return route.abort();
		if (url.pathname === '/api/banner') return route.fulfill({ json: banner });
		const path = resolve(publicRoot, url.pathname === '/website-home' ? 'index.html' : '.' + url.pathname);
		if (!path.startsWith(publicRoot + '/')) return route.abort();
		try { await route.fulfill({ body: readFileSync(path), contentType: mime[extname(path)] || 'application/octet-stream' }); }
		catch { await route.abort(); }
	});
	const home = await site.newPage();
	for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
		await home.setViewportSize(viewport);
		await home.goto(`${base}/website-home`);
		await home.locator('[data-banner-bar]').waitFor({ state: 'visible' });
		await home.getByText('View details', { exact: true }).click();
		const modal = home.getByRole('dialog');
		await modal.waitFor({ state: 'visible' });
		assert.ok(await modal.evaluate((el) => el.contains(document.activeElement)), 'Opening the modal moves focus inside');
		assert.match(await modal.innerText(), /Information & Enrollment Night/);
		assert.match(await modal.innerText(), /Tuesday, January 26, 2027 · 6:30 pm/);
		assert.match(await modal.innerText(), /Light refreshments/);
		assert.equal(await modal.locator('[data-modal-media]').isVisible(), false);
		await modal.getByRole('link', { name: 'RSVP (optional)' }).waitFor({ state: 'visible' });
		assert.ok(await home.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		await home.screenshot({ path: `${process.env.TMPDIR || '/tmp'}/info-night-modal-${viewport.width}.png`, fullPage: true });
		await home.keyboard.press('Escape');
		assert.equal(await modal.isVisible(), false);
	}
	await site.close();
	console.log('info night flows passed (guest upsert, interview children, admin, toggle, mobile, no-JS, security)');
} finally {
	await db()`insert into settings (key, value) values ('inquiry_autoreply_enabled', 'false'::jsonb) on conflict (key) do update set value = excluded.value`;
	await browser.close();
	await db().end();
}
