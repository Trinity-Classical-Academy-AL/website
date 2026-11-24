import { test } from 'node:test';
import assert from 'node:assert/strict';

test('hiring: apply, move through the stages with emails, recommendations tally, hired gets Teacher access', async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip('DATABASE_URL is not set');
		return;
	}
	const { db, dbReady, createTeacherApplication, listTeacherApplicants, setApplicantStage, addApplicantNote, applicantNotes, scheduleApplicant, setTeacherApplicationUrl, teacherApplicationUrl } = await import('@tca/school');
	await dbReady();
	const stamp = Date.now();
	const email = `teacher-${stamp}@example.com`;
	const before = await teacherApplicationUrl();
	let id = '';
	try {
		const bad = await createTeacherApplication({ name: 'J', email: 'nope' });
		assert.equal(bad.ok, false);
		assert.ok(bad.fields.name && bad.fields.email);

		const created = await createTeacherApplication({ name: 'Julie Teacher', email, position: 'Grammar school', statement: 'Truth, goodness and beauty.' });
		assert.equal(created.ok, true);
		id = created.id;
		const sent = async (template) => (await db()`select count(*)::int as n from email_log where recipient = ${email} and template = ${template}`)[0].n;
		assert.equal(await sent('hiring.received'), 1, 'the candidate gets a receipt');

		await setTeacherApplicationUrl('');
		assert.equal((await setApplicantStage(id, 'full_application', 'office@example.com')).ok, false, 'no link, no full application');
		await setTeacherApplicationUrl('https://example.com/full-application');
		assert.deepEqual(await setApplicantStage(id, 'full_application', 'office@example.com'), { ok: true });
		assert.equal(await sent('hiring.full-application'), 1);
		await setApplicantStage(id, 'full_application', 'office@example.com');
		assert.equal(await sent('hiring.full-application'), 1, 'repeating a stage does not email again');
		await setApplicantStage(id, 'video_lesson', 'office@example.com');
		assert.equal(await sent('hiring.video-lesson'), 1);

		assert.deepEqual(await scheduleApplicant({ id, videoWith: 'Admin@Example.com', videoAt: '2027-01-12T15:00:00.000Z', boardAt: '2027-01-19T23:00:00.000Z' }, 'office@example.com'), { ok: true });
		assert.equal((await addApplicantNote({ id, note: '' }, 'a@example.com')).ok, false);
		await addApplicantNote({ id, note: 'Great lesson', recommendation: 'maybe' }, 'board1@example.com');
		await addApplicantNote({ id, note: 'Changed my mind', recommendation: 'yes' }, 'board1@example.com');
		await addApplicantNote({ id, note: '', recommendation: 'no' }, 'board2@example.com');
		await addApplicantNote({ id, note: 'Strong Latin' }, 'board3@example.com');
		const row = (await listTeacherApplicants()).find((app) => app.id === id);
		assert.deepEqual(row.tally, { yes: 1, maybe: 0, no: 1 }, 'each reviewer counts once, their latest');
		assert.equal(row.videoWith, 'admin@example.com');
		assert.equal(row.status, 'video_lesson');

		assert.deepEqual(await setApplicantStage(id, 'hired', 'office@example.com'), { ok: true });
		const [access] = await db()`select roles from family_emails where email = ${email}`;
		assert.ok(access?.roles.includes('staff'), 'hired candidates get Teacher access');
		assert.ok((await applicantNotes(id)).some((note) => note.kind === 'stage' && note.note === 'Hired'));
	} finally {
		await setTeacherApplicationUrl(before);
		if (id) await db()`delete from teacher_applicants where id = ${id}`;
		const fams = await db()`select family_id from family_emails where email = ${email}`;
		await db()`delete from family_emails where email = ${email}`;
		for (const fam of fams) await db()`delete from families where id = ${fam.family_id}`;
	}
});

test('hiring: candidates apply from their account with a CV, get the portal full application, follow along and can withdraw', async (t) => {
	if (!process.env.DATABASE_URL) {
		t.skip('DATABASE_URL is not set');
		return;
	}
	const { randomUUID } = await import('node:crypto');
	const tmp = await import('node:os').then((os) => os.tmpdir());
	process.env.ADMISSIONS_DATA_DIR = `${tmp}/tca-hiring-test-${Date.now()}`;
	const { db, dbReady, getFamily, createTeacherApplication, setApplicantStage, myTeacherApplication, readApplicantFile, saveSchoolForm, saveAssignment, applicantFullApplication, withdrawMyApplication, sessionAccess } = await import('@tca/school');
	await dbReady();
	const stamp = Date.now();
	const email = `cand-${stamp}@example.com`;
	const family = randomUUID();
	let formId = '';
	await db()`insert into families (id, name, email, phone, password_hash, roles) values (${family}, ${'Cara Candidate'}, ${email}, ${''}, ${'hash'}, ${['prospect']})`;
	try {
		await getFamily(family);
		const noCv = await createTeacherApplication({ familyId: family, name: 'Cara Candidate', email, files: {} });
		assert.equal(noCv.ok, false);
		assert.ok(noCv.fields.cv, 'a CV is required from the portal');

		const cv = new File([new TextEncoder().encode('%PDF-1.4 cv')], 'cara-cv.pdf', { type: 'application/pdf' });
		const created = await createTeacherApplication({ familyId: family, name: 'Cara Candidate', email, position: 'Latin', files: { cv } });
		assert.equal(created.ok, true);
		assert.equal((await createTeacherApplication({ familyId: family, name: 'Cara Candidate', email, files: { cv } })).ok, false, 'one open application at a time');
		assert.equal((await sessionAccess(family, email)).teaching, true, 'Teaching shows in the sidebar');

		const mine = await myTeacherApplication(family, email);
		assert.equal(mine.status, 'applied');
		assert.equal(mine.files.length, 1);
		const file = await readApplicantFile({ applicantId: mine.id, key: mine.files[0].key, familyId: family });
		assert.equal(file?.name, 'cara-cv.pdf');
		assert.equal(await readApplicantFile({ applicantId: mine.id, key: mine.files[0].key, familyId: randomUUID() }), null, 'not another household');

		const saved = await saveSchoolForm({ title: `Teacher full application ${stamp}`, instructions: '', audience: 'everyone', grade: '', dueOn: '', publish: true, purpose: 'teacher', questions: [{ id: 'q1', label: 'Favorite book', type: 'short', required: true }] });
		assert.equal(saved.ok, true);
		formId = saved.id;
		assert.deepEqual(await setApplicantStage(mine.id, 'full_application', 'office@example.com'), { ok: true });
		const step = await myTeacherApplication(family, email);
		assert.ok(step.form, 'the portal form is assigned to them');
		assert.deepEqual(await saveAssignment({ familyId: family, id: step.form.id, answers: { q1: 'The Iliad' }, signature: 'Cara Candidate', confirm: true, submit: true }), { ok: true });
		const answers = await applicantFullApplication(mine.id);
		assert.equal(answers.status, 'submitted');
		assert.equal(answers.answers[0].value, 'The Iliad');

		assert.deepEqual(await withdrawMyApplication(mine.id, family, email), { ok: true });
		assert.equal((await myTeacherApplication(family, email)).status, 'withdrawn');
		assert.equal((await sessionAccess(family, email)).teaching, false);
	} finally {
		await db()`delete from teacher_applicants where family_id = ${family}`;
		if (formId) await db()`delete from school_forms where id = ${formId}`;
		await db()`delete from family_emails where family_id = ${family}`;
		await db()`delete from families where id = ${family}`;
	}
});
