import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { schoolYearOf } from './applications.ts';
import { routeEmail } from './accounts.ts';
import { portalOrigin, staffNotifyEmail } from './email.ts';
import { sendTemplate } from './email-catalog.ts';
import type { Result } from './result.ts';

/**
 * The classroom side of the school, set up the way most ACCS schools run:
 *
 * - The year has four quarters; report cards go out each quarter.
 * - K–6 has one homeroom per grade whose teacher teaches its subjects; 7–8
 *   can add subject sections with their own teachers.
 * - K–2 subjects are marked E/S/N/U; 3rd grade and up earn points that roll
 *   up by weighted category (Tests, Quizzes, Homework, Projects) to a percent
 *   and a letter grade.
 * - The homeroom teacher takes attendance each day; families can report an
 *   absence ahead of time.
 * - Each student has one conversation between the family and the school.
 */

// ---------- Grading ----------
export const MARKS = [
	{ value: 'E', label: 'Excellent' }, { value: 'S', label: 'Satisfactory' },
	{ value: 'N', label: 'Needs improvement' }, { value: 'U', label: 'Unsatisfactory' },
] as const;
export const CATEGORIES = ['Tests', 'Quizzes', 'Homework', 'Projects'] as const;
const LETTERS: [number, string][] = [[93, 'A'], [90, 'A-'], [87, 'B+'], [83, 'B'], [80, 'B-'], [77, 'C+'], [73, 'C'], [70, 'C-'], [67, 'D+'], [63, 'D'], [60, 'D-'], [0, 'F']];
export const letterFor = (percent: number) => LETTERS.find(([min]) => percent >= min)![1];
const LOWER = new Set(['K', '1', '2']);
export const gradingFor = (grade: string): 'letter' | 'mark' => LOWER.has(grade.trim().toUpperCase()) ? 'mark' : 'letter';
const SUBJECTS_LOWER = ['Bible', 'Phonics & Reading', 'Math', 'History', 'Science'];
const SUBJECTS_UPPER = ['Bible', 'Latin', 'Math', 'Literature', 'Grammar & Writing', 'History', 'Science'];
const GRADE_ORDER = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
export const gradeName = (grade: string) => grade === 'K' ? 'Kindergarten' : grade ? `${grade}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<string, string>)[grade] ?? 'th'} Grade` : 'Class';

export type ScoreCell = { points: number | null; mark: string; excused: boolean };
/**
 * A student's grade in a course for a set of assignments: letter courses
 * weight each category's points (categories with nothing graded are left out);
 * mark courses take the most common mark (ties go to the lower mark).
 */
export function courseGrade(input: { grading: 'letter' | 'mark'; weights: Record<string, number>; assignments: { id: string; category: string; points: number | null; graded: boolean }[]; scores: Map<string, ScoreCell> }): { percent: number | null; display: string } {
	const graded = input.assignments.filter((item) => item.graded);
	if (input.grading === 'mark') {
		const counts = new Map<string, number>();
		for (const item of graded) { const cell = input.scores.get(item.id); if (cell && !cell.excused && cell.mark) counts.set(cell.mark, (counts.get(cell.mark) ?? 0) + 1); }
		if (!counts.size) return { percent: null, display: '' };
		const order = MARKS.map((item) => item.value as string);
		const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(b[0]) - order.indexOf(a[0]))[0][0];
		return { percent: null, display: best };
	}
	let weighted = 0, weightUsed = 0;
	for (const [category, weight] of Object.entries(input.weights)) {
		let earned = 0, possible = 0;
		for (const item of graded.filter((assignment) => assignment.category === category && assignment.points)) {
			const cell = input.scores.get(item.id);
			if (!cell || cell.excused || cell.points == null) continue;
			earned += cell.points; possible += Number(item.points);
		}
		if (possible > 0 && weight > 0) { weighted += (earned / possible) * weight; weightUsed += weight; }
	}
	if (!weightUsed) return { percent: null, display: '' };
	const percent = Math.round((weighted / weightUsed) * 1000) / 10;
	return { percent, display: `${letterFor(percent)} (${percent}%)` };
}

// ---------- Terms ----------
export type Term = { id: string; schoolYear: string; name: string; startsOn: string; endsOn: string };
const mapTerm = (row: any): Term => ({ id: String(row.id), schoolYear: String(row.school_year), name: String(row.name), startsOn: String(row.starts_on), endsOn: String(row.ends_on) });

/** The year's quarters, created with usual dates the first time they're needed. */
export async function listTerms(year = schoolYearOf()): Promise<Term[]> {
	await dbReady();
	let rows = await db()`select id, school_year, name, starts_on::text, ends_on::text from school_terms where school_year = ${year} order by position, starts_on`;
	if (!rows.length) {
		const start = Number(year.slice(0, 4));
		const quarters = [['Quarter 1', `${start}-08-15`, `${start}-10-17`], ['Quarter 2', `${start}-10-20`, `${start}-12-19`], ['Quarter 3', `${start + 1}-01-05`, `${start + 1}-03-13`], ['Quarter 4', `${start + 1}-03-16`, `${start + 1}-05-29`]];
		for (const [index, [name, from, to]] of quarters.entries()) await db()`insert into school_terms (id, school_year, name, starts_on, ends_on, position) values (${randomUUID()}, ${year}, ${name}, ${from}::date, ${to}::date, ${index}) on conflict do nothing`;
		rows = await db()`select id, school_year, name, starts_on::text, ends_on::text from school_terms where school_year = ${year} order by position, starts_on`;
	}
	return rows.map(mapTerm);
}
export async function saveTerm(id: string, input: { startsOn: string; endsOn: string }): Promise<Result> {
	await dbReady();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) || input.endsOn < input.startsOn) return { ok: false, error: 'Check the term dates.' };
	await db()`update school_terms set starts_on = ${input.startsOn}::date, ends_on = ${input.endsOn}::date where id = ${id}`;
	return { ok: true };
}
/** The term a day falls in (or the nearest one before it). */
export function termFor(terms: Term[], day: string): Term | null {
	return terms.find((term) => day >= term.startsOn && day <= term.endsOn) ?? [...terms].reverse().find((term) => term.startsOn <= day) ?? terms[0] ?? null;
}

