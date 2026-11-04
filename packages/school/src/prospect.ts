import { randomUUID } from 'node:crypto';
import { db, dbReady } from './db.ts';
import { notifyStaff, sendEmail } from './email.ts';
import { csvResponse, toCsv } from './csv.ts';

const CAMPUS = '7160 Cahaba Valley Rd., Birmingham, AL 35242';
const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8'] as const;
const STATUSES = ['new', 'contacted', 'confirmed', 'cancelled'] as const;

export type TourStatus = (typeof STATUSES)[number];

const SEED_SLOTS = [
	{ date: '2027-01-13', start: '08:00', end: '09:00' },
	{ date: '2027-02-10', start: '08:00', end: '09:00' },
	{ date: '2027-03-10', start: '08:00', end: '09:00' },
];

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

export async function ensureTourSlots(): Promise<void> {
	await dbReady();
	for (const slot of SEED_SLOTS) {
		await db()`
			insert into tour_slots (id, slot_date, start_time, end_time, capacity)
			select ${randomUUID()}, ${slot.date}::date, ${slot.start}, ${slot.end}, 1
			where not exists (
				select 1 from tour_slots
				where slot_date = ${slot.date}::date and start_time = ${slot.start} and end_time = ${slot.end}
			)
		`;
	}
}

export type FamilySlot = {
	id: string;
	date: string;
	start: string;
	end: string;
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
};

