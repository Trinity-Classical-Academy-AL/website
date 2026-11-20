import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('families join by request: no account lookup, the other side approves, everything moves', async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip('DATABASE_URL is not set');
		return;
	}
	const school = await import('@tca/school');
	const { db, dbReady, getFamily, listJoinRequests, requestToJoin, inviteToFamily, answerJoinRequest, cancelJoinRequest, mergeFamilies, listFamilyActivity, addFamilyNote } = school;
	await dbReady();
	const stamp = Date.now();
	const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
	const [alex, rachel, sam, pat] = ids;
	const email = (name) => `${name}-${stamp}@example.com`;
	const make = (id, name, roles = ['prospect']) => db()`
		insert into families (id, name, email, phone, password_hash, roles) values (${id}, ${name}, ${email(name.toLowerCase())}, ${''}, ${'hash'}, ${roles})`;
	await make(alex, 'Alex'); await make(rachel, 'Rachel'); await make(sam, 'Sam', ['guardian']); await make(pat, 'Pat', ['guardian']);
	try {
		for (const id of ids) await getFamily(id); // mirrors the primary email into family_emails
		await db()`insert into prospect_children (id, family_id, first_name, position) values (${randomUUID()}, ${alex}, ${'Evelyn'}, 0)`;
		await addFamilyNote(alex, 'office@example.com', 'Called about K');

		// Unknown email: same success answer, nothing created.
		assert.deepEqual(await requestToJoin(alex, `nobody-${stamp}@example.com`), { ok: true });
		assert.equal((await listJoinRequests(alex)).length, 0);

		// Alex asks to join Rachel's family; only Rachel's side can answer.
		assert.deepEqual(await requestToJoin(alex, email('rachel')), { ok: true });
		const [request] = await listJoinRequests(alex);
		assert.equal(request.toFamilyId, rachel);
		assert.equal(request.initiatedBy, 'from');
		assert.equal((await answerJoinRequest({ id: request.id, familyId: alex, approve: true, by: 'alex' })).ok, false);
		assert.deepEqual(await requestToJoin(alex, email('rachel')), { ok: true }); // a repeat does not duplicate
		assert.equal((await listJoinRequests(alex)).length, 1);
		assert.deepEqual(await answerJoinRequest({ id: request.id, familyId: rachel, approve: true, by: 'rachel' }), { ok: true });

		// Alex's session, links and records now resolve to Rachel's family.
		assert.equal((await getFamily(alex)).id, rachel);
		const emails = await db()`select email, is_primary from family_emails where family_id = ${rachel} order by email`;
		assert.deepEqual(emails.map((row) => row.email), [email('alex'), email('rachel')]);
		assert.equal(emails.filter((row) => row.is_primary).length, 1);
		assert.equal((await db()`select count(*)::int as n from prospect_children where family_id = ${rachel}`)[0].n, 1);
		const activity = await listFamilyActivity(rachel);
		assert.ok(activity.some((item) => item.kind === 'merged'));
		assert.ok(activity.some((item) => item.note === 'Called about K'));
		assert.equal((await listJoinRequests(rachel)).length, 0);

		// Invite: Sam invites Pat's email; Pat's side answers. Both enrolled with students: staff only.
		await db()`insert into students (id, family_id, name) values (${randomUUID()}, ${sam}, ${'Amelia'}), (${randomUUID()}, ${pat}, ${'Oliver'})`;
		assert.deepEqual(await inviteToFamily(sam, email('pat')), { ok: true });
		const [invite] = await listJoinRequests(pat);
		assert.equal(invite.initiatedBy, 'to');
		assert.equal((await answerJoinRequest({ id: invite.id, familyId: sam, approve: true, by: 'sam' })).ok, false);
		const blocked = await answerJoinRequest({ id: invite.id, familyId: pat, approve: true, by: 'pat' });
		assert.equal(blocked.ok, false);
		assert.match(blocked.error, /school office/);
		assert.deepEqual(await cancelJoinRequest(invite.id, sam, 'sam'), { ok: true });
		assert.equal((await listJoinRequests(pat)).length, 0);
		assert.deepEqual(await mergeFamilies({ fromFamilyId: pat, toFamilyId: sam, by: 'office', staff: true }), { ok: true });
		assert.equal((await db()`select count(*)::int as n from students where family_id = ${sam}`)[0].n, 2);
		assert.equal((await mergeFamilies({ fromFamilyId: pat, toFamilyId: sam, by: 'office', staff: true })).ok, false);
	} finally {
		await db()`update families set merged_into_id = null where id in ${db()(ids)}`;
		await db()`delete from families where id in ${db()(ids)}`;
	}
});
