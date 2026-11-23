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
	{ value: 'staff', label: 'Staff', hint: 'Teachers and school staff: the Staff section' },
	{ value: 'admin', label: 'Admin', hint: 'Runs the school: the Admin section and Staff & access' },
	{ value: 'developer', label: 'Developer', hint: 'The developer console: email previews and copy' },
] as const;
export type PersonRole = (typeof PERSON_ROLES)[number]['value'];
export type FamilyStage = 'visitor' | 'prospective' | 'enrolling' | 'enrolled' | 'former';
export const STAGE_LABELS: Record<FamilyStage, string> = { visitor: 'Visitor', prospective: 'Prospective', enrolling: 'Enrolling', enrolled: 'Enrolled', former: 'Former' };

export type SessionAccess = {
	stage: FamilyStage;
	/** An open application (so Apply stays in the menu even for an enrolled family). */
	applying: boolean;
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
			(select roles from family_emails where email = lower(${email}) and family_id = ${familyId}) as person,
			(select child_id from family_emails where email = lower(${email}) and family_id = ${familyId}) as student`;
	const stage: FamilyStage = row?.enrolled ? 'enrolled' : row?.enrolling ? 'enrolling' : row?.applying || row?.touring ? 'prospective' : row?.former ? 'former' : 'visitor';
	if (row?.student) return { stage, applying: false, person: [], roles: ['student'], studentId: String(row.student) };
	const person = cleanRoles(row?.person);
	return { stage, applying: Boolean(row?.applying), person, roles: [stage === 'enrolled' ? 'guardian' : 'prospect', ...person] };
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

/**
 * Give or take one kind of access for a sign-in email. Someone can't remove
 * their own admin access (so the school is never left without one by accident).
 */
export async function setAccess(input: { email: string; role: string; on: boolean; by: string }): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const email = input.email.trim().toLowerCase();
	if (!PERSON_ROLES.some((item) => item.value === input.role)) return { ok: false, error: 'Choose staff, admin or developer.' };
	if (!input.on && input.role === 'admin' && email === input.by.trim().toLowerCase()) return { ok: false, error: 'You can’t remove your own admin access. Ask another admin.' };
	const [row] = await db()`
		update family_emails set roles = case when ${input.on} then array(select distinct unnest(roles || array[${input.role}]::text[])) else array_remove(roles, ${input.role}) end
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
	const roles = cleanRoles(input.roles);
	if (!roles.length) return { ok: false, error: 'Choose at least one: Staff, Admin or Developer.' };
	let [row] = await db()`select family_id from family_emails where email = ${email}`;
	let created = false;
	if (!row) {
		const id = randomUUID();
		await db()`insert into families (id, name, email, phone, password_hash, roles) values (${id}, ${''}, ${email}, ${''}, ${''}, ${['prospect']})`;
		await mirrorPrimary(id);
		created = true;
		[row] = await db()`select family_id from family_emails where email = ${email}`;
	}
	await db()`update family_emails set roles = array(select distinct unnest(roles || ${roles}::text[])) where email = ${email}`;
	const labels = roles.map((role) => PERSON_ROLES.find((item) => item.value === role)!.label).join(' and ');
	await sendTemplate('access.granted', email, { roles: labels, signin: `Sign in${roles.includes('admin') ? ' with your school email' : ''} to see it in the sidebar.`, link: portalOrigin() });
	return { ok: true, created };
}

/** For the Staff section: enrolled students this year with their homeroom, and the signed-in person's name. */
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
