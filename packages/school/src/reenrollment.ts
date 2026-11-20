import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { logFamilyActivity } from './family-merge.ts';
import type { Result } from './result.ts';

/**
 * Re-enrollment: each child enrolled this year gets a pending enrollment for
 * next year, and (when chosen) a re-enrollment form linked to it. Staff mark
 * each one returning (enrolled) or not returning (withdrawn).
 */
export type ReenrollmentRow = {
	childId: string; childName: string; familyId: string; familyName: string; grade: string; nextGrade: string;
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

/** Create next year's pending enrollments (and form assignments) for every current student. */
export async function startReenrollment(input: { current: string; next: string; formId: string | null; by: string }): Promise<Result<{ created: number; sent: number }>> {
	await dbReady();
	const rows = await listReenrollment(input.current, input.next);
	let created = 0, sent = 0;
	for (const row of rows) {
		let enrollmentId = row.enrollmentId;
		if (!enrollmentId) {
			enrollmentId = randomUUID();
			await db()`insert into enrollments (id, child_id, school_year, grade, status) values (${enrollmentId}, ${row.childId}, ${input.next}, ${row.nextGrade}, 'pending') on conflict (child_id, school_year) do nothing`;
			created += 1;
		}
		if (input.formId && row.formStatus === 'none') {
			const inserted = await db()`
				insert into form_assignments (id, form_id, family_id, student_id, enrollment_id) values (${randomUUID()}, ${input.formId}, ${row.familyId}, ${row.childId}, ${enrollmentId})
				on conflict (form_id, family_id, student_id) do nothing returning id`;
			sent += inserted.length;
		}
	}
	return { ok: true, created, sent };
}

export async function setReenrollment(enrollmentId: string, status: string, by: string): Promise<Result> {
	await dbReady();
	if (!['pending', 'enrolled', 'withdrawn'].includes(status)) return { ok: false, error: 'Choose returning or not returning.' };
	const [row] = await db()`
		update enrollments e set status = ${status}, updated_at = now(), contract_signed_on = case when ${status} = 'enrolled' then coalesce(e.contract_signed_on, current_date) else e.contract_signed_on end
		from children c where c.id = e.child_id and e.id = ${enrollmentId}
		returning c.family_id, c.name, e.school_year`;
	if (!row) return { ok: false, error: 'That enrollment no longer exists.' };
	await logFamilyActivity(String(row.family_id), 'note', by, `${row.name}: ${status === 'enrolled' ? 'returning' : status === 'withdrawn' ? 'not returning' : 're-enrollment reopened'} for ${row.school_year}`);
	return { ok: true };
}
