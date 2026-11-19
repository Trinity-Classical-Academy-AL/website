import { randomUUID } from 'node:crypto';
import { db, dbReady, type Sql } from './db.ts';
import { formatTourClock, formatTourWhen, slotTypeLabel, type CapacityUnit } from './prospect.ts';
import { routeEmail } from './accounts.ts';
import { sendEmail } from './email.ts';

export const TOUR_NOTE = "Tours run during a normal school day, Wednesdays and Thursdays from 8:10 to 9:00 AM. Please arrive by 8:10; we begin with chapel at 8:15. To respect our teachers' and staff's time, we wrap up by 9:00. One family per tour.";
export const chicagoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const TODAY = "(now() at time zone 'America/Chicago')::date";

// One bounded insert for all rules; the unique time key also protects one-offs.
// Lock rules before inserting so edits/skips/deletions cannot race regeneration.
async function materialize(sql: Sql) {
	await sql.unsafe(`
		with rules as materialized (select * from tour_slot_rules order by id for update)
		insert into tour_slots (id, rule_id, slot_date, start_time, end_time, capacity, capacity_unit, slot_type, published)
		select gen_random_uuid(), r.id, d::date, r.start_time, r.end_time, r.capacity, r.capacity_unit, r.slot_type, r.published
		from rules r cross join lateral generate_series(
			greatest(${TODAY}, r.starts_on)::timestamp,
			least(r.ends_on, ${TODAY} + 56)::timestamp, interval '1 day') d
		where extract(dow from d)::int = any(r.weekdays) and not (d::date = any(r.skip_dates))
		on conflict (slot_date, start_time, end_time) do nothing
	`);
}
let generating: Promise<void> | undefined;
export async function materializeTourOccurrences(): Promise<void> {
	await dbReady();
	// Concurrent list calls within the same render share this single round trip.
	if (!generating) generating = materialize(db()).finally(() => { generating = undefined; });
	await generating;
}

