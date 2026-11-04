import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('tour slots are stored dates, and staff mail defaults to Michelle Taylor', () => {
	const prospect = read('packages/school/src/prospect.ts');
	assert.match(prospect, /2027-01-13/);
	assert.match(prospect, /2027-02-10/);
	assert.match(prospect, /2027-03-10/);
	assert.match(prospect, /08:00/);
	assert.match(prospect, /09:00/);
	assert.match(read('packages/school/src/email.ts'), /michelle\.taylor@trinityclassical\.academy/);
	assert.doesNotMatch(read('portal/src/pages/tour.astro'), /defaultTourDates/);
	assert.match(read('portal/src/pages/account.astro'), /Admin/);
	assert.doesNotMatch(read('portal/src/pages/account.astro'), /Roles are set by the school/);
});

test('a full tour slot hides the other family', async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip('DATABASE_URL is not set');
		return;
	}
	const { db, dbReady, familyTourView, saveSlotBooking } = await import('@tca/school');
	await dbReady();
	const first = randomUUID();
	const second = randomUUID();
	const stamp = Date.now();
	await db()`
		insert into families (id, name, email, phone, password_hash, roles)
		values
			(${first}, ${'First Family'}, ${`first-${stamp}@example.com`}, ${''}, ${'x'}, ${['prospect']}),
			(${second}, ${'Second Family'}, ${`second-${stamp}@example.com`}, ${''}, ${'x'}, ${['prospect']})
	`;
	try {
		const before = await familyTourView(first);
		const slot = before.slots.find((item) => item.date === '2027-01-13');
		assert.ok(slot);
		const booked = await saveSlotBooking({
			familyId: first,
			familyName: 'First Family',
			email: `first-${stamp}@example.com`,
			phone: '',
			slotId: slot.id,
			grades: ['K'],
			note: 'secret note',
		});
		assert.equal(booked.ok, true);
		const other = await familyTourView(second);
		const hidden = other.slots.find((item) => item.id === slot.id);
		assert.equal(hidden.unavailable, true);
		assert.equal(JSON.stringify(other).includes('First Family'), false);
		assert.equal(JSON.stringify(other).includes('secret note'), false);
		const blocked = await saveSlotBooking({
			familyId: second,
			familyName: 'Second Family',
			email: `second-${stamp}@example.com`,
			phone: '',
			slotId: slot.id,
			grades: [],
			note: '',
		});
		assert.equal(blocked.ok, false);
	} finally {
		await db()`delete from tour_holds where family_id in (${first}, ${second})`;
		await db()`delete from families where id in (${first}, ${second})`;
	}
});