// ---------- Classes, rosters, courses ----------
export type Course = { id: string; classId: string; subject: string; teacherEmail: string; grading: 'letter' | 'mark'; weights: Record<string, number> };
export type ClassRow = { id: string; schoolYear: string; name: string; grade: string; kind: 'homeroom' | 'section'; teacherEmail: string; teacherName: string; students: { id: string; name: string; familyId: string }[]; courses: Course[] };

const mapCourse = (row: any): Course => ({ id: String(row.id), classId: String(row.class_id), subject: String(row.subject), teacherEmail: String(row.teacher_email || ''), grading: row.grading === 'mark' ? 'mark' : 'letter', weights: (row.weights ?? {}) as Record<string, number> });

export async function listClasses(year = schoolYearOf()): Promise<ClassRow[]> {
	await dbReady();
	const [classes, roster, courses, people] = await Promise.all([
		db()`select * from classes where school_year = ${year} order by array_position(array['K','1','2','3','4','5','6','7','8','9','10','11','12'], upper(grade)), kind, name`,
		db()`select cs.class_id, c.id, c.name, c.family_id from class_students cs join children c on c.id = cs.child_id order by c.name`,
		db()`select co.* from courses co join classes cl on cl.id = co.class_id where cl.school_year = ${year} order by co.position, co.subject`,
		db()`select e.email, coalesce(nullif(p.name, ''), nullif(e.label, ''), nullif(f.name, ''), e.email) as name from family_emails e join families f on f.id = e.family_id left join family_people p on p.id = e.person_id where 'staff' = any(e.roles) or 'admin' = any(e.roles)`,
	]);
	const names = new Map(people.map((row) => [String(row.email), String(row.name)]));
	return classes.map((row) => ({
		id: String(row.id), schoolYear: String(row.school_year), name: String(row.name), grade: String(row.grade || ''), kind: row.kind === 'section' ? 'section' : 'homeroom',
		teacherEmail: String(row.teacher_email || ''), teacherName: names.get(String(row.teacher_email)) ?? String(row.teacher_email || ''),
		students: roster.filter((item) => String(item.class_id) === String(row.id)).map((item) => ({ id: String(item.id), name: String(item.name), familyId: String(item.family_id) })),
		courses: courses.filter((item) => String(item.class_id) === String(row.id)).map(mapCourse),
	}));
}

/** People who can teach: everyone with Staff (or Admin) access. */
export async function listTeachers(): Promise<{ email: string; name: string }[]> {
	await dbReady();
	const rows = await db()`select e.email, coalesce(nullif(p.name, ''), nullif(e.label, ''), nullif(f.name, ''), e.email) as name from family_emails e join families f on f.id = e.family_id left join family_people p on p.id = e.person_id where 'staff' = any(e.roles) or 'admin' = any(e.roles) order by name`;
	return rows.map((row) => ({ email: String(row.email), name: String(row.name) }));
}

/**
 * Set up the year in one step: a homeroom per grade with this year's enrolled
 * students, the usual subjects, and each grade's current teacher when known.
 * Classes that already exist are left alone.
 */
export async function setUpClasses(year = schoolYearOf()): Promise<number> {
	await dbReady();
	await listTerms(year);
	const students = await db()`
		select c.id, c.grade, c.teacher from children c join enrollments e on e.child_id = c.id
		where e.school_year = ${year} and e.status = 'enrolled' and c.kind = 'student'`;
	const teachers = await listTeachers();
	const byName = new Map(teachers.map((item) => [item.name.toLowerCase(), item.email]));
	let created = 0;
	const grades = [...new Set(students.map((row) => String(row.grade || '').toUpperCase()).filter((grade) => GRADE_ORDER.includes(grade)))];
	for (const grade of grades) {
		const [existing] = await db()`select id from classes where school_year = ${year} and kind = 'homeroom' and upper(grade) = ${grade}`;
		const kids = students.filter((row) => String(row.grade || '').toUpperCase() === grade);
		const teacherName = kids.map((row) => String(row.teacher || '')).find(Boolean) ?? '';
		const classId = existing ? String(existing.id) : randomUUID();
		if (!existing) {
			await db()`insert into classes (id, school_year, name, grade, kind, teacher_email) values (${classId}, ${year}, ${gradeName(grade)}, ${grade}, 'homeroom', ${byName.get(teacherName.toLowerCase()) ?? ''})`;
			const subjects = gradingFor(grade) === 'mark' ? SUBJECTS_LOWER : SUBJECTS_UPPER;
			for (const [index, subject] of subjects.entries()) await db()`insert into courses (id, class_id, subject, teacher_email, grading, position) values (${randomUUID()}, ${classId}, ${subject}, '', ${gradingFor(grade)}, ${index})`;
			created += 1;
		}
		for (const kid of kids) await db()`insert into class_students (class_id, child_id) values (${classId}, ${kid.id}) on conflict do nothing`;
	}
	return created;
}

export async function saveClass(input: { id?: string; year: string; name: string; grade: string; kind: string; teacherEmail: string }): Promise<Result<{ id: string }>> {
	await dbReady();
	const name = input.name.trim().slice(0, 120);
	if (!name) return { ok: false, error: 'Name the class.' };
	const id = input.id || randomUUID();
	const kind = input.kind === 'section' ? 'section' : 'homeroom';
	await db()`insert into classes (id, school_year, name, grade, kind, teacher_email) values (${id}, ${input.year}, ${name}, ${input.grade.trim().toUpperCase()}, ${kind}, ${input.teacherEmail.trim().toLowerCase()})
		on conflict (id) do update set name = excluded.name, grade = excluded.grade, kind = excluded.kind, teacher_email = excluded.teacher_email`;
	return { ok: true, id };
}
export async function deleteClass(id: string): Promise<void> { await dbReady(); await db()`delete from classes where id = ${id}`; }

