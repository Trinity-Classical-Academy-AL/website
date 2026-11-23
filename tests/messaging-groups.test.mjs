import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Direct and group messages against a real database (its own people, removed
 * afterwards): who can write to whom, who sees which groups, and that student
 * conversations stay separate.
 */
test('messages: direct and group permissions', async (t) => {
	if (!process.env.DATABASE_URL) { t.skip('DATABASE_URL is not set'); return; }
	const school = await import('@tca/school');
	const { db, dbReady, getFamily, schoolYearOf } = school;
	await dbReady();
	const stamp = Date.now();
	const email = (name) => `${name}-${stamp}@example.com`;
	const ids = { admin: randomUUID(), teacher: randomUUID(), parent: randomUUID(), other: randomUUID(), kid: randomUUID(), otherKid: randomUUID(), klass: randomUUID() };
	const family = (id, name) => db()`insert into families (id, name, email, phone, password_hash, roles) values (${id}, ${name}, ${email(name)}, '', 'hash', ${['guardian']})`;
	let groupId;
	try {
		for (const [id, name] of [[ids.admin, 'admin'], [ids.teacher, 'teacher'], [ids.parent, 'parent'], [ids.other, 'other']]) { await family(id, name); await getFamily(id); }
		await db()`update family_emails set roles = ${['admin']} where family_id = ${ids.admin}`;
		await db()`update family_emails set roles = ${['staff']} where family_id = ${ids.teacher}`;
		await db()`insert into children (id, family_id, kind, name, grade, position) values (${ids.kid}, ${ids.parent}, 'student', ${`Kid ${stamp}`}, '4', 0), (${ids.otherKid}, ${ids.other}, 'student', ${`Other ${stamp}`}, '4', 0)`;
		await db()`insert into classes (id, school_year, name, grade, kind, teacher_email) values (${ids.klass}, ${schoolYearOf()}, ${`ZZ Msg ${stamp}`}, ${`Z${stamp}`}, 'homeroom', ${email('teacher')})`;
		await school.setRoster(ids.klass, [ids.kid]);

		const admin = { email: email('admin'), admin: true, staff: true };
		const teacher = { email: email('teacher'), admin: false, staff: true };
		const parent = { familyId: ids.parent, email: email('parent'), admin: false, staff: false };
		const other = { familyId: ids.other, email: email('other'), admin: false, staff: false };
		const student = { familyId: ids.parent, studentId: ids.kid, email: email('kid'), admin: false, staff: false };
		const me = (name) => ({ email: email(name), name });

		// Direct: staff with staff; a teacher only with families they teach; admins with any family.
		assert.equal(await school.canDirect(teacher, email('admin')), true);
		assert.equal(await school.canDirect(teacher, `family:${ids.parent}`), true, 'teaches their child');
		assert.equal(await school.canDirect(teacher, `family:${ids.other}`), false, 'doesn’t teach theirs');
		assert.equal(await school.canDirect(admin, `family:${ids.other}`), true);
		assert.equal(await school.canDirect(teacher, email('parent')), false, 'a family is written to as a family, not one parent');
		// Families only reply, and never to another family.
		assert.equal(await school.canDirect(parent, email('teacher')), false, 'families don’t start them');
		assert.equal(await school.canDirect(parent, `family:${ids.other}`), false);
		assert.equal((await school.postDirect(parent, email('teacher'), 'hi', me('parent'))).ok, false);
		assert.deepEqual(await school.postDirect(teacher, `family:${ids.parent}`, 'Quick note about Friday.', me('teacher')), { ok: true, key: `family:${ids.parent}` });
		assert.equal(await school.canDirect(parent, email('teacher')), true, 'now they can reply');
		assert.equal((await school.postDirect(parent, email('teacher'), 'Thanks!', me('parent'))).ok, true);
		const teacherList = await school.listConversations(teacher);
		const dm = teacherList.find((item) => item.kind === 'direct');
		assert.equal(dm?.key, `family:${ids.parent}`);
		assert.equal(dm?.unread, true, 'the family’s reply is new to the teacher');
		assert.equal((await school.openConversation(other, 'direct', email('teacher'))), null, 'another family can’t open it');
		assert.equal((await school.openConversation(parent, 'direct', email('teacher')))?.messages.length, 2);
		// Students have no direct or group messages.
		assert.deepEqual(await school.listConversations(student), []);
		assert.equal(await school.canDirect(student, email('teacher')), false);

		// Groups: automatic ones follow roles and classes; custom ones hold anyone.
		const groups = await school.listGroups();
		assert.ok(groups.find((group) => group.key === 'auto:admins').members.includes(email('admin')));
		assert.ok(groups.find((group) => group.key === 'auto:teachers').members.includes(email('teacher')));
		assert.deepEqual(groups.find((group) => group.key === `auto:grade:Z${stamp}`).members, [email('teacher')], 'grade team from the class');
		assert.equal((await school.saveGroup({ name: ' ', members: [email('admin')], by: email('admin') })).ok, false);
		const saved = await school.saveGroup({ name: `Ed Council ${stamp}`, members: [email('admin'), email('teacher'), email('parent'), 'nobody@example.com'], by: email('admin') });
		assert.equal(saved.ok, true);
		groupId = saved.id;
		const key = `group:${groupId}`;
		assert.deepEqual((await school.listGroups()).find((group) => group.key === key).members, [email('admin'), email('parent'), email('teacher')].sort(), 'unknown emails are dropped');
		// A parent sees the custom group, never the staff ones; a non-member sees neither.
		const parentGroups = (await school.listConversations(parent)).filter((item) => item.kind === 'group').map((item) => item.key);
		assert.deepEqual(parentGroups, [key]);
		assert.equal((await school.listConversations(other)).some((item) => item.kind === 'group'), false);
		assert.equal((await school.postGroup(other, key, 'let me in', me('other'))).ok, false);
		assert.equal((await school.postGroup(parent, 'auto:staff', 'hi', me('parent'))).ok, false);
		assert.equal((await school.postGroup(admin, key, 'Agenda attached.', me('admin'))).ok, true);
		assert.equal((await school.postGroup(parent, key, 'See you Tuesday.', me('parent'))).ok, true);
		const thread = await school.openConversation(teacher, 'group', key);
		assert.deepEqual(thread.messages.map((msg) => msg.body), ['Agenda attached.', 'See you Tuesday.']);
		// Removing someone takes the group away from them.
		await school.saveGroup({ id: groupId, name: `Ed Council ${stamp}`, members: [email('admin'), email('teacher')], by: email('admin') });
		assert.equal(await school.openConversation(parent, 'group', key), null);

		// Student conversations stay separate: an admin's student list has no direct or group threads.
		assert.equal((await school.listThreads(admin)).some((thread) => !thread.childId || thread.childId === 'null'), false);
	} finally {
		if (groupId) await school.deleteGroup(groupId);
		const keys = [`family:${ids.parent}`, `family:${ids.other}`, email('admin'), email('teacher')];
		await db()`delete from message_threads where kind = 'direct' and (split_part(dm_key, '|', 1) = any(${keys}) or split_part(dm_key, '|', 2) = any(${keys}))`;
		await db()`delete from classes where id = ${ids.klass}`;
		await db()`delete from families where id = any(${Object.values(ids).slice(0, 4)}::uuid[])`;
	}
});
