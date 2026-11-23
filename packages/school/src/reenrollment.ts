import { randomUUID } from 'node:crypto';
import { sendTemplate } from './email-catalog.ts';
import { db, dbReady } from './db.ts';
import { logFamilyActivity } from './family-merge.ts';
import type { Result } from './result.ts';
import { portalOrigin, sendEmail } from './email.ts';
import { routeEmail } from './accounts.ts';
import { recordAttempt, tooManyAttempts } from './data.ts';

/**
 * Re-enrollment, once a year: staff open it for next year with a deadline (and
 * optionally a form). Every child enrolled this year gets a pending enrollment
 * for next year; a child who'd move past the highest grade offered is marked
 * graduating. Families answer for each child (Returning counts right away);
 * staff can override any answer, and remind families who haven't answered.
 */
export type ReenrollmentSeason = { next: string; deadline: string; formId: string | null; highestGrade: string; openedAt: string; openedBy: string };
const seasonKey = (next: string) => `reenrollment:${next}`;
const GRADE_ORDER = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const gradeIndex = (grade: string) => GRADE_ORDER.indexOf(grade.trim().toUpperCase());

/** Next year's re-enrollment, if staff have opened it. */
export async function reenrollmentSeason(next: string): Promise<ReenrollmentSeason | null> {
	await dbReady();
	const [row] = await db()`select value from settings where key = ${seasonKey(next)}`;
	return row ? (row.value as ReenrollmentSeason) : null;
}

/** Families can answer until the deadline (inclusive, Chicago date). */
export const seasonOpen = (season: ReenrollmentSeason | null, today: string) => !!season && (!season.deadline || today <= season.deadline);
export type ReenrollmentRow = {
	childId: string; childName: string; familyId: string; familyName: string; grade: string; nextGrade: string;
	/** Next year: not opened yet, waiting on the family, returning, not returning, or graduating. */
	enrollmentId: string | null; status: 'not_started' | 'pending' | 'enrolled' | 'withdrawn' | 'graduated';
	formStatus: 'none' | 'not_started' | 'draft' | 'submitted';
};

/** "K" → "1", "3" → "4", "8" stays (graduating); anything else unchanged. */
export function nextGrade(grade: string): string {
	const value = grade.trim().toUpperCase();
	if (value === 'PK' || value === 'PRE-K') return 'K';
	if (value === 'K') return '1';
	const number = Number(value);
	return Number.isInteger(number) && number > 0 ? String(number + 1) : grade;
}

export async function listReenrollment(current: string, next: string): Promise<ReenrollmentRow[]> {
	await dbReady();
	const rows = await db()`
		select c.id as child_id, c.name, c.grade, f.id as family_id, coalesce(nullif(f.household_name, ''), f.name) as family_name,
			n.id as next_id, n.status as next_status, n.grade as next_grade,
			(select a.status from form_assignments a where a.enrollment_id = n.id order by a.submitted_at desc nulls last limit 1) as form_status
		from enrollments e
		join children c on c.id = e.child_id
		join families f on f.id = c.family_id
		left join enrollments n on n.child_id = c.id and n.school_year = ${next}
		where e.school_year = ${current} and e.status = 'enrolled' and f.merged_into_id is null
		order by family_name, c.name`;
	return rows.map((row) => ({
		childId: String(row.child_id), childName: String(row.name), familyId: String(row.family_id), familyName: String(row.family_name),
		grade: String(row.grade || ''), nextGrade: String(row.next_grade || nextGrade(String(row.grade || ''))),
		enrollmentId: row.next_id ? String(row.next_id) : null, status: row.next_id ? row.next_status : 'not_started',
		formStatus: row.form_status ? (row.form_status === 'submitted' ? 'submitted' : row.form_status === 'draft' ? 'draft' : 'not_started') : 'none',
	}));
}

/** Open forms marked for re-enrollment, to send with the start. */
export async function reenrollmentForms(): Promise<{ id: string; title: string }[]> {
	await dbReady();
	const rows = await db()`select id, title from school_forms where purpose = 'reenrollment' and status = 'open' order by created_at desc`;
	return rows.map((row) => ({ id: String(row.id), title: String(row.title) }));
}