export async function setRoster(classId: string, childIds: string[]): Promise<void> {
	await dbReady();
	await db()`delete from class_students where class_id = ${classId}`;
	for (const childId of [...new Set(childIds)]) await db()`insert into class_students (class_id, child_id) values (${classId}, ${childId}) on conflict do nothing`;
}

export async function saveCourse(input: { id?: string; classId: string; subject: string; teacherEmail: string; grading: string; weights?: Record<string, string> }): Promise<Result<{ id: string }>> {
	await dbReady();
	const subject = input.subject.trim().slice(0, 80);
	if (!subject) return { ok: false, error: 'Name the subject.' };
	const weights = Object.fromEntries(CATEGORIES.map((category) => [category, Math.max(0, Math.min(100, Number(input.weights?.[category] ?? 0) || 0))]));
	const id = input.id || randomUUID();
	await db()`insert into courses (id, class_id, subject, teacher_email, grading, weights, position) values (${id}, ${input.classId}, ${subject}, ${input.teacherEmail.trim().toLowerCase()}, ${input.grading === 'mark' ? 'mark' : 'letter'}, ${db().json(weights)}, 99)
		on conflict (id) do update set subject = excluded.subject, teacher_email = excluded.teacher_email, grading = excluded.grading, weights = excluded.weights`;
	return { ok: true, id };
}
export async function deleteCourse(id: string): Promise<void> { await dbReady(); await db()`delete from courses where id = ${id}`; }

/** Enrolled students this year, for building rosters. */
export async function enrolledStudents(year = schoolYearOf()): Promise<{ id: string; name: string; grade: string }[]> {
	await dbReady();
	const rows = await db()`select c.id, c.name, c.grade from children c join enrollments e on e.child_id = c.id where e.school_year = ${year} and e.status = 'enrolled' order by array_position(array['K','1','2','3','4','5','6','7','8'], upper(c.grade)), c.name`;
	return rows.map((row) => ({ id: String(row.id), name: String(row.name), grade: String(row.grade || '') }));
}

/** What a teacher can work with: classes they lead and courses they teach (admins: everything). */
export async function teachingFor(email: string, admin: boolean, year = schoolYearOf()): Promise<{ classes: ClassRow[]; courses: (Course & { className: string; grade: string })[] }> {
	const all = await listClasses(year);
	const me = email.trim().toLowerCase();
	const classes = admin ? all : all.filter((row) => row.teacherEmail === me || row.courses.some((course) => course.teacherEmail === me));
	const courses = all.flatMap((row) => row.courses.filter((course) => admin || course.teacherEmail === me || (!course.teacherEmail && row.teacherEmail === me)).map((course) => ({ ...course, className: row.name, grade: row.grade })));
	return { classes, courses };
}

/** Can this person teach (edit) this course? */
export async function canTeach(courseId: string, email: string, admin: boolean): Promise<boolean> {
	if (admin) return true;
	const [row] = await db()`select co.teacher_email, cl.teacher_email as homeroom from courses co join classes cl on cl.id = co.class_id where co.id = ${courseId}`;
	const me = email.trim().toLowerCase();
	return !!row && (row.teacher_email === me || (!row.teacher_email && row.homeroom === me));
}

// ---------- Attendance ----------
export const ATTENDANCE = [{ value: 'present', label: 'Present' }, { value: 'tardy', label: 'Tardy' }, { value: 'absent', label: 'Absent' }, { value: 'excused', label: 'Excused' }] as const;

export async function classAttendance(classId: string, day: string): Promise<{ childId: string; name: string; status: string; note: string; reportedBy: string }[]> {
	await dbReady();
	const rows = await db()`select c.id, c.name, a.status, a.note, a.reported_by from class_students cs join children c on c.id = cs.child_id left join attendance a on a.child_id = c.id and a.day = ${day}::date where cs.class_id = ${classId} order by c.name`;
	return rows.map((row) => ({ childId: String(row.id), name: String(row.name), status: String(row.status || ''), note: String(row.note || ''), reportedBy: String(row.reported_by || '') }));
}

/** Save a class's attendance for a day. Anyone not marked is present. A family's report stands unless changed. */
export async function saveAttendance(classId: string, day: string, marks: Record<string, string>, by: string): Promise<void> {
	await dbReady();
	const roster = await classAttendance(classId, day);
	for (const kid of roster) {
		const status = ATTENDANCE.some((item) => item.value === marks[kid.childId]) ? marks[kid.childId] : 'present';
		if (kid.status === status) continue;
		await db()`insert into attendance (child_id, day, status, reported_by) values (${kid.childId}, ${day}::date, ${status}, ${by})
			on conflict (child_id, day) do update set status = excluded.status, reported_by = excluded.reported_by, updated_at = now()`;
	}
}

/** A family tells the school a child will be absent (or late). It shows on the teacher's attendance. */
export async function reportAbsence(input: { familyId: string; childId: string; day: string; kind: 'absent' | 'tardy'; note: string; by: string }): Promise<Result> {
	await dbReady();
	const [child] = await db()`select name from children where id = ${input.childId} and family_id = ${input.familyId}`;
	if (!child) return { ok: false, error: 'That student isn’t on your account.' };
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return { ok: false, error: 'Choose the day.' };
	const status = input.kind === 'tardy' ? 'tardy' : 'excused';
	await db()`insert into attendance (child_id, day, status, note, reported_by) values (${input.childId}, ${input.day}::date, ${status}, ${input.note.trim().slice(0, 500)}, ${`family:${input.by}`})
		on conflict (child_id, day) do update set status = excluded.status, note = excluded.note, reported_by = excluded.reported_by, updated_at = now()`;
	const teacher = await homeroomTeacher(input.childId);
	const to = [teacher, staffNotifyEmail()].filter(Boolean).join(', ');
	await sendTemplate('attendance.reported', to, { child: String(child.name), day: input.day, kind: input.kind === 'tardy' ? 'will be late' : 'will be absent', note: input.note.trim(), link: `${portalOrigin()}/staff/attendance` });
	return { ok: true };
}

