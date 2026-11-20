import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { chicagoToday } from './time.ts';
import { logFamilyActivity } from './family-merge.ts';
import type { Result } from './result.ts';

/**
 * Applications: a family applying for a school year. Today they arrive through
 * Formaloo's interview form and the portal's interview form (both stored as
 * inquiries); syncApplications copies those in. Staff move them through review.
 */
export const APPLICATION_STATUSES = [
	{ value: 'submitted', label: 'Submitted' },
	{ value: 'reviewing', label: 'Reviewing' },
	{ value: 'interview', label: 'Interview' },
	{ value: 'accepted', label: 'Accepted' },
	{ value: 'waitlisted', label: 'Waitlisted' },
	{ value: 'declined', label: 'Declined' },
	{ value: 'withdrawn', label: 'Withdrawn' },
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]['value'];
export const applicationStatusLabel = (status: string) => APPLICATION_STATUSES.find((item) => item.value === status)?.label ?? status;

export type Application = {
	id: string; familyId: string | null; email: string; name: string; schoolYear: string; status: ApplicationStatus;
	students: { name: string; grade: string; currentSchool: string }[]; answers: Record<string, unknown>;
	source: string; inquiryId: string | null; submittedAt: string; updatedAt: string;
};

/** "2026–27" for a date in the 2026–27 school year (it turns over on August 1). */
export function schoolYearOf(day = chicagoToday()): string {
	const year = Number(day.slice(0, 4)), month = Number(day.slice(5, 7));
	const start = month >= 8 ? year : year - 1;
	return `${start}–${String(start + 1).slice(2)}`;
}
export const shiftSchoolYear = (schoolYear: string, by: number) => {
	const start = Number(schoolYear.slice(0, 4)) + by;
	return `${start}–${String(start + 1).slice(2)}`;
};
/** Form answers write years many ways ("2027-2028", "2027/28", "Fall 2027"); keep "2027–28". */
export function normalizeSchoolYear(value: string, fallbackDay: string): string {
	const match = value.match(/(20\d\d)\s*[-–/ ]\s*(?:20)?(\d\d)/) || value.match(/(20\d\d)/);
	if (!match) return schoolYearOf(fallbackDay);
	const start = Number(match[1]);
	return `${start}–${String(start + 1).slice(2)}`;
}

// Formaloo's Status column, mapped onto application statuses (confirmed against the
// live form). "Interview Held" emails the family the application, so it means the
// same as "Application sent". Formaloo has nothing for Waitlisted or Withdrawn.
const FORMALOO_STATUS: Record<string, ApplicationStatus> = {
	'Proceed with interview': 'interview', 'Pastoral Reference': 'reviewing', 'Interview Held': 'accepted',
	'Not approved for application': 'declined', 'Application sent': 'accepted', 'Family in ClassReach': 'accepted',
};

/** Copy interview submissions into applications. Staff status changes are kept. */
export async function syncApplications(): Promise<void> {
	await dbReady();
	const rows = await db()`
		select i.id, i.email, i.name, i.created_at, i.details, i.external_source, i.source,
			(select coalesce(f.merged_into_id, f.id) from family_emails e join families f on f.id = e.family_id where e.email = lower(i.email) limit 1) as family_id
		from inquiries i
		where i.source in ('formaloo_interview', 'interview') and i.email <> ''`;
	for (const row of rows) {
		const details = (row.details ?? {}) as Record<string, any>;
		const createdAt = new Date(row.created_at).toISOString();
		const schoolYear = normalizeSchoolYear(String(details.enrollmentYear || details.year || ''), createdAt.slice(0, 10));
		const students = (Array.isArray(details.children) ? details.children : []).map((child: any) => ({
			name: String(child?.name || ''), grade: String(child?.grade || child?.currentGrade || ''), currentSchool: String(child?.currentSchool || child?.school || ''),
		})).filter((child: { name: string }) => child.name);
		const status: ApplicationStatus = FORMALOO_STATUS[String(details.formalooStatus || '')] ?? 'submitted';
		await db()`
			insert into applications (id, family_id, email, name, school_year, status, students, answers, source, inquiry_id, submitted_at)
			values (${randomUUID()}, ${row.family_id}, ${String(row.email).toLowerCase()}, ${String(row.name || '')}, ${schoolYear}, ${status},
				${db().json(students)}, ${db().json(details)}, ${row.external_source === 'formaloo' ? 'formaloo' : 'portal'}, ${row.id}, ${row.created_at})
			on conflict (inquiry_id) where inquiry_id is not null do update set
				family_id = excluded.family_id, name = excluded.name, students = excluded.students, answers = excluded.answers,
				school_year = excluded.school_year,
				status = case when applications.status_by_staff then applications.status else excluded.status end`;
	}
}

function mapApplication(row: Record<string, any>): Application {
	return {
		id: String(row.id), familyId: row.family_id ? String(row.family_id) : null, email: String(row.email), name: String(row.name),
		schoolYear: String(row.school_year), status: row.status, students: Array.isArray(row.students) ? row.students : [],
		answers: row.answers ?? {}, source: String(row.source), inquiryId: row.inquiry_id ? String(row.inquiry_id) : null,
		submittedAt: new Date(row.submitted_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
	};
}

export async function listApplications(): Promise<Application[]> {
	await dbReady();
	const rows = await db()`
		select a.*, coalesce(f.merged_into_id, a.family_id) as family_id
		from applications a left join families f on f.id = a.family_id
		order by a.submitted_at desc`;
	return rows.map(mapApplication);
}

export async function setApplicationStatus(id: string, status: string, by: string): Promise<Result> {
	await dbReady();
	if (!APPLICATION_STATUSES.some((item) => item.value === status)) return { ok: false, error: 'Choose a status.' };
	const [row] = await db()`
		update applications set status = ${status}, status_by_staff = true, updated_at = now()
		where id = ${id} returning family_id, school_year`;
	if (!row) return { ok: false, error: 'That application no longer exists.' };
	if (row.family_id) await logFamilyActivity(String(row.family_id), 'note', by, `${row.school_year} application: ${applicationStatusLabel(status)}`);
	return { ok: true };
}
