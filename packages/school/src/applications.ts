import { randomUUID } from 'node:crypto';
import { sendTemplate } from './email-catalog.ts';
import { db, dbReady } from './db.ts';
import { chicagoToday } from './time.ts';
import { formatTourClock } from './tours/model.ts';
import { portalOrigin, sendEmail } from './email.ts';
import { routeEmail } from './accounts.ts';
import { logFamilyActivity } from './family-merge.ts';
import { gradeHasRoom } from './reenrollment.ts';
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
	/** The family's booked interview time ("Thu, Dec 3 · 4:00 PM–4:45 PM"), or '' if none. */
	interviewWhen: string;
	/** The family's full application (a form assignment), once they're approved. */
	fullApplication: { assignmentId: string; formId: string; status: string } | null;
	notes: string;
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
	// Only requests that are new, changed, or whose family has since signed up are worked through;
	// the fingerprint records what each was last synced from (this runs on page views).
	const rows = await db()`
		select * from (
			select i.id, i.email, i.name, i.created_at, i.details, i.external_source, i.application_sync,
				(select coalesce(f.merged_into_id, f.id) from family_emails e join families f on f.id = e.family_id where e.email = lower(i.email) limit 1) as family_id
			from inquiries i
			where i.source in ('formaloo_interview', 'interview') and i.email <> ''
		) r
		where r.application_sync is distinct from md5(coalesce(r.details::text, '') || '|' || r.name || '|' || r.email || '|' || coalesce(r.family_id::text, ''))
		order by r.created_at`;
	for (const row of rows) {
		await syncOne(row);
		await db()`update inquiries set application_sync = md5(coalesce(details::text, '') || '|' || name || '|' || email || '|' || ${row.family_id ? String(row.family_id) : ''}) where id = ${row.id}`;
	}
}

