import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The classroom end to end against a real database, with its own families,
 * class and students (removed afterwards): student sign-ins can't reach a
 * parent's account, messaging permissions, class notes, report cards that
 * stay as released, missing work, the transcript math and attendance.
 */
test('classroom: sign-ins, messages, report cards, missing work, transcript, attendance', async (t) => {
	if (!process.env.DATABASE_URL) { t.skip('DATABASE_URL is not set'); return; }
	const school = await import('@tca/school');
	const { db, dbReady, getFamily, schoolYearOf, chicagoToday } = school;
	const { studentPathAllowed } = await import('../portal/src/lib/security.ts');
	await dbReady();
	const stamp = Date.now();
	const year = schoolYearOf();
	const ids = { family: randomUUID(), other: randomUUID(), teacher: randomUUID(), outsider: randomUUID(), kid: randomUUID(), sibling: randomUUID(), stranger: randomUUID(), klass: randomUUID(), course: randomUUID() };
	const email = (name) => `${name}-${stamp}@example.com`;
	const makeFamily = (id, name) => db()`insert into families (id, name, email, phone, password_hash, roles) values (${id}, ${name}, ${email(name.toLowerCase())}, '', 'hash', ${['guardian']})`;
	try {
		await makeFamily(ids.family, 'Parent'); await makeFamily(ids.other, 'Other'); await makeFamily(ids.teacher, 'Teacher'); await makeFamily(ids.outsider, 'Outsider');
		for (const id of [ids.family, ids.other, ids.teacher, ids.outsider]) await getFamily(id); // mirrors each primary email
		await db()`update family_emails set roles = ${['staff']} where family_id in (${ids.teacher}, ${ids.outsider})`;
		const child = (id, familyId, name, grade) => db()`insert into children (id, family_id, kind, name, grade, position) values (${id}, ${familyId}, 'student', ${name}, ${grade}, 0)`;
		await child(ids.kid, ids.family, `Kit Flow${stamp}`, '7'); await child(ids.sibling, ids.family, `Sib Flow${stamp}`, '3'); await child(ids.stranger, ids.other, `Stran Flow${stamp}`, '7');
		for (const kid of [ids.kid, ids.sibling, ids.stranger]) await db()`insert into enrollments (id, child_id, school_year, grade, status) values (${randomUUID()}, ${kid}, ${year}, '7', 'enrolled')`;
		await db()`insert into classes (id, school_year, name, grade, kind, teacher_email) values (${ids.klass}, ${year}, ${`ZZ Flow ${stamp}`}, '7', 'homeroom', ${email('teacher')})`;
		await school.setRoster(ids.klass, [ids.kid, ids.sibling, ids.stranger]);
		await db()`insert into courses (id, class_id, subject, teacher_email, grading, position) values (${ids.course}, ${ids.klass}, 'Math', '', 'letter', 0)`;

		// ---- Student sign-in: their own pages only, never a way into the parent's account.
		assert.equal((await school.setStudentLogin({ familyId: ids.family, childId: ids.sibling, email: email('sib'), password: 'long-enough-1' })).ok, false, '3rd graders get no sign-in');
		assert.equal((await school.setStudentLogin({ familyId: ids.other, childId: ids.kid, email: email('kit'), password: 'long-enough-1' })).ok, false, 'another family cannot set it');
		assert.equal((await school.setStudentLogin({ familyId: ids.family, childId: ids.kid, email: email('parent'), password: 'long-enough-1' })).ok, false, 'a parent’s email is taken');
		assert.deepEqual(await school.setStudentLogin({ familyId: ids.family, childId: ids.kid, email: email('kit'), password: 'long-enough-1' }), { ok: true });
		const access = await school.sessionAccess(ids.family, email('kit'));
		assert.deepEqual(access.roles, ['student']);
		assert.equal(access.studentId, ids.kid);
		assert.equal((await school.sessionAccess(ids.family, email('parent'))).studentId, undefined);
		assert.equal((await school.signInFamily(email('kit'), 'long-enough-1')).ok, true);
		assert.deepEqual(await school.requestPasswordReset(email('kit')), { verifyUrl: null, email: null }, 'no reset link for a student sign-in');
		assert.ok(!(await school.listSignInEmails(ids.family)).some((item) => item.email === email('kit')), 'not among the family’s sign-in emails');
		// Google sign-in with the student's email opens the same student session and leaves the family's name alone.
		const google = await school.signInWithGoogle({ sub: `sub-${stamp}`, email: email('kit'), givenName: 'Kit', familyName: 'Flow' });
		assert.equal(google.id, ids.family);
		assert.equal((await school.sessionAccess(google.id, google.sessionEmail)).studentId, ids.kid);
		assert.equal(google.sessionEmail, email('kit'));
		assert.equal((await db()`select name from families where id = ${ids.family}`)[0].name, 'Parent');
		for (const path of ['/s', '/s/messages', '/sign-out', '/api/badges']) assert.ok(studentPathAllowed(path), path);
		for (const path of ['/g', '/g/students', '/account', '/staff', '/admin', '/records/x', '/home', '/sx']) assert.ok(!studentPathAllowed(path), path);

		// ---- Messaging permissions.
		const familyViewer = { familyId: ids.family, email: email('parent'), admin: false, staff: false };
		const studentViewer = { familyId: ids.family, studentId: ids.kid, email: email('kit'), admin: false, staff: false };
		const teacherViewer = { email: email('teacher'), admin: false, staff: true };
		const outsiderViewer = { email: email('outsider'), admin: false, staff: true };
		assert.equal(await school.canSeeChild(ids.kid, studentViewer), true);
		assert.equal(await school.canSeeChild(ids.sibling, studentViewer), false, 'a student sees only their own conversation');
		assert.equal(await school.canSeeChild(ids.stranger, familyViewer), false);
		assert.equal(await school.canSeeChild(ids.kid, teacherViewer), true);
		assert.equal(await school.canSeeChild(ids.kid, outsiderViewer), false, 'staff who don’t teach the student can’t');
		const teachers = await school.childTeachers(ids.kid);
		assert.equal(teachers[0].email, email('teacher'));
		assert.equal(teachers[0].role, 'Homeroom');
		const staffBefore = await school.unreadCount(teacherViewer);
		assert.equal((await school.postMessage({ childId: ids.kid, body: 'Kit will be late Friday.', author: { email: email('parent'), name: 'Parent' }, fromFamily: true, to: 'not-a-teacher@example.com' })).ok, true);
		const [sent] = await db()`select to_email from messages m join message_threads t on t.id = m.thread_id where t.child_id = ${ids.kid}`;
		assert.equal(sent.to_email, email('teacher'), 'an unknown recipient falls back to the homeroom teacher');
		assert.equal(await school.unreadCount(teacherViewer), staffBefore + 1);
		const [thread] = await school.listThreads(teacherViewer).then((list) => list.filter((item) => item.childId === ids.kid));
		await school.threadMessages(thread.id, email('teacher'));
		assert.equal(await school.unreadCount(teacherViewer), staffBefore);
		await school.postMessage({ childId: ids.kid, body: 'I finished the project!', author: { email: email('kit'), name: 'Kit' }, fromFamily: true, fromStudent: true });
		assert.equal(await school.unreadCount(familyViewer), 1, 'the family sees what their student wrote');
		assert.equal(await school.unreadCount(studentViewer), 0);
		// A note to the class: one per family, landing in each student's conversation.
		const note = await school.postClassMessage({ classId: ids.klass, body: 'Coats tomorrow, please.', author: { email: email('teacher'), name: 'Teacher' } });
		assert.deepEqual(note, { ok: true, sent: 2 });
		assert.equal((await db()`select count(*)::int as n from messages where class_id = ${ids.klass}`)[0].n, 3);

		// ---- Grades, missing work and report cards.
		const terms = await school.listTerms(year);
		const term = school.termFor(terms, chicagoToday()) ?? terms[0];
		const assignment = await school.saveCourseAssignment({ courseId: ids.course, title: 'Test 1', category: 'Tests', description: '', dueOn: term.startsOn, points: '20', graded: true, published: true });
		assert.equal(assignment.ok, true);
		const [{ id: assignmentId }] = await db()`select id from assignments where course_id = ${ids.course}`;
		await school.saveScores(assignmentId, { [ids.kid]: '18', [ids.stranger]: 'M' });
		const graded = await school.gradesFor([ids.kid, ids.stranger], term, { includeHidden: false });
		assert.equal(graded.get(ids.kid)[0].grade, 'A- (90%)');
		assert.equal(graded.get(ids.stranger)[0].percent, 0, 'missing work counts as zero');
		assert.equal((await db()`select count(*)::int as n from grade_alerts where child_id = ${ids.stranger}`)[0].n, 1, 'one low-grade alert');
		await school.saveScores(assignmentId, { [ids.stranger]: 'M' });
		assert.equal((await db()`select count(*)::int as n from grade_alerts where child_id = ${ids.stranger}`)[0].n, 1, 'no second alert');
		await school.saveScores(assignmentId, { [ids.stranger]: '19' });
		assert.equal((await db()`select count(*)::int as n from grade_alerts where child_id = ${ids.stranger}`)[0].n, 0, 'cleared once the grade recovers');

		await school.saveReportCard({ termId: term.id, childId: ids.kid, courseComments: { [ids.course]: 'Strong work.' }, courseMarks: {}, generalComment: 'A joy.', conduct: 'E' });
		assert.equal(await school.releaseReportCards(ids.klass, term), 3);
		assert.equal(await school.releaseReportCards(ids.klass, term), 0, 'releasing again with no changes does nothing');
		await school.saveReportCard({ termId: term.id, childId: ids.kid, courseComments: { [ids.course]: 'Strong work.' }, courseMarks: {}, generalComment: 'Edited after release.', conduct: 'S' });
		const [released] = await school.childReportCards(ids.kid);
		assert.equal(released.generalComment, 'A joy.', 'families keep seeing the released version');
		assert.equal(released.conduct, 'E');
		assert.equal((await school.classReportCards(ids.klass, term)).find((row) => row.child.id === ids.kid).changed, true);
		assert.equal(await school.releaseReportCards(ids.klass, term), 1, 'only the changed card goes out again');
		assert.equal((await school.childReportCards(ids.kid))[0].generalComment, 'Edited after release.');

		// ---- Transcript: imported past quarters average on the 4.0 scale (A and B make A-).
		const imported = await school.importPastGrades(`Student,School year,Quarter,Subject,Grade\nKit Flow${stamp},2020–21,Q1,Latin,A\n"Kit Flow${stamp}",2020-21,Quarter 2,Latin,B\nNobody Here,2020–21,Q1,Latin,A\n`);
		assert.equal(imported.ok, true);
		assert.equal(imported.rows, 2);
		assert.deepEqual(imported.unmatched, ['Nobody Here']);
		const record = await school.transcript(ids.kid);
		const past = record.years.find((item) => item.schoolYear === '2020–21');
		assert.deepEqual(past.subjects, [{ subject: 'Latin', quarters: ['A', 'B'], final: 'A-' }]);
		assert.equal(past.gpa, 3.7);

		// ---- Attendance: "left early" is allowed; marks show in the export.
		await school.saveAttendance(ids.klass, chicagoToday(), { [ids.kid]: 'absent', [ids.sibling]: 'early' }, email('teacher'));
		const exported = await school.attendanceExport({ year, classIds: [ids.klass] });
		assert.deepEqual(exported.map((row) => row.status).sort(), ['Absent', 'Left early']);
	} finally {
		await db()`delete from classes where id = ${ids.klass}`;
		await db()`delete from report_cards where term_id in (select id from school_terms where school_year = '2020–21')`;
		await db()`delete from school_terms where school_year = '2020–21'`;
		await db()`delete from families where id in (${ids.family}, ${ids.other}, ${ids.teacher}, ${ids.outsider})`;
	}
});
