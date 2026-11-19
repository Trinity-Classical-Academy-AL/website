import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { notifyStaff, portalOrigin, sendEmail } from './email.ts';
import { routeEmail } from './accounts.ts';
import { csvResponse, toCsv } from './csv.ts';
import { chicagoToday, materializeSeriesOccurrences, listSeries, listSeriesOccurrences, bookingWindowEnd, type CapacityUnit, type CancelledHold } from './schedule-series.ts';

import { sendInquiryAutoReply } from './inquiry-reply.ts';
import { inquiryDetailsText, type InterviewDetails } from './interview.ts';

const CAMPUS = '7160 Cahaba Valley Rd., Birmingham, AL 35242';
const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8'] as const;
const STATUSES = ['new', 'contacted', 'confirmed', 'cancelled', 'proposed'] as const;
const SLOT_TYPES = ['tour', 'open_house', 'info_night'] as const;

export type SlotType = (typeof SLOT_TYPES)[number];

export function slotTypeLabel(type: string): string {
	if (type === 'open_house') return 'Open house';
	if (type === 'info_night') return 'Info night';
	return 'Campus tour';
}

export type TourStatus = (typeof STATUSES)[number];

export function formatTourClock(value: string): string {
	const match = /^(\d{1,2}):(\d{2})/.exec(value);
	if (!match) return value;
	const hour = Number(match[1]);
	const suffix = hour >= 12 ? 'PM' : 'AM';
	const hour12 = hour % 12 || 12;
	return `${hour12}:${match[2]} ${suffix}`;
}

export function formatTourWhen(date: string, start: string, end: string): string {
	const [year, month, day] = date.split('-').map(Number);
	if (!year || !month || !day) return `${date} ${formatTourClock(start)}–${formatTourClock(end)}`;
	const label = new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	}).format(new Date(Date.UTC(year, month - 1, day)));
	return `${label}, ${formatTourClock(start)}–${formatTourClock(end)}`;
}

function cleanGrades(values: string[]): string[] {
	return GRADES.filter((grade) => values.includes(grade));
}

function clip(value: string, max: number): string {
	return value.trim().slice(0, max);
}

/** Kept for older callers. Tour times are only created by staff or rules. */
export async function ensureTourSlots(): Promise<void> {}

export type { CapacityUnit } from './schedule-series.ts';

export type FamilySlot = {
	id: string;
	seriesId: string;
	date: string;
	start: string;
	end: string;
	type: SlotType;
	capacity: number;
	capacityUnit: CapacityUnit;
	taken: number;
	spots: number;
	unavailable: boolean;
	mine: boolean;
};

export type FamilyHold = {
	id: string;
	kind: 'slot' | 'other';
	status: TourStatus;
	slotId: string;
	when: string;
	otherTime: string;
	grades: string[];
	note: string;
	phone: string;
	headCount: number;
	proposedWhen: string;
};

