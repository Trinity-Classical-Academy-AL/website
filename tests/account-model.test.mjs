import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('one profile keeps several sign-in emails and admin follows the school address', async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip('DATABASE_URL is not set');
		return;
	}
	const { db, dbReady, emailOpensAdmin, getFamily, listSignInEmails, makePrimary, notificationChoices, removeSignInEmail, startAddEmail, verifyEmailCode, addTourSlot, listTourSlotSummary } = await import('@tca/school');
	await dbReady();
	const id = randomUUID();
	const stamp = Date.now();
	const gmail = `parent-${stamp}@gmail.com`;
	const school = `parent-${stamp}@trinityclassical.academy`;
	const extra = `parent-${stamp}@example.com`;
	await db()`
		insert into families (id, name, email, phone, password_hash, roles)
		values (${id}, ${'Parent Example'}, ${gmail}, ${''}, ${'hash'}, ${['prospect', 'admin']})
	`;
	try {
		const mirrored = await getFamily(id);
		assert.equal(mirrored.email, gmail);
		const first = await listSignInEmails(id);
		assert.equal(first.length, 1);
		assert.equal(first[0].primary, true);
		assert.equal(first[0].email, gmail);
		assert.equal(emailOpensAdmin(gmail), false);
		assert.equal(emailOpensAdmin(school), true);

		const added = await startAddEmail(id, school);
		assert.equal(added.ok, true);
		const pending = await listSignInEmails(id);
		assert.equal(pending.find((item) => item.email === school).verified, false);
		const verified = await verifyEmailCode(id, school, added.code);
		assert.equal(verified.ok, true);
		const other = await startAddEmail(id, extra);
		assert.equal(other.ok, true);
		assert.equal((await verifyEmailCode(id, extra, other.code)).ok, true);
		const emails = await listSignInEmails(id);
		const schoolRow = emails.find((item) => item.email === school);
		const extraRow = emails.find((item) => item.email === extra);
		assert.equal((await makePrimary(id, extraRow.id)).ok, true);
		assert.equal((await getFamily(id)).email, extra);

		await db()`update notification_routes set email = ${school} where family_id = ${id} and category = 'admin'`;
		const blocked = await removeSignInEmail(id, schoolRow.id, 'yes');
		assert.equal(blocked.ok, false);
		const removed = await removeSignInEmail(id, schoolRow.id, 'anyway');
		assert.equal(removed.ok, true);
		const after = await getFamily(id);
		assert.equal(after.roles.includes('admin'), false);
		const routes = await notificationChoices(id);
		assert.equal(routes.admin, extra);
		assert.equal((await removeSignInEmail(id, (await listSignInEmails(id)).find((item) => item.primary).id, 'anyway')).ok, false);

		const slot = await addTourSlot({ date: '2027-04-14', start: '10:00', end: '11:00', capacity: 2, type: 'open_house' });
		assert.equal(slot.ok, true);
		const summary = await listTourSlotSummary();
		assert.equal(summary.some((item) => item.type === 'open_house' && item.when.includes('April 14')), true);
		await db()`delete from tour_slots where slot_date = '2027-04-14' and start_time = '10:00'`;
	} finally {
		await db()`delete from families where id = ${id}`;
	}
});
