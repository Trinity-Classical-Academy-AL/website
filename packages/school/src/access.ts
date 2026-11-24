import { randomUUID } from 'node:crypto';
import { sendTemplate } from './email-catalog.ts';
import { db, dbReady } from './db.ts';
import { mirrorPrimary } from './accounts.ts';
import { portalOrigin, sendEmail } from './email.ts';
import { schoolYearOf, shiftSchoolYear } from './applications.ts';

/**
 * Two separate things decide what someone sees:
 *
 * - Access belongs to the person (their sign-in email): staff, admin and
 *   developer each add a section on top of the family experience everyone has.
 * - Stage belongs to the household and is worked out from data, never set by
 *   hand: visitor, prospective (tour or application), enrolling (a child's
 *   enrollment pending), enrolled (a child enrolled this year or next) or
 *   former (had students, none now).
 */
export const PERSON_ROLES = [
	// Stored as 'staff' (existing access rows); shown as Teacher: it opens the teacher pages.
	{ value: 'staff', label: 'Teacher', hint: 'Classes, attendance, report cards and class messages: the Teacher section' },
	{ value: 'admin', label: 'Admin', hint: 'Runs the school: the Admin section, except People and Hiring' },
	// Always on top of Admin: turning it on adds Admin, turning Admin off removes it.
	{ value: 'super_admin', label: 'Super admin', hint: 'Admin plus People (everyone’s access) and Hiring' },
	{ value: 'finance', label: 'Finance', hint: 'Budgets, salaries, billing and payments: the Finance section' },
	{ value: 'developer', label: 'Developer', hint: 'The developer console: email previews and copy' },
] as const;
export type PersonRole = (typeof PERSON_ROLES)[number]['value'];
export type FamilyStage = 'visitor' | 'prospective' | 'enrolling' | 'enrolled' | 'former';
export const STAGE_LABELS: Record<FamilyStage, string> = { visitor: 'Visitor', prospective: 'Prospective', enrolling: 'Enrolling', enrolled: 'Enrolled', former: 'Former' };

export type SessionAccess = {
	stage: FamilyStage;
	/** An open application (so Apply stays in the menu even for an enrolled family). */
	applying: boolean;
	/** A teaching application in progress (shows Teaching in the sidebar). */
	teaching: boolean;
	person: PersonRole[];
	/** Family-side role for older checks: guardian when enrolled, prospect otherwise, plus the person's roles. */
	roles: string[];
	/** Set when a student signed in with their own sign-in: they see only their own pages. */
	studentId?: string;
};

const cleanRoles = (value: unknown): PersonRole[] => (Array.isArray(value) ? value : []).map(String).filter((role): role is PersonRole => PERSON_ROLES.some((item) => item.value === role));

/** One query: the household's stage facts and this person's access. */
export async function sessionAccess(familyId: string, email: string, today?: string): Promise<SessionAccess> {
	await dbReady();
	const current = schoolYearOf(today), next = shiftSchoolYear(current, 1);
	const [row] = await db()`
		select
			exists (select 1 from enrollments e join children c on c.id = e.child_id where c.family_id = ${familyId} and e.status = 'enrolled' and e.school_year in (${current}, ${next})) as enrolled,
			exists (select 1 from enrollments e join children c on c.id = e.child_id where c.family_id = ${familyId} and e.status in ('pending', 'waitlisted') and e.school_year >= ${current}) as enrolling,
			exists (select 1 from enrollments e join children c on c.id = e.child_id where c.family_id = ${familyId} and e.status in ('enrolled', 'graduated') and e.school_year < ${current}) as former,
			exists (select 1 from applications a where a.family_id = ${familyId} and a.status not in ('declined', 'withdrawn')) as applying,
			exists (select 1 from tour_holds h where h.family_id = ${familyId} and h.status <> 'cancelled') as touring,
			exists (select 1 from teacher_applicants t where (t.family_id = ${familyId} or (t.family_id is null and lower(t.email) = lower(${email}))) and t.status not in ('hired', 'declined', 'withdrawn')) as teaching,
			(select roles from family_emails where email = lower(${email}) and family_id = ${familyId}) as person,
			(select child_id from family_emails where email = lower(${email}) and family_id = ${familyId}) as student`;
	const stage: FamilyStage = row?.enrolled ? 'enrolled' : row?.enrolling ? 'enrolling' : row?.applying || row?.touring ? 'prospective' : row?.former ? 'former' : 'visitor';
	if (row?.student) return { stage, applying: false, teaching: false, person: [], roles: ['student'], studentId: String(row.student) };
	const person = cleanRoles(row?.person);
	return { stage, applying: Boolean(row?.applying), teaching: Boolean(row?.teaching), person, roles: [stage === 'enrolled' ? 'guardian' : 'prospect', ...person] };
}

