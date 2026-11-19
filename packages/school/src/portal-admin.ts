import { fieldErrorMessage } from './result.ts';
import type { Result } from './result.ts';
import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { sendEmail } from './email.ts';
import { routeEmail } from './accounts.ts';
import { formatTourWhen, slotTypeLabel, type SlotType, type CapacityUnit } from './prospect.ts';

import { removeSlotOccurrences, skipSeriesDate, deleteSeries } from './schedule-series.ts';
import { notifyCancelledTours } from './prospect.ts';

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
	capacityUnit?: CapacityUnit;
	type?: string;
	published?: boolean;
}): Promise<Result<{}, { fields?: SlotFields }>> {
	await dbReady();
	const fields: SlotFields = {};
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) fields.date = 'Enter a date.';
	if (!/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end) || input.start >= input.end) fields.end = 'End must be after start.';
	const capacity = Number.isInteger(input.capacity) ? input.capacity : 0;
	if (capacity < 1 || capacity > 500) fields.capacity = 'Capacity must be at least 1.';
	if (Object.keys(fields).length) return { ok: false, error: fieldErrorMessage(fields), fields };
	const clash = await db()`
		select id from tour_slots
		where slot_date = ${input.date}::date and start_time = ${input.start} and end_time = ${input.end} and id <> ${input.id}
	`;
	if (clash[0]) return { ok: false, error: 'That time already exists.' };
	await db()`
		update tour_slots
		set slot_date = ${input.date}::date, start_time = ${input.start}, end_time = ${input.end},
			capacity = ${capacity}, capacity_unit = ${input.capacityUnit === 'families' ? 'families' : 'people'}, slot_type = ${slotType(input.type ?? 'tour')}, published = ${input.published !== false}
		where id = ${input.id}
	`;
	return { ok: true };
}

export async function deleteTourSlot(id: string): Promise<Result<{ notified: number }>> {
	await dbReady();
	const [slot] = await db()`select series_id, slot_date::text from tour_slots where id = ${id}`;
	if (!slot) return { ok: false, error: 'That time is already gone.' };
	if (slot.series_id) {
		const result = await skipTourSeriesDate(String(slot.series_id), String(slot.slot_date));
		return result.ok ? { ok: true, notified: result.notified ?? 0 } : { ok: false, error: result.error! };
	}
	const holds = await db().begin(async tx => {
		if (!(await tx`select id from tour_slots where id = ${id} for update`)[0]) return null;
		return removeSlotOccurrences(tx as unknown as ReturnType<typeof db>, [id]);
	});
	if (!holds) return { ok: false, error: 'That time is already gone.' };
	await notifyCancelledTours(holds);
	return { ok: true, notified: holds.length };
}

export async function replyToTourRequest(input: {
	id: string;
	date: string;
	start: string;
	end: string;
	mode: 'confirmed' | 'proposed';
	message: string;
}): Promise<Result<{}, { fields?: SlotFields }>> {
	await dbReady();
	const fields: SlotFields = {};
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) fields.date = 'Enter a date.';
	if (!/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end) || input.start >= input.end) fields.end = 'End must be after start.';
	if (Object.keys(fields).length) return { ok: false, error: fieldErrorMessage(fields, { plural: true }), fields };
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
	const confirmed = await confirmRequestedTime({ id: input.id, familyId: String(hold.family_id), headCount: Number(hold.head_count), date: input.date, start: input.start, end: input.end, message });
	if (!confirmed.ok) return confirmed;
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

export async function acceptProposedHold(id: string, familyId: string): Promise<Result> {
	await dbReady();
	const rows = await db()`
		select id, head_count, proposed_date::text as proposed_date, proposed_start, proposed_end, family_name, email
		from tour_holds
		where id = ${id} and family_id = ${familyId} and status = 'proposed'
	`;
	const hold = rows[0];
	if (!hold?.proposed_date) return { ok: false, error: 'That proposal is no longer open.' };
	return confirmRequestedTime({ id, familyId, headCount: Number(hold.head_count), date: String(hold.proposed_date), start: String(hold.proposed_start), end: String(hold.proposed_end) });
}

/** Replies and accepted proposals obey the same slot lock and capacity as bookings. */
async function confirmRequestedTime(input: { id: string; familyId: string; headCount: number; date: string; start: string; end: string; message?: string }): Promise<Result> {
	return await db().begin(async tx => {
		// Serialize creation at a requested time; a rule may also occupy the unique time key.
		await tx`select pg_advisory_xact_lock(hashtext(${`tour-time:${input.date}:${input.start}:${input.end}`}))`;
		await tx`insert into tour_slots (id, slot_date, start_time, end_time, capacity, capacity_unit, slot_type, published)
			values (${randomUUID()}, ${input.date}::date, ${input.start}, ${input.end}, 1, 'families', 'tour', true)
			on conflict (slot_date, start_time, end_time) do nothing`;
		const [found] = await tx`select id from tour_slots where slot_date = ${input.date}::date and start_time = ${input.start} and end_time = ${input.end}`;
		if (!found) return { ok: false as const, error: 'That time is already gone.' };
		const slotId = String(found.id);
		await tx`select pg_advisory_xact_lock(hashtext(${slotId}))`;
		const [slot] = await tx`select s.capacity, s.capacity_unit,
			(select case when s.capacity_unit = 'families' then count(distinct h.family_id) else coalesce(sum(h.head_count),0) end
			 from tour_holds h where h.slot_id = s.id and h.kind = 'slot' and h.status <> 'cancelled' and h.family_id <> ${input.familyId})::int as taken
			from tour_slots s where s.id = ${slotId} for update of s`;
		if (!slot || Number(slot.taken) + (slot.capacity_unit === 'families' ? 1 : input.headCount) > Number(slot.capacity)) return { ok: false as const, error: 'That time is full.' };
		const rows = await tx`update tour_holds set kind = 'slot', slot_id = ${slotId}, status = 'confirmed', reply_message = coalesce(${input.message ?? null}, reply_message)
			where id = ${input.id} and family_id = ${input.familyId} and kind = 'other' and status <> 'cancelled' returning id`;
		return rows.length ? { ok: true as const } : { ok: false as const, error: 'That request is no longer open.' };
	});
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
	await db()`delete from prospect_children where family_id = ${input.familyId}`;
	if (kept.length) {
		const rows = kept.map((child, position) => ({
			id: randomUUID(), family_id: input.familyId, first_name: child.firstName,
			grade: child.grade, school_year: child.schoolYear, position,
		}));
		await db()`insert into prospect_children ${db()(rows)}`;
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

export async function saveStudent(input: { familyId: string; id?: string; name: string; grade: string; teacher: string }): Promise<Result<{ id: string }>> {
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

export async function skipTourSeriesDate(id: string, date: string, restore = false) {
	const result = await skipSeriesDate(id, date, restore);
	if (result.ok && result.cancelledHolds) await notifyCancelledTours(result.cancelledHolds);
	return { ...result, notified: result.ok ? result.cancelledHolds.length : 0 };
}
export async function deleteTourSeries(id: string) {
	const result = await deleteSeries(id);
	if (result.ok && result.cancelledHolds) await notifyCancelledTours(result.cancelledHolds);
	return result;
}
