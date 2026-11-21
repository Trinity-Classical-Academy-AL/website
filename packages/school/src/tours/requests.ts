import { CAMPUS } from '../campus.ts';
import { sendTemplate } from '../email-catalog.ts';
import { reserve, type ReservationParty } from '../scheduling/reserve.ts';
import { cancelHolds } from '../scheduling/cancel.ts';
import { chicagoToday } from '../scheduling/schedule-series.ts';
import type { Result } from '../result.ts';
import { randomUUID } from 'node:crypto';
import { db, dbReady, type Sql } from '../db.ts';
import { fieldErrorMessage } from '../result.ts';
import { sendEmail, notifyStaff } from '../email.ts';
import { routeEmail } from '../accounts.ts';
import { cleanGrades, clip } from '../contact-input.ts';
import { formatTourWhen } from './model.ts';
import type { SlotFields } from './slots.ts';

export async function requestOtherTourTime(input: {
	familyId: string;
	familyName: string;
	email: string;
	phone: string;
	otherTime: string;
	grades: string[];
	note: string;
	days?: string[];
	dayParts?: string[];
	earliest?: string;
	headCount?: number;
}): Promise<Result> {
	await dbReady();
	const days = (input.days ?? []).filter((day) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(day));
	const dayParts = (input.dayParts ?? []).filter((part) => ['Morning', 'Midday', 'Afternoon'].includes(part));
	const earliest = /^\d{4}-\d{2}-\d{2}$/.test(input.earliest ?? '') ? input.earliest! : null;
	const headCount = Math.max(1, Math.trunc(input.headCount ?? 1) || 1);
	const composed = [days.join(', '), dayParts.join(', '), earliest ? `after ${earliest}` : ''].filter(Boolean).join(' · ');
	const otherTime = clip(input.otherTime || composed, 500);
	if (otherTime.length < 3 && days.length === 0 && dayParts.length === 0) return { ok: false, error: 'Choose a time to continue.' };
	const grades = cleanGrades(input.grades);
	const note = clip(input.note, 2000);
	const phone = clip(input.phone, 40);
	const name = clip(input.familyName, 160) || input.email;
	await db()`
		insert into tour_holds (id, family_id, kind, status, family_name, email, phone, grades, note, other_time, head_count, days, day_parts, earliest_date)
		values (${randomUUID()}, ${input.familyId}, 'other', 'new', ${name}, ${input.email}, ${phone}, ${grades}, ${note}, ${otherTime || composed}, ${headCount}, ${days}, ${dayParts}, ${earliest})
	`;
	await sendTemplate('tour.request-received', await routeEmail(input.familyId, 'tours', input.email), { name, time: otherTime || composed, campus: CAMPUS });
	await notifyStaff('Different tour time', `${name} (${input.email}${phone ? `, ${phone}` : ''}) asked for another time: ${otherTime}.${grades.length ? `\nGrades: ${grades.join(', ')}` : ''}${note ? `\nNote: ${note}` : ''}`);
	return { ok: true };
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
	const rows = await db()`select id, family_id, family_name, email, phone, head_count, grades, note from tour_holds where id = ${input.id} and kind = 'other' and status <> 'cancelled'`;
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
		await sendTemplate('tour.proposed', await routeEmail(String(hold.family_id), 'tours', String(hold.email)), { name: String(hold.family_name), when, message });
		return { ok: true };
	}
	const confirmed = await confirmRequestedTime({ id: input.id, party: requestParty(hold), date: input.date, start: input.start, end: input.end, message });
	if (!confirmed.ok) return confirmed;
	await sendTemplate('tour.confirmed', await routeEmail(String(hold.family_id), 'tours', String(hold.email)), { name: String(hold.family_name), when, message, campus: CAMPUS });
	return { ok: true };
}

export async function declineTourRequest(id: string): Promise<boolean> {
	await dbReady();
	const rows = await cancelHolds(db(), { id, kind: 'other' });
	const row = rows[0];
	if (!row) return false;
	await sendTemplate('tour.declined', await routeEmail(String(row.family_id), 'tours', String(row.email)), { name: String(row.family_name), time: String(row.other_time || 'that time') });
	return true;
}

export async function acceptProposedHold(id: string, familyId: string): Promise<Result> {
	await dbReady();
	const rows = await db()`
		select id, family_id, family_name, email, phone, head_count, grades, note, proposed_date::text as proposed_date, proposed_start, proposed_end
		from tour_holds
		where id = ${id} and family_id = ${familyId} and status = 'proposed'
	`;
	const hold = rows[0];
	if (!hold?.proposed_date) return { ok: false, error: 'That proposal is no longer open.' };
	return confirmRequestedTime({ id, party: requestParty(hold), date: String(hold.proposed_date), start: String(hold.proposed_start), end: String(hold.proposed_end) });
}

/** Replies and accepted proposals obey the same slot lock and capacity as bookings. */
async function confirmRequestedTime(input: { id: string; party: ReservationParty; date: string; start: string; end: string; message?: string }): Promise<Result> {
	return await db().begin(async tx => {
		// Serialize creation at a requested time; a rule may also occupy the unique time key.
		await tx`select pg_advisory_xact_lock(hashtext(${`tour-time:${input.date}:${input.start}:${input.end}`}))`;
		await tx`insert into tour_slots (id, slot_date, start_time, end_time, capacity, capacity_unit, slot_type, published)
			values (${randomUUID()}, ${input.date}::date, ${input.start}, ${input.end}, 1, 'families', 'tour', true)
			on conflict (slot_date, start_time, end_time) do nothing`;
		const [found] = await tx`select id from tour_slots where slot_date = ${input.date}::date and start_time = ${input.start} and end_time = ${input.end}`;
		if (!found) return { ok: false as const, error: 'That time is already gone.' };
		const slotId = String(found.id);
		const result = await reserve(tx as unknown as Sql, { slotId, party: input.party, today: chicagoToday(), source: { kind: 'confirmation', holdId: input.id, message: input.message } });
		return result.ok ? { ok: true as const } : result;
	});
}

function requestParty(hold: Record<string, unknown>): ReservationParty {
	return { familyId: String(hold.family_id), name: String(hold.family_name), email: String(hold.email), phone: String(hold.phone),
		headCount: Number(hold.head_count), grades: Array.isArray(hold.grades) ? hold.grades.map(String) : [], note: String(hold.note) };
}
