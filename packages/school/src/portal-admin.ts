import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { sendEmail } from './email.ts';
import { routeEmail } from './accounts.ts';
import type { Result } from './result.ts';
import { slotTypeLabel } from './tours/model.ts';
export { updateTourSlot, deleteTourSlot, skipTourSeriesDate, deleteTourSeries, type SlotFields } from './tours/slots.ts';
export { replyToTourRequest, declineTourRequest, acceptProposedHold } from './tours/requests.ts';

export type ProspectChild = { id: string; firstName: string; grade: string; schoolYear: string };

export async function listProspectChildren(familyId: string): Promise<{ children: ProspectChild[]; note: string }> {
	await dbReady();
	const rows = await db()`
		select id, name as first_name, grade, school_year from children where kind = 'prospective' and family_id = ${familyId} order by position, name
	`;
	const notes = await db()`select family_note from families where id = ${familyId}`;
	return {
		children: rows.map((row) => ({
			id: String(row.id),
			firstName: String(row.first_name),
			grade: String(row.grade),
			schoolYear: String(row.school_year),
		})),
		note: String(notes[0]?.family_note ?? ''),
	};
}

export async function saveProspectChildren(input: {
	familyId: string;
	children: { firstName: string; grade: string; schoolYear: string }[];
	note: string;
}): Promise<Result<{}, { row?: number }>> {
	await dbReady();
	const clean = input.children.map((child) => ({
		firstName: child.firstName.trim().slice(0, 80),
		grade: child.grade.trim().slice(0, 20),
		schoolYear: child.schoolYear.trim().slice(0, 20),
	}));
	const empty = clean.findIndex((child) => !child.firstName && (child.grade || child.schoolYear));
	if (empty >= 0) return { ok: false, error: 'Add a first name or remove the empty row.', row: empty };
	const kept = clean.filter((child) => child.firstName);
	await db()`delete from children where kind = 'prospective' and family_id = ${input.familyId}`;
	if (kept.length) {
		const rows = kept.map((child, position) => ({
			id: randomUUID(), family_id: input.familyId, kind: 'prospective', name: child.firstName,
			grade: child.grade, school_year: child.schoolYear, position,
		}));
		await db()`insert into children ${db()(rows)}`;
	}
	await db()`update families set family_note = ${input.note.trim().slice(0, 2000)} where id = ${input.familyId}`;
	return { ok: true };
}

export async function saveStaffNote(familyId: string, note: string): Promise<void> {
	await dbReady();
	await db()`update families set staff_note = ${note.trim().slice(0, 4000)} where id = ${familyId}`;
}

/** Staff-editable household name; blank falls back to the account holder's name. */
export async function saveHouseholdName(familyId: string, name: string): Promise<void> {
	await dbReady();
	await db()`update families set household_name = ${name.replace(/\s+/g, ' ').trim().slice(0, 120)} where id = ${familyId}`;
}

export async function readHouseholdName(familyId: string): Promise<string> {
	await dbReady();
	const rows = await db()`select household_name from families where id = ${familyId}`;
	return String(rows[0]?.household_name ?? '');
}

export async function readStaffNote(familyId: string): Promise<string> {
	await dbReady();
	const rows = await db()`select staff_note from families where id = ${familyId}`;
	return String(rows[0]?.staff_note ?? '');
}

export type AnnouncementRow = {
	id: string;
	title: string;
	body: string;
	audience: string;
	status: string;
	emailed: boolean;
	sentAt: string;
	createdAt: string;
};

export async function listAdminAnnouncements(): Promise<AnnouncementRow[]> {
	await dbReady();
	const rows = await db()`
		select id, title, body, audience, status, emailed, sent_at, created_at
		from announcements order by created_at desc
	`;
	return rows.map((row) => ({
		id: String(row.id),
		title: String(row.title),
		body: String(row.body ?? ''),
		audience: String(row.audience || 'all'),
		status: String(row.status || 'sent'),
		emailed: Boolean(row.emailed),
		sentAt: row.sent_at ? new Date(row.sent_at as string | Date).toISOString() : '',
		createdAt: row.created_at ? new Date(row.created_at as string | Date).toISOString() : '',
	}));
}

function audienceLabel(audience: string): string {
	if (audience === 'grammar') return 'Grammar school (K–6)';
	if (audience === 'upper') return 'Upper school (7–8)';
	if (audience.startsWith('grade:')) return `Grade ${audience.slice(6)}`;
	return 'All guardians';
}