async function homeroomTeacher(childId: string): Promise<string> {
	const [row] = await db()`select cl.teacher_email from class_students cs join classes cl on cl.id = cs.class_id where cs.child_id = ${childId} and cl.kind = 'homeroom' and cl.school_year = ${schoolYearOf()} limit 1`;
	return String(row?.teacher_email || '');
}

/** A student's attendance this year: totals and the days that weren't "present". */
export async function childAttendance(childId: string, year = schoolYearOf()): Promise<{ absent: number; tardy: number; excused: number; days: { day: string; status: string; note: string }[] }> {
	await dbReady();
	const start = `${year.slice(0, 4)}-08-01`;
	const rows = await db()`select day::text, status, note from attendance where child_id = ${childId} and day >= ${start}::date and status <> 'present' order by day desc`;
	const count = (status: string) => rows.filter((row) => row.status === status).length;
	return { absent: count('absent'), tardy: count('tardy'), excused: count('excused'), days: rows.map((row) => ({ day: String(row.day), status: String(row.status), note: String(row.note || '') })) };
}

// ---------- Messages ----------
export type Thread = { id: string; childId: string; childName: string; familyId: string; familyName: string; lastAt: string; lastBody: string; unread: boolean };
export type Message = { id: string; authorName: string; authorEmail: string; fromFamily: boolean; body: string; createdAt: string };

async function threadFor(childId: string): Promise<{ id: string; familyId: string } | null> {
	const [child] = await db()`select id, family_id, name from children where id = ${childId}`;
	if (!child) return null;
	const [row] = await db()`insert into message_threads (id, child_id, family_id, subject) values (${randomUUID()}, ${childId}, ${child.family_id}, ${String(child.name)})
		on conflict (child_id) do update set family_id = excluded.family_id returning id, family_id`;
	return { id: String(row.id), familyId: String(row.family_id) };
}

/**
 * Conversations a person can see: a family sees its children's; a teacher sees
 * the students in their classes; admins see every conversation.
 */
export async function listThreads(viewer: { familyId?: string; email: string; admin: boolean; staff: boolean }): Promise<Thread[]> {
	await dbReady();
	const reader = viewer.familyId && !viewer.staff && !viewer.admin ? `family:${viewer.familyId}` : viewer.email;
	const rows = viewer.admin ? await db()`select t.* from message_threads t where exists (select 1 from messages m where m.thread_id = t.id) order by t.last_at desc`
		: viewer.staff ? await db()`select t.* from message_threads t where exists (select 1 from messages m where m.thread_id = t.id) and t.child_id in (
			select cs.child_id from class_students cs join classes cl on cl.id = cs.class_id
			where cl.teacher_email = ${viewer.email} or exists (select 1 from courses co where co.class_id = cl.id and co.teacher_email = ${viewer.email})) order by t.last_at desc`
		: await db()`select t.* from message_threads t where t.family_id = ${viewer.familyId ?? null} and exists (select 1 from messages m where m.thread_id = t.id) order by t.last_at desc`;
	if (!rows.length) return [];
	const ids = rows.map((row) => String(row.id));
	const [kids, lasts, reads] = await Promise.all([
		db()`select c.id, c.name, coalesce(nullif(f.household_name, ''), f.name) as family from children c join families f on f.id = c.family_id where c.id = any(${rows.map((row) => String(row.child_id))}::uuid[])`,
		db()`select distinct on (thread_id) thread_id, body, created_at from messages where thread_id = any(${ids}::uuid[]) order by thread_id, created_at desc`,
		db()`select thread_id, read_at from message_reads where reader = ${reader} and thread_id = any(${ids}::uuid[])`,
	]);
	return rows.map((row) => {
		const kid = kids.find((item) => String(item.id) === String(row.child_id));
		const last = lasts.find((item) => String(item.thread_id) === String(row.id));
		const read = reads.find((item) => String(item.thread_id) === String(row.id));
		return {
			id: String(row.id), childId: String(row.child_id), childName: String(kid?.name ?? ''), familyId: String(row.family_id), familyName: String(kid?.family ?? ''),
			lastAt: new Date(row.last_at).toISOString(), lastBody: String(last?.body ?? '').slice(0, 140), unread: !read || new Date(read.read_at) < new Date(row.last_at),
		};
	});
}

export async function threadMessages(threadId: string, reader: string): Promise<Message[]> {
	await dbReady();
	await db()`insert into message_reads (thread_id, reader) values (${threadId}, ${reader}) on conflict (thread_id, reader) do update set read_at = now()`;
	const rows = await db()`select * from messages where thread_id = ${threadId} order by created_at`;
	return rows.map((row) => ({ id: String(row.id), authorName: String(row.author_name || row.author_email), authorEmail: String(row.author_email), fromFamily: Boolean(row.from_family), body: String(row.body), createdAt: new Date(row.created_at).toISOString() }));
}

/** Can this person see (and write in) the conversation about this student? */
export async function canSeeChild(childId: string, viewer: { familyId?: string; email: string; admin: boolean; staff: boolean }): Promise<boolean> {
	if (viewer.admin) return true;
	const [child] = await db()`select family_id from children where id = ${childId}`;
	if (!child) return false;
	if (viewer.familyId && String(child.family_id) === viewer.familyId) return true;
	if (!viewer.staff) return false;
	const [taught] = await db()`select 1 from class_students cs join classes cl on cl.id = cs.class_id where cs.child_id = ${childId}
		and (cl.teacher_email = ${viewer.email} or exists (select 1 from courses co where co.class_id = cl.id and co.teacher_email = ${viewer.email}))`;
	return !!taught;
}

