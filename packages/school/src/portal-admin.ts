import { randomUUID } from 'node:crypto';
import { renderEmail, sendTemplate } from './email-catalog.ts';
import { richTextToPlain, sanitizeRichText } from './rich-text.ts';
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
	inPortal: boolean;
	mailed: number;
	signOff: string;
	signedBy: string;
	sentAt: string;
	createdAt: string;
};

export async function listAdminAnnouncements(): Promise<AnnouncementRow[]> {
	await dbReady();
	const rows = await db()`
		select id, title, body, audience, status, emailed, in_portal, mailed, sign_off, signed_by, sent_at, created_at
		from announcements order by created_at desc
	`;
	return rows.map((row) => ({
		id: String(row.id),
		title: String(row.title),
		body: String(row.body ?? ''),
		audience: String(row.audience || 'all'),
		status: String(row.status || 'sent'),
		emailed: Boolean(row.emailed),
		inPortal: row.in_portal !== false,
		mailed: Number(row.mailed || 0),
		signOff: String(row.sign_off || 'Warmly,'),
		signedBy: String(row.signed_by || 'Trinity Classical Academy'),
		sentAt: row.sent_at ? new Date(row.sent_at as string | Date).toISOString() : '',
		createdAt: row.created_at ? new Date(row.created_at as string | Date).toISOString() : '',
	}));
}

/** Who an announcement can go to. Enrolled families by default; prospective families and everyone for newsletters. */
export const ANNOUNCEMENT_AUDIENCES = [
	{ value: 'all', label: 'All enrolled families' },
	{ value: 'grammar', label: 'Grammar school (K–6)' },
	{ value: 'upper', label: 'Upper school (7–8)' },
	...['K', '1', '2', '3', '4', '5', '6', '7', '8'].map((grade) => ({ value: `grade:${grade}`, label: grade === 'K' ? 'Kindergarten families' : `Grade ${grade} families` })),
	{ value: 'prospective', label: 'Prospective families' },
	{ value: 'everyone', label: 'Everyone with an account' },
];
export function audienceLabel(audience: string): string {
	return ANNOUNCEMENT_AUDIENCES.find((item) => item.value === audience)?.label ?? 'All enrolled families';
}

/** Households an announcement email goes to, by audience (enrolled = a child enrolled this year or next). */
export async function announcementRecipients(audience: string): Promise<{ id: string; email: string }[]> {
	await dbReady();
	const { schoolYearOf, shiftSchoolYear } = await import('./applications.ts');
	const current = schoolYearOf(), next = shiftSchoolYear(current, 1);
	const grades = audience === 'grammar' ? ['K', '1', '2', '3', '4', '5', '6'] : audience === 'upper' ? ['7', '8'] : audience.startsWith('grade:') ? [audience.slice(6)] : null;
	const rows = await db()`
		select f.id, f.email from families f
		where f.merged_into_id is null and f.email <> ''
			and case
				when ${audience} = 'everyone' then true
				when ${audience} = 'prospective' then not exists (select 1 from enrollments e join children c on c.id = e.child_id where c.family_id = f.id and e.status = 'enrolled' and e.school_year in (${current}, ${next}))
				else exists (select 1 from enrollments e join children c on c.id = e.child_id where c.family_id = f.id and e.status = 'enrolled' and e.school_year = ${current}
					and (${grades}::text[] is null or upper(e.grade) = any(${grades}::text[])))
			end`;
	return rows.map((row) => ({ id: String(row.id), email: String(row.email) }));
}

