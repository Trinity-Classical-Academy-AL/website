import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { chicagoToday } from './time.ts';
import { logFamilyActivity } from './family-merge.ts';
import type { Result } from './result.ts';

/**
 * Applications: one per child per school year (siblings from one submission
 * share a group). Today they arrive through Formaloo's interview form and the
 * portal's interview form (stored as inquiries); syncApplications copies them in.
 * Staff move each child through the stages; accepting creates a pending
 * enrollment for that year.
 */
export const APPLICATION_STATUSES = [
	{ value: 'requested', label: 'Requested' },
	{ value: 'interview', label: 'Interview' },
	{ value: 'interviewed', label: 'Interviewed' },
	{ value: 'application_sent', label: 'Application sent' },
	{ value: 'application_submitted', label: 'Application in' },
	{ value: 'accepted', label: 'Accepted' },
	{ value: 'waitlisted', label: 'Waitlisted' },
	{ value: 'declined', label: 'Declined' },
	{ value: 'withdrawn', label: 'Withdrawn' },
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]['value'];
export const applicationStatusLabel = (status: string) => APPLICATION_STATUSES.find((item) => item.value === status)?.label ?? status;
/** The pipeline in order, for boards and trackers (closed outcomes last). */
export const PIPELINE: ApplicationStatus[] = ['requested', 'interview', 'interviewed', 'application_sent', 'application_submitted', 'accepted'];
export const CLOSED: ApplicationStatus[] = ['waitlisted', 'declined', 'withdrawn'];

export type Application = {
	id: string; familyId: string | null; email: string; name: string; schoolYear: string; status: ApplicationStatus;
	childId: string | null; childName: string; grade: string; currentSchool: string; groupId: string;
	students: { name: string; grade: string; currentSchool: string }[]; answers: Record<string, unknown>;
	source: string; inquiryId: string | null; submittedAt: string; updatedAt: string; decidedAt: string | null; decidedBy: string;
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

// Formaloo's Status column, mapped onto application stages (confirmed against the
// live form). "Interview Held" emails the family the application, so it means the
// same as "Application sent". Formaloo has nothing for Waitlisted or Withdrawn.
const FORMALOO_STATUS: Record<string, ApplicationStatus> = {
	'Proceed with interview': 'interview', 'Pastoral Reference': 'interview', 'Interview Held': 'application_sent',
	'Not approved for application': 'declined', 'Application sent': 'application_sent', 'Family in ClassReach': 'accepted',
};

const firstName = (name: string) => name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

/** Copy interview submissions into per-child applications. Staff status changes are kept. */
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
		const kids = (Array.isArray(details.children) ? details.children : []).map((child: any) => ({
			name: String(child?.name || '').trim(), grade: String(child?.grade || child?.currentGrade || ''), currentSchool: String(child?.currentSchool || child?.school || ''),
		})).filter((child: { name: string }) => child.name);
		const entries = kids.length ? kids : [{ name: '', grade: '', currentSchool: '' }];
		const status: ApplicationStatus = FORMALOO_STATUS[String(details.formalooStatus || '')] ?? 'requested';
		const familyId = row.family_id ? String(row.family_id) : null;
		// A staff-set status on the old one-row-per-family record carries over to each child.
		const [legacy] = await db()`select status, status_by_staff from applications where inquiry_id = ${row.id} and child_name = '' and ${kids.length > 0}`;
		for (const kid of entries) {
			let childId: string | null = null;
			if (familyId && kid.name) {
				const existing = await db()`select id, name from children where family_id = ${familyId}`;
				const match = existing.find((child) => String(child.name).toLowerCase() === kid.name.toLowerCase())
					?? existing.find((child) => firstName(String(child.name)) === firstName(kid.name));
				childId = match ? String(match.id) : randomUUID();
				if (!match) await db()`insert into children (id, family_id, kind, name, grade, school_year, current_school) values (${childId}, ${familyId}, 'prospective', ${kid.name}, ${kid.grade}, ${schoolYear}, ${kid.currentSchool})`;
			}
			await db()`
				insert into applications (id, family_id, email, name, school_year, status, status_by_staff, students, answers, source, inquiry_id, submitted_at, child_id, child_name, grade, group_id)
				values (${randomUUID()}, ${familyId}, ${String(row.email).toLowerCase()}, ${String(row.name || '')}, ${schoolYear},
					${legacy?.status_by_staff ? legacy.status : status}, ${Boolean(legacy?.status_by_staff)}, ${db().json([kid])}, ${db().json(details)},
					${row.external_source === 'formaloo' ? 'formaloo' : 'portal'}, ${row.id}, ${row.created_at}, ${childId}, ${kid.name}, ${kid.grade}, ${row.id})
				on conflict (inquiry_id, child_name) where inquiry_id is not null do update set
					family_id = excluded.family_id, name = excluded.name, students = excluded.students, answers = excluded.answers,
					school_year = excluded.school_year, grade = excluded.grade, group_id = excluded.group_id,
					child_id = coalesce(applications.child_id, excluded.child_id),
					status = case when applications.status_by_staff then applications.status else excluded.status end`;
		}
		if (legacy) await db()`delete from applications where inquiry_id = ${row.id} and child_name = ''`;
	}
}

