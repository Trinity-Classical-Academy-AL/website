import { slotAvailability } from './availability.ts';
import { cancelHolds, type CancelledHold } from './cancel.ts';
import type { Result } from '../result.ts';
import { randomUUID } from 'node:crypto';
import { db, dbReady, type Sql } from '../db.ts';

export type { CancelledHold } from './cancel.ts';
export type CapacityUnit = 'people' | 'families';

export const chicagoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const TODAY = "(now() at time zone 'America/Chicago')::date";

// One bounded insert for all series; the unique time key also protects one-offs.
// Lock series before inserting so edits/skips/deletions cannot race regeneration.
async function materialize(sql: Sql) {
	await sql.unsafe(`
		with rules as materialized (select * from schedule_series order by id for update)
		insert into tour_slots (id, series_id, slot_date, start_time, end_time, capacity, capacity_unit, slot_type, published)
		select gen_random_uuid(), r.id, d::date, r.start_time, r.end_time, r.capacity, r.capacity_unit, r.slot_type, r.published
		from rules r cross join lateral generate_series(
			r.starts_on::timestamp,
			least(r.ends_on, (r.starts_on + interval '1 year')::date)::timestamp, interval '1 day') d
		where extract(dow from d)::int = any(r.weekdays) and not (d::date = any(r.skip_dates))
		and not exists (select 1 from tour_slots s where s.slot_date = d::date
			and ((s.start_time = r.start_time and s.end_time = r.end_time)
				or (s.series_id = r.id and d::date < ${TODAY})))
		on conflict (slot_date, start_time, end_time) do nothing
	`);
}
let generating: Promise<void> | undefined;
export async function materializeSeriesOccurrences(): Promise<void> {
	await dbReady();
	// Concurrent list calls within the same render share this single round trip.
	if (!generating) generating = materialize(db()).finally(() => { generating = undefined; });
	await generating;
}

export type ScheduleSeries = {
	id: string; type: string; weekdays: number[]; start: string; end: string;
	startsOn: string; endsOn: string; capacity: number; capacityUnit: CapacityUnit;
	published: boolean; bookingWindowDays: number | null; skipDates: string[]; families: number;
};
export async function listSeries(): Promise<ScheduleSeries[]> {
	await dbReady();
	const rows = await db().unsafe(`select r.*, r.starts_on::text, r.ends_on::text,
		array(select x::text from unnest(r.skip_dates) x) as skipped,
		(select count(*)::int from tour_holds h join tour_slots s on s.id = h.slot_id
		 where s.series_id = r.id and s.slot_date >= ${TODAY} and h.kind = 'slot' and h.status <> 'cancelled') as families
		from schedule_series r order by r.created_at, r.id`);
	return rows.map(r => ({ id: String(r.id), type: String(r.slot_type), weekdays: r.weekdays.map(Number),
		start: String(r.start_time), end: String(r.end_time), startsOn: String(r.starts_on), endsOn: String(r.ends_on),
		capacity: Number(r.capacity), capacityUnit: r.capacity_unit === 'people' ? 'people' : 'families',
		published: Boolean(r.published), bookingWindowDays: r.booking_window_days === null ? null : Number(r.booking_window_days), skipDates: r.skipped.map(String), families: Number(r.families) }));
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function nextSeriesDates(rule: ScheduleSeries, today = chicagoToday()): string[] {
	const dates: string[] = [];
	const limit = new Date(`${rule.startsOn}T12:00:00Z`);
	limit.setUTCFullYear(limit.getUTCFullYear() + 1);
	const date = new Date(`${rule.startsOn > today ? rule.startsOn : today}T12:00:00Z`);
	while (date.toISOString().slice(0, 10) <= rule.endsOn && date <= limit) {
		if (rule.weekdays.includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
		date.setUTCDate(date.getUTCDate() + 1);
	}
	return dates;
}
export type SeriesInput = {
	id?: string; type?: string; weekdays: number[]; start: string; end: string;
	startsOn: string; endsOn: string; capacity: number; capacityUnit: CapacityUnit; published: boolean; bookingWindowDays?: number | null;
};
const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export async function saveSeries(input: SeriesInput): Promise<Result<{ id: string }, { fields?: Record<string, string> }>> {
	await dbReady();
	const fields: Record<string, string> = {};
	const weekdays = [...new Set(input.weekdays)].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort();
	if (!weekdays.length) fields.weekdays = 'Choose at least one weekday.';
	if (!validDate(input.startsOn)) fields.startsOn = 'Enter a date.';
	if (!validDate(input.endsOn)) fields.endsOn = 'Enter a date.';
	if (!fields.startsOn && !fields.endsOn) {
		const limit = new Date(input.startsOn); limit.setUTCFullYear(limit.getUTCFullYear() + 1);
		if (input.endsOn <= input.startsOn) fields.endsOn = 'End must be after start.';
		else if (new Date(input.endsOn) > limit) fields.endsOn = 'Choose a range of one year or less.';
	}
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.end) || input.start >= input.end) fields.end = 'End must be after start.';
	if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 500) fields.capacity = 'Capacity must be between 1 and 500.';
	if (input.bookingWindowDays != null && (!Number.isInteger(input.bookingWindowDays) || input.bookingWindowDays < 0)) fields.bookingWindowDays = 'Choose a booking window.';
	if (Object.keys(fields).length) return { ok: false, error: 'Check the marked fields.', fields };
	const id = input.id || randomUUID();
	return await db().begin(async tx => {
		if (input.id && !(await tx`select id from schedule_series where id = ${id} for update`)[0]) return { ok: false as const, error: 'That time is already gone.' };
		const data = { slot_type: input.type?.trim() || 'tour', weekdays,
			start_time: input.start, end_time: input.end, starts_on: input.startsOn, ends_on: input.endsOn,
			capacity: input.capacity, capacity_unit: input.capacityUnit === 'people' ? 'people' : 'families', published: input.published, booking_window_days: input.bookingWindowDays ?? null };
		if (input.id) {
			await tx`update schedule_series set ${tx(data)} where id = ${id}`;
			// Booking also locks the slot row. Recheck active holds after taking those locks.
			await tx`select id from tour_slots where series_id = ${id} order by id for update`;
			await tx.unsafe(`delete from tour_slots s using schedule_series r where s.series_id = r.id and r.id = $1
				and s.slot_date >= ${TODAY} and not exists (select 1 from tour_holds h where h.slot_id = s.id and h.status <> 'cancelled')
				and (s.slot_date < r.starts_on or s.slot_date > r.ends_on or not (extract(dow from s.slot_date)::int = any(r.weekdays))
				or s.slot_date = any(r.skip_dates) or s.start_time <> r.start_time or s.end_time <> r.end_time)`, [id]);
			await tx.unsafe(`update tour_slots s set capacity = r.capacity, capacity_unit = r.capacity_unit, published = r.published, slot_type = r.slot_type
				from schedule_series r where s.series_id = r.id and r.id = $1 and s.slot_date >= ${TODAY}
				and not exists (select 1 from tour_holds h where h.slot_id = s.id and h.status <> 'cancelled')`, [id]);
		} else await tx`insert into schedule_series ${tx({ id, ...data })}`;
		// Generate after committing, so concurrent list calls see the complete edit.
		return { ok: true as const, id };
	}).then(async result => { if (result.ok) await materializeSeriesOccurrences(); return result; });
}

