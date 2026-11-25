import { CAMPUS } from '../campus.ts';
import { portalOrigin } from '../email.ts';
import { sendTemplate } from '../email-catalog.ts';
import { reserve } from '../scheduling/reserve.ts';
import { cancelHolds } from '../scheduling/cancel.ts';
import type { Result } from '../result.ts';
import { db, dbReady, type Sql } from '../db.ts';
import { sendEmail, notifyStaff } from '../email.ts';
import { routeEmail } from '../accounts.ts';
import { csvResponse, toCsv } from '../csv.ts';
import { chicagoToday, materializeSeriesOccurrences } from '../scheduling/schedule-series.ts';
import { cleanGrades, clip } from '../contact-input.ts';
import { TOUR_STATUSES, formatTourWhen, slotTypeLabel, type TourStatus } from './model.ts';

export async function saveSlotBooking(input: {
	familyId: string;
	familyName: string;
	email: string;
	phone: string;
	slotId: string;
	grades: string[];
	note: string;
	headCount?: number;
}, today = chicagoToday()): Promise<Result> {
	await materializeSeriesOccurrences();
	const grades = cleanGrades(input.grades);
	const note = clip(input.note, 2000);
	const phone = clip(input.phone, 40);
	const name = clip(input.familyName, 160) || input.email;
	const headCount = Math.max(1, Math.trunc(input.headCount ?? 1) || 1);
	const saved = await db().begin(tx => reserve(tx as unknown as Sql, {
		slotId: input.slotId, party: { familyId: input.familyId, name, email: input.email, phone, headCount, grades, note },
		today, source: { kind: 'booking' },
	}));
	if (!saved.ok) return saved;
	if (saved.changed) {
		const open = { when: formatTourWhen(saved.slot.date, saved.slot.start, saved.slot.end) };
		const inbox = await routeEmail(input.familyId, 'tours', input.email);
		const interview = saved.slot.type === 'interview';
		// Where: the time's location (the campus when blank), and its video link if it has one.
		const where = [saved.slot.location || CAMPUS, saved.slot.meetingUrl && `Join online: ${saved.slot.meetingUrl}`].filter(Boolean).join('\n');
		if (interview) await sendTemplate('interview.booked', inbox, { name, when: open.when, campus: where, link: `${portalOrigin()}/applications` });
		else await sendTemplate('tour.booked', inbox, { name, when: open.when, people: `${headCount} ${headCount === 1 ? 'person' : 'people'}`, campus: where, link: `${portalOrigin()}/tour` });
		await notifyStaff(`${name} booked ${interview ? 'an interview' : 'a tour'} (${open.when})`, `${name} (${input.email}${phone ? `, ${phone}` : ''}) booked ${open.when}.${grades.length ? `\nGrades: ${grades.join(', ')}` : ''}${note ? `\nNote: ${note}` : ''}`, { except: [inbox, input.email] });
	}
	return { ok: true };
}

export async function cancelTourHold(id: string, familyId: string): Promise<boolean> {
	await dbReady();
	const rows = await cancelHolds(db(), { id, familyId });
	const row = rows[0];
	if (!row) return false;
	let when = String(row.other_time ?? '');
	if (row.slot_id) {
		const slots = await db()`select slot_date::text as slot_date, start_time, end_time from tour_slots where id = ${row.slot_id}`;
		if (slots[0]) when = formatTourWhen(String(slots[0].slot_date), String(slots[0].start_time), String(slots[0].end_time));
	}
	const inbox = await routeEmail(familyId, 'tours', String(row.email));
	await notifyStaff(`${row.family_name} cancelled their tour${when ? ` (${when})` : ''}`, `${row.family_name} (${row.email}) cancelled ${when || 'their tour request'}.`, { except: [inbox, String(row.email)] });
	await sendTemplate('tour.cancelled', inbox, { name: String(row.family_name), when: when ? `for ${when}` : '', link: `${portalOrigin()}/tour` });
	return true;
}

/**
 * Staff cancel one booking (a tour or an interview) from the calendar. No email:
 * the school writes to the family itself, so the portal never locks it in.
 */
export async function staffCancelHold(id: string): Promise<boolean> {
	await dbReady();
	return (await cancelHolds(db(), { id })).length > 0;
}

export type AdminTourRow = {
	id: string;
	kind: 'slot' | 'other';
	status: TourStatus;
	when: string;
	otherTime: string;
	familyName: string;
	email: string;
	phone: string;
	grades: string;
	note: string;
	createdAt: string;
	headCount: number;
	slotId: string;
};

export async function listAdminTours(): Promise<AdminTourRow[]> {
	await materializeSeriesOccurrences();
	const rows = await db()`
		select h.id, h.kind, h.status, h.family_name, h.email, h.phone, h.grades, h.note, h.other_time, h.created_at, h.head_count, h.slot_id,
			s.slot_date::text as slot_date, s.start_time, s.end_time
		from tour_holds h
		left join tour_slots s on s.id = h.slot_id
		order by s.slot_date nulls last, s.start_time nulls last, h.created_at desc
	`;
	return rows.map((row) => ({
		id: String(row.id),
		kind: row.kind === 'other' ? 'other' : 'slot',
		status: String(row.status) as TourStatus,
		when: row.slot_date ? formatTourWhen(String(row.slot_date), String(row.start_time), String(row.end_time)) : '',
		otherTime: String(row.other_time ?? ''),
		familyName: String(row.family_name),
		email: String(row.email),
		phone: String(row.phone ?? ''),
		grades: Array.isArray(row.grades) ? row.grades.map(String).join(', ') : '',
		note: String(row.note ?? ''),
		createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
		headCount: Number(row.head_count ?? 1),
		slotId: row.slot_id ? String(row.slot_id) : '',
	}));
}

export async function setTourHoldStatus(id: string, status: TourStatus): Promise<void> {
	await dbReady();
	if (!Object.values(TOUR_STATUSES).includes(status)) return;
	await db()`update tour_holds set status = ${status} where id = ${id}`;
}

export function tourHoldsCsv(rows: AdminTourRow[]): Response {
	const body = toCsv(
		rows.map((row) => ({
			...row,
			kind: row.kind === 'other' ? 'other time' : 'slot',
			when: row.when || row.otherTime,
		})),
		[
			{ key: 'createdAt', label: 'Created' },
			{ key: 'kind', label: 'Kind' },
			{ key: 'status', label: 'Status' },
			{ key: 'when', label: 'When' },
			{ key: 'familyName', label: 'Family' },
			{ key: 'email', label: 'Email' },
			{ key: 'phone', label: 'Phone' },
			{ key: 'grades', label: 'Grades' },
			{ key: 'note', label: 'Note' },
		],
	);
	return csvResponse('tour-requests.csv', body);
}
