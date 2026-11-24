import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('classreach match: dry run sorts matched / new / conflict, import is idempotent and sends nothing', async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip('DATABASE_URL is not set');
		return;
	}
	const { db, dbReady, getFamily, classReachMatch, importClassReach, skipClassReach, planClassReachMatch, classReachGrade, classReachDisplayName } = await import('@tca/school');
	const { CLASSREACH_MATCH_SQL } = await import('../packages/school/src/classreach-match-schema.ts');
	await dbReady();
	await db().unsafe(CLASSREACH_MATCH_SQL);

	assert.equal(classReachDisplayName('Brooks, Rachel'), 'Rachel Brooks');
	assert.equal(classReachGrade('Kindergarten'), 'K');
	assert.equal(classReachGrade('3rd Grade'), '3');
	assert.equal(planClassReachMatch({ guardians: [], families: [], students: [], skips: new Set(), emails: [], portalFamilies: [], children: [] }).items.length, 0);

	const stamp = String(Date.now());
	const S = stamp.split('').map((digit) => 'abcdefghij'[Number(digit)]).join('');
	const email = (name) => `${name}-${stamp}@example.com`;
	const brooks = randomUUID(), twinA = randomUUID(), twinB = randomUUID();
	const make = (id, name, last, address) => db()`
		insert into families (id, name, last_name, email, phone, password_hash, roles) values (${id}, ${name}, ${last}, ${address}, ${''}, ${'hash'}, ${['prospect']})`;
	await make(brooks, `Rachel Brooks${S}`, `Brooks${S}`, email('rachel'));
	await make(twinA, `Ann Twin${S}`, `Twin${S}`, email('twin-a'));
	await make(twinB, `Bo Twin${S}`, `Twin${S}`, email('twin-b'));
	const cr = (name) => `cr-${stamp}-${name}`;
	const stage = (table, id, fullName, address, payload = {}) => db()`
		insert into ${db()(table)} (classreach_id, directory_name, email, full_name, payload) values (${id}, ${'Families'}, ${address}, ${fullName}, ${db().json(payload)})`;
	const startedAt = new Date();
	let leeFamily = '';
	try {
		for (const id of [brooks, twinA, twinB]) await getFamily(id);
		await db()`insert into children (id, family_id, kind, name, position) values (${randomUUID()}, ${brooks}, 'prospective', ${`Oliver Brooks${S}`}, 0)`;
		await stage('classreach_guardians', cr('rachel'), `Brooks${S}, Rachel`, email('rachel'));
		await stage('classreach_families', `email:${email('rachel')}`, `Brooks${S}, Rachel`, email('rachel'));
		await stage('classreach_guardians', cr('pat'), `Lee${S}, Pat`, email('pat'));
		await stage('classreach_guardians', cr('noemail'), `Nobody${S}, Sam`, '');
		await stage('classreach_guardians', cr('mark'), `Mark Brooks${S}`, email('mark'));
		await stage('classreach_students', cr('oliver'), `Brooks${S}, Oliver`, '', { StudentAcademicLevel: '2nd Grade' });
		await stage('classreach_students', cr('ivy'), `Ivy Lee${S}`, '', { StudentAcademicLevel: 'Kindergarten' });
		await stage('classreach_students', cr('ann'), `Cy Twin${S}`, '', {});
		await stage('classreach_students', cr('max'), `Max Brooks${S}`, '', { StudentAcademicLevel: '4', ParentEmails: [email('rachel')] });

		const statusOf = (match) => Object.fromEntries(match.items.filter((item) => item.classreachId.startsWith(`cr-${stamp}`)).map((item) => [item.classreachId.slice(`cr-${stamp}-`.length), item.status]));
		const dry = await classReachMatch();
		assert.deepEqual(statusOf(dry), {
			rachel: 'matched', pat: 'new', noemail: 'conflict', mark: 'conflict',
			oliver: 'matched', ivy: 'conflict', ann: 'conflict', max: 'new',
		});
		const byId = (match, name) => match.items.find((item) => item.classreachId === cr(name));
		assert.equal(byId(dry, 'oliver').basis, 'Name');
		assert.equal(byId(dry, 'max').basis, 'Email');
		assert.equal(byId(dry, 'mark').familyId, brooks, 'same last name suggests the Brooks family');
		assert.equal(byId(dry, 'ann').candidates.length, 2);
		assert.match(byId(dry, 'ivy').reason, /Import Pat Lee/);
		assert.ok(!dry.items.some((item) => item.key === `f:email:${email('rachel')}`), 'the household row a guardian derives is not listed twice');
		for (const key of ['matched', 'new', 'conflict', 'imported', 'skipped']) assert.equal(typeof dry.summary[key], 'number');
		assert.equal((await db()`select count(*)::int as n from children where family_id = ${brooks}`)[0].n, 1, 'the dry run writes nothing');

		const keys = ['rachel', 'pat', 'noemail', 'mark', 'oliver', 'ivy', 'ann', 'max'].map((name) => byId(dry, name).key);
		const first = await importClassReach({ keys, targets: { [byId(dry, 'mark').key]: brooks }, by: 'office@example.com' });
		assert.deepEqual(first, { ok: true, imported: 6, needsDecision: 2 });

		const kids = await db()`select name, kind, grade, classreach_id from children where family_id = ${brooks} order by name`;
		assert.deepEqual(kids.map((kid) => [kid.name, kid.kind, kid.grade, kid.classreach_id]), [
			[`Max Brooks${S}`, 'student', '4', cr('max')],
			[`Oliver Brooks${S}`, 'student', '2', cr('oliver')],
		]);
		assert.equal((await db()`select family_id from family_emails where email = ${email('mark')}`)[0].family_id, brooks, 'Mark joins the Brooks family');
		assert.ok((await db()`select roles from families where id = ${brooks}`)[0].roles.includes('guardian'));
		[{ family_id: leeFamily }] = await db()`select family_id from family_emails where email = ${email('pat')}`;
		assert.ok(leeFamily && leeFamily !== brooks, 'Pat starts a family');
		assert.equal((await db()`select name from children where family_id = ${leeFamily}`)[0].name, `Ivy Lee${S}`, 'Ivy, approved with Pat, lands in the new family');
		assert.equal((await db()`select count(*)::int as n from enrollments e join children c on c.id = e.child_id where c.family_id in ${db()([brooks, leeFamily])} and e.status = 'enrolled'`)[0].n, 3);
		assert.equal((await db()`select approval from classreach_families where classreach_id = ${`email:${email('rachel')}`}`)[0].approval, 'approved');

		const again = await classReachMatch();
		assert.deepEqual(statusOf(again), {
			rachel: 'imported', pat: 'imported', noemail: 'conflict', mark: 'imported',
			oliver: 'imported', ivy: 'imported', ann: 'conflict', max: 'imported',
		});
		assert.deepEqual(await importClassReach({ keys, by: 'office@example.com' }), { ok: true, imported: 0, needsDecision: 2 }, 're-running changes nothing');
		assert.equal((await db()`select count(*)::int as n from children where family_id = ${brooks}`)[0].n, 2);

		assert.deepEqual(await skipClassReach({ keys: [byId(dry, 'ann').key], skip: true, by: 'office@example.com' }), { ok: true, count: 1 });
		assert.equal(statusOf(await classReachMatch()).ann, 'skipped');
		await skipClassReach({ keys: [byId(dry, 'ann').key], skip: false, by: 'office@example.com' });
		assert.equal(statusOf(await classReachMatch()).ann, 'conflict');

		const everyone = ['rachel', 'pat', 'mark', 'twin-a', 'twin-b'].map(email);
		const sent = await db()`select count(*)::int as n from email_log where at >= ${startedAt} and recipient in ${db()(everyone)}`;
		assert.equal(sent[0].n, 0, 'no email goes out');
	} finally {
		await db()`delete from classreach_guardians where classreach_id like ${`cr-${stamp}-%`}`;
		await db()`delete from classreach_students where classreach_id like ${`cr-${stamp}-%`}`;
		await db()`delete from classreach_families where classreach_id = ${`email:${email('rachel')}`}`;
		await db()`delete from classreach_match_skips where classreach_id like ${`cr-${stamp}-%`}`;
		const ids = [brooks, twinA, twinB, leeFamily].filter(Boolean);
		await db()`delete from families where id in ${db()(ids)}`;
	}
});