export async function familyTourView(familyId: string, today = chicagoToday()): Promise<{ slots: FamilySlot[]; holds: FamilyHold[]; summary: Awaited<ReturnType<typeof publishedTourSummary>> }> {
	await materializeSeriesOccurrences();
	const [slots, holds] = await Promise.all([db()`
		select s.id, s.series_id, s.slot_date::text as slot_date, s.start_time, s.end_time, s.capacity, s.capacity_unit, s.slot_type, s.published,
			coalesce((
				select case when s.capacity_unit = 'families' then count(distinct h.family_id) else coalesce(sum(h.head_count), 0) end from tour_holds h
				where h.slot_id = s.id and h.kind = 'slot' and h.status <> 'cancelled' and h.family_id <> ${familyId}
			), 0)::int as taken_by_others,
			exists (
				select 1 from tour_holds h
				where h.slot_id = s.id and h.family_id = ${familyId} and h.kind = 'slot' and h.status <> 'cancelled'
			) as mine
		from tour_slots s left join schedule_series series on series.id = s.series_id
		where (series.booking_window_days is null or s.slot_date <= ${today}::date + series.booking_window_days)
		and s.slot_type in ('tour', 'open_house', 'info_night')
		and ((s.slot_date >= ${today}::date and s.published) or exists (
			select 1 from tour_holds h
			where h.slot_id = s.id and h.family_id = ${familyId} and h.kind = 'slot' and h.status <> 'cancelled'
		))
		order by s.slot_date, s.start_time
	`, db()`
		select h.id, h.kind, h.status, h.slot_id, h.other_time, h.grades, h.note, h.phone, h.head_count,
			h.proposed_date::text as proposed_date, h.proposed_start, h.proposed_end,
			s.slot_date::text as slot_date, s.start_time, s.end_time
		from tour_holds h
		left join tour_slots s on s.id = h.slot_id
		where h.family_id = ${familyId} and h.status <> 'cancelled'
		order by h.created_at desc
	`]);
	return {
		summary: await publishedTourSummary(),
		slots: slots.map((row) => ({
			id: String(row.id),
			seriesId: row.series_id ? String(row.series_id) : '',
			date: String(row.slot_date),
			start: String(row.start_time),
			end: String(row.end_time),
			type: row.slot_type === 'open_house' || row.slot_type === 'info_night' ? row.slot_type : 'tour',
			capacity: Number(row.capacity),
			capacityUnit: row.capacity_unit === 'families' ? 'families' : 'people',
			taken: Number(row.taken_by_others),
			spots: Math.max(0, Number(row.capacity) - Number(row.taken_by_others)),
			unavailable: Number(row.taken_by_others) >= Number(row.capacity) && !row.mine,
			mine: Boolean(row.mine),
		})),
		holds: holds.map((row) => ({
			id: String(row.id),
			kind: row.kind === 'other' ? 'other' : 'slot',
			status: String(row.status) as TourStatus,
			slotId: row.slot_id ? String(row.slot_id) : '',
			when: row.slot_date ? formatTourWhen(String(row.slot_date), String(row.start_time), String(row.end_time)) : '',
			otherTime: String(row.other_time ?? ''),
			grades: Array.isArray(row.grades) ? row.grades.map(String) : [],
			note: String(row.note ?? ''),
			phone: String(row.phone ?? ''),
			headCount: Number(row.head_count ?? 1),
			proposedWhen: row.proposed_date ? formatTourWhen(String(row.proposed_date), String(row.proposed_start || '00:00'), String(row.proposed_end || row.proposed_start || '00:00')) : '',
		})),
	};
}