export async function saveAnnouncement(input: {
	id?: string;
	title: string;
	body: string;
	audience: string;
	emailIt: boolean;
	publish: boolean;
}): Promise<Result<{ id: string; mailed: number }>> {
	await dbReady();
	const title = input.title.trim().slice(0, 160);
	const body = input.body.trim().slice(0, 8000);
	if (!title) return { ok: false, error: 'Add a title.' };
	if (!body) return { ok: false, error: 'Add a message.' };
	const audience = ['all', 'grammar', 'upper'].includes(input.audience) || input.audience.startsWith('grade:') ? input.audience : 'all';
	const id = input.id || randomUUID();
	const status = input.publish ? 'sent' : 'draft';
	const sentAt = input.publish ? new Date().toISOString() : null;
	if (input.id) {
		await db()`
			update announcements
			set title = ${title}, body = ${body}, audience = ${audience}, status = ${status},
				emailed = ${input.publish && input.emailIt}, sent_at = coalesce(${sentAt}::timestamptz, sent_at)
			where id = ${id}
		`;
	} else {
		await db()`
			insert into announcements (id, title, body, audience, status, emailed, sent_at)
			values (${id}, ${title}, ${body}, ${audience}, ${status}, ${input.publish && input.emailIt}, ${sentAt}::timestamptz)
		`;
	}
	let mailed = 0;
	if (input.publish && input.emailIt) {
		const guardians = await db()`
			select f.id, f.email from families f where 'guardian' = any(f.roles) and f.merged_into_id is null
		`;
		for (const guardian of guardians) {
			await sendEmail({
				to: await routeEmail(String(guardian.id), 'announcements', String(guardian.email)),
				subject: title,
				text: `${body}\n\n${audienceLabel(audience)}\n`,
			});
			mailed += 1;
		}
	}
	return { ok: true, id, mailed };
}

export async function deleteAnnouncement(id: string): Promise<void> {
	await dbReady();
	await db()`delete from announcements where id = ${id} and status = 'draft'`;
}

export async function saveStudent(input: { familyId: string; id?: string; name: string; grade: string; teacher: string }): Promise<Result<{ id: string }>> {
	await dbReady();
	const name = input.name.trim().slice(0, 160);
	if (name.length < 2) return { ok: false, error: 'Enter a first and last name.' };
	const grade = input.grade.trim().slice(0, 20);
	const teacher = input.teacher.trim().slice(0, 80);
	if (input.id) {
		await db()`update children set name = ${name}, grade = ${grade}, teacher = ${teacher} where id = ${input.id} and family_id = ${input.familyId}`;
		return { ok: true, id: input.id };
	}
	const id = randomUUID();
	await db()`insert into children (id, family_id, kind, name, grade, teacher) values (${id}, ${input.familyId}, 'student', ${name}, ${grade}, ${teacher})`;
	// A student added by staff is enrolled for the current school year.
	await db()`insert into enrollments (id, child_id, school_year, grade, status) values (${randomUUID()}, ${id}, school_year_of((now() at time zone 'America/Chicago')::date), ${grade}, 'enrolled') on conflict (child_id, school_year) do nothing`;
	return { ok: true, id };
}

export async function removeStudent(id: string, familyId: string): Promise<void> {
	await dbReady();
	await db()`delete from children where id = ${id} and family_id = ${familyId}`;
}

export async function addGuardianEmail(input: { familyId: string; email: string; label: string }): Promise<Result> {
	await dbReady();
	const email = input.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter an email address like name@example.com.' };
	const taken = await db()`select id from family_emails where email = ${email}`;
	if (taken[0]) return { ok: false, error: 'That email is already on an account.' };
	await db()`
		insert into family_emails (id, family_id, email, is_primary, label)
		values (${randomUUID()}, ${input.familyId}, ${email}, false, ${input.label.trim().slice(0, 160)})
	`;
	return { ok: true };
}

export async function listUpdateSignups(): Promise<{ email: string; createdAt: string; source: string }[]> {
	await dbReady();
	const rows = await db()`select email, created_at, source from updates_list order by created_at desc`;
	return rows.map((row) => ({
		email: String(row.email),
		createdAt: row.created_at ? new Date(row.created_at as string | Date).toISOString() : '',
		source: String(row.source ?? ''),
	}));
}

export function audienceText(audience: string): string {
	return audienceLabel(audience);
}

export function slotLabel(type: string): string {
	return slotTypeLabel(type);
}