/** Everyone with staff, admin or developer access, by sign-in email. */
export async function listAccess(): Promise<{ email: string; familyId: string; name: string; roles: PersonRole[] }[]> {
	await dbReady();
	const rows = await db()`
		select e.email, e.family_id, e.roles, coalesce(nullif(p.name, ''), nullif(e.label, ''), nullif(f.name, ''), e.email) as name
		from family_emails e join families f on f.id = e.family_id
		left join family_people p on p.id = e.person_id
		where cardinality(e.roles) > 0 and f.merged_into_id is null
		order by name`;
	return rows.map((row) => ({ email: String(row.email), familyId: String(row.family_id), name: String(row.name), roles: cleanRoles(row.roles) }));
}

/** One person who can sign in: their emails, household and access (all of their emails share it). */
export type PersonRow = { key: string; name: string; emails: string[]; familyId: string; household: string; roles: PersonRole[]; verified: boolean };

/**
 * Everyone who can sign in, grouped into people. A read never writes: older
 * emails with no person yet group the way ensurePeople would place them
 * (unlabeled ones with the account holder, a labeled one on its own).
 * Students' own sign-ins are left out; they never get access.
 */
export async function listPeople(): Promise<PersonRow[]> {
	await dbReady();
	const rows = await db()`
		select e.id, e.email, e.family_id, e.person_id, e.roles, e.is_primary, e.label, e.verified_at is not null as verified,
			coalesce(nullif(p.name, ''), nullif(e.label, ''), case when e.is_primary then nullif(f.name, '') end, '') as name,
			coalesce(nullif(f.household_name, ''), nullif(f.name, ''), '') as household
		from family_emails e join families f on f.id = e.family_id
		left join family_people p on p.id = e.person_id
		where f.merged_into_id is null and e.child_id is null
		order by e.is_primary desc, e.created_at`;
	const holderKey = new Map<string, string>();
	for (const row of rows) if (row.is_primary) holderKey.set(String(row.family_id), row.person_id ? String(row.person_id) : `e:${row.id}`);
	const people = new Map<string, PersonRow & { roleSet: Set<PersonRole> }>();
	for (const row of rows) {
		const familyId = String(row.family_id);
		const key = row.person_id ? String(row.person_id) : (!String(row.label || '').trim() && holderKey.get(familyId)) || `e:${row.id}`;
		let person = people.get(key);
		if (!person) {
			person = { key: String(row.email), name: '', emails: [], familyId, household: String(row.household), roles: [], verified: false, roleSet: new Set() };
			people.set(key, person);
		}
		person.emails.push(String(row.email));
		if (!person.name && row.name) person.name = String(row.name);
		person.verified ||= Boolean(row.verified);
		for (const role of cleanRoles(row.roles)) person.roleSet.add(role);
	}
	return [...people.values()]
		.map(({ roleSet, ...person }) => ({ ...person, roles: PERSON_ROLES.map((item) => item.value).filter((role) => roleSet.has(role)) }))
		.sort((a, b) => Number(b.roles.length > 0) - Number(a.roles.length > 0) || (a.name || a.emails[0]).localeCompare(b.name || b.emails[0]));
}

/** Every sign-in email that belongs to the same person as this one (just this one when it has no person yet). */
export async function personEmails(emailInput: string): Promise<string[]> {
	await dbReady();
	const email = emailInput.trim().toLowerCase();
	const rows = await db()`
		select o.email from family_emails e join family_emails o on o.person_id = e.person_id
		where e.email = ${email} and e.person_id is not null and o.child_id is null`;
	return rows.length ? rows.map((row) => String(row.email)) : [email];
}

/** Super admin rides on Admin: adding it adds Admin; removing Admin removes it. */
const linkedRoles = (role: string, on: boolean): string[] => (on && role === 'super_admin' ? ['super_admin', 'admin'] : !on && role === 'admin' ? ['admin', 'super_admin'] : [role]);
const ownGuard = (role: string, on: boolean) => !on && (role === 'admin' || role === 'super_admin');
const ownGuardError = (role: string) => `You can’t remove your own ${role === 'super_admin' ? 'super admin' : 'admin'} access. Ask another super admin.`;

/**
 * Give or take one kind of access for a person: every sign-in email they have
 * gets the same change. Someone can't remove their own admin access.
 */
export async function setPersonAccess(input: { email: string; role: string; on: boolean; by: string }): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	if (!PERSON_ROLES.some((item) => item.value === input.role)) return { ok: false, error: 'Choose teacher, admin, super admin, finance or developer.' };
	const emails = await personEmails(input.email);
	if (ownGuard(input.role, input.on) && emails.includes(input.by.trim().toLowerCase())) return { ok: false, error: ownGuardError(input.role) };
	const change = linkedRoles(input.role, input.on);
	const rows = await db()`
		update family_emails set roles = case when ${input.on} then array(select distinct unnest(roles || ${change}::text[])) else array(select unnest(roles) except select unnest(${change}::text[])) end
		where email in ${db()(emails)} returning family_id`;
	if (!rows.length) return { ok: false, error: 'No one has signed up with that email yet. They need a portal account first.' };
	return { ok: true };
}