/**
 * Post in a student's conversation. Families' messages go to the student's
 * homeroom teacher by email; staff messages go to the family's inbox.
 */
export async function postMessage(input: { childId: string; body: string; author: { email: string; name: string }; fromFamily: boolean }): Promise<Result<{ threadId: string }>> {
	await dbReady();
	const body = input.body.trim().slice(0, 8000);
	if (!body) return { ok: false, error: 'Write a message first.' };
	const thread = await threadFor(input.childId);
	if (!thread) return { ok: false, error: 'That student no longer exists.' };
	await db()`insert into messages (id, thread_id, author_email, author_name, from_family, body) values (${randomUUID()}, ${thread.id}, ${input.author.email}, ${input.author.name}, ${input.fromFamily}, ${body})`;
	await db()`update message_threads set last_at = now() where id = ${thread.id}`;
	await db()`insert into message_reads (thread_id, reader) values (${thread.id}, ${input.fromFamily ? `family:${thread.familyId}` : input.author.email}) on conflict (thread_id, reader) do update set read_at = now()`;
	const [child] = await db()`select c.name, f.email from children c join families f on f.id = c.family_id where c.id = ${input.childId}`;
	const childName = String(child?.name ?? '').split(' ')[0];
	if (input.fromFamily) {
		const teacher = await homeroomTeacher(input.childId);
		const to = teacher || staffNotifyEmail();
		await sendTemplate('message.to-school', to, { from: input.author.name, child: childName, body, link: `${portalOrigin()}/staff/messages?thread=${thread.id}` }, input.author.email);
	} else if (child) {
		await sendTemplate('message.to-family', await routeEmail(thread.familyId, 'admin', String(child.email)), { from: input.author.name, child: childName, body, link: `${portalOrigin()}/g/messages?thread=${thread.id}` });
	}
	return { ok: true, threadId: thread.id };
}

/** Unread conversations for a badge. */
export async function unreadCount(viewer: { familyId?: string; email: string; admin: boolean; staff: boolean }): Promise<number> {
	return (await listThreads(viewer)).filter((thread) => thread.unread).length;
}

// ---------- Assignments ----------
export type Assignment = { id: string; courseId: string; title: string; category: string; description: string; dueOn: string; points: number | null; graded: boolean; published: boolean };
const mapAssignment = (row: any): Assignment => ({ id: String(row.id), courseId: String(row.course_id), title: String(row.title), category: String(row.category), description: String(row.description || ''), dueOn: row.due_on ? String(row.due_on) : '', points: row.points == null ? null : Number(row.points), graded: Boolean(row.graded), published: Boolean(row.published) });

export async function listAssignments(courseId: string): Promise<Assignment[]> {
	await dbReady();
	const rows = await db()`select id, course_id, title, category, description, due_on::text, points, graded, published from assignments where course_id = ${courseId} order by due_on nulls last, created_at`;
	return rows.map(mapAssignment);
}

export async function saveCourseAssignment(input: { id?: string; courseId: string; title: string; category: string; description: string; dueOn: string; points: string; graded: boolean; published: boolean }): Promise<Result<{ id: string }>> {
	await dbReady();
	const title = input.title.trim().slice(0, 160);
	if (!title) return { ok: false, error: 'Name the assignment.' };
	if (input.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) return { ok: false, error: 'Choose a due date.' };
	const points = input.points.trim() ? Number(input.points) : null;
	if (points != null && (!Number.isFinite(points) || points <= 0)) return { ok: false, error: 'Points must be a number above zero.' };
	const id = input.id || randomUUID();
	const category = CATEGORIES.includes(input.category as any) ? input.category : 'Homework';
	await db()`insert into assignments (id, course_id, title, category, description, due_on, points, graded, published) values (${id}, ${input.courseId}, ${title}, ${category}, ${input.description.trim().slice(0, 4000)}, ${input.dueOn || null}, ${points}, ${input.graded}, ${input.published})
		on conflict (id) do update set title = excluded.title, category = excluded.category, description = excluded.description, due_on = excluded.due_on, points = excluded.points, graded = excluded.graded, published = excluded.published`;
	return { ok: true, id };
}
export async function deleteCourseAssignment(id: string): Promise<void> { await dbReady(); await db()`delete from assignments where id = ${id}`; }

/** A student's week: published assignments due in the week, from every course in their classes. */
export async function weekAgenda(childId: string, from: string, to: string): Promise<(Assignment & { subject: string; score: ScoreCell | null })[]> {
	await dbReady();
	const rows = await db()`
		select a.id, a.course_id, a.title, a.category, a.description, a.due_on::text, a.points, a.graded, a.published, co.subject, s.points as got, s.mark, s.excused
		from assignments a join courses co on co.id = a.course_id join class_students cs on cs.class_id = co.class_id
		left join scores s on s.assignment_id = a.id and s.child_id = ${childId}
		where cs.child_id = ${childId} and a.published and a.due_on between ${from}::date and ${to}::date
		order by a.due_on, co.position, co.subject`;
	return rows.map((row) => ({ ...mapAssignment(row), subject: String(row.subject), score: row.got != null || row.mark || row.excused ? { points: row.got == null ? null : Number(row.got), mark: String(row.mark || ''), excused: Boolean(row.excused) } : null }));
}