function mapApplication(row: Record<string, any>): Application {
	const students = Array.isArray(row.students) ? row.students : [];
	return {
		id: String(row.id), familyId: row.family_id ? String(row.family_id) : null, email: String(row.email), name: String(row.name),
		schoolYear: String(row.school_year), status: row.status, students, answers: row.answers ?? {},
		childId: row.child_id ? String(row.child_id) : null, childName: String(row.child_name || students[0]?.name || ''),
		grade: String(row.grade || students[0]?.grade || ''), currentSchool: String(students[0]?.currentSchool || ''),
		groupId: String(row.group_id || row.id), source: String(row.source), inquiryId: row.inquiry_id ? String(row.inquiry_id) : null,
		submittedAt: new Date(row.submitted_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
		decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null, decidedBy: String(row.decided_by || ''),
	};
}

export async function listApplications(): Promise<Application[]> {
	await dbReady();
	const rows = await db()`
		select a.*, coalesce(f.merged_into_id, a.family_id) as family_id
		from applications a left join families f on f.id = a.family_id
		order by a.submitted_at desc, a.child_name`;
	return rows.map(mapApplication);
}

/** A family's own applications: linked to the family, or sent from one of its emails. */
export async function listFamilyApplications(familyId: string): Promise<Application[]> {
	await dbReady();
	await syncApplications();
	const rows = await db()`
		select a.* from applications a
		where a.family_id = ${familyId}
			or lower(a.email) in (select email from family_emails where family_id = ${familyId})
			or lower(a.email) = (select lower(email) from families where id = ${familyId})
		order by a.school_year desc, a.submitted_at desc, a.child_name`;
	return rows.map(mapApplication);
}

/**
 * Move one child's application to a stage. Decisions record who and when;
 * accepting creates a pending enrollment for that school year.
 */
export async function setApplicationStatus(id: string, status: string, by: string): Promise<Result> {
	await dbReady();
	if (!APPLICATION_STATUSES.some((item) => item.value === status)) return { ok: false, error: 'Choose a status.' };
	const decision = ['accepted', 'waitlisted', 'declined'].includes(status);
	const [row] = await db()`
		update applications set status = ${status}, status_by_staff = true, updated_at = now(),
			decided_at = case when ${decision} then now() else decided_at end, decided_by = case when ${decision} then ${by} else decided_by end
		where id = ${id} returning family_id, school_year, child_id, child_name, grade`;
	if (!row) return { ok: false, error: 'That application no longer exists.' };
	if (status === 'accepted' && row.child_id) {
		await db()`insert into enrollments (id, child_id, school_year, grade, status) values (${randomUUID()}, ${row.child_id}, ${row.school_year}, ${row.grade}, 'pending')
			on conflict (child_id, school_year) do nothing`;
	}
	if (row.family_id) await logFamilyActivity(String(row.family_id), 'note', by, `${row.school_year} application${row.child_name ? ` for ${row.child_name}` : ''}: ${applicationStatusLabel(status)}`);
	return { ok: true };
}

/** Mark an accepted child enrolled for the year (contract and deposit done). */
export async function confirmEnrollment(applicationId: string, by: string): Promise<Result> {
	await dbReady();
	const [app] = await db()`select family_id, child_id, child_name, school_year, grade from applications where id = ${applicationId} and status = 'accepted'`;
	if (!app?.child_id) return { ok: false, error: 'Only an accepted child with a family account can be enrolled.' };
	await db()`
		insert into enrollments (id, child_id, school_year, grade, status, contract_signed_on) values (${randomUUID()}, ${app.child_id}, ${app.school_year}, ${app.grade}, 'enrolled', current_date)
		on conflict (child_id, school_year) do update set status = 'enrolled', contract_signed_on = coalesce(enrollments.contract_signed_on, current_date), updated_at = now()`;
	await db()`update children set kind = 'student' where id = ${app.child_id}`;
	await db()`update families set roles = array(select distinct unnest(array_remove(roles, 'prospect') || array['guardian'])) where id = ${app.family_id}`;
	await logFamilyActivity(String(app.family_id), 'note', by, `${app.child_name} enrolled for ${app.school_year}`);
	return { ok: true };
}

/** Enrollment status per child and school year for a family ("childId|year" → status). */
export async function familyEnrollments(familyId: string): Promise<Map<string, string>> {
	await dbReady();
	const rows = await db()`select e.child_id, e.school_year, e.status from enrollments e join children c on c.id = e.child_id where c.family_id = ${familyId}`;
	return new Map(rows.map((row) => [`${row.child_id}|${row.school_year}`, String(row.status)]));
}