/**
 * Give or take one kind of access for a sign-in email. Someone can't remove
 * their own admin access (so the school is never left without one by accident).
 */
export async function setAccess(input: { email: string; role: string; on: boolean; by: string }): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const email = input.email.trim().toLowerCase();
	if (!PERSON_ROLES.some((item) => item.value === input.role)) return { ok: false, error: 'Choose teacher, admin, super admin, finance or developer.' };
	if (ownGuard(input.role, input.on) && email === input.by.trim().toLowerCase()) return { ok: false, error: ownGuardError(input.role) };
	const change = linkedRoles(input.role, input.on);
	const [row] = await db()`
		update family_emails set roles = case when ${input.on} then array(select distinct unnest(roles || ${change}::text[])) else array(select unnest(roles) except select unnest(${change}::text[])) end
		where email = ${email} returning family_id`;
	if (!row) return { ok: false, error: 'No one has signed up with that email yet. They need a portal account first.' };
	return { ok: true };
}

/**
 * Add someone with the given access by email. If they have no portal account
 * yet, one is made (a household of their own) and they're emailed a sign-in link.
 */
export async function grantAccess(input: { email: string; roles: string[]; by: string }): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
	await dbReady();
	const email = input.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter an email address like name@example.com.' };
	const picked = cleanRoles(input.roles);
	const roles = picked.includes('super_admin') && !picked.includes('admin') ? [...picked, 'admin' as const] : picked;
	if (!roles.length) return { ok: false, error: 'Choose at least one: Teacher, Admin, Super admin, Finance or Developer.' };
	let [row] = await db()`select family_id from family_emails where email = ${email}`;
	let created = false;
	if (!row) {
		const id = randomUUID();
		await db()`insert into families (id, name, email, phone, password_hash, roles) values (${id}, ${''}, ${email}, ${''}, ${''}, ${['prospect']})`;
		await mirrorPrimary(id);
		created = true;
		[row] = await db()`select family_id from family_emails where email = ${email}`;
	}
	// Access is the person's: their other sign-in emails get it too.
	await db()`update family_emails set roles = array(select distinct unnest(roles || ${roles}::text[])) where email in ${db()(await personEmails(email))}`;
	const labels = roles.map((role) => PERSON_ROLES.find((item) => item.value === role)!.label).join(' and ');
	await sendTemplate('access.granted', email, { roles: labels, signin: 'Sign in to see it in the sidebar.', link: portalOrigin() });
	return { ok: true, created };
}

/** For the Teacher section: enrolled students this year with their homeroom, and the signed-in person's name. */
export async function staffRoster(email: string): Promise<{ me: string; students: { id: string; name: string; grade: string; teacher: string; homeroom: string; teacherEmail: string; family: string; email: string }[] }> {
	await dbReady();
	const year = schoolYearOf();
	const [person] = await db()`select coalesce(nullif(p.name, ''), nullif(e.label, ''), nullif(f.name, '')) as name from family_emails e join families f on f.id = e.family_id left join family_people p on p.id = e.person_id where e.email = lower(${email})`;
	const rows = await db()`
		select c.id, c.name, c.grade, c.teacher, coalesce(nullif(f.household_name, ''), f.name) as family, f.email, h.name as homeroom, h.teacher_email,
			(select coalesce(nullif(p.name, ''), nullif(e.label, ''), e.email) from family_emails e left join family_people p on p.id = e.person_id where e.email = h.teacher_email limit 1) as teacher_name
		from children c join families f on f.id = c.family_id
		left join lateral (select cl.name, cl.teacher_email from class_students cs join classes cl on cl.id = cs.class_id where cs.child_id = c.id and cl.school_year = ${year} and cl.kind = 'homeroom' limit 1) h on true
		where c.kind = 'student' and f.merged_into_id is null
			and exists (select 1 from enrollments e where e.child_id = c.id and e.school_year = ${year} and e.status = 'enrolled')
		order by array_position(array['K','1','2','3','4','5','6','7','8','9','10','11','12'], upper(c.grade)), c.name`;
	return { me: String(person?.name || ''), students: rows.map((row) => ({ id: String(row.id), name: String(row.name), grade: String(row.grade || ''), teacher: String(row.teacher_name || row.teacher || ''), homeroom: String(row.homeroom || ''), teacherEmail: String(row.teacher_email || ''), family: String(row.family || ''), email: String(row.email || '') })) };
}