/**
 * Open re-enrollment for next year: a pending enrollment for every current
 * student (graduating past the highest grade offered), the optional form
 * assigned, and one email per family. Running it again picks up students
 * enrolled since, without emailing families twice.
 */
export async function openReenrollment(input: { current: string; next: string; deadline: string; formId: string | null; highestGrade: string; by: string }): Promise<Result<{ created: number; families: number }>> {
	await dbReady();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deadline)) return { ok: false, error: 'Choose a deadline.' };
	if (gradeIndex(input.highestGrade) < 0) return { ok: false, error: 'Choose the highest grade offered next year.' };
	const before = await reenrollmentSeason(input.next);
	const season: ReenrollmentSeason = { next: input.next, deadline: input.deadline, formId: input.formId, highestGrade: input.highestGrade, openedAt: before?.openedAt ?? new Date().toISOString(), openedBy: before?.openedBy ?? input.by };
	await db()`insert into settings (key, value) values (${seasonKey(input.next)}, ${db().json(season)}) on conflict (key) do update set value = excluded.value`;
	const rows = await listReenrollment(input.current, input.next);
	let created = 0;
	const newFamilies = new Map<string, string[]>();
	for (const row of rows) {
		let enrollmentId = row.enrollmentId;
		if (!enrollmentId) {
			enrollmentId = randomUUID();
			const graduating = gradeIndex(row.nextGrade) > gradeIndex(input.highestGrade);
			await db()`insert into enrollments (id, child_id, school_year, grade, status) values (${enrollmentId}, ${row.childId}, ${input.next}, ${row.nextGrade}, ${graduating ? 'graduated' : 'pending'}) on conflict (child_id, school_year) do nothing`;
			created += 1;
			if (!graduating) newFamilies.set(row.familyId, [...(newFamilies.get(row.familyId) ?? []), row.childName.split(' ')[0]]);
		}
		if (input.formId && row.formStatus === 'none') {
			await db()`
				insert into form_assignments (id, form_id, family_id, student_id, enrollment_id) values (${randomUUID()}, ${input.formId}, ${row.familyId}, ${row.childId}, ${enrollmentId})
				on conflict (form_id, family_id, student_id) do nothing`;
		}
	}
	const deadline = longDay(input.deadline);
	for (const [familyId, names] of newFamilies) {
		const [family] = await db()`select email from families where id = ${familyId}`;
		if (!family) continue;
		await sendTemplate('reenrollment.open', await routeEmail(familyId, 'announcements', String(family.email)), { year: input.next, deadline, children: names.join(' and '), link: `${portalOrigin()}/g/students` });
	}
	return { ok: true, created, families: newFamilies.size };
}

const longDay = (day: string) => new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

/** Email every family that still has a child waiting on an answer. At most three times in 15 minutes. */
export async function remindReenrollment(next: string): Promise<number> {
	await dbReady();
	if (await tooManyAttempts('remind-reenroll', next, 3)) return -1;
	await recordAttempt('remind-reenroll', next);
	const season = await reenrollmentSeason(next);
	const rows = await db()`
		select f.id, f.email, array_agg(split_part(c.name, ' ', 1) order by c.name) as names
		from enrollments e join children c on c.id = e.child_id join families f on f.id = c.family_id
		where e.school_year = ${next} and e.status = 'pending' and c.kind = 'student' and f.merged_into_id is null
		group by f.id, f.email`;
	for (const row of rows) {
		await sendTemplate('reenrollment.reminder', await routeEmail(String(row.id), 'announcements', String(row.email)), { children: (row.names as string[]).join(' and '), year: next, deadline: season?.deadline ? `Please let us know by ${longDay(season.deadline)}.` : '', link: `${portalOrigin()}/g/students` });
	}
	return rows.length;
}

/**
 * A family answers for one child: returning (enrolled) or not returning
 * (withdrawn). Only their own child, only while re-enrollment is open.
 */
