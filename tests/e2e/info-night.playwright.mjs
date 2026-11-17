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
const guestName = `Legacy Family ${stamp}`;
const interviewName = `Interview ${stamp}`;
let admin;
try {
	await dbReady();
	const anonymous = await browser.newContext();
	const page = await anonymous.newPage();
	const entry = await anonymous.request.get(`${base}/rsvp/${INFO_NIGHT_ID}`, { maxRedirects: 0 });
	assert.equal(entry.status(), 303);
	const signon = new URL(entry.headers().location);
	assert.equal(signon.origin, base);
	assert.equal(signon.pathname, '/');
	assert.equal(signon.searchParams.get('next'), `/rsvp/${INFO_NIGHT_ID}`);
	await page.goto(`${base}/rsvp/${INFO_NIGHT_ID}`);
	assert.equal(new URL(page.url()).pathname, '/');
	await page.locator('[data-rsvp-return]').filter({ hasText: 'Create an account or sign in to RSVP for Information & Enrollment Night.' }).waitFor();
	const rsvpPath = `/rsvp/${INFO_NIGHT_ID}`;
	async function captureRsvp(page, state) {
		for (const width of [1440, 390]) {
			await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
			await page.locator('h1').waitFor();
			await page.waitForFunction(() => !document.querySelector('#rsvp-form-region')?.style.height);
			await page.evaluate(() => document.fonts.ready);
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
			for (const button of await page.locator('.btn:visible').all()) {
				assert.ok(await button.evaluate(el => el.scrollWidth <= el.clientWidth && getComputedStyle(el).whiteSpace === 'nowrap'));
			}
			const lefts = await page.locator('.rsvp-header img, .rsvp-header h1, .rsvp-header > p').evaluateAll(els => els.map(el => el.getBoundingClientRect().left));
			assert.ok(lefts.every(left => Math.abs(left - lefts[0]) < 1), 'Event header is left aligned');
			await page.screenshot({ path: `${process.env.TMPDIR || '/tmp'}/${state}-${width}.png`, fullPage: true });
		}
	}
	assert.equal(await page.locator('[name="headCount"]').count(), 0);
	await captureRsvp(page, 'signon-callout');
	const anonymousPost = await anonymous.request.post(base + rsvpPath, { form: { headCount: '8', email: 'forged@example.com', name: 'Forged' } });
	assert.equal(anonymousPost.status(), 401);
	await page.getByLabel('Email', { exact: true }).fill(email);
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	await page.waitForURL(/\/sent\?/);
	assert.match(await page.locator('[data-rsvp-return]').innerText(), /Information & Enrollment Night/);
	// The real local email sink logs the actual link. Never emit it to test output.
	const mailLog = readFileSync(process.env.PORTAL_E2E_LOG || `/tmp/verify-${new URL(base).port}.log`, 'utf8');
	const message = mailLog.slice(mailLog.lastIndexOf(`To: ${email}`));
	const verification = message.match(/https?:\/\/[^\s]+\/verify\?token=[^\s]+/)?.[0];
	assert.ok(Boolean(verification), 'Verification link was logged locally');
	const verifyUrl = new URL(verification);
	assert.equal(verifyUrl.origin, base, 'Verification stays local');
	// A fresh browser has no return cookie: the token must restore the RSVP return.
	const verified = await browser.newContext();
	const account = await verified.newPage();
	await account.goto(verifyUrl.href);
	await account.waitForURL(/\/setup\?/);
	await account.getByLabel('First name', { exact: true }).fill('New');
	await account.getByLabel('Last name', { exact: true }).fill('Family');
	await account.getByLabel('Password', { exact: true }).fill('local-rsvp-password');
	await account.getByRole('button', { name: 'Create account', exact: true }).click();
	await account.waitForURL(base + rsvpPath);
	assert.match(await account.locator('.rsvp-identity').innerText(), new RegExp(email));
	assert.equal(await account.locator('[name="email"], [name="name"]').count(), 0);
	assert.equal(await account.getByLabel('Number attending').inputValue(), '1');
	const invalidCsrf = await verified.request.post(base + rsvpPath, { form: { headCount: '8', note: 'Forged' } });
	assert.equal(invalidCsrf.status(), 403);
	const crossSite = await verified.request.post(base + rsvpPath, { headers: { origin: 'https://evil.com' }, form: { headCount: '8' } });
	assert.equal(crossSite.status(), 403);
	await account.getByLabel('Number attending').fill('3');
	await account.getByLabel('Note').fill('Two adults and one child');
	await account.getByRole('button', { name: 'RSVP', exact: true }).click();
	await account.locator('[data-rsvp-confirmation]').waitFor({ state: 'visible' });
	await account.locator('[data-optimistic="rsvp"][aria-busy]').waitFor({ state: 'detached' });
	await account.getByLabel('Number attending').waitFor({ state: 'hidden' });
	assert.match(await account.locator('[data-rsvp-confirmation]').innerText(), /3 attending/);
	await account.reload();
	await account.getByLabel('Number attending').waitFor({ state: 'hidden' });
	assert.equal(await account.getByLabel('Number attending').inputValue(), '3');
	assert.equal(await account.getByLabel('Note').inputValue(), 'Two adults and one child');
	const edit = account.getByRole('button', { name: 'Need to change something?', exact: true });
	assert.equal(await edit.getAttribute('aria-expanded'), 'false');
	await edit.click();
	assert.equal(await edit.getAttribute('aria-expanded'), 'true');
	assert.equal(await account.getByLabel('Number attending').evaluate(el => el === document.activeElement), true);
	await account.getByLabel('Number attending').fill('4');
	await account.getByLabel('Note').fill('Updated to four');
	// Hold the response: the summary, collapsed form, and toast update before the server replies.
	let releaseUpdate;
	const updateGate = new Promise(resolve => { releaseUpdate = resolve; });
	await account.route('**' + rsvpPath, async route => { await updateGate; await route.continue(); }, { times: 1 });
	await account.getByRole('button', { name: 'Update RSVP', exact: true }).click();
	await account.getByLabel('Number attending').waitFor({ state: 'hidden' });
	assert.equal(await edit.getAttribute('aria-expanded'), 'false');
	assert.equal(await account.locator('[data-optimistic="rsvp"]').getAttribute('aria-busy'), 'true');
	assert.match(await account.locator('[data-rsvp-confirmation]').innerText(), /4 attending[\s\S]*Updated to four/);
	await account.locator('.toast').filter({ hasText: 'RSVP updated' }).waitFor();
	releaseUpdate();
	await account.locator('[data-optimistic="rsvp"][aria-busy]').waitFor({ state: 'detached' });
	await account.reload();
	await account.getByLabel('Number attending').waitFor({ state: 'hidden' });
	assert.match(await account.locator('[data-rsvp-confirmation]').innerText(), /4 attending[\s\S]*Updated to four/);
	await captureRsvp(account, 'rsvp-confirmed');
	await edit.click();
	await account.getByLabel('Number attending').waitFor({ state: 'visible' });
	await captureRsvp(account, 'rsvp-expanded');
	// A rejected write restores the saved summary and fields and reopens the editor.
	await account.getByLabel('Number attending').fill('5');
	await account.getByLabel('Note').fill('Should roll back');
	await account.route('**' + rsvpPath, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Local test: please try again.' }) }), { times: 1 });
	await account.getByRole('button', { name: 'Update RSVP', exact: true }).click();
	await account.locator('[data-rsvp-error]').filter({ hasText: 'Local test: please try again.' }).waitFor();
	assert.equal(await edit.getAttribute('aria-expanded'), 'true');
	assert.equal(await account.getByLabel('Number attending').inputValue(), '4');
	assert.equal(await account.getByLabel('Note').inputValue(), 'Updated to four');
	assert.match(await account.locator('[data-rsvp-confirmation]').innerText(), /4 attending/);
	await account.locator('.toast.t-err').filter({ hasText: 'Local test: please try again.' }).waitFor();

	const [response] = await db()`select count(*)::int as responses, sum(r.head_count)::int as heads from rsvps r join families f on f.id = r.family_id where r.event_id = ${INFO_NIGHT_ID} and f.email = ${email}`;
	assert.deepEqual({ ...response }, { responses: 1, heads: 4 });
	assert.equal((await db()`select count(*)::int as n from event_guest_rsvps where email = ${email}`)[0].n, 0);
	const noCsrf = await verified.request.post(base + '/sign-out', { form: { next: rsvpPath }, maxRedirects: 0 });
	assert.equal(noCsrf.status(), 403);
	await account.getByRole('button', { name: 'Not you?', exact: true }).click();
	await account.waitForURL(url => url.pathname === '/' && url.searchParams.get('next') === rsvpPath);
	assert.match(await account.locator('[data-rsvp-return]').innerText(), /Information & Enrollment Night/);
	assert.equal((await verified.cookies()).some(c => c.name === 'tca_family_session'), false);
	// Existing password sign-in also consumes the return cookie.
	await account.getByLabel('Email', { exact: true }).fill(email);
	await account.getByRole('button', { name: 'Continue', exact: true }).click();
	await account.waitForURL(/\/password\?/);
	assert.match(await account.locator('[data-rsvp-return]').innerText(), /Information & Enrollment Night/);
	await account.getByLabel('Password', { exact: true }).fill('local-rsvp-password');
	await account.getByRole('button', { name: 'Sign in', exact: true }).click();
	await account.waitForURL(base + rsvpPath);
	assert.equal(await account.getByLabel('Number attending').inputValue(), '4');
	assert.equal(await account.getByLabel('Note').inputValue(), 'Updated to four');
	await account.getByLabel('Number attending').waitFor({ state: 'hidden' });
	const nojsRsvp = await browser.newContext({ javaScriptEnabled: false, storageState: await verified.storageState() });
	const nativeRsvp = await nojsRsvp.newPage();
	await nativeRsvp.goto(base + rsvpPath);
	assert.equal(await nativeRsvp.getByLabel('Number attending').isVisible(), true);
	await nativeRsvp.getByLabel('Number attending').fill('4');
	const nativePost = nativeRsvp.waitForResponse(response => response.request().method() === 'POST' && response.url() === base + rsvpPath);
	await nativeRsvp.getByRole('button', { name: 'Update RSVP', exact: true }).click();
	assert.equal((await nativePost).status(), 303);
	await nativeRsvp.waitForURL(base + rsvpPath);
	assert.match(await nativeRsvp.locator('[data-rsvp-confirmation]').innerText(), /4 attending/);
	await nojsRsvp.close();
	await verified.close();

	for (const next of ['//evil.com', 'https://evil.com']) {
		const redirected = await browser.newContext();
		const login = await redirected.newPage();
		await login.goto(`${base}/?next=${encodeURIComponent(next)}`);
		assert.equal(await login.locator('[data-rsvp-return]').count(), 0);
		await login.getByLabel('Email', { exact: true }).fill(seed.pat.email);
		await login.getByRole('button', { name: 'Continue', exact: true }).click();
		await login.waitForURL(/\/password\?/);
		await login.getByLabel('Password', { exact: true }).fill(seed.password);
		await login.getByRole('button', { name: 'Sign in', exact: true }).click();
		await login.waitForURL(base + '/home');
		await redirected.close();
	}
	for (const role of ['ada', 'pat', 'office']) {
		const signedIn = await browser.newContext();
		await signedIn.addCookies([{ name: 'tca_family_session', value: seed.cookies[role], url: base }]);
		const member = await signedIn.newPage();
		await member.goto(base + rsvpPath);
		assert.match(await member.locator('.rsvp-identity').innerText(), new RegExp(seed[role].email));
		assert.equal(await member.getByLabel('Number attending').inputValue(), '1');
		await member.getByLabel('Number attending').fill('2');
		await member.getByRole('button', { name: 'RSVP', exact: true }).click();
		await member.getByRole('status').filter({ hasText: "You're on the list" }).waitFor();
		await member.locator('[data-optimistic="rsvp"][aria-busy]').waitFor({ state: 'detached' });
		if (role === 'ada') {
			await member.goto(base + '/events');
			assert.match(await member.locator('body').innerText(), /Update RSVP/);
		}
		await signedIn.close();
	}
	// Existing anonymous rows remain visible and exportable alongside account RSVPs.
	await db()`insert into event_guest_rsvps (id, event_id, name, email, head_count, note) values (gen_random_uuid(), ${INFO_NIGHT_ID}, ${guestName}, ${`legacy-${stamp}@example.com`}, 2, 'Legacy note')`;
	const missing = await page.goto(`${base}/rsvp/not-an-event`);
	assert.equal(missing.status(), 404);
	assert.match(await page.locator('body').innerText(), /Event not found/);

	for (const closed of ['disabled', 'ended']) {
		const [event] = await db()`insert into events (id, title, starts_at, collect_rsvp) values (gen_random_uuid(), 'Closed RSVP fixture', ${closed === 'ended' ? '2020-01-01T00:00:00Z' : '2030-01-01T00:00:00Z'}, ${closed !== 'disabled'}) returning id`;
		try {
			const closedPage = await page.goto(`${base}/rsvp/${event.id}`);
			assert.equal(closedPage.status(), 200);
			assert.equal(new URL(page.url()).pathname, `/rsvp/${event.id}`);
			assert.match(await page.getByRole('status').innerText(), /RSVPs are closed/);
			assert.equal(await page.locator('[name="headCount"]').count(), 0);
			assert.equal(await page.getByRole('link', { name: 'Create account', exact: true }).count(), 0);
		} finally { await db()`delete from events where id = ${event.id}`; }
	}

	admin = await browser.newContext();
	await admin.addCookies([{ name: 'tca_family_session', value: seed.cookies.office, url: base }]);
	const staff = await admin.newPage();
	await staff.goto(`${base}/admin/events?event=${INFO_NIGHT_ID}`);
	const guestList = staff.getByRole('dialog', { name: 'Edit event' });
	await guestList.getByText(guestName, { exact: true }).waitFor();
	await guestList.getByText(email, { exact: false }).waitFor();
	assert.match(await guestList.innerText(), /4 attending/);
	assert.match(await guestList.innerText(), /guest \(legacy\)/);
	assert.match(await guestList.innerText(), /Updated to four/);
	const csv = await admin.request.get(`${base}/admin/event-guests-export?id=${INFO_NIGHT_ID}`);
	assert.equal(csv.status(), 200);
	const csvText = await csv.text();
	for (const value of [guestName, email, 'Updated to four', 'guest (legacy)']) assert.ok(csvText.includes(value));

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
	console.log('info night flows passed (account signup/return/upsert, password, redirects, roles, legacy CSV, interview children, admin, toggle, mobile, no-JS, security)');
} finally {
	await db()`insert into settings (key, value) values ('inquiry_autoreply_enabled', 'false'::jsonb) on conflict (key) do update set value = excluded.value`;
	await browser.close();
	await db().end();
}
