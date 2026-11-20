import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('guardians: each email belongs to a person; add, rename, remove others but never yourself', async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip('DATABASE_URL is not set');
		return;
	}
	const { db, dbReady, getFamily, listGuardians, currentGuardian, addGuardian, renameGuardian, removeGuardian, startAddEmail, verifyEmailCode, claimEmail } = await import('@tca/school');
	await dbReady();
	const stamp = Date.now();
	const id = randomUUID();
	const rachel = `rachel-${stamp}@example.com`, work = `rachel-work-${stamp}@example.com`, alex = `alex-${stamp}@example.com`;
	await db()`insert into families (id, name, email, phone, password_hash, roles, email_verified_at) values (${id}, ${'Rachel Brooks'}, ${rachel}, ${''}, ${'hash'}, ${['guardian']}, now())`;
	try {
		await getFamily(id);
		const [only] = await listGuardians(id);
		assert.equal(only.name, 'Rachel Brooks');
		assert.equal(only.holder, true);

		// Rachel's own second email stays hers.
		const added = await startAddEmail(id, work);
		await verifyEmailCode(id, work, added.code);
		await claimEmail(id, only.id, work);
		assert.deepEqual((await listGuardians(id)).map((person) => person.emails.length), [2]);

		// Another guardian is a separate person.
		assert.deepEqual(await addGuardian({ familyId: id, name: 'Alex Brooks', email: alex, by: 'Rachel Brooks' }), { ok: true, invited: 'new' });
		assert.equal((await addGuardian({ familyId: id, name: 'Alex Brooks', email: alex, by: 'Rachel Brooks' })).ok, false);
		const people = await listGuardians(id);
		assert.deepEqual(people.map((person) => person.name), ['Rachel Brooks', 'Alex Brooks']);
		const alexPerson = people[1];
		assert.equal(alexPerson.emails[0].verified, false);
		assert.equal((await currentGuardian(id, alex)).id, alexPerson.id);

		// Renaming the account holder keeps families.name in step; the family name is separate.
		assert.deepEqual(await renameGuardian(id, only.id, 'Rachel A. Brooks'), { ok: true });
		assert.equal((await getFamily(id)).name, 'Rachel A. Brooks');

		// Nobody removes themselves; removing the holder moves the primary email to the remover.
		assert.equal((await removeGuardian({ familyId: id, actorId: only.id, personId: only.id, by: 'x' })).ok, false);
		await db()`update family_emails set verified_at = now() where email = ${alex}`;
		assert.deepEqual(await removeGuardian({ familyId: id, actorId: alexPerson.id, personId: only.id, by: 'Alex Brooks' }), { ok: true });
		const left = await listGuardians(id);
		assert.deepEqual(left.map((person) => person.name), ['Alex Brooks']);
		assert.equal(left[0].holder, true);
		assert.equal((await getFamily(id)).email, alex);
	} finally {
		await db()`delete from families where id = ${id}`;
	}
});