export async function answerReenrollment(input: { familyId: string; enrollmentId: string; returning: boolean; today: string }): Promise<Result> {
	await dbReady();
	const [row] = await db()`select e.school_year, e.status, c.family_id, c.name from enrollments e join children c on c.id = e.child_id where e.id = ${input.enrollmentId}`;
	if (!row || String(row.family_id) !== input.familyId) return { ok: false, error: 'That child isn’t on your account.' };
	if (!['pending', 'enrolled', 'withdrawn'].includes(String(row.status))) return { ok: false, error: 'Contact the office to change this.' };
	if (!seasonOpen(await reenrollmentSeason(String(row.school_year)), input.today)) return { ok: false, error: 'Re-enrollment has closed. Contact the office to make a change.' };
	await db()`update enrollments set status = ${input.returning ? 'enrolled' : 'withdrawn'}, updated_at = now() where id = ${input.enrollmentId}`;
	await logFamilyActivity(input.familyId, 'note', 'family', `${row.name}: ${input.returning ? 'returning' : 'not returning'} for ${row.school_year}`);
	return { ok: true };
}

export async function setReenrollment(enrollmentId: string, status: string, by: string): Promise<Result> {
	await dbReady();
	if (!['pending', 'enrolled', 'withdrawn', 'graduated'].includes(status)) return { ok: false, error: 'Choose returning or not returning.' };
	const [row] = await db()`
		update enrollments e set status = ${status}, updated_at = now(), contract_signed_on = case when ${status} = 'enrolled' then coalesce(e.contract_signed_on, current_date) else e.contract_signed_on end
		from children c where c.id = e.child_id and e.id = ${enrollmentId}
		returning c.family_id, c.name, e.school_year`;
	if (!row) return { ok: false, error: 'That enrollment no longer exists.' };
	await logFamilyActivity(String(row.family_id), 'note', by, `${row.name}: ${status === 'enrolled' ? 'returning' : status === 'withdrawn' ? 'not returning' : status === 'graduated' ? 'graduating' : 're-enrollment reopened'} for ${row.school_year}`);
	return { ok: true };
}

/**
 * Next year's class sizes by grade: returning students (enrolled this year) and
 * new students (from Applications), each confirmed or still waiting.
 */
export async function nextYearSeats(current: string, next: string): Promise<{ grade: string; returning: number; fresh: number; waiting: number }[]> {
	await dbReady();
	const rows = await db()`
		select n.grade, n.status, exists (select 1 from enrollments e where e.child_id = n.child_id and e.school_year = ${current} and e.status = 'enrolled') as returning
		from enrollments n join children c on c.id = n.child_id join families f on f.id = c.family_id
		where n.school_year = ${next} and n.status in ('enrolled', 'pending') and f.merged_into_id is null`;
	const byGrade = new Map<string, { grade: string; returning: number; fresh: number; waiting: number }>();
	for (const row of rows) {
		const grade = String(row.grade || '—');
		const entry = byGrade.get(grade) ?? { grade, returning: 0, fresh: 0, waiting: 0 };
		if (row.status === 'pending') entry.waiting += 1;
		else if (row.returning) entry.returning += 1;
		else entry.fresh += 1;
		byGrade.set(grade, entry);
	}
	return [...byGrade.values()].sort((a, b) => gradeIndex(a.grade) - gradeIndex(b.grade));
}

/** A family's own next-year re-enrollment rows (current students only), for them to answer. */
export async function familyReenrollment(familyId: string, current: string, next: string): Promise<{ childId: string; name: string; enrollmentId: string; status: string; nextGrade: string }[]> {
	await dbReady();
	const rows = await db()`
		select c.id as child_id, c.name, n.id, n.status, n.grade from enrollments n join children c on c.id = n.child_id
		where c.family_id = ${familyId} and n.school_year = ${next}
			and exists (select 1 from enrollments e where e.child_id = c.id and e.school_year = ${current} and e.status = 'enrolled')
		order by c.name`;
	return rows.map((row) => ({ childId: String(row.child_id), name: String(row.name), enrollmentId: String(row.id), status: String(row.status), nextGrade: String(row.grade || '') }));
}

/** Seats per grade for a school year (stored in settings "seats:<year>"); a grade with no number has no limit. */
export async function gradeSeats(year: string): Promise<Record<string, number>> {
	await dbReady();
	const [row] = await db()`select value from settings where key = ${`seats:${year}`}`;
	return (row?.value as Record<string, number>) ?? {};
}