export type TourRule = {
	id: string; type: string; weekdays: number[]; start: string; end: string;
	startsOn: string; endsOn: string; capacity: number; capacityUnit: CapacityUnit;
	published: boolean; skipDates: string[]; families: number;
};
export async function listTourRules(): Promise<TourRule[]> {
	await dbReady();
	const rows = await db().unsafe(`select r.*, r.starts_on::text, r.ends_on::text,
		array(select x::text from unnest(r.skip_dates) x) as skipped,
		(select count(*)::int from tour_holds h join tour_slots s on s.id = h.slot_id
		 where s.rule_id = r.id and s.slot_date >= ${TODAY} and h.kind = 'slot' and h.status <> 'cancelled') as families
		from tour_slot_rules r order by r.created_at, r.id`);
	return rows.map(r => ({ id: String(r.id), type: String(r.slot_type), weekdays: r.weekdays.map(Number),
		start: String(r.start_time), end: String(r.end_time), startsOn: String(r.starts_on), endsOn: String(r.ends_on),
		capacity: Number(r.capacity), capacityUnit: r.capacity_unit === 'people' ? 'people' : 'families',
		published: Boolean(r.published), skipDates: r.skipped.map(String), families: Number(r.families) }));
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
export function nextRuleDates(rule: TourRule, today = chicagoToday()): string[] {
	const dates: string[] = [];
	const date = new Date(`${rule.startsOn > today ? rule.startsOn : today}T12:00:00Z`);
	while (dates.length < 8 && date.toISOString().slice(0, 10) <= rule.endsOn) {
		if (rule.weekdays.includes(date.getUTCDay())) dates.push(date.toISOString().slice(0, 10));
		date.setUTCDate(date.getUTCDate() + 1);
	}
	return dates;
}
export function tourClockRange(start: string, end: string): string {
	const first = formatTourClock(start), last = formatTourClock(end);
	return `${first.slice(-2) === last.slice(-2) ? first.slice(0, -3) : first} to ${last}`;
}
export async function publishedTourSummary() {
	const rules = (await listTourRules()).filter(r => r.published && r.type === 'tour');
	if (!rules.length) return null;
	const days = [...new Set(rules.flatMap(r => r.weekdays))].sort((a, b) => a - b);
	return { when: days.map(d => DAY_NAMES[d]).join(' & '), time: tourClockRange(rules[0].start, rules[0].end), note: TOUR_NOTE };
}
export async function websiteTourSlots() {
	// Import here keeps the shared list implementation as the capacity source of truth.
	const { listTourSlotSummary } = await import('./prospect.ts');
	const [all, summary] = await Promise.all([listTourSlotSummary(), publishedTourSummary()]);
	const today = chicagoToday();
	return { summary, slots: all.filter(s => s.published && s.date >= today && s.taken < s.capacity).slice(0, 3)
		.map(s => ({ when: s.when, type: slotTypeLabel(s.type), open: s.taken < s.capacity })) };
}

export type RuleInput = {
	id?: string; type?: string; weekdays: number[]; start: string; end: string;
	startsOn: string; endsOn: string; capacity: number; capacityUnit: CapacityUnit; published: boolean;
};
const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export async function saveTourRule(input: RuleInput): Promise<{ ok: true; id: string } | { ok: false; error: string; fields?: Record<string, string> }> {
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
	if (Object.keys(fields).length) return { ok: false, error: 'Check the marked fields.', fields };
	const id = input.id || randomUUID();
	return await db().begin(async tx => {
		if (input.id && !(await tx`select id from tour_slot_rules where id = ${id} for update`)[0]) return { ok: false as const, error: 'That time is already gone.' };
		const data = { slot_type: ['open_house', 'info_night'].includes(input.type ?? '') ? input.type! : 'tour', weekdays,
			start_time: input.start, end_time: input.end, starts_on: input.startsOn, ends_on: input.endsOn,
			capacity: input.capacity, capacity_unit: input.capacityUnit === 'people' ? 'people' : 'families', published: input.published };
		if (input.id) {
			await tx`update tour_slot_rules set ${tx(data)} where id = ${id}`;
			// Booking also locks the slot row. Recheck active holds after taking those locks.
			await tx`select id from tour_slots where rule_id = ${id} order by id for update`;
			await tx.unsafe(`delete from tour_slots s using tour_slot_rules r where s.rule_id = r.id and r.id = $1
				and s.slot_date >= ${TODAY} and not exists (select 1 from tour_holds h where h.slot_id = s.id and h.status <> 'cancelled')
				and (s.slot_date < r.starts_on or s.slot_date > r.ends_on or not (extract(dow from s.slot_date)::int = any(r.weekdays))
				or s.slot_date = any(r.skip_dates) or s.start_time <> r.start_time or s.end_time <> r.end_time)`, [id]);
			await tx.unsafe(`update tour_slots s set capacity = r.capacity, capacity_unit = r.capacity_unit, published = r.published, slot_type = r.slot_type
				from tour_slot_rules r where s.rule_id = r.id and r.id = $1 and s.slot_date >= ${TODAY}
				and not exists (select 1 from tour_holds h where h.slot_id = s.id and h.status <> 'cancelled')`, [id]);
		} else await tx`insert into tour_slot_rules ${tx({ id, ...data })}`;
		// Generate after committing, so concurrent list calls see the complete edit.
		return { ok: true as const, id };
	}).then(async result => { if (result.ok) await materializeTourOccurrences(); return result; });
}

type CancelledHold = { family_id: string; family_name: string; email: string; slot_date: string; start_time: string; end_time: string };
/** Caller locks the slots first; cancellation and deletion commit atomically. */
export async function removeTourSlots(sql: Sql, ids: string[]): Promise<CancelledHold[]> {
	if (!ids.length) return [];
	const holds = await sql`select h.family_id, h.family_name, h.email, s.slot_date::text, s.start_time, s.end_time
		from tour_holds h join tour_slots s on s.id = h.slot_id where s.id = any(${ids}::uuid[]) and h.status <> 'cancelled'`;
	await sql`update tour_holds set status = 'cancelled' where slot_id = any(${ids}::uuid[]) and status <> 'cancelled'`;
	await sql`delete from tour_slots where id = any(${ids}::uuid[])`;
	return holds as unknown as CancelledHold[];
}
export async function notifyCancelledTours(holds: CancelledHold[]) {
	for (const hold of holds) await sendEmail({
		to: await routeEmail(hold.family_id, 'tours', hold.email), subject: 'A Trinity tour time was cancelled',
		text: `Hello ${hold.family_name},\n\nThe school cancelled the tour on ${formatTourWhen(hold.slot_date, hold.start_time, hold.end_time)}. Please pick another time in the TCA Portal.\n7160 Cahaba Valley Rd., Birmingham, AL 35242\n`,
	});
}
export async function skipTourRuleDate(id: string, date: string, restore = false) {
	await dbReady();
	if (!validDate(date)) return { ok: false, error: 'Enter a date.' };
	const result = await db().begin(async tx => {
		const [rule] = await tx`select id from tour_slot_rules where id = ${id} for update`;
		if (!rule) return null;
		if (restore) { await tx`update tour_slot_rules set skip_dates = array_remove(skip_dates, ${date}::date) where id = ${id}`; return []; }
		await tx`update tour_slot_rules set skip_dates = array_append(array_remove(skip_dates, ${date}::date), ${date}::date) where id = ${id}`;
		const slots = await tx`select id from tour_slots where rule_id = ${id} and slot_date = ${date}::date order by id for update`;
		return removeTourSlots(tx as unknown as Sql, slots.map(s => String(s.id)));
	});
	if (!result) return { ok: false, error: 'That time is already gone.' };
	await notifyCancelledTours(result);
	if (restore) await materializeTourOccurrences();
	return { ok: true, notified: result.length };
}
export async function deleteTourRule(id: string) {
	await dbReady();
	const holds = await db().begin(async tx => {
		if (!(await tx`select id from tour_slot_rules where id = ${id} for update`)[0]) return null;
		const slots = await tx.unsafe(`select id from tour_slots where rule_id = $1 and slot_date >= ${TODAY} order by id for update`, [id]);
		const holds = await removeTourSlots(tx as unknown as Sql, slots.map(s => String(s.id)));
		await tx`delete from tour_slot_rules where id = ${id}`;
		return holds;
	});
	if (!holds) return { ok: false, error: 'That time is already gone.' };
	await notifyCancelledTours(holds);
	return { ok: true };
}