// ---------- Gradebook ----------
export async function gradebook(courseId: string, term: Term): Promise<{ course: Course & { className: string; grade: string }; assignments: Assignment[]; students: { id: string; name: string; scores: Map<string, ScoreCell>; grade: { percent: number | null; display: string } }[] } | null> {
	await dbReady();
	const [row] = await db()`select co.*, cl.name as class_name, cl.grade from courses co join classes cl on cl.id = co.class_id where co.id = ${courseId}`;
	if (!row) return null;
	const course = { ...mapCourse(row), className: String(row.class_name), grade: String(row.grade || '') };
	const assignments = (await listAssignments(courseId)).filter((item) => item.dueOn && item.dueOn >= term.startsOn && item.dueOn <= term.endsOn);
	const kids = await db()`select c.id, c.name from class_students cs join children c on c.id = cs.child_id where cs.class_id = ${course.classId} order by c.name`;
	const ids = assignments.map((item) => item.id);
	const scores = ids.length ? await db()`select assignment_id, child_id, points, mark, excused from scores where assignment_id = any(${ids}::uuid[])` : [];
	return {
		course, assignments,
		students: kids.map((kid) => {
			const mine = new Map<string, ScoreCell>(scores.filter((item) => String(item.child_id) === String(kid.id)).map((item) => [String(item.assignment_id), { points: item.points == null ? null : Number(item.points), mark: String(item.mark || ''), excused: Boolean(item.excused) }]));
			return { id: String(kid.id), name: String(kid.name), scores: mine, grade: courseGrade({ grading: course.grading, weights: course.weights, assignments, scores: mine }) };
		}),
	};
}

/** Save one assignment's scores: points (letter courses), a mark (K–2), or "EX" to excuse. Blank clears. */
export async function saveScores(assignmentId: string, entries: Record<string, string>): Promise<void> {
	await dbReady();
	for (const [childId, raw] of Object.entries(entries)) {
		const value = raw.trim().toUpperCase();
		if (!value) { await db()`delete from scores where assignment_id = ${assignmentId} and child_id = ${childId}`; continue; }
		const excused = value === 'EX';
		const mark = MARKS.some((item) => item.value === value) ? value : '';
		const points = !excused && !mark && Number.isFinite(Number(value)) ? Number(value) : null;
		if (!excused && !mark && points == null) continue;
		await db()`insert into scores (assignment_id, child_id, points, mark, excused) values (${assignmentId}, ${childId}, ${points}, ${mark}, ${excused})
			on conflict (assignment_id, child_id) do update set points = excluded.points, mark = excluded.mark, excused = excluded.excused, updated_at = now()`;
	}
}

/** A student's grades for a term, course by course (what families see as progress). */
export async function childGrades(childId: string, term: Term): Promise<{ courseId: string; subject: string; grade: string; assignments: (Assignment & { score: ScoreCell | null })[] }[]> {
	await dbReady();
	const courses = await db()`select co.* from courses co join class_students cs on cs.class_id = co.class_id join classes cl on cl.id = co.class_id where cs.child_id = ${childId} and cl.school_year = ${term.schoolYear} order by co.position, co.subject`;
	const out = [];
	for (const row of courses) {
		const course = mapCourse(row);
		const assignments = (await listAssignments(course.id)).filter((item) => item.published && item.dueOn && item.dueOn >= term.startsOn && item.dueOn <= term.endsOn);
		const ids = assignments.map((item) => item.id);
		const scores = ids.length ? await db()`select assignment_id, points, mark, excused from scores where child_id = ${childId} and assignment_id = any(${ids}::uuid[])` : [];
		const mine = new Map<string, ScoreCell>(scores.map((item) => [String(item.assignment_id), { points: item.points == null ? null : Number(item.points), mark: String(item.mark || ''), excused: Boolean(item.excused) }]));
		out.push({ courseId: course.id, subject: course.subject, grade: courseGrade({ grading: course.grading, weights: course.weights, assignments, scores: mine }).display, assignments: assignments.map((item) => ({ ...item, score: mine.get(item.id) ?? null })) });
	}
	return out;
}

// ---------- Report cards ----------
export const CONDUCT = ['E', 'S', 'N', 'U'] as const;
export type ReportCard = { id: string; termId: string; childId: string; comments: Record<string, string>; marks: Record<string, string>; generalComment: string; conduct: string; grades: { subject: string; grade: string; comment: string }[]; releasedAt: string | null };

/** A class's report cards for a term: each student's computed grades plus what teachers wrote. */
export async function classReportCards(classId: string, term: Term): Promise<{ child: { id: string; name: string }; card: ReportCard; computed: { courseId: string; subject: string; grade: string }[] }[]> {
	await dbReady();
	const [klass] = await db()`select id from classes where id = ${classId}`;
	if (!klass) return [];
	const kids = await db()`select c.id, c.name from class_students cs join children c on c.id = cs.child_id where cs.class_id = ${classId} order by c.name`;
	const cards = kids.length ? await db()`select * from report_cards where term_id = ${term.id} and child_id = any(${kids.map((kid) => String(kid.id))}::uuid[])` : [];
	const out = [];
	for (const kid of kids) {
		const card = cards.find((row) => String(row.child_id) === String(kid.id));
		const computed = (await childGrades(String(kid.id), term)).map((item) => ({ courseId: item.courseId, subject: item.subject, grade: item.grade }));
		const comments = (card?.comments ?? {}) as Record<string, any>;
		out.push({
			child: { id: String(kid.id), name: String(kid.name) }, computed,
			card: { id: String(card?.id ?? ''), termId: term.id, childId: String(kid.id), comments: Object.fromEntries(Object.entries(comments).map(([key, value]) => [key, String(value?.comment ?? value ?? '')])), marks: Object.fromEntries(Object.entries(comments).filter(([, value]) => value?.mark).map(([key, value]) => [key, String(value.mark)])), generalComment: String(card?.general_comment ?? ''), conduct: String(card?.conduct ?? ''), grades: (card?.grades ?? []) as ReportCard['grades'], releasedAt: card?.released_at ? new Date(card.released_at).toISOString() : null },
		});
	}
	return out;
}