export async function familyTourView(familyId: string): Promise<{ slots: FamilySlot[]; holds: FamilyHold[] }> {
	await ensureTourSlots();
	const slots = await db()`
		select s.id, s.slot_date::text as slot_date, s.start_time, s.end_time, s.capacity,
			(
				select count(*) from tour_holds h
				where h.slot_id = s.id and h.kind = 'slot' and h.status <> 'cancelled' and h.family_id <> ${familyId}
			)::int as taken_by_others,
			exists (
				select 1 from tour_holds h
				where h.slot_id = s.id and h.family_id = ${familyId} and h.kind = 'slot' and h.status <> 'cancelled'
			) as mine
		from tour_slots s
		order by s.slot_date, s.start_time
	`;
	const holds = await db()`
		select h.id, h.kind, h.status, h.slot_id, h.other_time, h.grades, h.note, h.phone,
			s.slot_date::text as slot_date, s.start_time, s.end_time
		from tour_holds h
		left join tour_slots s on s.id = h.slot_id
		where h.family_id = ${familyId} and h.status <> 'cancelled'
		order by h.created_at desc
	`;
	return {
		slots: slots.map((row) => ({
			id: String(row.id),
			date: String(row.slot_date),
			start: String(row.start_time),
			end: String(row.end_time),
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
	await ensureTourSlots();
	const grades = cleanGrades(input.grades);
	const note = clip(input.note, 2000);
	const phone = clip(input.phone, 40);
	const name = clip(input.familyName, 160) || input.email;
	const saved = await withSlotLock(input.slotId, async (sql) => {
		const rows = await sql`
			select s.slot_date::text as slot_date, s.start_time, s.end_time, s.capacity,
				(
					select count(*) from tour_holds h
					where h.slot_id = s.id and h.kind = 'slot' and h.status <> 'cancelled' and h.family_id <> ${input.familyId}
				)::int as taken
			from tour_slots s
			where s.id = ${input.slotId}
		`;
		const slot = rows[0];
		if (!slot) return { ok: false as const, error: 'Choose a tour time.' };
		if (Number(slot.taken) >= Number(slot.capacity)) return { ok: false as const, error: 'That time is unavailable.' };
		const when = formatTourWhen(String(slot.slot_date), String(slot.start_time), String(slot.end_time));
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
					grades = ${grades}, note = ${note},
					status = case when slot_id is distinct from ${input.slotId} then 'new' else status end
				where id = ${current.id}
			`;
		} else {
			await sql`
				insert into tour_holds (id, family_id, slot_id, kind, status, family_name, email, phone, grades, note)
				values (${randomUUID()}, ${input.familyId}, ${input.slotId}, 'slot', 'new', ${name}, ${input.email}, ${phone}, ${grades}, ${note})
			`;
		}
		return { ok: true as const, changed, when };
	});
	if (!saved.ok) return saved;
	if (saved.changed) {
		const open = { when: saved.when };
		await sendEmail({
			to: input.email,
			subject: 'Your Trinity tour time',
			text: `Hello ${name},\n\nYou are booked for a campus tour on ${open.when}.\n${CAMPUS}\n\nOne family is scheduled in each time. You can cancel or pick a different time in the TCA Portal.\n`,
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
}): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const otherTime = clip(input.otherTime, 500);
	if (otherTime.length < 3) return { ok: false, error: 'Tell us what time would work.' };
	const grades = cleanGrades(input.grades);
	const note = clip(input.note, 2000);
	const phone = clip(input.phone, 40);
	const name = clip(input.familyName, 160) || input.email;
	await db()`
		insert into tour_holds (id, family_id, kind, status, family_name, email, phone, grades, note, other_time)
		values (${randomUUID()}, ${input.familyId}, 'other', 'new', ${name}, ${input.email}, ${phone}, ${grades}, ${note}, ${otherTime})
	`;
	await sendEmail({
		to: input.email,
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
		to: String(row.email),
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
};

export async function listTourSlotSummary(): Promise<{ id: string; when: string; capacity: number; taken: number }[]> {
	await ensureTourSlots();
	const rows = await db()`
		select s.id, s.slot_date::text as slot_date, s.start_time, s.end_time, s.capacity,
			(select count(*) from tour_holds h where h.slot_id = s.id and h.kind = 'slot' and h.status <> 'cancelled')::int as taken
		from tour_slots s
		order by s.slot_date, s.start_time
	`;
	return rows.map((row) => ({
		id: String(row.id),
		when: formatTourWhen(String(row.slot_date), String(row.start_time), String(row.end_time)),
		capacity: Number(row.capacity),
		taken: Number(row.taken),
	}));
}

export async function listAdminTours(): Promise<AdminTourRow[]> {
	await ensureTourSlots();
	const rows = await db()`
		select h.id, h.kind, h.status, h.family_name, h.email, h.phone, h.grades, h.note, h.other_time, h.created_at,
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
	}));
}

export async function setTourHoldStatus(id: string, status: TourStatus): Promise<void> {
	await dbReady();
	if (!STATUSES.includes(status)) return;
	await db()`update tour_holds set status = ${status} where id = ${id}`;
}

export async function addTourSlot(input: { date: string; start: string; end: string; capacity: number }): Promise<{ ok: true } | { ok: false; error: string }> {
	await ensureTourSlots();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: 'Choose a date.' };
	if (!/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end) || input.start >= input.end) {
		return { ok: false, error: 'Enter a start and end time.' };
	}
	const capacity = Number.isInteger(input.capacity) && input.capacity >= 1 && input.capacity <= 20 ? input.capacity : 1;
	const existing = await db()`
		select id from tour_slots
		where slot_date = ${input.date}::date and start_time = ${input.start} and end_time = ${input.end}
	`;
	if (existing[0]) return { ok: false, error: 'That slot already exists.' };
	await db()`
		insert into tour_slots (id, slot_date, start_time, end_time, capacity)
		values (${randomUUID()}, ${input.date}::date, ${input.start}, ${input.end}, ${capacity})
	`;
	return { ok: true };
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
};

export async function createInquiry(input: {
	email: string;
	name: string;
	phone: string;
	grades: string[];
	message: string;
	source: string;
	notify?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
	await dbReady();
	const email = input.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter an email address like name@example.com.' };
	const name = clip(input.name, 160);
	const phone = clip(input.phone, 40);
	const message = clip(input.message, 2000);
	const source = clip(input.source, 80) || 'portal';
	const grades = cleanGrades(input.grades);
	await db()`
		insert into inquiries (id, email, name, phone, grades, message, source)
		values (${randomUUID()}, ${email}, ${name}, ${phone}, ${grades}, ${message}, ${source})
	`;
	if (input.notify) {
		await notifyStaff(
			'New inquiry',
			[`Name: ${name || '—'}`, `Email: ${email}`, `Phone: ${phone || '—'}`, `Grades: ${grades.join(', ') || '—'}`, `Source: ${source}`, `Message: ${message || '—'}`].join('\n'),
		);
	}
	return { ok: true };
}

export async function listInquiries(): Promise<InquiryRow[]> {
	await dbReady();
	const rows = await db()`select id, created_at, status, email, name, phone, grades, message, source from inquiries order by created_at desc`;
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
	}));
}

export async function setInquiryStatus(id: string, status: TourStatus): Promise<void> {
	await dbReady();
	if (!STATUSES.includes(status)) return;
	await db()`update inquiries set status = ${status} where id = ${id}`;
}

export function inquiriesCsv(rows: InquiryRow[]): Response {
	const body = toCsv(rows, [
		{ key: 'createdAt', label: 'Created' },
		{ key: 'status', label: 'Status' },
		{ key: 'name', label: 'Name' },
		{ key: 'email', label: 'Email' },
		{ key: 'phone', label: 'Phone' },
		{ key: 'grades', label: 'Grades' },
		{ key: 'message', label: 'Message' },
		{ key: 'source', label: 'Source' },
	]);
	return csvResponse('inquiries.csv', body);
}
