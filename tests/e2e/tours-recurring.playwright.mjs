import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { db, listTourRules, listTourSlotSummary, TOUR_NOTE } from '@tca/school';
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
	const rule = (await listTourRules()).find(r => r.startsOn === '2026-12-02' && r.start === '08:10');
	assert.ok(rule); assert.equal(rule.published, false);
	await page.goto(base + '/admin/tours', { waitUntil: 'networkidle' });
	const row = page.locator(`[data-rule-row="${rule.id}"]:visible`);
	assert.equal(await row.count(), 1);
	assert.equal(await page.locator('[data-rule-row]:visible').count(), 1);
	assert.match(await row.innerText(), /Every Wed & Thu.*Unpublished/s);
	const before = (await listTourSlotSummary()).filter(s => s.ruleId === rule.id);
	assert.ok(before.length > 1);
	for (const slot of before) assert.equal(await page.locator(`.t-click a[href="/admin/tours?slot=${slot.id}"]`).count(), 0);
	await capture(page, 'admin-times');
	await row.getByRole('link', { name: 'Open', exact: true }).click();
	await page.waitForURL(url => url.searchParams.get('rule') === rule.id);
	const sheet = page.getByRole('dialog', { name: 'Edit time', exact: true });
	await sheet.waitFor({ state: 'visible' });
	assert.equal(await sheet.locator('[name=repeats][value=weekly]').isChecked(), true);
	assert.equal(await sheet.locator('[name=capacityUnit][value=families]').isChecked(), true);
	assert.equal(await sheet.locator('[data-rule-date]:visible').count(), 8);
	await capture(page, 'admin-rule-sheet');
	await sheet.locator('.sh-b').evaluate(el => { el.scrollTop = el.scrollHeight; });
	await capture(page, 'admin-rule-dates');
	await sheet.getByRole('checkbox', { name: /Published/ }).check();
	await sheet.getByRole('button', { name: 'Save', exact: true }).click();
	await page.waitForURL(url => url.searchParams.has('saved'));
	await page.locator(`[data-rule-row="${rule.id}"]:visible .b-green`).waitFor();
	await page.goto(`${base}/admin/tours?rule=${rule.id}`, { waitUntil: 'networkidle' });
	const dateRow = page.locator('[data-rule-date]:visible').first();
	const skipped = await dateRow.getAttribute('data-rule-date');
	const occurrence = (await listTourSlotSummary()).find(s => s.ruleId === rule.id && s.date === skipped);
	assert.ok(occurrence);
	await dateRow.getByRole('button', { name: 'Skip', exact: true }).click();
	await page.locator(`[data-rule-date="${skipped}"]:visible .badge`).filter({ hasText: 'Skipped' }).waitFor();
	await familyPage.goto(base + '/tour', { waitUntil: 'networkidle' });
	assert.equal(await familyPage.locator(`[name=slotId][value="${occurrence.id}"]`).count(), 0);
	assert.ok((await familyPage.locator('body').innerText()).includes(TOUR_NOTE));
	await page.locator(`[data-rule-date="${skipped}"]:visible`).getByRole('button', { name: 'Restore', exact: true }).click();
	await page.locator(`[data-rule-date="${skipped}"]:visible`).getByRole('button', { name: 'Skip', exact: true }).waitFor();
	const restored = (await listTourSlotSummary()).find(s => s.ruleId === rule.id && s.date === skipped);
	assert.ok(restored);
	await familyPage.reload({ waitUntil: 'networkidle' });
	await familyPage.locator(`[name=slotId][value="${restored.id}"]:visible`).check();
	await familyPage.getByLabel('How many people are coming?').filter({visible:true}).selectOption('4');
	await familyPage.getByRole('button', { name: 'Send request', exact: true }).click();
	await familyPage.waitForURL(url => url.searchParams.get('saved') === '1');
	bookedId = restored.id;
	await secondPage.goto(base + '/tour', { waitUntil: 'networkidle' });
	const full = secondPage.locator(`[name=slotId][value="${restored.id}"]:visible`);
	assert.equal(await full.isDisabled(), true);
	assert.match(await full.locator('..').innerText(), /Full/);
	await capture(secondPage, 'family-tour');
	await familyPage.goto(base + '/tour?other=1', { waitUntil: 'networkidle' });
	const otherSheet = familyPage.getByRole('dialog', { name: 'Request a different time', exact: true });
	assert.ok((await otherSheet.innerText()).includes(TOUR_NOTE));
	await otherSheet.locator('[name=days][value=Wed]').check();
	await otherSheet.getByRole('button', { name: 'Send request', exact: true }).click();
	await familyPage.waitForURL(url => url.searchParams.get('requested') === '1');
	assert.equal(await familyPage.getByRole('dialog', { name: 'Request a different time', exact: true }).count(), 0);
	await familyPage.getByRole('status').filter({ hasText: 'Request sent.' }).waitFor();
	otherRequestId = (await db()`select id from tour_holds where family_id = ${seed.pat.id} and kind = 'other' order by created_at desc limit 1`)[0]?.id;
	await page.goto(base + '/admin/tours?sheet=add', { waitUntil: 'networkidle' });
	const add = page.getByRole('dialog', { name: 'Add a time' });
	await page.setViewportSize({ width: 390, height: 844 });
	await add.locator('[name=repeats][value=weekly]').check();
	assert.equal(await add.locator('[data-weekly]').isVisible(), true);
	await add.locator('[name=repeats][value=none]').check();
	assert.equal(await add.locator('[data-once]').isVisible(), true);
	await page.setViewportSize({ width: 1440, height: 1000 });
	assert.equal(await add.getByLabel('Capacity', { exact: true }).inputValue(), '1');
	await add.locator('[name=type][value=open_house]').check();
	assert.equal(await add.getByLabel('Capacity', { exact: true }).inputValue(), '12');
	assert.equal(await add.locator('[name=capacityUnit][value=people]').isChecked(), true);
	await add.locator('[name=type][value=tour]').check();
	await add.getByLabel('Date', { exact: true }).fill('12/21/2027');
	await add.getByLabel('Start', { exact: true }).fill('7:01 AM');
	await add.getByLabel('End', { exact: true }).fill('7:31 AM');
	await add.getByRole('button', { name: 'Save', exact: true }).click();
	await page.waitForURL(url => url.searchParams.has('saved'));
	oneOffId = new URL(page.url()).searchParams.get('saved');
	await page.goto(`${base}/admin/tours?slot=${oneOffId}`, { waitUntil: 'networkidle' });
	await page.getByRole('dialog', { name: 'Edit time', exact: true }).getByRole('link', { name: 'Delete time' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete time' }).click();
	await page.waitForURL(url => url.searchParams.has('removed'));
	await page.reload({ waitUntil: 'networkidle' });
	assert.equal(await page.locator(`a[href="/admin/tours?slot=${oneOffId}"]`).count(), 0);
	assert.equal((await db()`select id from tour_slots where id = ${oneOffId}`).length, 0);
	await page.goto(base + '/admin/tours?tab=requests', { waitUntil: 'networkidle' });
	await page.getByRole('columnheader', { name: 'Requested', exact: true }).waitFor();
	await capture(page, 'admin-requests');
	await page.locator(`a[href="/admin/tours?tab=requests&reply=${seed.tourRequest}"]:visible`).click();
	await page.getByRole('dialog', { name: 'Reply to request' }).waitFor();
	assert.match(await page.locator('.ssheet:visible .sh-tt').innerText(), /Requested/);
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
	const rules = await listTourRules();
	const rule = rules.find(r => r.startsOn === '2026-12-02' && r.start === '08:10');
	if (rule) {
		await db()`update tour_slot_rules set published = false where id = ${rule.id}`;
		await db()`update tour_slots set published = false where rule_id = ${rule.id}`;
	}
	for (const ctx of contexts) await ctx.close();
	await browser.close(); await db().end();
}
