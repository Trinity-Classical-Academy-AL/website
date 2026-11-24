import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('people: access is per person, and two accounts that are one person merge', async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip('DATABASE_URL is not set');
		return;
	}
	const { db, dbReady, getFamily, ensurePeople, listPeople, personEmails, setPersonAccess, grantAccess, mergePeople } = await import('@tca/school');
	await dbReady();
	const stamp = Date.now();
	const email = (name) => `${name}-${stamp}@example.com`;
	const [work, home, shared] = [randomUUID(), randomUUID(), randomUUID()];
	const make = (id, name, address, roles = ['prospect']) => db()`
		insert into families (id, name, email, phone, password_hash, roles) values (${id}, ${name}, ${address}, ${''}, ${'hash'}, ${roles})`;
	// A teacher's school email became its own household; their real household uses a personal email.
	await make(work, 'Jane Doe', email('jane-school'));
	await make(home, 'Jane Doe', email('jane-home'), ['guardian']);
	await make(shared, 'Sam Lee', email('sam'), ['guardian']);
	try {
		for (const id of [work, home, shared]) await getFamily(id);
		await db()`insert into children (id, family_id, kind, name, position) values (${randomUUID()}, ${work}, 'prospective', ${'Evelyn'}, 0)`;
		// Sam's household has a second guardian.
		await db()`insert into family_emails (id, family_id, email, label) values (${randomUUID()}, ${shared}, ${email('pat')}, ${'Pat Lee'})`;
		await ensurePeople(shared);

		// Everyone who can sign in is listed, with or without access.
		const listed = await listPeople();
		const jane = listed.find((person) => person.emails.includes(email('jane-school')));
		assert.ok(jane, 'lists people without access');
		assert.deepEqual(jane.roles, []);
		assert.equal(listed.filter((person) => person.familyId === shared).length, 2);

		assert.deepEqual(await grantAccess({ email: email('jane-school'), roles: ['staff'], by: 'office@example.com' }).then((r) => r.ok), true);

		// A guardian who shares a household can't be merged away without merging households first.
		const blocked = await mergePeople({ keepEmail: email('jane-home'), dropEmail: email('pat'), by: 'office@example.com' });
		assert.equal(blocked.ok, false);
		assert.match(blocked.error, /shares a household/);

		// Merge the school account into the home account.
		const merged = await mergePeople({ keepEmail: email('jane-home'), dropEmail: email('jane-school'), by: 'office@example.com' });
		assert.deepEqual(merged, { ok: true, familyId: home });
		assert.equal((await getFamily(work)).id, home, 'the empty household follows the merge');
		assert.deepEqual((await personEmails(email('jane-home'))).sort(), [email('jane-home'), email('jane-school')].sort());
		const rows = await db()`select email, roles from family_emails where email in ${db()([email('jane-home'), email('jane-school')])}`;
		assert.ok(rows.every((row) => row.roles.includes('staff')), 'both emails share the combined access');
		assert.equal((await db()`select count(*)::int as n from children where family_id = ${home}`)[0].n, 1, 'children move with the household');
		assert.equal((await db()`select count(*)::int as n from family_people where family_id = ${home}`)[0].n, 1, 'one person remains');

		// Access changes apply to every email the person has; your own admin stays.
		assert.deepEqual(await setPersonAccess({ email: email('jane-school'), role: 'admin', on: true, by: 'office@example.com' }), { ok: true });
		assert.ok((await db()`select roles from family_emails where email = ${email('jane-home')}`)[0].roles.includes('admin'));
		const self = await setPersonAccess({ email: email('jane-home'), role: 'admin', on: false, by: email('jane-school') });
		assert.equal(self.ok, false);

		// Super admin rides on Admin: on adds Admin, Admin off takes it away.
		const rolesOf = async () => (await db()`select roles from family_emails where email = ${email('jane-home')}`)[0].roles;
		await setPersonAccess({ email: email('jane-home'), role: 'admin', on: false, by: 'office@example.com' });
		assert.deepEqual(await setPersonAccess({ email: email('jane-home'), role: 'super_admin', on: true, by: 'office@example.com' }), { ok: true });
		assert.ok((await rolesOf()).includes('admin') && (await rolesOf()).includes('super_admin'));
		assert.equal((await setPersonAccess({ email: email('jane-home'), role: 'super_admin', on: false, by: email('jane-school') })).ok, false, 'not your own');
		await setPersonAccess({ email: email('jane-home'), role: 'admin', on: false, by: 'office@example.com' });
		assert.ok(!(await rolesOf()).includes('admin') && !(await rolesOf()).includes('super_admin'));

		assert.equal((await mergePeople({ keepEmail: email('jane-home'), dropEmail: email('jane-school'), by: 'x' })).ok, false, 'already one person');
	} finally {
		const ids = [work, home, shared];
		await db()`delete from family_emails where family_id in ${db()(ids)}`;
		await db()`delete from families where id in ${db()(ids)}`;
	}
});