export async function saveAnnouncement(input: {
	id?: string;
	title: string;
	body: string;
	audience: string;
	emailIt: boolean;
	publish: boolean;
	/** Show it on the family Announcements page (false = email only). */
	inPortal?: boolean;
	signOff?: string;
	signedBy?: string;
}): Promise<Result<{ id: string; mailed: number }>> {
	await dbReady();
	const title = input.title.trim().slice(0, 160);
	// The body is a little rich text (bold, italic, underline, lists), sanitized here.
	const body = sanitizeRichText(input.body.slice(0, 20000));
	if (!title) return { ok: false, error: 'Add a title.' };
	if (!richTextToPlain(body)) return { ok: false, error: 'Add a message.' };
	const audience = ANNOUNCEMENT_AUDIENCES.some((item) => item.value === input.audience) ? input.audience : 'all';
	const inPortal = input.inPortal !== false;
	const signOff = (input.signOff ?? '').trim().slice(0, 80) || 'Warmly,';
	const signedBy = (input.signedBy ?? '').trim().slice(0, 200) || 'Trinity Classical Academy';
	if (!inPortal && !input.emailIt) return { ok: false, error: 'Choose where it goes: the portal, email, or both.' };
	const id = input.id || randomUUID();
	const status = input.publish ? 'sent' : 'draft';
	const sentAt = input.publish ? new Date().toISOString() : null;
	if (input.id) {
		await db()`
			update announcements
			set title = ${title}, body = ${body}, audience = ${audience}, status = ${status}, in_portal = ${inPortal}, sign_off = ${signOff}, signed_by = ${signedBy},
				emailed = ${input.emailIt}, sent_at = coalesce(${sentAt}::timestamptz, sent_at)
			where id = ${id}
		`;
	} else {
		await db()`
			insert into announcements (id, title, body, audience, status, emailed, in_portal, sign_off, signed_by, sent_at)
			values (${id}, ${title}, ${body}, ${audience}, ${status}, ${input.emailIt}, ${inPortal}, ${signOff}, ${signedBy}, ${sentAt}::timestamptz)
		`;
	}
	let mailed = 0;
	if (input.publish && input.emailIt) {
		const guardians = await announcementRecipients(audience);
		for (const guardian of guardians) {
			await sendTemplate('announcement', await routeEmail(String(guardian.id), 'announcements', String(guardian.email)), { title, body: richTextToPlain(body), bodyHtml: body, signoff: signOff, signer: signedBy });
			mailed += 1;
		}
	}
	if (mailed) await db()`update announcements set mailed = ${mailed} where id = ${id}`;
	return { ok: true, id, mailed };
}

/** The email an announcement would send, for the composer's Email preview. */
export async function announcementEmailPreview(input: { title: string; body: string; signOff?: string; signedBy?: string }) {
	const html = sanitizeRichText(input.body || '');
	return renderEmail('announcement', { title: input.title || 'Untitled', body: richTextToPlain(html) || ' ', bodyHtml: html, signoff: input.signOff || 'Warmly,', signer: input.signedBy || 'Trinity Classical Academy' });
}

/** Email a draft to chosen admins to look over. Nothing is published. */
export async function sendAnnouncementPreview(input: { title: string; body: string; signOff?: string; signedBy?: string; to: string[]; by: string }): Promise<number> {
	const email = await announcementEmailPreview(input);
	for (const address of input.to) {
		await sendEmail({ to: address, subject: `[Preview] ${email.subject}`, text: `Preview from ${input.by}. Not sent to families yet.\n\n${email.text}`, html: email.html });
	}
	return input.to.length;
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

/** Removed families (soft delete): account id or lowercase email → when it was removed. */
export async function listHiddenFamilies(): Promise<Map<string, string>> {
	await dbReady();
	const rows = await db()`select key, hidden_at from family_hidden`;
	return new Map(rows.map((row) => [String(row.key), new Date(row.hidden_at as string | Date).toISOString()]));
}

/** Hide families from the Families list until they do something new. Keys: account ids and emails. */
export async function hideFamilies(keys: string[], by: string): Promise<number> {
	const clean = [...new Set(keys.map((key) => key.trim().toLowerCase()).filter(Boolean))];
	if (!clean.length) return 0;
	await dbReady();
	await db()`insert into family_hidden (key, hidden_by) select unnest(${clean}::text[]), ${by.slice(0, 254)}
		on conflict (key) do update set hidden_at = now(), hidden_by = excluded.hidden_by`;
	return clean.length;
}

export function audienceText(audience: string): string {
	return audienceLabel(audience);
}

export function slotLabel(type: string): string {
	return slotTypeLabel(type);
}