async function syncOne(row: Record<string, any>): Promise<void> {
	{
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
			return;
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

/** Booked interview times by family ("familyId" → when). */
async function interviewsFor(rows: Record<string, any>[]): Promise<Map<string, string>> {
	const ids = [...new Set(rows.map((row) => row.family_id).filter(Boolean).map(String))];
	if (!ids.length) return new Map();
	const found = await db()`select h.family_id, s.slot_date::text as slot_date, s.start_time, s.end_time from tour_holds h join tour_slots s on s.id = h.slot_id
		where h.family_id = any(${ids}::uuid[]) and h.kind = 'slot' and h.status <> 'cancelled' and s.slot_type = 'interview'`;
	const day = (date: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
	return new Map(found.map((item) => [String(item.family_id), `${day(String(item.slot_date))} · ${formatTourClock(String(item.start_time))}–${formatTourClock(String(item.end_time))}`]));
}

/** Full application assignments by application id. */
async function fullApplicationsFor(rows: Record<string, any>[]): Promise<Map<string, { assignmentId: string; formId: string; status: string }>> {
	const ids = rows.map((row) => String(row.id));
	if (!ids.length) return new Map();
	const found = await db()`select id, form_id, status, application_id from form_assignments where application_id = any(${ids}::uuid[])`;
	return new Map(found.map((item) => [String(item.application_id), { assignmentId: String(item.id), formId: String(item.form_id), status: String(item.status) }]));
}

function mapApplication(row: Record<string, any>, enrollments: Map<string, EnrollmentStatus>, interviews: Map<string, string> = new Map(), full: Map<string, { assignmentId: string; formId: string; status: string }> = new Map()): Application {
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
		interviewWhen: row.family_id ? interviews.get(String(row.family_id)) ?? '' : '',
		fullApplication: full.get(String(row.id)) ?? null,
		notes: String(row.staff_notes || ''),
	};
}

export async function listApplications(): Promise<Application[]> {
	await dbReady();
	const rows = await db()`
		select a.*, coalesce(f.merged_into_id, a.family_id) as family_id
		from applications a left join families f on f.id = a.family_id
		order by a.submitted_at desc`;
	const [enrollments, interviews, full] = await Promise.all([enrollmentsFor(rows), interviewsFor(rows), fullApplicationsFor(rows)]);
	return rows.map((row) => mapApplication(row, enrollments, interviews, full));
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
	const [enrollments, interviews, full] = await Promise.all([enrollmentsFor(rows), interviewsFor(rows), fullApplicationsFor(rows)]);
	return rows.map((row) => mapApplication(row, enrollments, interviews, full));
}

/** Once the full application is in, every child on it has a pending enrollment for that year. */
async function openEnrollments(applicationId: string): Promise<void> {
	const [app] = await db()`select school_year, students, status from applications where id = ${applicationId}`;
	if (!app || app.status !== 'application_submitted') return;
	for (const kid of (app.students as StoredChild[]) ?? []) {
		if (!kid.childId) continue;
		// A full grade: the child goes on the waitlist instead (and the family hears why).
		const year = kid.schoolYear || String(app.school_year);
		const room = await gradeHasRoom(year, kid.grade, kid.childId);
		const [created] = await db()`insert into enrollments (id, child_id, school_year, grade, status) values (${randomUUID()}, ${kid.childId}, ${year}, ${kid.grade}, ${room.ok ? 'pending' : 'waitlisted'})
			on conflict (child_id, school_year) do nothing returning id, status, child_id`;
		if (created?.status === 'pending') await sendAgreement(String(created.id));
		if (created?.status === 'waitlisted') {
			const [child] = await db()`select family_id from children where id = ${created.child_id}`;
			const contact = child ? await familyContact(String(child.family_id)) : null;
			if (contact) await sendTemplate('enrollment.waitlisted', contact.email, { name: contact.name, child: kid.name.split(' ')[0], year, grade: kid.grade === 'K' ? 'Kindergarten' : `Grade ${kid.grade}` });
		}
	}
}

/** First names of a family's household contact, for emails. */
async function familyContact(familyId: string): Promise<{ email: string; name: string } | null> {
	const [row] = await db()`select email, coalesce(nullif(household_name, ''), name, '') as name from families where id = ${familyId}`;
	return row ? { email: await routeEmail(familyId, 'admin', String(row.email)), name: String(row.name || '').trim() || 'there' } : null;
}

/**
 * When a child's enrollment opens, the family signs an enrollment agreement for
 * that child (if the school has one: a form "Used for" enrollment agreement).
 * Signing it enrolls the child.
 */
export async function sendAgreement(enrollmentId: string): Promise<void> {
	const [form] = await db()`select id from school_forms where purpose = 'contract' and status = 'open' order by created_at desc limit 1`;
	if (!form) return;
	const [row] = await db()`select e.school_year, c.id as child_id, c.name, c.family_id from enrollments e join children c on c.id = e.child_id where e.id = ${enrollmentId}`;
	if (!row) return;
	const [assignment] = await db()`
		insert into form_assignments (id, form_id, family_id, student_id, enrollment_id) values (${randomUUID()}, ${form.id}, ${row.family_id}, ${row.child_id}, ${enrollmentId})
		on conflict (form_id, family_id, student_id) do nothing returning id`;
	const contact = await familyContact(String(row.family_id));
	if (assignment && contact) await sendTemplate('enrollment.agreement', contact.email, { name: contact.name, child: String(row.name).split(' ')[0], year: String(row.school_year), link: `${portalOrigin()}/g/forms/${assignment.id}` });
}

/** The family signed a child's enrollment agreement: the child is enrolled. */
export async function agreementSigned(enrollmentId: string, signature: string): Promise<void> {
	const [row] = await db()`select e.school_year, c.id as child_id, c.name, c.family_id from enrollments e join children c on c.id = e.child_id where e.id = ${enrollmentId}`;
	if (!row) return;
	await db()`update enrollments set status = 'enrolled', contract_signed_on = current_date, updated_at = now() where id = ${enrollmentId}`;
	await db()`update children set kind = 'student' where id = ${row.child_id}`;
	await logFamilyActivity(String(row.family_id), 'note', signature || 'family', `${row.name}: enrollment agreement signed for ${row.school_year}`);
	const contact = await familyContact(String(row.family_id));
	if (contact) await sendTemplate('enrollment.enrolled', contact.email, { name: contact.name, child: String(row.name).split(' ')[0], year: String(row.school_year), link: portalOrigin() });
}

/**
 * Approved after the interview: the family gets the full application (the
 * newest open form "Used for" full application) and an email with its link.
 */
async function assignFullApplication(applicationId: string): Promise<string | null> {
	const [app] = await db()`select id, family_id from applications where id = ${applicationId}`;
	if (!app?.family_id) return null;
	const [existing] = await db()`select id from form_assignments where application_id = ${applicationId}`;
	if (existing) return String(existing.id);
	const [form] = await db()`select id from school_forms where purpose = 'application' and status = 'open' order by created_at desc limit 1`;
	if (!form) return null;
	const id = randomUUID();
	await db()`insert into form_assignments (id, form_id, family_id, student_id, application_id) values (${id}, ${form.id}, ${app.family_id}, null, ${applicationId})`;
	return id;
}

/** The family submitted their full application: it's in, and each child's enrollment opens. */
export async function applicationFormSubmitted(applicationId: string): Promise<void> {
	const [row] = await db()`update applications set status = 'application_submitted', updated_at = now() where id = ${applicationId} and status in ('approved', 'interview') returning family_id`;
	if (!row) return;
	await openEnrollments(applicationId);
	if (row.family_id) {
		await logFamilyActivity(String(row.family_id), 'note', 'family', 'Full application submitted');
		const contact = await familyContact(String(row.family_id));
		if (contact) await sendTemplate('application.received', contact.email, { name: contact.name, link: `${portalOrigin()}/applications` });
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
		where id = ${id} returning family_id, school_year, email, name, (select status from applications where id = ${id}) as before`;
	if (!row) return { ok: false, error: 'That application no longer exists.' };
	// Approved: the full application goes out. Not approved: a kind note.
	if (status === 'approved' && row.before !== 'approved' && row.family_id) {
		const assignment = await assignFullApplication(id);
		const contact = await familyContact(String(row.family_id));
		if (contact) await sendTemplate('application.approved', contact.email, { name: contact.name, link: assignment ? `${portalOrigin()}/g/forms/${assignment}` : `${portalOrigin()}/applications` });
	}
	if (status === 'declined' && row.before !== 'declined' && row.family_id) {
		const contact = await familyContact(String(row.family_id));
		if (contact) await sendTemplate('application.declined', contact.email, { name: contact.name });
	}
	// Invited to interview: ask the family to pick one of the posted interview times.
	if (status === 'interview' && row.before !== 'interview' && row.family_id) {
		const to = await routeEmail(String(row.family_id), 'admin', String(row.email));
		await sendTemplate('interview.invite', to, { name: String(row.name || '').trim() || 'there', link: `${portalOrigin()}/applications` });
	}
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
	if (['enrolled', 'pending'].includes(input.status)) {
		const room = await gradeHasRoom(kid.schoolYear || String(app.school_year), kid.grade, input.childId);
		if (!room.ok) return { ok: false, error: `${kid.grade === 'K' ? 'Kindergarten' : `Grade ${kid.grade}`} is full (${room.taken} of ${room.seats}). Waitlist ${kid.name.split(' ')[0]}, or raise the seats on the Re-enrollment page.` };
	}
	await db()`
		insert into enrollments (id, child_id, school_year, grade, status, contract_signed_on) values (${randomUUID()}, ${input.childId}, ${kid.schoolYear || app.school_year}, ${kid.grade}, ${input.status}, ${input.status === 'enrolled' ? db()`current_date` : null})
		on conflict (child_id, school_year) do update set status = excluded.status, updated_at = now(),
			contract_signed_on = case when excluded.status = 'enrolled' then coalesce(enrollments.contract_signed_on, current_date) else enrollments.contract_signed_on end`;
	if (app.family_id && ['enrolled', 'waitlisted'].includes(input.status)) {
		const contact = await familyContact(String(app.family_id));
		const year = kid.schoolYear || String(app.school_year);
		if (contact && input.status === 'enrolled') await sendTemplate('enrollment.enrolled', contact.email, { name: contact.name, child: kid.name.split(' ')[0], year, link: portalOrigin() });
		if (contact && input.status === 'waitlisted') await sendTemplate('enrollment.waitlisted', contact.email, { name: contact.name, child: kid.name.split(' ')[0], year, grade: kid.grade === 'K' ? 'Kindergarten' : `Grade ${kid.grade}` });
	}
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

/** Staff-only notes on an application (interview notes, impressions). */
export async function saveApplicationNotes(id: string, notes: string, by: string): Promise<Result> {
	await dbReady();
	const [row] = await db()`update applications set staff_notes = ${notes.trim().slice(0, 8000)}, updated_at = now() where id = ${id} returning family_id`;
	if (!row) return { ok: false, error: 'That application no longer exists.' };
	return { ok: true };
}

export type PastoralReference = { name: string; church: string; email: string; phone: string; status: 'not_requested' | 'requested' | 'received'; notes: string };
/** The pastoral reference: who, how to reach them, whether it's in, and what they said (staff only). */
export async function saveReference(id: string, input: Partial<PastoralReference>): Promise<Result> {
	await dbReady();
	const clean: PastoralReference = {
		name: String(input.name ?? '').trim().slice(0, 160), church: String(input.church ?? '').trim().slice(0, 160), email: String(input.email ?? '').trim().slice(0, 200),
		phone: String(input.phone ?? '').trim().slice(0, 40), status: (['requested', 'received'].includes(String(input.status)) ? input.status : 'not_requested') as PastoralReference['status'], notes: String(input.notes ?? '').trim().slice(0, 8000),
	};
	const [row] = await db()`update applications set reference = ${db().json(clean)}, updated_at = now() where id = ${id} returning id`;
	return row ? { ok: true } : { ok: false, error: 'That application no longer exists.' };
}
export async function applicationReference(id: string): Promise<PastoralReference> {
	await dbReady();
	const [row] = await db()`select reference from applications where id = ${id}`;
	const ref = (row?.reference ?? {}) as Partial<PastoralReference>;
	return { name: ref.name ?? '', church: ref.church ?? '', email: ref.email ?? '', phone: ref.phone ?? '', status: ref.status ?? 'not_requested', notes: ref.notes ?? '' };
}

/** A full application or enrollment agreement form was just published: send it to families already waiting for it. */
export async function catchUpForms(purpose: string): Promise<void> {
	await dbReady();
	if (purpose === 'application') {
		const waiting = await db()`select a.id, a.family_id from applications a where a.status = 'approved' and a.family_id is not null and not exists (select 1 from form_assignments f where f.application_id = a.id)`;
		for (const row of waiting) {
			const assignment = await assignFullApplication(String(row.id));
			const contact = await familyContact(String(row.family_id));
			if (assignment && contact) await sendTemplate('application.approved', contact.email, { name: contact.name, link: `${portalOrigin()}/g/forms/${assignment}` });
		}
	}
	if (purpose === 'contract') {
		const pending = await db()`select e.id from enrollments e join children c on c.id = e.child_id where e.status = 'pending' and c.kind = 'prospective'`;
		for (const row of pending) await sendAgreement(String(row.id));
	}
}