/** Save what a teacher wrote on one student's report card (a course comment, a mark override, the general comment, conduct). */
export async function saveReportCard(input: { termId: string; childId: string; courseComments: Record<string, string>; courseMarks: Record<string, string>; generalComment: string; conduct: string }): Promise<void> {
	await dbReady();
	const comments = Object.fromEntries([...new Set([...Object.keys(input.courseComments), ...Object.keys(input.courseMarks)])].map((courseId) => [courseId, { comment: (input.courseComments[courseId] ?? '').trim().slice(0, 1200), mark: (input.courseMarks[courseId] ?? '').trim().toUpperCase().slice(0, 4) }]));
	const conduct = CONDUCT.includes(input.conduct as any) ? input.conduct : '';
	await db()`insert into report_cards (id, term_id, child_id, comments, general_comment, conduct) values (${randomUUID()}, ${input.termId}, ${input.childId}, ${db().json(comments)}, ${input.generalComment.trim().slice(0, 3000)}, ${conduct})
		on conflict (term_id, child_id) do update set comments = excluded.comments, general_comment = excluded.general_comment, conduct = excluded.conduct`;
}

/**
 * Release a class's report cards for a term: each card captures its grades
 * (a teacher's mark override wins), families get an email, and the card is
 * part of the student's record from then on.
 */
export async function releaseReportCards(classId: string, term: Term): Promise<number> {
	const rows = await classReportCards(classId, term);
	let released = 0;
	for (const { child, card, computed } of rows) {
		const grades = computed.map((item) => ({ subject: item.subject, grade: (card.marks[item.courseId] || item.grade).replace(/\s*\(.*\)$/, ''), comment: card.comments[item.courseId] ?? '' }));
		await db()`insert into report_cards (id, term_id, child_id, grades, released_at) values (${randomUUID()}, ${term.id}, ${child.id}, ${db().json(grades)}, now())
			on conflict (term_id, child_id) do update set grades = excluded.grades, released_at = now()`;
		released += 1;
		const [family] = await db()`select f.id, f.email from children c join families f on f.id = c.family_id where c.id = ${child.id}`;
		if (family) await sendTemplate('reportcard.released', await routeEmail(String(family.id), 'announcements', String(family.email)), { child: child.name.split(' ')[0], term: term.name, link: `${portalOrigin()}/g/students/${child.id}?tab=report` });
	}
	return released;
}

/** A student's released report cards, newest first (their record, and the basis for a transcript). */
export async function childReportCards(childId: string): Promise<(ReportCard & { termName: string; schoolYear: string })[]> {
	await dbReady();
	const rows = await db()`select r.*, t.name as term_name, t.school_year from report_cards r join school_terms t on t.id = r.term_id where r.child_id = ${childId} and r.released_at is not null order by t.starts_on desc`;
	return rows.map((row) => ({ id: String(row.id), termId: String(row.term_id), childId, comments: {}, marks: {}, generalComment: String(row.general_comment || ''), conduct: String(row.conduct || ''), grades: (row.grades ?? []) as ReportCard['grades'], releasedAt: new Date(row.released_at).toISOString(), termName: String(row.term_name), schoolYear: String(row.school_year) }));
}

// ---------- Transcript ----------
const GRADE_POINTS: Record<string, number> = { 'A': 4, 'A-': 3.7, 'B+': 3.3, 'B': 3, 'B-': 2.7, 'C+': 2.3, 'C': 2, 'C-': 1.7, 'D+': 1.3, 'D': 1, 'D-': 0.7, 'F': 0 };
const round2 = (value: number) => Math.round(value * 100) / 100;
/** The letter nearest an average on the 4.0 scale (ties go up). */
const letterForPoints = (points: number) => Object.entries(GRADE_POINTS).reduce((best, entry) => Math.abs(entry[1] - points) < Math.abs(best[1] - points) - 1e-9 ? entry : best)[0];

export type TranscriptYear = { schoolYear: string; grade: string; terms: string[]; subjects: { subject: string; quarters: string[]; final: string }[]; gpa: number | null; absences: number; tardies: number };

/**
 * A student's transcript from their released report cards: per year, each
 * subject's quarter grades and a final grade (the average of the quarters on
 * the 4.0 scale), a yearly GPA, attendance, and a cumulative GPA. K–2 marks
 * show as given and don't count toward GPA.
 */
export async function transcript(childId: string): Promise<{ child: { id: string; name: string; birthdate: string }; years: TranscriptYear[]; gpa: number | null }> {
	await dbReady();
	const [child] = await db()`select id, name, coalesce(birth_date::text, '') as birthdate from children where id = ${childId}`;
	if (!child) return { child: { id: childId, name: '', birthdate: '' }, years: [], gpa: null };
	const [cards, enrollments, attendance] = await Promise.all([
		db()`select r.grades, t.name as term, t.school_year, t.position from report_cards r join school_terms t on t.id = r.term_id where r.child_id = ${childId} and r.released_at is not null order by t.school_year, t.position`,
		db()`select school_year, grade from enrollments where child_id = ${childId}`,
		db()`select day::text as day, status from attendance where child_id = ${childId} and status <> 'present'`,
	]);
	const years: TranscriptYear[] = [];
	const allPoints: number[] = [];
	for (const schoolYear of [...new Set(cards.map((row) => String(row.school_year)))]) {
		const rows = cards.filter((row) => String(row.school_year) === schoolYear);
		const terms = rows.map((row) => String(row.term));
		const subjects = [...new Set(rows.flatMap((row) => ((row.grades ?? []) as { subject: string }[]).map((item) => item.subject)))];
		const yearPoints: number[] = [];
		const list = subjects.map((subject) => {
			const quarters = rows.map((row) => ((row.grades ?? []) as { subject: string; grade: string }[]).find((item) => item.subject === subject)?.grade ?? '');
			const points = quarters.filter((grade) => grade in GRADE_POINTS).map((grade) => GRADE_POINTS[grade]);
			let final = '';
			if (points.length) {
				const average = points.reduce((sum, value) => sum + value, 0) / points.length;
				final = letterForPoints(average);
				yearPoints.push(GRADE_POINTS[final]);
			} else {
				final = quarters.filter(Boolean).at(-1) ?? '';
			}
			return { subject, quarters, final };
		});
		allPoints.push(...yearPoints);
		const days = attendance.filter((row) => schoolYearOf(String(row.day)) === schoolYear);
		years.push({
			schoolYear, terms, subjects: list,
			grade: String(enrollments.find((row) => String(row.school_year) === schoolYear)?.grade ?? ''),
			gpa: yearPoints.length ? round2(yearPoints.reduce((sum, value) => sum + value, 0) / yearPoints.length) : null,
			absences: days.filter((row) => row.status === 'absent' || row.status === 'excused').length,
			tardies: days.filter((row) => row.status === 'tardy').length,
		});
	}
	return { child: { id: String(child.id), name: String(child.name), birthdate: String(child.birthdate) }, years, gpa: allPoints.length ? round2(allPoints.reduce((sum, value) => sum + value, 0) / allPoints.length) : null };
}

