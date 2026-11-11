import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { sendEmail } from './email.ts';
import { routeEmail } from './accounts.ts';
import { formatTourWhen, slotTypeLabel, type SlotType } from './prospect.ts';

const CAMPUS = '7160 Cahaba Valley Rd., Birmingham, AL 35242';

export type SlotFields = { date?: string; end?: string; capacity?: string };

function slotType(value: string): SlotType {
	return value === 'open_house' || value === 'info_night' ? value : 'tour';
}

export async function updateTourSlot(input: {
	id: string;
	date: string;
	start: string;
	end: string;
	capacity: number;
	type?: string;
	published?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string; fields?: SlotFields }> {
	await dbReady();
	const fields: SlotFields = {};
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) fields.date = 'Enter a date.';
	if (!/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end) || input.start >= input.end) fields.end = 'End must be after start.';
	const capacity = Number.isInteger(input.capacity) ? input.capacity : 0;
	if (capacity < 1 || capacity > 500) fields.capacity = 'Capacity must be at least 1.';
	if (Object.keys(fields).length) return { ok: false, error: `Fix ${Object.keys(fields).length} ${Object.keys(fields).length === 1 ? 'field' : 'fields'} to save.`, fields };
	const clash = await db()`
		select id from tour_slots
		where slot_date = ${input.date}::date and start_time = ${input.start} and end_time = ${input.end} and id <> ${input.id}
	`;
	if (clash[0]) return { ok: false, error: 'That time already exists.' };
	await db()`
		update tour_slots
		set slot_date = ${input.date}::date, start_time = ${input.start}, end_time = ${input.end},
			capacity = ${capacity}, slot_type = ${slotType(input.type ?? 'tour')}, published = ${input.published !== false}
		where id = ${input.id}
	`;
	return { ok: true };
}

export async function deleteTourSlot(id: string): Promise<{ ok: true; notified: number } | { ok: false; error: string }> {
	await dbReady();
	const holds = await db()`
		select h.family_id, h.family_name, h.email, s.slot_date::text as slot_date, s.start_time, s.end_time
		from tour_holds h
		join tour_slots s on s.id = h.slot_id
		where h.slot_id = ${id} and h.status <> 'cancelled'
	`;
	await db()`update tour_holds set status = 'cancelled' where slot_id = ${id} and status <> 'cancelled'`;
	const removed = await db()`delete from tour_slots where id = ${id} returning id`;
	if (!removed[0]) return { ok: false, error: 'That time is already gone.' };
	let notified = 0;
	for (const hold of holds) {
		const when = formatTourWhen(String(hold.slot_date), String(hold.start_time), String(hold.end_time));
		const to = await routeEmail(String(hold.family_id), 'tours', String(hold.email));
		await sendEmail({
			to,
			subject: 'A Trinity tour time was cancelled',
			text: `Hello ${hold.family_name},\n\nThe school cancelled the tour on ${when}. Please pick another time in the TCA Portal.\n${CAMPUS}\n`,
		});
		notified += 1;
	}
	return { ok: true, notified };
}

export async function replyToTourRequest(input: {
	id: string;
	date: string;
	start: string;
	end: string;
	mode: 'confirmed' | 'proposed';
	message: string;
}): Promise<{ ok: true } | { ok: false; error: string; fields?: SlotFields }> {
	await dbReady();
	const fields: SlotFields = {};
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) fields.date = 'Enter a date.';
	if (!/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end) || input.start >= input.end) fields.end = 'End must be after start.';
	if (Object.keys(fields).length) return { ok: false, error: `Fix ${Object.keys(fields).length} fields to save.`, fields };
	const rows = await db()`select id, family_id, family_name, email, head_count from tour_holds where id = ${input.id} and kind = 'other' and status <> 'cancelled'`;
	const hold = rows[0];
	if (!hold) return { ok: false, error: 'That request is no longer open.' };
	const when = formatTourWhen(input.date, input.start, input.end);
	const message = input.message.trim().slice(0, 1000);
	if (input.mode === 'proposed') {
		await db()`
			update tour_holds
			set status = 'proposed', proposed_date = ${input.date}::date, proposed_start = ${input.start}, proposed_end = ${input.end}, reply_message = ${message}
			where id = ${input.id}
		`;
		await sendEmail({
			to: await routeEmail(String(hold.family_id), 'tours', String(hold.email)),
			subject: 'A tour time to confirm',
			text: `Hello ${hold.family_name},\n\nThe school proposed ${when}.${message ? `\n\n${message}` : ''}\n\nOpen the TCA Portal to accept or decline.\n`,
		});
		return { ok: true };
	}
	const existing = await db()`
		select id from tour_slots where slot_date = ${input.date}::date and start_time = ${input.start} and end_time = ${input.end}
	`;
	const slotId = existing[0] ? String(existing[0].id) : randomUUID();
	if (!existing[0]) {
		await db()`
			insert into tour_slots (id, slot_date, start_time, end_time, capacity, slot_type, published)
			values (${slotId}, ${input.date}::date, ${input.start}, ${input.end}, ${Math.max(12, Number(hold.head_count) || 1)}, 'tour', true)
		`;
	}
	await db()`
		update tour_holds
		set kind = 'slot', slot_id = ${slotId}, status = 'confirmed', reply_message = ${message}
		where id = ${input.id}
	`;
	await sendEmail({
		to: await routeEmail(String(hold.family_id), 'tours', String(hold.email)),
		subject: 'Your Trinity tour is confirmed',
		text: `Hello ${hold.family_name},\n\nYour visit is confirmed for ${when}.${message ? `\n\n${message}` : ''}\n${CAMPUS}\n`,
	});
	return { ok: true };
}