export async function saveSlotBooking(input: {
	familyId: string;
	familyName: string;
	email: string;
	phone: string;
	slotId: string;
	grades: string[];
	note: string;
	headCount?: number;
}, today = chicagoToday()): Promise<{ ok: true } | { ok: false; error: string }> {
	await materializeSeriesOccurrences();
	const grades = cleanGrades(input.grades);
	const note = clip(input.note, 2000);
	const phone = clip(input.phone, 40);
	const name = clip(input.familyName, 160) || input.email;
	const headCount = Math.min(6, Math.max(1, Math.trunc(input.headCount ?? 1) || 1));
	const saved = await withSlotLock(input.slotId, async (sql) => {
		const rows = await sql`
			select s.slot_date::text as slot_date, s.start_time, s.end_time, s.capacity, s.capacity_unit, s.slot_type, s.published,
				(select booking_window_days from schedule_series where id = s.series_id) as booking_window_days,
				coalesce((
					select case when s.capacity_unit = 'families' then count(distinct h.family_id) else coalesce(sum(h.head_count), 0) end from tour_holds h
					where h.slot_id = s.id and h.kind = 'slot' and h.status <> 'cancelled' and h.family_id <> ${input.familyId}
				), 0)::int as taken
			from tour_slots s
			where s.id = ${input.slotId}
			for update of s
		`;
		const slot = rows[0];
		if (!slot || slot.published === false || String(slot.slot_date) < today) return { ok: false as const, error: 'Choose a time to continue.' };
		const windowEnd = bookingWindowEnd(today, slot.booking_window_days == null ? null : Number(slot.booking_window_days));
		if (windowEnd && String(slot.slot_date) > windowEnd) return { ok: false as const, error: 'That time is no longer open.' };
		if (Number(slot.taken) + (slot.capacity_unit === 'families' ? 1 : headCount) > Number(slot.capacity)) return { ok: false as const, error: 'That time is full.' };
		const when = formatTourWhen(String(slot.slot_date), String(slot.start_time), String(slot.end_time));
		const slotType = String(slot.slot_type || 'tour');
		const existing = await sql`
			select id, slot_id from tour_holds
			where family_id = ${input.familyId} and kind = 'slot' and status <> 'cancelled'
			order by created_at desc
			limit 1
		`;
		const current = existing[0];
		const changed = !current || String(current.slot_id) !== input.slotId;
		if (current) {
			await sql`
				update tour_holds
				set slot_id = ${input.slotId}, family_name = ${name}, email = ${input.email}, phone = ${phone},
					grades = ${grades}, note = ${note}, head_count = ${headCount},
					status = case when slot_id is distinct from ${input.slotId} then 'new' else status end
				where id = ${current.id}
			`;
		} else {
			await sql`
				insert into tour_holds (id, family_id, slot_id, kind, status, family_name, email, phone, grades, note, head_count)
				values (${randomUUID()}, ${input.familyId}, ${input.slotId}, 'slot', 'new', ${name}, ${input.email}, ${phone}, ${grades}, ${note}, ${headCount})
			`;
		}
		return { ok: true as const, changed, when, slotType };
	});
	if (!saved.ok) return saved;
	if (saved.changed) {
		const open = { when: saved.when };
		const inbox = await routeEmail(input.familyId, 'tours', input.email);
		await sendEmail({
			to: inbox,
			subject: 'Your Trinity tour time',
			text: `Hello ${name},\n\nYou are booked for a ${slotTypeLabel(saved.slotType).toLowerCase()} on ${open.when}, for ${headCount} ${headCount === 1 ? 'person' : 'people'}.\n${CAMPUS}\n\nYou can cancel or pick a different time in the TCA Portal.\n`,
		});
		await notifyStaff('Tour booking', `${name} (${input.email}${phone ? `, ${phone}` : ''}) booked ${open.when}.${grades.length ? `\nGrades: ${grades.join(', ')}` : ''}${note ? `\nNote: ${note}` : ''}`);
	}
	return { ok: true };
}