// ---------- Overview ----------
/**
 * What the classroom side needs from the office today: homerooms that haven't
 * taken attendance, who's out, family messages nobody has answered, and
 * report cards not yet released for a quarter that just ended.
 */
export async function classroomOverview(today: string): Promise<{ schoolDay: boolean; absent: number; tardy: number; missingAttendance: { id: string; name: string }[]; awaitingReply: number; unreleased: { term: Term; classes: { id: string; name: string }[] } | null }> {
	await dbReady();
	const year = schoolYearOf(today);
	const terms = await listTerms(year);
	const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
	const schoolDay = !!termFor(terms, today) && weekday > 0 && weekday < 6;
	const [homerooms, out, awaiting] = await Promise.all([
		db()`select c.id, c.name,
				exists (select 1 from class_students cs join attendance a on a.child_id = cs.child_id and a.day = ${today}::date where cs.class_id = c.id and a.reported_by not like 'family:%') as taken,
				exists (select 1 from class_students cs where cs.class_id = c.id) as has_students
			from classes c where c.school_year = ${year} and c.kind = 'homeroom' order by c.grade = 'K' desc, nullif(regexp_replace(c.grade, '\\D', '', 'g'), '')::int nulls first, c.name`,
		db()`select status, count(*)::int as n from attendance where day = ${today}::date and status in ('absent', 'excused', 'tardy') group by status`,
		db()`select count(*)::int as n from message_threads t where (select m.from_family from messages m where m.thread_id = t.id order by m.created_at desc limit 1)`,
	]);
	const count = (status: string) => out.filter((row) => row.status === status).reduce((sum, row) => sum + Number(row.n), 0);
	// The most recent quarter that ended in the last three weeks.
	const ended = terms.filter((term) => term.endsOn < today && Date.parse(`${today}T12:00:00Z`) - Date.parse(`${term.endsOn}T12:00:00Z`) <= 21 * 86400000).at(-1) ?? null;
	let unreleased: { term: Term; classes: { id: string; name: string }[] } | null = null;
	if (ended) {
		const rows = await db()`select c.id, c.name from classes c where c.school_year = ${year} and c.kind = 'homeroom'
			and exists (select 1 from class_students cs where cs.class_id = c.id)
			and not exists (select 1 from class_students cs join report_cards r on r.child_id = cs.child_id and r.term_id = ${ended.id} where cs.class_id = c.id and r.released_at is not null)`;
		if (rows.length) unreleased = { term: ended, classes: rows.map((row) => ({ id: String(row.id), name: String(row.name) })) };
	}
	return {
		schoolDay, absent: count('absent') + count('excused'), tardy: count('tardy'),
		missingAttendance: schoolDay ? homerooms.filter((row) => row.has_students && !row.taken).map((row) => ({ id: String(row.id), name: String(row.name) })) : [],
		awaitingReply: Number(awaiting[0]?.n ?? 0), unreleased,
	};
}

// ---------- Student sign-in (7th and 8th grade) ----------
/** Students in these grades can have their own sign-in. */
export const studentSignInAllowed = (grade: string) => Number(grade) >= 7;

export async function studentLogin(childId: string): Promise<{ email: string } | null> {
	await dbReady();
	const [row] = await db()`select email from family_emails where child_id = ${childId}`;
	return row ? { email: String(row.email) } : null;
}

/**
 * Give a 7th or 8th grader their own sign-in, or change its email or password.
 * Their parents set the password; the student sees only their own week,
 * grades and report cards.
 */
export async function setStudentLogin(input: { familyId: string; childId: string; email: string; password: string }): Promise<Result> {
	await dbReady();
	const [child] = await db()`select id, name, grade from children where id = ${input.childId} and family_id = ${input.familyId}`;
	if (!child) return { ok: false, error: 'That student isn’t in your family.' };
	if (!studentSignInAllowed(String(child.grade))) return { ok: false, error: 'Student sign-ins start in 7th grade.' };
	const email = input.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter an email address like name@example.com.' };
	const [current] = await db()`select id, email from family_emails where child_id = ${input.childId}`;
	if (!current && input.password.length < 10) return { ok: false, error: 'Use a password of at least 10 characters.' };
	if (input.password && input.password.length < 10) return { ok: false, error: 'Use a password of at least 10 characters.' };
	const [taken] = await db()`select id from family_emails where email = ${email}`;
	if (taken && String(taken.id) !== String(current?.id ?? '')) return { ok: false, error: 'That email already signs in to the portal. Use the student’s own email.' };
	const { hashPassword } = await import('./passwords.ts');
	const hash = input.password ? await hashPassword(input.password) : null;
	if (current) {
		await db()`update family_emails set email = ${email}, password_hash = coalesce(${hash}, password_hash), google_sub = case when email = ${email} then google_sub else null end where id = ${current.id}`;
	} else {
		await db()`insert into family_emails (id, family_id, email, is_primary, verified_at, password_hash, label, child_id) values (${randomUUID()}, ${input.familyId}, ${email}, false, now(), ${hash}, ${String(child.name)}, ${input.childId})`;
	}
	return { ok: true };
}

export async function removeStudentLogin(familyId: string, childId: string): Promise<void> {
	await dbReady();
	await db()`delete from family_emails where child_id = ${childId} and family_id = ${familyId}`;
}
