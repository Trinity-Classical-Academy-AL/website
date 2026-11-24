import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { db, listSeries, listTourSlotSummary, TOUR_NOTE, chicagoToday, bookingWindowEnd } from '@tca/school';
import { handleAdmissionsRequest } from '../../src/lib/admissions/http.ts';

const base = process.env.PORTAL_E2E_URL || 'http://127.0.0.1:4323';
const seed = JSON.parse(readFileSync('/tmp/tca-e2e-seed.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const contexts = [];
const screenshots = process.env.TOUR_SCREENSHOT_DIR;
if (screenshots) mkdirSync(screenshots, { recursive: true });
async function context(token) {
	const ctx = await browser.newContext(); contexts.push(ctx);
	// Keep the full test, including website assets, on the local origin.
	await ctx.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
	if (token) await ctx.addCookies([{ name: 'tca_family_session', value: token, url: base }]);
	return ctx;
}
async function capture(page, name) {
	if (!screenshots) return;
	for (const width of [1440,390]) {
		await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
		if (name === 'admin-rule-dates') await page.locator('.ssheet:visible .sh-b').evaluate(el => { el.scrollTop = el.scrollHeight; });
		await page.evaluate(() => document.fonts.ready);
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} overflows at ${width}`);
		await page.screenshot({ path: resolve(screenshots, `${name}-${width}.png`), fullPage: true });
	}
	await page.setViewportSize({ width: 1440, height: 1000 });
}
let bookedId, oneOffId, otherRequestId;
try {
	const admin = await context(seed.cookies.office), family = await context(seed.cookies.pat), second = await context(seed.cookies.bea);
	const page = await admin.newPage(); page.setDefaultTimeout(15000);
	const familyPage = await family.newPage(), secondPage = await second.newPage();
	const rule = (await listSeries()).find(r => r.startsOn === '2026-12-02' && r.start === '08:10');
	assert.ok(rule); assert.equal(rule.published, false);
	// Tours live on the calendar now: a weekly tour is one schedule that puts a Tour item on each of its dates.
	const month = '/admin/calendar?type=tour&m=2026-12';
	const itemLink = id => page.locator(`a[href="${month}&item=${encodeURIComponent(`tour:${id}`)}"]:visible`);
	const sheet = page.locator('.ssheet:visible');
	const editRule = async () => {
		const [first] = (await listTourSlotSummary()).filter(s => s.seriesId === rule.id).sort((a, b) => a.date.localeCompare(b.date));
		await page.goto(`${base}${month}&item=${encodeURIComponent(`tour:${first.id}`)}&edit=1`, { waitUntil: 'networkidle' });
		// Editing one date of a repeating tour starts on "This date"; the schedule's fields are under "All dates".
		await sheet.locator('label.type-opt', { hasText: 'All dates' }).click();
		await sheet.locator('select[name=repeats]').waitFor();
	};
	await page.goto(base + month, { waitUntil: 'networkidle' });
	const before = (await listTourSlotSummary()).filter(s => s.seriesId === rule.id);
	assert.ok(before.length > 1);
	const december = before.filter(s => s.date.startsWith('2026-12'));
	assert.ok(december.length > 1);
	for (const slot of december) assert.ok(await itemLink(slot.id).count() >= 1, slot.date);
	await capture(page, 'admin-times');
	await itemLink(december[0].id).first().click();
	await page.waitForURL(url => url.searchParams.get('item') === `tour:${december[0].id}`);
	await sheet.waitFor({ state: 'visible' });
	assert.match(await sheet.innerText(), /Repeats\s*Every week/);
	assert.match(await sheet.innerText(), /No, staff only/);
	await sheet.getByRole('link', { name: 'Edit', exact: true }).click();
	await sheet.locator('label.type-opt', { hasText: 'All dates' }).click();
	await sheet.locator('select[name=repeats]').waitFor();
	assert.equal(await sheet.locator('select[name=repeats]').inputValue(), 'weekly');
	assert.equal(await sheet.locator('select[name=unit]').inputValue(), 'families');
	assert.deepEqual(await sheet.locator('[name=weekdays]:checked').evaluateAll(els => els.map(el => el.value)), ['3', '4']);
	assert.equal(await sheet.locator('[name=startsOn]').inputValue(), '2026-12-02');
	assert.equal(await sheet.locator('[name=endsOn]').inputValue(), '2027-05-27');
	assert.equal(await sheet.locator('select[name=window]').inputValue(), '92');
	await capture(page, 'admin-rule-sheet');
	await sheet.locator('select[name=window]').selectOption('14');
	await sheet.getByRole('checkbox', { name: /Published/ }).check();
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await page.waitForURL(url => url.searchParams.has('saved'));
	assert.equal((await listSeries()).find(s => s.id === rule.id).bookingWindowDays, 14);
	assert.equal((await listSeries()).find(s => s.id === rule.id).published, true);
	// Families pick a day, then a time; each time is a slotId radio, so read the weekly tour's dates from those.
	const bookable = async () => {
		await familyPage.goto(base + '/tour', { waitUntil: 'networkidle' });
		const ids = new Set(await familyPage.locator('[name=slotId]').evaluateAll(els => els.map(el => el.value)));
		return (await listTourSlotSummary()).filter(s => s.seriesId === rule.id && ids.has(s.id));
	};
	const dates = (await bookable()).map(s => s.date);
	assert.ok(dates.length > 0);
	assert.ok(dates.every(date => date <= bookingWindowEnd(chicagoToday(),14)), JSON.stringify(dates));
	await editRule();
	assert.equal(await sheet.locator('select[name=window]').inputValue(), '14');
	await sheet.locator('select[name=window]').selectOption('92');
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await page.waitForURL(url => url.searchParams.has('saved'));
	assert.equal((await listSeries()).find(s => s.id === rule.id).bookingWindowDays, 92);
	// Skip one date from its sheet; families can no longer book it.
	const [occurrence] = (await listTourSlotSummary()).filter(s => s.seriesId === rule.id).sort((a, b) => a.date.localeCompare(b.date));
	const skipped = occurrence.date;
	await page.goto(`${base}${month}&item=${encodeURIComponent(`tour:${occurrence.id}`)}`, { waitUntil: 'networkidle' });
	// Delete → This date skips just this one (Google Calendar style).
	await sheet.locator('details.del-menu > summary').click();
	await sheet.getByRole('menuitem', { name: 'This date', exact: true }).click();
	await page.locator('.confirm-ov [data-yes]').click();
	await page.waitForURL(url => url.searchParams.has('deleted'));
	assert.equal((await listTourSlotSummary()).some(s => s.seriesId === rule.id && s.date === skipped), false);
	await page.goto(base + month, { waitUntil: 'networkidle' });
	assert.equal(await itemLink(occurrence.id).count(), 0);
	await familyPage.goto(base + '/tour', { waitUntil: 'networkidle' });
	assert.equal(await familyPage.locator(`[name=slotId][value="${occurrence.id}"]`).count(), 0);
	assert.ok((await familyPage.locator('body').innerText()).includes(TOUR_NOTE));
	// Restore from any other date of the same tour: its sheet lists the skipped dates.
	const other = (await listTourSlotSummary()).filter(s => s.seriesId === rule.id).sort((a, b) => a.date.localeCompare(b.date))[0];
	await page.goto(`${base}${month}&item=${encodeURIComponent(`tour:${other.id}`)}`, { waitUntil: 'networkidle' });
	await sheet.locator(`[data-skipped-date="${skipped}"]`).getByRole('button', { name: 'Restore', exact: true }).click();
	await page.waitForURL(url => url.searchParams.has('saved'));
	assert.equal((await listSeries()).find(s => s.id === rule.id).skipDates.includes(skipped), false);
	const restored = (await listTourSlotSummary()).find(s => s.seriesId === rule.id && s.date === skipped);
	assert.ok(restored);
	await familyPage.reload({ waitUntil: 'networkidle' });
	await familyPage.locator(`[data-tb-day="${restored.date}"]:visible`).click();
	await familyPage.locator(`[name=slotId][value="${restored.id}"]:visible`).check();
	await familyPage.getByLabel('People coming').filter({visible:true}).fill('4');
	await familyPage.getByRole('button', { name: 'Send request', exact: true }).click();
	await familyPage.waitForURL(url => url.searchParams.get('saved') === '1');
	bookedId = restored.id;
	await secondPage.goto(base + '/tour', { waitUntil: 'networkidle' });
	// A full time is no longer offered to other families.
	assert.ok(await secondPage.locator('[name=slotId]').count() > 0);
	assert.equal(await secondPage.locator(`[name=slotId][value="${restored.id}"]`).count(), 0);
	await capture(secondPage, 'family-tour');
	await familyPage.goto(base + '/tour?other=1', { waitUntil: 'networkidle' });
	const otherSheet = familyPage.getByRole('dialog', { name: 'Request a different time', exact: true });
	// The tour note sits in About tours on the page now, not repeated in the sheet.
	assert.ok((await familyPage.locator('.tb-about').first().innerText()).includes(TOUR_NOTE));
	await otherSheet.locator('[name=days][value=Wed]').check();
	await otherSheet.getByRole('button', { name: 'Send request', exact: true }).click();
	await familyPage.waitForURL(url => url.searchParams.get('requested') === '1');
	assert.equal(await familyPage.getByRole('dialog', { name: 'Request a different time', exact: true }).count(), 0);
	await familyPage.getByRole('status').filter({ hasText: 'Request sent.' }).waitFor();
	otherRequestId = (await db()`select id from tour_holds where family_id = ${seed.pat.id} and kind = 'other' order by created_at desc limit 1`)[0]?.id;
	await page.goto(base + '/admin/calendar?type=tour&new=2027-12-21', { waitUntil: 'networkidle' });
	const add = page.getByRole('dialog', { name: 'Add to the calendar' });
	await page.setViewportSize({ width: 390, height: 844 });
	await add.locator('select[name=repeats]').selectOption('weekly');
	assert.equal(await add.locator('.days-only').isVisible(), true);
	assert.equal(await add.locator('[name=date]').isVisible(), false);
	await add.locator('select[name=repeats]').selectOption('once');
	assert.equal(await add.locator('[name=date]').isVisible(), true);
	await page.setViewportSize({ width: 1440, height: 1000 });
	assert.equal(await add.getByLabel('Places', { exact: true }).inputValue(), '6');
	// Interviews are one family at a time; open houses are gatherings now.
	await add.getByRole('link', { name: 'Interview', exact: true }).click();
	await page.waitForURL(url => url.searchParams.get('type') === 'interview');
	assert.equal(await add.getByLabel('Places', { exact: true }).inputValue(), '1');
	await add.getByRole('link', { name: 'Tour', exact: true }).click();
	await page.waitForURL(url => url.searchParams.get('type') === 'tour');
	assert.equal(await add.getByLabel('Places', { exact: true }).inputValue(), '6');
	await add.getByLabel('Date', { exact: true }).fill('2027-12-21');
	await add.getByLabel('Starts', { exact: true }).fill('07:01');
	await add.getByLabel('Ends', { exact: true }).fill('07:31');
	await add.getByRole('button', { name: 'Add', exact: true }).click();
	await page.waitForURL(url => url.searchParams.has('saved'));
	oneOffId = (await db()`select id from tour_slots where slot_date = '2027-12-21' and start_time = '07:01' and series_id is null`)[0]?.id;
	assert.ok(oneOffId);
	await page.goto(`${base}/admin/calendar?m=2027-12&item=${encodeURIComponent(`tour:${oneOffId}`)}`, { waitUntil: 'networkidle' });
	await sheet.getByRole('button', { name: 'Delete', exact: true }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
	await page.waitForURL(url => url.searchParams.has('deleted'));
	await page.reload({ waitUntil: 'networkidle' });
	assert.equal(await page.locator(`a[href*="${oneOffId}"]`).count(), 0);
	assert.equal((await db()`select id from tour_slots where id = ${oneOffId}`).length, 0);
	// Time requests are answered from Calendar → RSVPs; the old Requests tab redirects there.
	await page.goto(base + '/admin/tours?tab=requests', { waitUntil: 'networkidle' });
	assert.equal(new URL(page.url()).pathname, '/admin/calendar/rsvps');
	await page.getByRole('columnheader', { name: 'For', exact: true }).waitFor();
	await capture(page, 'admin-requests');
	await page.locator(`[data-href*="reply=${seed.tourRequest}"]:visible strong`).first().click();
	await page.getByRole('dialog', { name: 'Reply to tour request' }).waitFor();
	assert.match(await page.locator('.ssheet:visible .sh-tt').innerText(), /Asked .* for/);
	// Serve the built website from disk through the same local browser origin.
	const site = await context(''), root = resolve('dist');
	const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
	await site.route('**/*', async route => {
		const url = new URL(route.request().url());
		if (url.origin !== base) return route.abort();
		if (url.pathname.startsWith('/api/')) {
			const response = await handleAdmissionsRequest(new Request(url));
			return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
		}
		const path = resolve(root, url.pathname === '/visit' ? 'visit/index.html' : '.' + url.pathname);
		if (!path.startsWith(root + '/')) return route.abort();
		try { await route.fulfill({ body: readFileSync(path), contentType: mime[extname(path)] || 'application/octet-stream' }); }
		catch { await route.abort(); }
	});
	const visit = await site.newPage();
	await visit.goto(base + '/visit', { waitUntil: 'networkidle' });
	assert.equal(await visit.locator('[data-visit-when]').innerText(), 'Wednesdays & Thursdays');
	assert.equal(await visit.locator('[data-visit-time]').innerText(), '8:10 to 9:00 AM');
	assert.equal(await visit.locator('[data-visit-note]').innerText(), TOUR_NOTE);
	assert.match(await visit.locator('[data-visit-next]').innerText(), /^Next open: .* · .* · /);
	await capture(visit, 'visit');
	console.log('tour recurrence, skip/restore, deletion, request dates, family capacity and website checks passed');
} finally {
	// Leave seed admin/families intact for other local suites; restore the rule's unpublished state.
	if (otherRequestId) await db()`delete from tour_holds where id = ${otherRequestId}`;
	if (bookedId) await db()`delete from tour_holds where slot_id = ${bookedId}`;
	const rules = await listSeries();
	const rule = rules.find(r => r.startsOn === '2026-12-02' && r.start === '08:10');
	if (rule) {
		await db()`update schedule_series set published = false, booking_window_days = 92 where id = ${rule.id}`;
		await db()`update tour_slots set published = false where series_id = ${rule.id}`;
	}
	for (const ctx of contexts) await ctx.close();
	await browser.close(); await db().end();
}
