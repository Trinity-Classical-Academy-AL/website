import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('admissions: Accepted needs the ClassReach link, then emails it once', async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip('DATABASE_URL is not set');
		return;
	}
	const { db, dbReady, getFamily, setApplicationStatus, classReachSignupUrl, setClassReachSignupUrl, applicationStatusLabel, PIPELINE } = await import('@tca/school');
	await dbReady();
	const stamp = Date.now();
	const family = randomUUID(), app = randomUUID();
	const email = `accept-${stamp}@example.com`;
	const before = await classReachSignupUrl();
	await db()`insert into families (id, name, email, phone, password_hash, roles) values (${family}, ${'Ada Accept'}, ${email}, ${''}, ${'hash'}, ${['prospect']})`;
	try {
		await getFamily(family);
		await db()`insert into applications (id, family_id, email, name, school_year, status, students) values (${app}, ${family}, ${email}, ${'Ada Accept'}, ${'2027–28'}, ${'application_submitted'}, ${db().json([])})`;
		assert.equal(PIPELINE.at(-1), 'accepted');
		assert.equal(applicationStatusLabel('accepted'), 'Accepted');

		await setClassReachSignupUrl('');
		const blocked = await setApplicationStatus(app, 'accepted', 'office@example.com');
		assert.equal(blocked.ok, false, 'no link, no accept');
		assert.match(blocked.error, /ClassReach sign-up link/);
		assert.equal((await setClassReachSignupUrl('not a link')).ok, false);

		const link = `https://trinityclassicalacademy.classreach.com/signup-test-${stamp}`;
		assert.deepEqual(await setClassReachSignupUrl(link), { ok: true });
		assert.deepEqual(await setApplicationStatus(app, 'accepted', 'office@example.com'), { ok: true });
		const [row] = await db()`select status, decided_by from applications where id = ${app}`;
		assert.equal(row.status, 'accepted');
		assert.equal(row.decided_by, 'office@example.com');
		const sent = await db()`select subject from email_log where recipient = ${email} and template = 'application.accepted'`;
		assert.equal(sent.length, 1, 'the family is emailed once');

		// Moving it again doesn't email again.
		await setApplicationStatus(app, 'accepted', 'office@example.com');
		assert.equal((await db()`select count(*)::int as n from email_log where recipient = ${email} and template = 'application.accepted'`)[0].n, 1);
	} finally {
		await setClassReachSignupUrl(before);
		await db()`delete from applications where id = ${app}`;
		await db()`delete from family_emails where family_id = ${family}`;
		await db()`delete from families where id = ${family}`;
	}
});