/** Caller locks the slots first; cancellation and deletion commit atomically. */
export async function removeSlotOccurrences(sql: Sql, ids: string[]): Promise<CancelledHold[]> {
	if (!ids.length) return [];
	const holds = await cancelHolds(sql, { slotIds: ids });
	await sql`delete from tour_slots where id = any(${ids}::uuid[])`;
	return holds.map(h => ({ family_id: h.family_id, family_name: h.family_name, email: h.email, slot_date: h.slot_date!, start_time: h.start_time!, end_time: h.end_time! }));
}
export async function skipSeriesDate(id: string, date: string, restore = false): Promise<Result<{ cancelledHolds: CancelledHold[] }>> {
	await dbReady();
	if (!validDate(date)) return { ok: false, error: 'Enter a date.' };
	const result = await db().begin(async tx => {
		const [rule] = await tx`select id from schedule_series where id = ${id} for update`;
		if (!rule) return null;
		if (restore) { await tx`update schedule_series set skip_dates = array_remove(skip_dates, ${date}::date) where id = ${id}`; return []; }
		await tx`update schedule_series set skip_dates = array_append(array_remove(skip_dates, ${date}::date), ${date}::date) where id = ${id}`;
		const slots = await tx`select id from tour_slots where series_id = ${id} and slot_date = ${date}::date order by id for update`;
		return removeSlotOccurrences(tx as unknown as Sql, slots.map(s => String(s.id)));
	});
	if (!result) return { ok: false, error: 'That time is already gone.' };
	if (restore) await materializeSeriesOccurrences();
	return { ok: true, cancelledHolds: result };
}
export async function deleteSeries(id: string): Promise<Result<{ cancelledHolds: CancelledHold[] }>> {
	await dbReady();
	const holds = await db().begin(async tx => {
		if (!(await tx`select id from schedule_series where id = ${id} for update`)[0]) return null;
		const slots = await tx.unsafe(`select id from tour_slots where series_id = $1 and slot_date >= ${TODAY} order by id for update`, [id]);
		const holds = await removeSlotOccurrences(tx as unknown as Sql, slots.map(s => String(s.id)));
		await tx`delete from schedule_series where id = ${id}`;
		return holds;
	});
	if (!holds) return { ok: false, error: 'That time is already gone.' };
	return { ok: true, cancelledHolds: holds };
}

export const restoreSeriesDate = (id: string, date: string) => skipSeriesDate(id, date, true);

export { bookingWindowEnd } from './window.ts';

export async function listSeriesOccurrences({ slotType, publicOnly = false, today = chicagoToday() }: {
	slotType?: string; publicOnly?: boolean; today?: string;
} = {}) {
	await materializeSeriesOccurrences();
	const rows = await db()`
		select s.id, s.series_id, s.slot_date::text as slot_date, s.start_time, s.end_time, s.capacity, s.capacity_unit, s.slot_type, s.published,
			availability.taken, availability.families
		from tour_slots s left join schedule_series series on series.id = s.series_id
		cross join lateral (${slotAvailability(db())}) availability
		where (${slotType ?? null}::text is null or s.slot_type = ${slotType ?? null})
		and (${publicOnly} = false or (s.published and s.slot_date >= ${today}::date
			and (series.booking_window_days is null or s.slot_date <= ${today}::date + series.booking_window_days)))
		order by s.slot_date, s.start_time
	`;
	return rows.map(row => ({
		id: String(row.id), seriesId: row.series_id ? String(row.series_id) : '', date: String(row.slot_date),
		start: String(row.start_time), end: String(row.end_time), type: String(row.slot_type),
		capacity: Number(row.capacity), capacityUnit: row.capacity_unit as CapacityUnit,
		taken: Number(row.taken), families: Number(row.families), published: Boolean(row.published),
	}));
}
