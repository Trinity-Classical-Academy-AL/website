import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { chicagoToday } from './time.ts';
import { logFamilyActivity } from './family-merge.ts';
import type { Result } from './result.ts';

/**
 * Applications: one per family per school year, from an interview request
 * (Formaloo's form or the portal's, stored as inquiries; syncApplications copies
 * them in). The family moves through one set of steps with a single approval
 * after the interview. Children ride along on the application and the guardian
 * can add or remove them; enrollment is per child (pending, enrolled, waitlisted
 * when a grade is full, or withdrawn).
 */
export const APPLICATION_STATUSES = [
	{ value: 'requested', label: 'Requested' },
	{ value: 'interview', label: 'Interview' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'application_submitted', label: 'Application in' },
	{ value: 'declined', label: 'Not approved' },
	{ value: 'withdrawn', label: 'Withdrawn' },
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]['value'];
export const applicationStatusLabel = (status: string) => APPLICATION_STATUSES.find((item) => item.value === status)?.label ?? status;
/** The pipeline in order, for boards and trackers (closed outcomes last). */
export const PIPELINE: ApplicationStatus[] = ['requested', 'interview', 'approved', 'application_submitted'];
export const CLOSED: ApplicationStatus[] = ['declined', 'withdrawn'];

export type EnrollmentStatus = 'pending' | 'enrolled' | 'waitlisted' | 'withdrawn';
export const ENROLLMENT_LABELS: Record<EnrollmentStatus, string> = { pending: 'Enrolling', enrolled: 'Enrolled', waitlisted: 'Waitlisted', withdrawn: 'Not enrolling' };
/** A child on the application. schoolYear is the year they'd start (a younger sibling added later starts later). */
export type ApplicationChild = { name: string; grade: string; currentSchool: string; childId: string | null; schoolYear: string; enrollment: EnrollmentStatus | null };
export type Application = {
	id: string; familyId: string | null; email: string; name: string; schoolYear: string; status: ApplicationStatus;
	children: ApplicationChild[]; answers: Record<string, unknown>;
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
// live form). "Interview Held" emails the family the application, so it means
// approved. Formaloo has nothing for Withdrawn.
const FORMALOO_STATUS: Record<string, ApplicationStatus> = {
	'Proceed with interview': 'interview', 'Pastoral Reference': 'interview', 'Interview Held': 'approved',
	'Not approved for application': 'declined', 'Application sent': 'approved', 'Family in ClassReach': 'application_submitted',
};

const firstName = (name: string) => name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

/** A family's child record for this name, created when missing (prospective). */
async function childFor(familyId: string, kid: { name: string; grade: string; currentSchool: string }, schoolYear: string): Promise<string> {
	const existing = await db()`select id, name from children where family_id = ${familyId}`;
	const match = existing.find((child) => String(child.name).toLowerCase() === kid.name.toLowerCase())
		?? existing.find((child) => firstName(String(child.name)) === firstName(kid.name));
	if (match) return String(match.id);
	const id = randomUUID();
	await db()`insert into children (id, family_id, kind, name, grade, school_year, current_school) values (${id}, ${familyId}, 'prospective', ${kid.name}, ${kid.grade}, ${schoolYear}, ${kid.currentSchool})`;
	return id;
}

type StoredChild = { name: string; grade: string; currentSchool: string; childId: string | null; schoolYear?: string };
const STAGE_ORDER = ['withdrawn', 'declined', 'requested', 'interview', 'approved', 'application_submitted'];
const furthest = (a: string, b: string) => STAGE_ORDER.indexOf(b) > STAGE_ORDER.indexOf(a) ? b : a;
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Copy interview requests into applications: one per family, ever (one per
 * email before there's an account). A family's later request folds into its
 * application, adding any new children. Staff stage changes and the family's
 * own edits to children are kept.
 */
export async function syncApplications(): Promise<void> {
	await dbReady();
	const rows = await db()`
		select i.id, i.email, i.name, i.created_at, i.details, i.external_source,
			(select coalesce(f.merged_into_id, f.id) from family_emails e join families f on f.id = e.family_id where e.email = lower(i.email) limit 1) as family_id
		from inquiries i
		where i.source in ('formaloo_interview', 'interview') and i.email <> ''
		order by i.created_at`;
	for (const row of rows) {
		const details = (row.details ?? {}) as Record<string, any>;
		const createdAt = new Date(row.created_at).toISOString();
		const schoolYear = normalizeSchoolYear(String(details.enrollmentYear || details.year || ''), createdAt.slice(0, 10));
		const familyId = row.family_id ? String(row.family_id) : null;
		const email = String(row.email).toLowerCase();
		const fromForm: StoredChild[] = (Array.isArray(details.children) ? details.children : []).map((child: any) => ({
			name: String(child?.name || '').trim(), grade: String(child?.grade || child?.currentGrade || ''), currentSchool: String(child?.currentSchool || child?.school || ''), childId: null, schoolYear,
		})).filter((child: StoredChild) => child.name);
		const status: ApplicationStatus = FORMALOO_STATUS[String(details.formalooStatus || '')] ?? 'requested';
		// This request's application, else the family's (or the email's) one.
		let [app] = await db()`select * from applications where inquiry_id = ${row.id} or ${row.id} = any(inquiry_ids) limit 1`;
		const owner = familyId
			? (await db()`select * from applications where family_id = ${familyId} limit 1`)[0]
			: (await db()`select * from applications where family_id is null and lower(email) = ${email} limit 1`)[0];
		if (app && owner && owner.id !== app.id) {
			// The family now has an account and already had an application: fold this one in.
			await db()`select merge_applications(${owner.id}, ${app.id})`;
			app = (await db()`select * from applications where id = ${owner.id}`)[0];
		}
		const absorbing = !app && owner;
		if (absorbing) app = owner;
		const kids: StoredChild[] = (Array.isArray(app?.students) ? app.students as StoredChild[] : []).filter((kid) => kid?.name);
		// The family's own edits stand; only a newly folded-in request adds children.
		if (!app || !app.students_edited || absorbing) for (const kid of fromForm) if (!kids.some((item) => sameName(item.name, kid.name))) kids.push(kid);
		if (familyId) for (const kid of kids) if (!kid.childId && kid.name) kid.childId = await childFor(familyId, kid, kid.schoolYear || schoolYear);
		if (!app) {
			await db()`
				insert into applications (id, family_id, email, name, school_year, status, students, answers, source, inquiry_id, submitted_at, group_id)
				values (${randomUUID()}, ${familyId}, ${email}, ${String(row.name || '')}, ${schoolYear}, ${status},
					${db().json(kids)}, ${db().json(details)}, ${row.external_source === 'formaloo' ? 'formaloo' : 'portal'}, ${row.id}, ${row.created_at}, ${row.id})`;
			continue;
		}
		const nextStatus = app.status_by_staff ? app.status : app.inquiry_id === row.id ? status : furthest(String(app.status), status);
		await db()`
			update applications set family_id = coalesce(family_id, ${familyId}), students = ${db().json(kids)}, status = ${nextStatus},
				inquiry_ids = case when inquiry_id = ${row.id} or ${row.id} = any(inquiry_ids) then inquiry_ids else inquiry_ids || ${row.id}::uuid end,
				name = case when inquiry_id = ${row.id} then ${String(row.name || '')} else name end,
				answers = case when inquiry_id = ${row.id} then ${db().json(details)} else answers end
			where id = ${app.id}`;
	}
}

/** Enrollment per child for these applications ("childId|year" → status). */
async function enrollmentsFor(rows: Record<string, any>[]): Promise<Map<string, EnrollmentStatus>> {
	const ids = [...new Set(rows.flatMap((row) => (Array.isArray(row.students) ? row.students : []).map((kid: StoredChild) => kid.childId).filter(Boolean)))] as string[];
	if (!ids.length) return new Map();
	const found = await db()`select child_id, school_year, status from enrollments where child_id = any(${ids}::uuid[])`;
	return new Map(found.map((item) => [`${item.child_id}|${item.school_year}`, item.status as EnrollmentStatus]));
}

function mapApplication(row: Record<string, any>, enrollments: Map<string, EnrollmentStatus>): Application {
	const stored: StoredChild[] = Array.isArray(row.students) ? row.students : [];
	return {
		id: String(row.id), familyId: row.family_id ? String(row.family_id) : null, email: String(row.email), name: String(row.name),
		schoolYear: String(row.school_year), status: row.status, answers: row.answers ?? {},
		children: stored.filter((kid) => kid?.name).map((kid) => ({
			name: String(kid.name), grade: String(kid.grade || ''), currentSchool: String(kid.currentSchool || ''), childId: kid.childId ? String(kid.childId) : null,
			schoolYear: String(kid.schoolYear || row.school_year),
			enrollment: kid.childId ? enrollments.get(`${kid.childId}|${kid.schoolYear || row.school_year}`) ?? null : null,
		})),
		source: String(row.source), inquiryId: row.inquiry_id ? String(row.inquiry_id) : null,
		submittedAt: new Date(row.submitted_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
		decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null, decidedBy: String(row.decided_by || ''),
	};
}

export async function listApplications(): Promise<Application[]> {
	await dbReady();
	const rows = await db()`
		select a.*, coalesce(f.merged_into_id, a.family_id) as family_id
		from applications a left join families f on f.id = a.family_id
		order by a.submitted_at desc`;
	const enrollments = await enrollmentsFor(rows);
	return rows.map((row) => mapApplication(row, enrollments));
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
		order by a.submitted_at`;
	const enrollments = await enrollmentsFor(rows);
	return rows.map((row) => mapApplication(row, enrollments));
}

/** Once the full application is in, every child on it has a pending enrollment for that year. */
async function openEnrollments(applicationId: string): Promise<void> {
	const [app] = await db()`select school_year, students, status from applications where id = ${applicationId}`;
	if (!app || app.status !== 'application_submitted') return;
	for (const kid of (app.students as StoredChild[]) ?? []) {
		if (!kid.childId) continue;
		await db()`insert into enrollments (id, child_id, school_year, grade, status) values (${randomUUID()}, ${kid.childId}, ${kid.schoolYear || app.school_year}, ${kid.grade}, 'pending')
			on conflict (child_id, school_year) do nothing`;
	}
}

/** Move a family's application to a stage. Approval (or not) records who and when. */
export async function setApplicationStatus(id: string, status: string, by: string): Promise<Result> {
	await dbReady();
	if (!APPLICATION_STATUSES.some((item) => item.value === status)) return { ok: false, error: 'Choose a status.' };
	const decision = ['approved', 'declined'].includes(status);
	const [row] = await db()`
		update applications set status = ${status}, status_by_staff = true, updated_at = now(),
			decided_at = case when ${decision} then now() else decided_at end, decided_by = case when ${decision} then ${by} else decided_by end
		where id = ${id} returning family_id, school_year`;
	if (!row) return { ok: false, error: 'That application no longer exists.' };
	await openEnrollments(id);
	if (row.family_id) await logFamilyActivity(String(row.family_id), 'note', by, `${row.school_year} application: ${applicationStatusLabel(status)}`);
	return { ok: true };
}

/**
 * The guardian (or staff) adds a child to the family's application. A family
 * account is needed so the child has a record to enroll.
 */
export async function addApplicationChild(input: { applicationId: string; familyId: string; name: string; grade: string; currentSchool?: string }): Promise<Result> {
	await dbReady();
	const name = input.name.trim().slice(0, 120);
	if (!name) return { ok: false, error: 'Add the child’s name.' };
	if (!input.grade.trim()) return { ok: false, error: 'Choose a grade.' };
	const [app] = await db()`select id, school_year, students, status from applications where id = ${input.applicationId}`;
	if (!app) return { ok: false, error: 'That application no longer exists.' };
	if (CLOSED.includes(app.status)) return { ok: false, error: 'This application is closed.' };
	const kids = ((app.students as StoredChild[]) ?? []).filter((kid) => kid?.name);
	if (kids.some((kid) => kid.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `${name} is already on this application.` };
	// A child added after the application's first year starts next school year.
	const next = shiftSchoolYear(schoolYearOf(), 1);
	const kid = { name, grade: input.grade.trim(), currentSchool: (input.currentSchool ?? '').trim(), schoolYear: String(app.school_year) < next ? next : String(app.school_year) };
	const childId = await childFor(input.familyId, kid, kid.schoolYear);
	await db()`update applications set students = ${db().json([...kids, { ...kid, childId }])}, students_edited = true, family_id = coalesce(family_id, ${input.familyId}), updated_at = now() where id = ${app.id}`;
	await openEnrollments(String(app.id));
	return { ok: true };
}

/** Take a child off the application. An enrolled child stays; anything else for that year is cleared. */
export async function removeApplicationChild(input: { applicationId: string; childName: string }): Promise<Result> {
	await dbReady();
	const [app] = await db()`select id, school_year, students from applications where id = ${input.applicationId}`;
	if (!app) return { ok: false, error: 'That application no longer exists.' };
	const kids = ((app.students as StoredChild[]) ?? []).filter((kid) => kid?.name);
	const kid = kids.find((item) => item.name === input.childName);
	if (!kid) return { ok: true };
	if (kid.childId) {
		const year = kid.schoolYear || app.school_year;
		const [enrollment] = await db()`select status from enrollments where child_id = ${kid.childId} and school_year = ${year}`;
		if (enrollment?.status === 'enrolled') return { ok: false, error: `${kid.name} is already enrolled. Contact the office to make a change.` };
		await db()`delete from enrollments where child_id = ${kid.childId} and school_year = ${year} and status <> 'enrolled'`;
	}
	await db()`update applications set students = ${db().json(kids.filter((item) => item !== kid))}, students_edited = true, updated_at = now() where id = ${app.id}`;
	return { ok: true };
}

/**
 * Staff set one child's enrollment for the application's year: enrolled
 * (contract done), waitlisted (grade is full), not enrolling, or back to pending.
 */
export async function setChildEnrollment(input: { applicationId: string; childId: string; status: string; by: string }): Promise<Result> {
	await dbReady();
	if (!['pending', 'enrolled', 'waitlisted', 'withdrawn'].includes(input.status)) return { ok: false, error: 'Choose an enrollment status.' };
	const [app] = await db()`select family_id, school_year, students from applications where id = ${input.applicationId}`;
	const kid = ((app?.students as StoredChild[]) ?? []).find((item) => item?.childId === input.childId);
	if (!app || !kid) return { ok: false, error: 'That child is no longer on the application.' };
	await db()`
		insert into enrollments (id, child_id, school_year, grade, status, contract_signed_on) values (${randomUUID()}, ${input.childId}, ${kid.schoolYear || app.school_year}, ${kid.grade}, ${input.status}, ${input.status === 'enrolled' ? db()`current_date` : null})
		on conflict (child_id, school_year) do update set status = excluded.status, updated_at = now(),
			contract_signed_on = case when excluded.status = 'enrolled' then coalesce(enrollments.contract_signed_on, current_date) else enrollments.contract_signed_on end`;
	if (input.status === 'enrolled') {
		await db()`update children set kind = 'student' where id = ${input.childId}`;
		await db()`update families set roles = array(select distinct unnest(array_remove(roles, 'prospect') || array['guardian'])) where id = ${app.family_id}`;
	}
	if (app.family_id) await logFamilyActivity(String(app.family_id), 'note', input.by, `${kid.name}, ${kid.schoolYear || app.school_year}: ${ENROLLMENT_LABELS[input.status as EnrollmentStatus]}`);
	return { ok: true };
}

/** Enrollment status per child and school year for a family ("childId|year" → status). */
export async function familyEnrollments(familyId: string): Promise<Map<string, string>> {
	await dbReady();
	const rows = await db()`select e.child_id, e.school_year, e.status from enrollments e join children c on c.id = e.child_id where c.family_id = ${familyId}`;
	return new Map(rows.map((row) => [`${row.child_id}|${row.school_year}`, String(row.status)]));
}