export async function declineTourRequest(id: string): Promise<boolean> {
	await dbReady();
	const rows = await db()`
		update tour_holds set status = 'cancelled'
		where id = ${id} and kind = 'other' and status <> 'cancelled'
		returning family_id, family_name, email, other_time
	`;
	const row = rows[0];
	if (!row) return false;
	await sendEmail({
		to: await routeEmail(String(row.family_id), 'tours', String(row.email)),
		subject: 'About your tour time request',
		text: `Hello ${row.family_name},\n\nWe can’t offer ${row.other_time || 'that time'}. Please pick another time in the TCA Portal, or reply to this email.\n`,
	});
	return true;
}

export async function acceptProposedHold(id: string, familyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const rows = await db()`
		select id, head_count, proposed_date::text as proposed_date, proposed_start, proposed_end, family_name, email
		from tour_holds
		where id = ${id} and family_id = ${familyId} and status = 'proposed'
	`;
	const hold = rows[0];
	if (!hold?.proposed_date) return { ok: false, error: 'That proposal is no longer open.' };
	const existing = await db()`
		select id from tour_slots
		where slot_date = ${hold.proposed_date}::date and start_time = ${hold.proposed_start} and end_time = ${hold.proposed_end}
	`;
	const slotId = existing[0] ? String(existing[0].id) : randomUUID();
	if (!existing[0]) {
		await db()`
			insert into tour_slots (id, slot_date, start_time, end_time, capacity, slot_type, published)
			values (${slotId}, ${hold.proposed_date}::date, ${hold.proposed_start}, ${hold.proposed_end}, ${Math.max(12, Number(hold.head_count) || 1)}, 'tour', true)
		`;
	}
	await db()`update tour_holds set kind = 'slot', slot_id = ${slotId}, status = 'confirmed' where id = ${id}`;
	return { ok: true };
}

export type ProspectChild = { id: string; firstName: string; grade: string; schoolYear: string };

export async function listProspectChildren(familyId: string): Promise<{ children: ProspectChild[]; note: string }> {
	await dbReady();
	const rows = await db()`
		select id, first_name, grade, school_year from prospect_children where family_id = ${familyId} order by position, first_name
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
}): Promise<{ ok: true } | { ok: false; error: string; row?: number }> {
	await dbReady();
	const clean = input.children.map((child) => ({
		firstName: child.firstName.trim().slice(0, 80),
		grade: child.grade.trim().slice(0, 20),
		schoolYear: child.schoolYear.trim().slice(0, 20),
	}));
	const empty = clean.findIndex((child) => !child.firstName && (child.grade || child.schoolYear));
	if (empty >= 0) return { ok: false, error: 'Add a first name or remove the empty row.', row: empty };
	const kept = clean.filter((child) => child.firstName);
	await db()`delete from prospect_children where family_id = ${input.familyId}`;
	for (const [position, child] of kept.entries()) {
		await db()`
			insert into prospect_children (id, family_id, first_name, grade, school_year, position)
			values (${randomUUID()}, ${input.familyId}, ${child.firstName}, ${child.grade}, ${child.schoolYear}, ${position})
		`;
	}
	await db()`update families set family_note = ${input.note.trim().slice(0, 2000)} where id = ${input.familyId}`;
	return { ok: true };
}

export async function saveStaffNote(familyId: string, note: string): Promise<void> {
	await dbReady();
	await db()`update families set staff_note = ${note.trim().slice(0, 4000)} where id = ${familyId}`;
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
}): Promise<{ ok: true; id: string; mailed: number } | { ok: false; error: string }> {
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
			select f.id, r.email
			from families f
			join notification_routes r on r.family_id = f.id and r.category = 'announcements'
			where 'guardian' = any(f.roles)
		`;
		for (const guardian of guardians) {
			await sendEmail({
				to: String(guardian.email),
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

export async function saveStudent(input: { familyId: string; id?: string; name: string; grade: string; teacher: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
	await dbReady();
	const name = input.name.trim().slice(0, 160);
	if (name.length < 2) return { ok: false, error: 'Enter a first and last name.' };
	const grade = input.grade.trim().slice(0, 20);
	const teacher = input.teacher.trim().slice(0, 80);
	if (input.id) {
		await db()`update students set name = ${name}, grade = ${grade}, teacher = ${teacher} where id = ${input.id} and family_id = ${input.familyId}`;
		return { ok: true, id: input.id };
	}
	const id = randomUUID();
	await db()`insert into students (id, family_id, name, grade, teacher) values (${id}, ${input.familyId}, ${name}, ${grade}, ${teacher})`;
	return { ok: true, id };
}

export async function removeStudent(id: string, familyId: string): Promise<void> {
	await dbReady();
	await db()`delete from students where id = ${id} and family_id = ${familyId}`;
}

export async function addGuardianEmail(input: { familyId: string; email: string; label: string }): Promise<{ ok: true } | { ok: false; error: string }> {
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