async function withSlotLock<T>(slotId: string, task: (sql: ReturnType<typeof db>) => Promise<T>): Promise<T> {
	await dbReady();
	const result = await db().begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(hashtext(${slotId}))`;
		return task(tx as unknown as ReturnType<typeof db>);
	});
	return result as T;
}

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
}): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const days = (input.days ?? []).filter((day) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(day));
	const dayParts = (input.dayParts ?? []).filter((part) => ['Morning', 'Midday', 'Afternoon'].includes(part));
	const earliest = /^\d{4}-\d{2}-\d{2}$/.test(input.earliest ?? '') ? input.earliest! : null;
	const headCount = Math.min(6, Math.max(1, Math.trunc(input.headCount ?? 1) || 1));
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
	await sendEmail({
		to: await routeEmail(input.familyId, 'tours', input.email),
		subject: 'We received your tour time request',
		text: `Hello ${name},\n\nWe received your request for a tour at a different time: ${otherTime}.\nThe school will write back to this email.\n${CAMPUS}\n`,
	});
	await notifyStaff('Different tour time', `${name} (${input.email}${phone ? `, ${phone}` : ''}) asked for another time: ${otherTime}.${grades.length ? `\nGrades: ${grades.join(', ')}` : ''}${note ? `\nNote: ${note}` : ''}`);
	return { ok: true };
}

export async function cancelTourHold(id: string, familyId: string): Promise<boolean> {
	await dbReady();
	const rows = await db()`
		update tour_holds set status = 'cancelled'
		where id = ${id} and family_id = ${familyId} and status <> 'cancelled'
		returning family_name, email, kind, other_time, slot_id
	`;
	const row = rows[0];
	if (!row) return false;
	let when = String(row.other_time ?? '');
	if (row.slot_id) {
		const slots = await db()`select slot_date::text as slot_date, start_time, end_time from tour_slots where id = ${row.slot_id}`;
		if (slots[0]) when = formatTourWhen(String(slots[0].slot_date), String(slots[0].start_time), String(slots[0].end_time));
	}
	await notifyStaff('Tour request cancelled', `${row.family_name} (${row.email}) cancelled ${when || 'a tour request'}.`);
	await sendEmail({
		to: await routeEmail(familyId, 'tours', String(row.email)),
		subject: 'Your Trinity tour request was cancelled',
		text: `Hello ${row.family_name},\n\nYour tour request${when ? ` for ${when}` : ''} is cancelled. You can choose another time in the TCA Portal.\n`,
	});
	return true;
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

export type TourSlotSummary = {
	seriesId: string;
	id: string;
	date: string;
	start: string;
	end: string;
	when: string;
	type: string;
	capacity: number;
	capacityUnit: CapacityUnit;
	taken: number;
	families: number;
	published: boolean;
};

export async function listTourSlotSummary({ publicOnly = false, today = chicagoToday() }: { publicOnly?: boolean; today?: string } = {}): Promise<TourSlotSummary[]> {
	const slots = await listSeriesOccurrences({ publicOnly, today });
	return slots.filter(slot => SLOT_TYPES.includes(slot.type as SlotType)).map(slot => ({
		...slot, when: formatTourWhen(slot.date, slot.start, slot.end),
	}));
}

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
	if (!STATUSES.includes(status)) return;
	await db()`update tour_holds set status = ${status} where id = ${id}`;
}

export async function addTourSlot(input: { date: string; start: string; end: string; capacity: number; type?: string; published?: boolean; capacityUnit?: CapacityUnit }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
	await dbReady();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: 'Choose a date.' };
	if (!/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end) || input.start >= input.end) {
		return { ok: false, error: 'Enter a start and end time.' };
	}
	const capacity = Number.isInteger(input.capacity) && input.capacity >= 1 && input.capacity <= 500 ? input.capacity : 0;
	if (!capacity) return { ok: false, error: 'Capacity must be at least 1.' };
	const slotType = input.type === 'open_house' || input.type === 'info_night' ? input.type : 'tour';
	const published = input.published !== false;
	const existing = await db()`
		select id from tour_slots
		where slot_date = ${input.date}::date and start_time = ${input.start} and end_time = ${input.end}
	`;
	if (existing[0]) return { ok: false, error: 'That slot already exists.' };
	const id = randomUUID();
	await db()`
		insert into tour_slots (id, slot_date, start_time, end_time, capacity, capacity_unit, slot_type, published)
		values (${id}, ${input.date}::date, ${input.start}, ${input.end}, ${capacity}, ${input.capacityUnit === 'families' ? 'families' : 'people'}, ${slotType}, ${published})
	`;
	return { ok: true, id };
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

export type InquiryRow = {
	id: string;
	createdAt: string;
	status: TourStatus;
	email: string;
	name: string;
	phone: string;
	grades: string;
	message: string;
	source: string;
	details: InterviewDetails | Record<string, never>;
};

export async function createInquiry(input: {
	email: string;
	name: string;
	phone: string;
	grades: string[];
	message: string;
	source: string;
	notify?: boolean;
	details?: InterviewDetails;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
	await dbReady();
	const email = input.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter an email address like name@example.com.' };
	const name = clip(input.name, 160);
	const phone = clip(input.phone, 40);
	const message = clip(input.message, 2000);
	const source = clip(input.source, 80) || 'portal';
	const grades = cleanGrades(input.grades);
	const id = randomUUID();
	await db()`
		insert into inquiries (id, email, name, phone, grades, message, source, details)
		values (${id}, ${email}, ${name}, ${phone}, ${grades}, ${message}, ${source}, ${db().json(input.details || {})})
	`;
	// Persist first. A failed staff notice or reply must never hide a saved inquiry.
	if (input.notify) {
		try {
			await notifyStaff(
				source === 'interview' ? `New interview request: ${name}` : 'New inquiry',
				[`Name: ${name || '—'}`, `Email: ${email}`, `Phone: ${phone || '—'}`, `Grades: ${grades.join(', ') || '—'}`, `Source: ${source}`, `Message: ${message || '—'}`, inquiryDetailsText(input.details || {}), `${portalOrigin()}/admin/inquiries?inquiry=${id}`].filter(Boolean).join('\n'),
			);
		} catch { console.error('[inquiry] Staff notification failed; inquiry saved.', id); }
	}
	if (source === 'interview' || source === 'interested') {
		try { await sendInquiryAutoReply(id); }
		catch { console.error('[inquiry] Automatic reply failed; inquiry saved.', id); }
	}
	return { ok: true, id };
}

export async function listInquiries(): Promise<InquiryRow[]> {
	await dbReady();
	const rows = await db()`select id, created_at, status, email, name, phone, grades, message, source, details from inquiries order by created_at desc`;
	return rows.map((row) => ({
		id: String(row.id),
		createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
		status: String(row.status) as TourStatus,
		email: String(row.email),
		name: String(row.name ?? ''),
		phone: String(row.phone ?? ''),
		grades: Array.isArray(row.grades) ? row.grades.map(String).join(', ') : '',
		message: String(row.message ?? ''),
		source: String(row.source ?? ''),
		details: row.details && typeof row.details === 'object' ? row.details : {},
	}));
}

export async function setInquiryStatus(id: string, status: TourStatus): Promise<void> {
	await dbReady();
	if (!STATUSES.includes(status)) return;
	await db()`update inquiries set status = ${status} where id = ${id}`;
}

export function inquiriesCsv(rows: InquiryRow[]): Response {
	const body = toCsv(rows.map((row) => ({ ...row, detailsText: inquiryDetailsText(row.details) })), [
		{ key: 'createdAt', label: 'Created' },
		{ key: 'status', label: 'Status' },
		{ key: 'name', label: 'Name' },
		{ key: 'email', label: 'Email' },
		{ key: 'phone', label: 'Phone' },
		{ key: 'grades', label: 'Grades' },
		{ key: 'message', label: 'Message' },
		{ key: 'source', label: 'Source' },
		{ key: 'detailsText', label: 'Details' },
	]);
	return csvResponse('inquiries.csv', body);
}

export const TOUR_NOTE = "Tours run during a normal school day, Wednesdays and Thursdays from 8:10 to 9:00 AM. Please arrive by 8:10; we begin with chapel at 8:15. To respect our teachers' and staff's time, we wrap up by 9:00. One family per tour.";

const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
export function tourClockRange(start: string, end: string): string {
	const first = formatTourClock(start), last = formatTourClock(end);
	return `${first.slice(-2) === last.slice(-2) ? first.slice(0, -3) : first} to ${last}`;
}
export async function publishedTourSummary() {
	const rules = (await listSeries()).filter(r => r.published && r.type === 'tour');
	if (!rules.length) return null;
	const days = [...new Set(rules.flatMap(r => r.weekdays))].sort((a, b) => a - b);
	return { when: days.map(d => DAY_NAMES[d]).join(' & '), time: tourClockRange(rules[0].start, rules[0].end), note: TOUR_NOTE };
}
export async function websiteTourSlots(today = chicagoToday()) {
	const [all, summary] = await Promise.all([listTourSlotSummary({ publicOnly: true, today }), publishedTourSummary()]);
	return { summary, slots: all.filter(s => s.published && s.date >= today && s.taken < s.capacity).slice(0, 3)
		.map(s => ({ when: s.when, type: slotTypeLabel(s.type), open: s.taken < s.capacity })) };
}

export async function notifyCancelledTours(holds: CancelledHold[]) {
	for (const hold of holds) await sendEmail({
		to: await routeEmail(hold.family_id, 'tours', hold.email), subject: 'A Trinity tour time was cancelled',
		text: `Hello ${hold.family_name},\n\nThe school cancelled the tour on ${formatTourWhen(hold.slot_date, hold.start_time, hold.end_time)}. Please pick another time in the TCA Portal.\n7160 Cahaba Valley Rd., Birmingham, AL 35242\n`,
	});
}