export async function saveGradeSeats(year: string, seats: Record<string, string>): Promise<void> {
	await dbReady();
	const clean = Object.fromEntries(Object.entries(seats).filter(([grade, value]) => GRADE_ORDER.includes(grade) && /^\d+$/.test(value.trim()) && Number(value) > 0).map(([grade, value]) => [grade, Number(value)]));
	await db()`insert into settings (key, value) values (${`seats:${year}`}, ${db().json(clean)}) on conflict (key) do update set value = excluded.value`;
}

/**
 * Is there a seat in this grade for that year? Seats taken = enrolled plus
 * still enrolling (pending). `except` leaves one child out (the one being placed).
 */
export async function gradeHasRoom(year: string, grade: string, except?: string): Promise<{ ok: boolean; taken: number; seats: number | null }> {
	const seats = (await gradeSeats(year))[grade.trim().toUpperCase()] ?? null;
	if (seats == null) return { ok: true, taken: 0, seats };
	const [row] = await db()`select count(*)::int as n from enrollments where school_year = ${year} and upper(grade) = upper(${grade}) and status in ('enrolled', 'pending') and child_id is distinct from ${except ?? null}::uuid`;
	const taken = Number(row?.n ?? 0);
	return { ok: taken < seats, taken, seats };
}

/** Staff place a child in a different grade for next year (repeating, skipping). */
export async function setNextGrade(enrollmentId: string, grade: string, by: string): Promise<Result> {
	await dbReady();
	const value = grade.trim().toUpperCase();
	if (gradeIndex(value) < 0) return { ok: false, error: 'Choose a grade.' };
	const [row] = await db()`update enrollments e set grade = ${value}, updated_at = now() from children c where c.id = e.child_id and e.id = ${enrollmentId} returning c.family_id, c.name, e.school_year`;
	if (!row) return { ok: false, error: 'That enrollment no longer exists.' };
	await logFamilyActivity(String(row.family_id), 'note', by, `${row.name}: placed in ${value === 'K' ? 'Kindergarten' : `grade ${value}`} for ${row.school_year}`);
	return { ok: true };
}

/** End re-enrollment now: families can no longer change answers (staff still can). */
export async function closeReenrollment(next: string, today: string): Promise<void> {
	const season = await reenrollmentSeason(next);
	if (!season) return;
	const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
	await db()`update settings set value = ${db().json({ ...season, deadline: season.deadline < today ? season.deadline : yesterday })} where key = ${`reenrollment:${next}`}`;
}

/** After closing: anyone who never answered is marked not returning. */
export async function markUnansweredNotReturning(next: string, by: string): Promise<number> {
	await dbReady();
	const rows = await db()`update enrollments e set status = 'withdrawn', updated_at = now() from children c
		where c.id = e.child_id and e.school_year = ${next} and e.status = 'pending' and c.kind = 'student' returning c.family_id, c.name`;
	for (const row of rows) await logFamilyActivity(String(row.family_id), 'note', by, `${row.name}: no answer by the deadline, marked not returning for ${next}`);
	return rows.length;
}

/** Next year's roster: everyone enrolled or still enrolling, returning and new. */
export async function nextYearRoster(current: string, next: string): Promise<{ child: string; grade: string; family: string; email: string; status: string; kind: string }[]> {
	await dbReady();
	const rows = await db()`
		select c.name, n.grade, coalesce(nullif(f.household_name, ''), f.name) as family, f.email, n.status,
			exists (select 1 from enrollments e where e.child_id = c.id and e.school_year = ${current} and e.status = 'enrolled') as returning
		from enrollments n join children c on c.id = n.child_id join families f on f.id = c.family_id
		where n.school_year = ${next} and n.status in ('enrolled', 'pending', 'waitlisted') and f.merged_into_id is null
		order by array_position(array['K','1','2','3','4','5','6','7','8','9','10','11','12'], upper(n.grade)), c.name`;
	return rows.map((row) => ({ child: String(row.name), grade: String(row.grade || ''), family: String(row.family || ''), email: String(row.email || ''), status: row.status === 'enrolled' ? 'Enrolled' : row.status === 'waitlisted' ? 'Waitlisted' : 'Waiting', kind: row.returning ? 'Returning' : 'New' }));
}
